/**
 * Platform Configuration
 *
 * Reads SOCIAL_TARGETS from env. Each entry is one (platform, instanceUrl, token)
 * tuple. The queue creates one task per entry per published post.
 *
 * SOCIAL_TARGETS format (JSON-encoded array, base64 not required, just careful quoting):
 *
 *   [
 *     { "platform": "telegraph", "subPlatform": "" },
 *     { "platform": "nostr", "subPlatform": "" },
 *     { "platform": "mastodon", "subPlatform": "mastodon.social" },
 *     { "platform": "bluesky", "subPlatform": "" },
 *     { "platform": "medium", "subPlatform": "" }
 *   ]
 *
 * The actual auth tokens for each platform live in their own env vars
 * (e.g. MEDIUM_INTEGRATION_TOKEN, BLUESKY_HANDLE / BLUESKY_APP_PASSWORD,
 * MASTODON_<HOST>_TOKEN, etc.) and are read by their adapters at post-time.
 *
 * Platform "kind" tells the content builder which payload shape to use.
 */

const PLATFORM_KIND = {
    medium: 'article',
    telegraph: 'article',
    writefreely: 'article',

    mastodon: 'microblog',
    pleroma: 'microblog',
    misskey: 'microblog',
    calckey: 'microblog',
    iceshrimp: 'microblog',
    friendica: 'microblog',
    gotosocial: 'microblog',
    bluesky: 'microblog',
    nostr: 'microblog',
    twitter: 'microblog',
    tumblr: 'microblog',
    plurk: 'microblog',
    mistly: 'microblog',
};

function getPlatformKind(platform) {
    return PLATFORM_KIND[platform] || null;
}

function listPlatformConfigs() {
    const raw = process.env.SOCIAL_TARGETS || '[]';
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            console.warn('[Social] SOCIAL_TARGETS is not an array, ignoring');
            return [];
        }
        // Filter to known platforms
        return parsed.filter((c) => c && c.platform && PLATFORM_KIND[c.platform]);
    } catch (err) {
        console.warn('[Social] SOCIAL_TARGETS parse error:', err.message);
        return [];
    }
}

module.exports = {
    getPlatformKind,
    listPlatformConfigs,
    PLATFORM_KIND,
};
