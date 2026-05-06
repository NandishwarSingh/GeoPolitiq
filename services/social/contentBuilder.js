/**
 * Content Builder
 *
 * Translates a Post + platform config into the platform-specific payload.
 * Different platforms have different shapes:
 *
 *   - Article-syndication (Medium, WriteFreely, Telegra.ph):
 *       { kind: 'article', title, bodyHtml, canonicalUrl, tags, image }
 *
 *   - Microblog (Mastodon, Bluesky, Nostr, etc.):
 *       { kind: 'microblog', text, url, image, tags }
 *
 *   - Image-first (Pixelfed if added later):
 *       { kind: 'image', caption, image }
 *
 * The teaser format for microblogs is:
 *     <hook (truncated)>\n\n<3-5 hashtags> <UTM-tagged URL>
 */

const { getPlatformKind } = require('./platformConfig');

const SITE_URL = (process.env.SITE_URL || 'https://geopolitiq.com').replace(/\/$/, '');

const CHAR_LIMITS = {
    mastodon: 500,
    pleroma: 5000,
    misskey: 3000,
    calckey: 3000,
    iceshrimp: 3000,
    friendica: 8000,
    gotosocial: 500,
    bluesky: 300,
    nostr: 2000,        // softly capped — relays accept more but readers prefer short
    twitter: 280,
    plurk: 360,
    tumblr: 4096,
    mistly: 500,
};

// Platforms whose communities reject tracking parameters (privacy bots
// will publicly flag and strip them). For these we send the bare canonical URL.
const NO_UTM_PLATFORMS = new Set(['nostr']);

function buildUtmUrl(post, platform) {
    const base = `${SITE_URL}/post/${post.slug}`;
    if (NO_UTM_PLATFORMS.has(platform)) return base;
    const params = new URLSearchParams({
        utm_source: platform,
        utm_medium: 'social',
        utm_campaign: 'auto_repost',
    });
    return `${base}?${params.toString()}`;
}

function buildHashtags(tags = [], topicCluster = '', max = 4) {
    const all = [];
    // Topic cluster first (USA, EUROPE, INDIA, UK, MIDDLE_EAST)
    if (topicCluster) {
        const cluster = topicCluster.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (cluster) all.push('#' + cluster);
    }
    // Then a default genre tag
    all.push('#geopolitics');
    // Then up to (max - already_added) post tags, kebab → camel for hashtag readability
    for (const t of tags) {
        if (all.length >= max) break;
        const slug = String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (!slug) continue;
        const tag = '#' + slug;
        if (!all.includes(tag)) all.push(tag);
    }
    return all.slice(0, max).join(' ');
}

/**
 * Trim text to fit a platform's char limit, leaving room for hashtags + URL.
 * URL counts as either its raw length OR a fixed 23 chars on platforms that
 * auto-shorten (we conservatively use raw length for everyone — overshoots
 * are safer than undershoots).
 */
function fitMicroblog({ hook, hashtags, url, charLimit }) {
    const trailer = `\n\n${hashtags} ${url}`;
    const max = charLimit - trailer.length - 5; // 5-char safety buffer
    if (max < 60) {
        // Platform too tight — just send url + hashtags, no hook
        return `${hashtags} ${url}`.substring(0, charLimit);
    }
    let text = hook.length > max ? hook.substring(0, max - 1).trimEnd() + '…' : hook;
    return `${text}${trailer}`;
}

function buildMicroblogPayload(post, platform) {
    const charLimit = CHAR_LIMITS[platform] || 500;
    const url = buildUtmUrl(post, platform);
    const hashtags = buildHashtags(post.tags, post.topicCluster, 4);
    const hook = (post.tldr || post.title || '').trim();
    const text = fitMicroblog({ hook, hashtags, url, charLimit });
    return {
        kind: 'microblog',
        text,
        url,
        image: post.featuredImage || null,
        imageAlt: post.imageAlt || post.title || '',
        tags: post.tags || [],
    };
}

function buildArticlePayload(post, platform) {
    const canonicalUrl = `${SITE_URL}/post/${post.slug}`;
    return {
        kind: 'article',
        title: post.title,
        subtitle: post.tldr || '',
        bodyHtml: post.bodyHtml || '',
        bodyMarkdown: post.rawContent || '',
        canonicalUrl,                           // SEO win for Medium / WriteFreely
        tags: (post.tags || []).slice(0, 5),
        image: post.featuredImage || null,
        imageAlt: post.imageAlt || post.title,
    };
}

/**
 * Public entry point. Returns the payload for a given (post, platform-config) pair.
 * Throws on validation failure (e.g. missing required fields) so the queue can
 * mark the task `content` failure (no retry).
 */
function buildPayload(post, { platform, subPlatform }) {
    if (!post || !post.title || !post.slug) {
        throw new Error('Post missing required fields (title/slug)');
    }
    const kind = getPlatformKind(platform);
    if (kind === 'article') return buildArticlePayload(post, platform);
    if (kind === 'microblog') return buildMicroblogPayload(post, platform);
    throw new Error(`Unknown platform kind for ${platform}`);
}

module.exports = { buildPayload, buildUtmUrl, buildHashtags };
