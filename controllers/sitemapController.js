/**
 * Sitemap Controller
 * Route handlers for sitemap endpoints
 */

const sitemapService = require('../services/sitemapService');

/**
 * GET /sitemap.xml
 * Returns the sitemap index
 */
exports.getIndex = async (req, res) => {
    try {
        const xml = await sitemapService.generateSitemapIndex();
        res.set('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.send(xml);
    } catch (error) {
        console.error('Sitemap index error:', error);
        res.status(500).send('Error generating sitemap');
    }
};

/**
 * GET /sitemap-posts-:page.xml
 * Returns paginated posts sitemap
 */
exports.getPostsSitemap = async (req, res) => {
    try {
        const page = parseInt(req.params.page) || 1;
        const totalPages = await sitemapService.getPostSitemapPages();

        if (page < 1 || page > totalPages) {
            return res.status(404).send('Sitemap page not found');
        }

        const xml = await sitemapService.generatePostsSitemap(page);
        res.set('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(xml);
    } catch (error) {
        console.error('Posts sitemap error:', error);
        res.status(500).send('Error generating sitemap');
    }
};

/**
 * GET /sitemap-static.xml
 * Returns static pages sitemap
 */
exports.getStaticSitemap = async (req, res) => {
    try {
        const xml = await sitemapService.generateStaticSitemap();
        res.set('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(xml);
    } catch (error) {
        console.error('Static sitemap error:', error);
        res.status(500).send('Error generating sitemap');
    }
};

/**
 * GET /sitemap-tags.xml
 * Returns tags sitemap
 */
exports.getTagsSitemap = async (req, res) => {
    try {
        const xml = await sitemapService.generateTagsSitemap();
        res.set('Content-Type', 'application/xml');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(xml);
    } catch (error) {
        console.error('Tags sitemap error:', error);
        res.status(500).send('Error generating sitemap');
    }
};
