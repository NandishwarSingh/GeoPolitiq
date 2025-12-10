/**
 * SEO Helper Utility
 * Centralized SEO data generation with fallback logic
 */

const SITE_URL = process.env.SITE_URL || 'https://geopolitiq.com';
const SITE_NAME = process.env.SITE_NAME || 'GeoPolitiq';
const TWITTER_HANDLE = process.env.TWITTER_HANDLE || '@geopolitiq';
const DEFAULT_IMAGE = `${SITE_URL}/favicon.png`;

/**
 * Truncate text to specified length with ellipsis
 */
function truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3).trim() + '...';
}

/**
 * Build complete SEO data object for a page
 * @param {Object} options - SEO configuration
 * @param {string} options.type - Page type: 'website', 'article', 'profile'
 * @param {string} options.title - Page title
 * @param {string} options.description - Page description
 * @param {string} options.image - Image URL (optional)
 * @param {string} options.url - Page path (e.g., '/post/my-article')
 * @param {Object} options.article - Post object for article pages (optional)
 * @returns {Object} Complete SEO data object
 */
function buildPageSEO(options = {}) {
    const {
        type = 'website',
        title = SITE_NAME,
        description = 'Geopolitical intelligence and analysis platform',
        image = null,
        url = '/',
        article = null
    } = options;

    const fullUrl = url.startsWith('http') ? url : `${SITE_URL}${url}`;
    const fullImage = image ? (image.startsWith('http') ? image : `${SITE_URL}${image}`) : DEFAULT_IMAGE;
    const metaTitle = truncate(title, 60);
    const metaDescription = truncate(description, 160);

    const seo = {
        // Basic meta
        title: `${metaTitle} - ${SITE_NAME}`,
        description: metaDescription,

        // Canonical
        canonicalUrl: fullUrl,

        // Open Graph
        og: {
            title: metaTitle,
            description: metaDescription,
            image: fullImage,
            url: fullUrl,
            type: type === 'article' ? 'article' : 'website',
            siteName: SITE_NAME
        },

        // Twitter Card
        twitter: {
            card: 'summary_large_image',
            title: metaTitle,
            description: metaDescription,
            image: fullImage,
            site: TWITTER_HANDLE
        },

        // JSON-LD (will be stringified in template)
        jsonLd: null
    };

    // Generate appropriate JSON-LD based on page type
    if (type === 'article' && article) {
        seo.jsonLd = generateArticleJSONLD(article);
        seo.og.publishedTime = article.publishTime;
        seo.og.modifiedTime = article.updatedAt;
        if (article.tags && article.tags.length > 0) {
            seo.og.tags = article.tags;
        }
    } else {
        seo.jsonLd = generateWebsiteJSONLD();
    }

    return seo;
}

/**
 * Generate Article JSON-LD structured data
 */
function generateArticleJSONLD(post) {
    return {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: truncate(post.title, 110),
        description: truncate(post.metaDescription || post.tldr, 160),
        image: post.featuredImage ? [post.featuredImage] : [`${SITE_URL}/favicon.png`],
        datePublished: post.publishTime,
        dateModified: post.updatedAt || post.publishTime,
        author: {
            '@type': 'Organization',
            name: post.authorOrg || SITE_NAME,
            url: SITE_URL
        },
        publisher: {
            '@type': 'Organization',
            name: SITE_NAME,
            url: SITE_URL,
            logo: {
                '@type': 'ImageObject',
                url: `${SITE_URL}/favicon.png`
            }
        },
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': `${SITE_URL}/post/${post.slug}`
        },
        keywords: post.tags ? post.tags.join(', ') : undefined,
        articleSection: post.topicCluster || 'Geopolitics'
    };
}

/**
 * Generate Website JSON-LD structured data
 */
function generateWebsiteJSONLD() {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: SITE_URL,
        description: 'Geopolitical intelligence and analysis platform',
        potentialAction: {
            '@type': 'SearchAction',
            target: {
                '@type': 'EntryPoint',
                urlTemplate: `${SITE_URL}/tags?q={search_term_string}`
            },
            'query-input': 'required name=search_term_string'
        }
    };
}

/**
 * Generate Organization JSON-LD structured data
 */
function generateOrganizationJSONLD() {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/favicon.png`,
        sameAs: [
            // Add social media URLs here
        ]
    };
}

/**
 * Generate BreadcrumbList JSON-LD
 * @param {Array} crumbs - Array of {name, url} objects
 */
function generateBreadcrumbJSONLD(crumbs) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.name,
            item: crumb.url.startsWith('http') ? crumb.url : `${SITE_URL}${crumb.url}`
        }))
    };
}

module.exports = {
    buildPageSEO,
    generateArticleJSONLD,
    generateWebsiteJSONLD,
    generateOrganizationJSONLD,
    generateBreadcrumbJSONLD,
    truncate,
    SITE_URL,
    SITE_NAME
};
