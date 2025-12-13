/**
 * Footer Middleware - Populates dynamic Topics/Regions for footer
 * Uses caching to avoid database queries on every request
 */

const Post = require('../models/Post');

// Cache for footer data (5 minute TTL)
let footerCache = { topics: [], regions: [], lastUpdated: 0 };
const CACHE_TTL = 5 * 60 * 1000;

async function getFooterData() {
    const now = Date.now();
    if (now - footerCache.lastUpdated < CACHE_TTL) {
        return footerCache;
    }

    try {
        // Get topics: most popular tags
        const topics = await Post.aggregate([
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ]);

        // Get regions: topic clusters by post count
        const regions = await Post.aggregate([
            { $match: { status: 'published' } },
            { $group: { _id: '$topicCluster', count: { $sum: 1 } } },
            { $match: { _id: { $ne: null } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ]);

        footerCache = { topics, regions, lastUpdated: now };
        return footerCache;
    } catch (error) {
        console.error('[Footer] Failed to fetch footer data:', error.message);
        return { topics: [], regions: [] };
    }
}

module.exports = async (req, res, next) => {
    try {
        const { topics, regions } = await getFooterData();
        res.locals.footerTopics = topics;
        res.locals.footerRegions = regions;
    } catch (err) {
        res.locals.footerTopics = [];
        res.locals.footerRegions = [];
    }
    next();
};
