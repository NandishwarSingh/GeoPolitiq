const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const sitemapController = require('../controllers/sitemapController');
const llmController = require('../controllers/llmController');
const rssController = require('../controllers/rssController');

// ═══════════════════════════════════════════════════════════
// SITEMAP & SEO ROUTES
// ═══════════════════════════════════════════════════════════

router.get('/sitemap.xml', sitemapController.getIndex);
router.get('/sitemap-posts-:page.xml', sitemapController.getPostsSitemap);
router.get('/sitemap-static.xml', sitemapController.getStaticSitemap);
router.get('/sitemap-tags.xml', sitemapController.getTagsSitemap);
router.get('/sitemap-news.xml', sitemapController.getNewsSitemap);
router.get('/llms-full.txt', llmController.getFullContext);

// ═══════════════════════════════════════════════════════════
// RSS FEED ROUTES
// ═══════════════════════════════════════════════════════════

router.get('/rss', rssController.getMainFeed);
router.get('/rss.xml', rssController.getMainFeed);
router.get('/feed', rssController.getMainFeed);
router.get('/rss/tag/:tag', rssController.getTagFeed);
router.get('/rss/topic/:topic', rssController.getTopicFeed);

// ═══════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════


/**
 * GET /
 * Global feed - latest 20 published posts sorted by publishTime DESC
 */
router.get('/', postController.getGlobalFeed);

/**
 * GET /post/:slug
 * Single post page with full content
 */
router.get('/post/:slug', postController.getPostBySlug);

/**
 * GET /tag/:tag
 * Posts filtered by tag
 */
router.get('/tag/:tag', postController.getPostsByTag);

/**
 * GET /tags
 * All tags page with D3.js visualization
 */
router.get('/tags', postController.getAllTags);

/**
 * GET /topic/:cluster
 * Posts filtered by topic cluster
 */
router.get('/topic/:cluster', postController.getPostsByCluster);

// ═══════════════════════════════════════════════════════════
// API ROUTES (JSON for infinite scroll)
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/posts
 * JSON API for main feed infinite scroll
 */
router.get('/api/posts', postController.getPostsApi);

/**
 * GET /api/posts/:slug/related
 * JSON API for related posts infinite scroll
 */
router.get('/api/posts/:slug/related', postController.getRelatedPostsApi);

/**
 * GET /api/tag/:tag
 * JSON API for tag posts infinite scroll
 */
router.get('/api/tag/:tag', postController.getTagPostsApi);

// ═══════════════════════════════════════════════════════════
// STATIC PAGES
// ═══════════════════════════════════════════════════════════

/**
 * GET /about
 * About page
 */
router.get('/about', (req, res) => {
    const { buildPageSEO } = require('../utils/seoHelper');
    res.render('about', {
        title: 'About Us | GeoPolitiq',
        seo: buildPageSEO({
            type: 'website',
            title: 'About Us',
            description: 'Learn about GeoPolitiq, your trusted source for in-depth geopolitical analysis, breaking international news, and global intelligence coverage.',
            url: '/about'
        })
    });
});

/**
 * GET /contact
 * Contact page
 */
router.get('/contact', (req, res) => {
    const { buildPageSEO } = require('../utils/seoHelper');
    res.render('contact', {
        title: 'Contact Us | GeoPolitiq',
        seo: buildPageSEO({
            type: 'website',
            title: 'Contact Us',
            description: 'Get in touch with the GeoPolitiq team. We welcome your feedback, story tips, and partnership inquiries.',
            url: '/contact'
        })
    });
});

/**
 * GET /privacy
 * Privacy Policy page
 */
router.get('/privacy', (req, res) => {
    const { buildPageSEO } = require('../utils/seoHelper');
    res.render('privacy', {
        title: 'Privacy Policy | GeoPolitiq',
        seo: buildPageSEO({
            type: 'website',
            title: 'Privacy Policy',
            description: 'Privacy Policy for GeoPolitiq - Learn how we collect, use, and protect your personal information.',
            url: '/privacy'
        })
    });
});

// ═══════════════════════════════════════════════════════════
// PUSH NOTIFICATION ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/push/vapid-key
 * Get VAPID public key for push subscription
 */
router.get('/api/push/vapid-key', (req, res) => {
    const { getPublicKey, isConfigured } = require('../services/pushNotificationService');

    if (!isConfigured()) {
        return res.status(503).json({ error: 'Push notifications not configured' });
    }

    res.json({ publicKey: getPublicKey() });
});

/**
 * POST /api/push/subscribe
 * Subscribe to push notifications
 */
router.post('/api/push/subscribe', async (req, res) => {
    const { subscription, preferredCountries } = req.body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ error: 'Invalid subscription object' });
    }

    const PushSubscription = require('../models/PushSubscription');

    try {
        await PushSubscription.findOneAndUpdate(
            { endpoint: subscription.endpoint },
            {
                endpoint: subscription.endpoint,
                keys: {
                    p256dh: subscription.keys.p256dh,
                    auth: subscription.keys.auth
                },
                preferredCountries: preferredCountries || ['USA', 'INDIA', 'UK', 'EU', 'GLOBAL']
            },
            { upsert: true, new: true }
        );

        console.log('[Push] New subscription saved');
        res.json({ success: true });
    } catch (error) {
        console.error('[Push] Failed to save subscription:', error.message);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

/**
 * POST /api/push/unsubscribe
 * Unsubscribe from push notifications
 */
router.post('/api/push/unsubscribe', async (req, res) => {
    const { endpoint } = req.body;

    if (!endpoint) {
        return res.status(400).json({ error: 'Endpoint required' });
    }

    const PushSubscription = require('../models/PushSubscription');

    try {
        await PushSubscription.deleteOne({ endpoint });
        console.log('[Push] Subscription removed');
        res.json({ success: true });
    } catch (error) {
        console.error('[Push] Failed to unsubscribe:', error.message);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

module.exports = router;
