/**
 * Sitemap Service
 * Dynamic XML sitemap generation with pagination
 */

const Post = require('../models/Post');

const SITE_URL = process.env.SITE_URL || 'https://geopolitiq.com';
const POSTS_PER_SITEMAP = 1000;

/**
 * Generate XML header
 */
function xmlHeader() {
  return '<?xml version="1.0" encoding="UTF-8"?>';
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date for sitemap (W3C format)
 */
function formatDate(date) {
  if (!date) return new Date().toISOString().split('T')[0];
  return new Date(date).toISOString().split('T')[0];
}

/**
 * Get total number of published posts
 */
async function getPostCount() {
  return await Post.countDocuments({ status: 'published' });
}

/**
 * Calculate number of post sitemap pages needed
 */
async function getPostSitemapPages() {
  const count = await getPostCount();
  return Math.ceil(count / POSTS_PER_SITEMAP);
}

/**
 * Generate sitemap index (main sitemap.xml)
 * Links to all sub-sitemaps
 */
async function generateSitemapIndex() {
  const postPages = await getPostSitemapPages();
  const now = formatDate(new Date());

  let xml = xmlHeader();
  xml += '\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  // Static pages sitemap
  xml += `
  <sitemap>
    <loc>${SITE_URL}/sitemap-static.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`;

  // Post sitemaps (paginated)
  for (let i = 1; i <= postPages; i++) {
    xml += `
  <sitemap>
    <loc>${SITE_URL}/sitemap-posts-${i}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`;
  }

  // Tags sitemap
  xml += `
  <sitemap>
    <loc>${SITE_URL}/sitemap-tags.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`;

  // Google News sitemap (for Google News inclusion)
  xml += `
  <sitemap>
    <loc>${SITE_URL}/sitemap-news.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`;

  xml += '\n</sitemapindex>';
  return xml;
}

/**
 * Generate posts sitemap for a specific page
 * @param {number} page - Page number (1-indexed)
 */
async function generatePostsSitemap(page = 1) {
  const skip = (page - 1) * POSTS_PER_SITEMAP;

  const posts = await Post.find({ status: 'published' })
    .select('slug updatedAt publishTime')
    .sort({ publishTime: -1 })
    .skip(skip)
    .limit(POSTS_PER_SITEMAP)
    .lean();

  let xml = xmlHeader();
  xml += '\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  for (const post of posts) {
    const lastmod = formatDate(post.updatedAt || post.publishTime);
    xml += `
  <url>
    <loc>${SITE_URL}/post/${escapeXml(post.slug)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
  }

  xml += '\n</urlset>';
  return xml;
}

/**
 * Generate static pages sitemap
 */
async function generateStaticSitemap() {
  const now = formatDate(new Date());

  const staticPages = [
    { url: '/', priority: '1.0', changefreq: 'hourly' },
    { url: '/about', priority: '0.5', changefreq: 'monthly' },
    { url: '/contact', priority: '0.5', changefreq: 'monthly' },
    { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
    { url: '/tags', priority: '0.7', changefreq: 'daily' }
  ];

  let xml = xmlHeader();
  xml += '\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  for (const page of staticPages) {
    xml += `
  <url>
    <loc>${SITE_URL}${page.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
  }

  xml += '\n</urlset>';
  return xml;
}

/**
 * Generate tags sitemap
 * Includes all unique tags from published posts
 */
async function generateTagsSitemap() {
  const now = formatDate(new Date());

  // Get all unique tags
  const tags = await Post.aggregate([
    { $match: { status: 'published' } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags' } },
    { $sort: { _id: 1 } }
  ]);

  let xml = xmlHeader();
  xml += '\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  for (const tag of tags) {
    xml += `
  <url>
    <loc>${SITE_URL}/tag/${escapeXml(encodeURIComponent(tag._id))}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`;
  }

  xml += '\n</urlset>';
  return xml;
}

/**
 * Generate topic clusters sitemap
 */
async function generateClustersSitemap() {
  const now = formatDate(new Date());

  // Get all unique topic clusters
  const clusters = await Post.aggregate([
    { $match: { status: 'published', topicCluster: { $exists: true, $ne: null } } },
    { $group: { _id: '$topicCluster' } },
    { $sort: { _id: 1 } }
  ]);

  let xml = xmlHeader();
  xml += '\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

  for (const cluster of clusters) {
    xml += `
  <url>
    <loc>${SITE_URL}/topic/${escapeXml(encodeURIComponent(cluster._id))}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`;
  }

  xml += '\n</urlset>';
  return xml;
}

/**
 * Generate Google News sitemap
 * Special format for Google News inclusion
 * Only includes posts from last 48 hours (Google News requirement)
 */
async function generateNewsSitemap() {
  // Google News only indexes <news:news> entries from the last 48 hours.
  // We always emit <url> entries for the most recent 50 published posts so
  // the sitemap is never blank, and only attach <news:news> markup to those
  // that fall inside the freshness window — this stays valid both as a
  // Google News sitemap and as a regular sitemap.
  const FRESH_WINDOW_HOURS = 48;
  const cutoff = new Date(Date.now() - FRESH_WINDOW_HOURS * 60 * 60 * 1000);

  const posts = await Post.find({ status: 'published' })
    .select('title slug publishTime tags topicCluster')
    .sort({ publishTime: -1 })
    .limit(50)
    .lean();

  let xml = xmlHeader();
  xml += '\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  xml += ' xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">';

  for (const post of posts) {
    const publishDate = post.publishTime ? new Date(post.publishTime) : null;
    const isFresh = publishDate && publishDate >= cutoff;
    const lastmod = publishDate ? publishDate.toISOString().split('T')[0] : '';
    const keywords = post.tags ? post.tags.slice(0, 5).join(', ') : '';

    xml += `
  <url>
    <loc>${SITE_URL}/post/${escapeXml(post.slug)}</loc>${lastmod ? `
    <lastmod>${lastmod}</lastmod>` : ''}`;

    if (isFresh) {
      const pubDateIso = publishDate.toISOString();
      xml += `
    <news:news>
      <news:publication>
        <news:name>GeoPolitiq</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${pubDateIso}</news:publication_date>
      <news:title>${escapeXml(post.title)}</news:title>${keywords ? `
      <news:keywords>${escapeXml(keywords)}</news:keywords>` : ''}
    </news:news>`;
    }

    xml += `
  </url>`;
  }

  xml += '\n</urlset>';
  return xml;
}

module.exports = {
  generateSitemapIndex,
  generatePostsSitemap,
  generateStaticSitemap,
  generateTagsSitemap,
  generateClustersSitemap,
  generateNewsSitemap,
  getPostSitemapPages,
  POSTS_PER_SITEMAP
};
