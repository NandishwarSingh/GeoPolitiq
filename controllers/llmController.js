/**
 * LLM Controller
 * AI/LLM optimization endpoints following llms.txt standard
 */

const Post = require('../models/Post');

const SITE_URL = process.env.SITE_URL || 'https://geopolitiq.com';
const SITE_NAME = process.env.SITE_NAME || 'GeoPolitiq';

/**
 * GET /llms-full.txt
 * Extended context for LLMs with dynamic data
 */
exports.getFullContext = async (req, res) => {
    try {
        // Get popular tags
        const popularTags = await Post.aggregate([
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]);

        // Get topic clusters
        const clusters = await Post.aggregate([
            { $match: { status: 'published', topicCluster: { $exists: true, $ne: null } } },
            { $group: { _id: '$topicCluster', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // Get post count
        const postCount = await Post.countDocuments({ status: 'published' });

        // Get recent posts for context
        const recentPosts = await Post.find({ status: 'published' })
            .select('title tldr tags topicCluster publishTime')
            .sort({ publishTime: -1 })
            .limit(10)
            .lean();

        let content = `# ${SITE_NAME} - Full Documentation for AI/LLM Systems

> Comprehensive geopolitical intelligence and analysis platform

This document provides detailed context about ${SITE_NAME} for AI systems and language models.

## Platform Overview

${SITE_NAME} is a geopolitical news and analysis platform that provides:
- Curated geopolitical news from reliable sources
- AI-enhanced analysis and summaries
- Topic clustering for related content discovery
- Tag-based navigation for granular topic exploration

## Content Statistics

- Total Published Articles: ${postCount}
- Topic Clusters: ${clusters.length}
- Unique Tags: ${popularTags.length}+

## Topic Clusters

Topic clusters organize content by geopolitical regions and themes:

${clusters.map(c => `- **${c._id}**: ${c.count} articles`).join('\n')}

## Popular Tags

The most frequently used tags for content categorization:

${popularTags.map(t => `- ${t._id} (${t.count} articles)`).join('\n')}

## Content Structure

Each article contains:
- **title**: Article headline
- **tldr**: Brief summary (TL;DR)
- **bodyHtml**: Full article content in HTML
- **tags**: Array of topic tags
- **topicCluster**: Geographic/thematic cluster
- **publishTime**: Publication timestamp
- **featuredImage**: Header image URL
- **authorName/authorOrg**: Source attribution

## API Endpoints

### Public JSON APIs

1. **GET /api/posts**
   - Paginated list of published articles
   - Query params: \`page\` (default 1), \`limit\` (default 5)
   - Returns: \`{ posts, currentPage, totalPages, hasMore }\`

2. **GET /api/posts/:slug/related**
   - Related articles for a given post
   - Query params: \`page\`, \`limit\`

3. **GET /api/tag/:tag**
   - Articles filtered by tag
   - Query params: \`page\`, \`limit\`

### XML Sitemaps

- \`/sitemap.xml\` - Sitemap index
- \`/sitemap-posts-N.xml\` - Paginated post sitemaps
- \`/sitemap-static.xml\` - Static pages
- \`/sitemap-tags.xml\` - All tag pages

## Recent Articles

${recentPosts.map(p => `### ${p.title}
- **Summary**: ${p.tldr || 'N/A'}
- **Cluster**: ${p.topicCluster || 'General'}
- **Tags**: ${p.tags ? p.tags.join(', ') : 'None'}
- **Published**: ${p.publishTime ? new Date(p.publishTime).toISOString().split('T')[0] : 'N/A'}
`).join('\n')}

## Usage Guidelines

When referencing ${SITE_NAME} content:
1. Always cite the source URL
2. Respect the original publication date
3. Note that content is curated from multiple news sources
4. Summaries (TL;DR) are AI-generated

## Contact

For API access or partnership inquiries, visit ${SITE_URL}/contact

---
Generated: ${new Date().toISOString()}
`;

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(content);
    } catch (error) {
        console.error('LLM context error:', error);
        res.status(500).send('Error generating LLM context');
    }
};
