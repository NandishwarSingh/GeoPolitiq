const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const sitemapController = require('../controllers/sitemapController');
const llmController = require('../controllers/llmController');

// ═══════════════════════════════════════════════════════════
// SITEMAP & SEO ROUTES
// ═══════════════════════════════════════════════════════════

router.get('/sitemap.xml', sitemapController.getIndex);
router.get('/sitemap-posts-:page.xml', sitemapController.getPostsSitemap);
router.get('/sitemap-static.xml', sitemapController.getStaticSitemap);
router.get('/sitemap-tags.xml', sitemapController.getTagsSitemap);
router.get('/llms-full.txt', llmController.getFullContext);

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
    res.render('about', {
        title: 'About - Geo Politiq',
        metaDescription: 'About Geo Politiq - Your source for geopolitical intelligence and analysis.'
    });
});

/**
 * GET /contact
 * Contact page
 */
router.get('/contact', (req, res) => {
    res.render('contact', {
        title: 'Contact - Geo Politiq',
        metaDescription: 'Get in touch with the Geo Politiq team.'
    });
});

/**
 * GET /privacy
 * Privacy Policy page
 */
router.get('/privacy', (req, res) => {
    res.render('privacy', {
        title: 'Privacy Policy - Geo Politiq',
        metaDescription: 'Privacy Policy for Geo Politiq - How we collect, use, and protect your information.'
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
