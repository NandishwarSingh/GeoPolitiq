/**
 * RSS Feed Controller
 * Route handlers for RSS endpoints
 */

const rssService = require('../services/rssService');

/**
 * GET /rss or /rss.xml or /feed
 * Returns the main RSS feed with latest posts
 */
exports.getMainFeed = async (req, res) => {
    try {
        const xml = await rssService.generateMainFeed();
        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800'); // Cache for 30 minutes
        res.send(xml);
    } catch (error) {
        console.error('[RSS] Main feed error:', error);
        res.status(500).send('<?xml version="1.0"?><error>Failed to generate RSS feed</error>');
    }
};

/**
 * GET /rss/tag/:tag
 * Returns RSS feed for a specific tag
 */
exports.getTagFeed = async (req, res) => {
    try {
        const tag = req.params.tag;
        if (!tag) {
            return res.status(400).send('<?xml version="1.0"?><error>Tag required</error>');
        }

        const xml = await rssService.generateTagFeed(tag);
        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800');
        res.send(xml);
    } catch (error) {
        console.error('[RSS] Tag feed error:', error);
        res.status(500).send('<?xml version="1.0"?><error>Failed to generate RSS feed</error>');
    }
};

/**
 * GET /rss/topic/:topic
 * Returns RSS feed for a specific topic cluster
 */
exports.getTopicFeed = async (req, res) => {
    try {
        const topic = req.params.topic;
        if (!topic) {
            return res.status(400).send('<?xml version="1.0"?><error>Topic required</error>');
        }

        const xml = await rssService.generateTopicFeed(topic);
        res.set('Content-Type', 'application/rss+xml; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800');
        res.send(xml);
    } catch (error) {
        console.error('[RSS] Topic feed error:', error);
        res.status(500).send('<?xml version="1.0"?><error>Failed to generate RSS feed</error>');
    }
};
