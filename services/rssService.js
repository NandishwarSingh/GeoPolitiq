/**
 * RSS Feed Service for GeoPolitiq
 * Generates RSS 2.0 compliant feeds with content namespaces
 */

const Post = require('../models/Post');

const SITE_URL = process.env.SITE_URL || 'https://geopolitiq.com';
const SITE_NAME = process.env.SITE_NAME || 'GeoPolitiq';

/**
 * Escape special XML characters
 */
function escapeXml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Format date as RFC 822 (required by RSS 2.0)
 * Example: "Wed, 11 Dec 2024 18:30:00 +0000"
 */
function formatRFC822Date(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toUTCString();
}

/**
 * Generate a single RSS item from a post
 */
function generateItem(post) {
    const link = `${SITE_URL}/post/${post.slug}`;
    const pubDate = formatRFC822Date(post.publishTime || post.createdAt);

    // Categories from tags
    const categories = (post.tags || [])
        .map(tag => `        <category>${escapeXml(tag)}</category>`)
        .join('\n');

    // Enclosure for featured image (if exists)
    const enclosure = post.featuredImage
        ? `        <enclosure url="${escapeXml(post.featuredImage)}" type="image/jpeg" length="0"/>`
        : '';

    // Topic cluster as additional category
    const topicCategory = post.topicCluster
        ? `        <category domain="topic">${escapeXml(post.topicCluster)}</category>`
        : '';

    return `    <item>
        <title>${escapeXml(post.title)}</title>
        <link>${link}</link>
        <guid isPermaLink="true">${link}</guid>
        <pubDate>${pubDate}</pubDate>
        <description>${escapeXml(post.tldr || '')}</description>
        <content:encoded><![CDATA[${post.bodyHtml || ''}]]></content:encoded>
        <dc:creator>${escapeXml(post.authorOrg || post.authorName || SITE_NAME)}</dc:creator>
${categories}
${topicCategory}
${enclosure}
    </item>`;
}

/**
 * Generate RSS XML wrapper
 */
function generateRSSWrapper(title, description, link, items) {
    const lastBuildDate = formatRFC822Date(new Date());

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
    xmlns:content="http://purl.org/rss/1.0/modules/content/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <title>${escapeXml(title)}</title>
        <description>${escapeXml(description)}</description>
        <link>${SITE_URL}${link}</link>
        <atom:link href="${SITE_URL}/rss${link === '/' ? '' : link}" rel="self" type="application/rss+xml"/>
        <language>en</language>
        <lastBuildDate>${lastBuildDate}</lastBuildDate>
        <generator>GeoPolitiq RSS Generator</generator>
        <image>
            <url>${SITE_URL}/favicon.png</url>
            <title>${escapeXml(SITE_NAME)}</title>
            <link>${SITE_URL}</link>
        </image>
        <ttl>30</ttl>
${items.join('\n')}
    </channel>
</rss>`;
}

/**
 * Generate main RSS feed with latest posts
 */
async function generateMainFeed(limit = 50) {
    try {
        const posts = await Post.find({ status: 'published' })
            .sort({ publishTime: -1 })
            .limit(limit)
            .lean();

        const items = posts.map(post => generateItem(post));

        return generateRSSWrapper(
            SITE_NAME,
            'Breaking geopolitical news, in-depth analysis, and global intelligence coverage.',
            '/',
            items
        );
    } catch (error) {
        console.error('[RSS] Error generating main feed:', error.message);
        throw error;
    }
}

/**
 * Generate RSS feed for a specific tag
 */
async function generateTagFeed(tag, limit = 30) {
    try {
        const posts = await Post.find({
            status: 'published',
            tags: tag.toLowerCase()
        })
            .sort({ publishTime: -1 })
            .limit(limit)
            .lean();

        const items = posts.map(post => generateItem(post));

        return generateRSSWrapper(
            `${tag} - ${SITE_NAME}`,
            `Latest news and analysis about ${tag} from ${SITE_NAME}.`,
            `/tag/${tag}`,
            items
        );
    } catch (error) {
        console.error(`[RSS] Error generating tag feed for ${tag}:`, error.message);
        throw error;
    }
}

/**
 * Generate RSS feed for a specific topic cluster
 */
async function generateTopicFeed(topic, limit = 30) {
    try {
        const posts = await Post.find({
            status: 'published',
            topicCluster: topic
        })
            .sort({ publishTime: -1 })
            .limit(limit)
            .lean();

        const items = posts.map(post => generateItem(post));

        return generateRSSWrapper(
            `${topic} Coverage - ${SITE_NAME}`,
            `Geopolitical news and analysis about ${topic} from ${SITE_NAME}.`,
            `/topic/${topic}`,
            items
        );
    } catch (error) {
        console.error(`[RSS] Error generating topic feed for ${topic}:`, error.message);
        throw error;
    }
}

module.exports = {
    generateMainFeed,
    generateTagFeed,
    generateTopicFeed,
    escapeXml,
    formatRFC822Date
};
