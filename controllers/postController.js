const Post = require('../models/Post');
const { mapCountryToCluster, getCountryFromIP } = require('../utils/countryMapper');
const { buildPageSEO } = require('../utils/seoHelper');


/**
 * Get popular tags with counts (helper function)
 */
async function getPopularTags(limit = 10) {
    try {
        const result = await Post.aggregate([
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ]);
        return result;
    } catch (error) {
        console.error('Get popular tags error:', error);
        return [];
    }
}

/**
 * Get personalized tags: mix of country-specific + global tags
 */
async function getPersonalizedTags(userCluster) {
    try {
        // Get country-specific tags (from posts in user's cluster)
        const countryTags = userCluster !== 'Global' ? await Post.aggregate([
            { $match: { status: 'published', topicCluster: userCluster } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 3 },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ]) : [];

        // Get global popular tags (excluding country tags)
        const countryTagNames = countryTags.map(t => t.name);
        const globalTags = await Post.aggregate([
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $match: { tags: { $nin: countryTagNames } } },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 4 },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ]);

        // Interleave: Global, Country, Global, Country...
        const result = [];
        const maxLen = Math.max(globalTags.length, countryTags.length);
        for (let i = 0; i < maxLen && result.length < 6; i++) {
            if (globalTags[i]) result.push(globalTags[i]);
            if (countryTags[i]) result.push(countryTags[i]);
        }

        console.log(`[Tags] Personalized for ${userCluster}: ${result.map(t => t.name).join(', ')}`);
        return result;
    } catch (error) {
        console.error('Get personalized tags error:', error);
        return await getPopularTags(6);
    }
}

/**
 * Build personalized hero feed: alternating Global + User-Country posts
 */
async function getPersonalizedHero(userCluster) {
    const selectFields = 'slug title tldr tags topicCluster publishTime featuredImage imageAlt';

    // Fetch Global posts and User-Country posts in parallel
    const [globalPosts, countryPosts] = await Promise.all([
        Post.find({ status: 'published', topicCluster: 'Global' })
            .select(selectFields)
            .sort({ publishTime: -1 })
            .limit(3)
            .lean(),
        userCluster !== 'Global'
            ? Post.find({ status: 'published', topicCluster: userCluster })
                .select(selectFields)
                .sort({ publishTime: -1 })
                .limit(3)
                .lean()
            : []
    ]);

    // Interleave: Global, Country, Global, Country...
    const heroFeed = [];
    const maxLen = Math.max(globalPosts.length, countryPosts.length);

    for (let i = 0; i < maxLen; i++) {
        if (globalPosts[i]) heroFeed.push(globalPosts[i]);
        if (countryPosts[i]) heroFeed.push(countryPosts[i]);
    }

    // If no country posts, fill with more global/all posts
    if (heroFeed.length < 6) {
        const existingSlugs = heroFeed.map(p => p.slug);
        const morePosts = await Post.find({
            status: 'published',
            slug: { $nin: existingSlugs }
        })
            .select(selectFields)
            .sort({ publishTime: -1 })
            .limit(6 - heroFeed.length)
            .lean();
        heroFeed.push(...morePosts);
    }

    return heroFeed.slice(0, 6);
}

/**
 * GET / - Personalized Homepage
 * Hero: Alternating Global + User's Country news
 * Latest: All other posts chronologically
 */
exports.getGlobalFeed = async (req, res) => {
    try {
        // Detect user's country from IP
        // With trust proxy enabled, req.ip should have the real client IP
        // Fallback to x-forwarded-for header if needed
        const forwardedFor = req.headers['x-forwarded-for'];
        const userIP = req.ip || (forwardedFor ? forwardedFor.split(',')[0].trim() : '');
        const userCountry = await getCountryFromIP(userIP);
        const userCluster = mapCountryToCluster(userCountry);

        // Log personalization data
        console.log(`[Feed] IP: ${userIP.substring(0, 15)}... → Country: ${userCountry || 'Unknown'} → Cluster: ${userCluster}`);

        // Get personalized hero feed
        const heroFeed = await getPersonalizedHero(userCluster);
        const heroSlugs = heroFeed.map(p => p.slug);

        // Log hero composition
        const heroClusters = heroFeed.map(p => p.topicCluster).join(', ');
        console.log(`[Feed] Hero composition: [${heroClusters}]`);

        // Get latest posts (excluding hero posts)
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const [latestPosts, totalPosts, popularTags] = await Promise.all([
            Post.find({
                status: 'published',
                slug: { $nin: heroSlugs }
            })
                .select('slug title tldr tags topicCluster publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments({ status: 'published' }),
            getPersonalizedTags(userCluster)
        ]);

        const totalPages = Math.ceil(totalPosts / limit);

        // Split hero feed: featured (large left) + sidebar (right)
        const featuredPost = heroFeed.length > 0 ? heroFeed[0] : null;
        const sidebarPosts = heroFeed.slice(1, 6);

        res.render('index', {
            title: 'GeoPolitiq - Geopolitical Intelligence',
            metaDescription: 'Latest geopolitical analysis, breaking news, and intelligence from around the world.',
            seo: buildPageSEO({
                type: 'website',
                title: 'GeoPolitiq - Geopolitical Intelligence',
                description: 'Latest geopolitical analysis, breaking news, and intelligence from around the world.',
                url: '/'
            }),
            featuredPost,
            sidebarPosts,
            posts: latestPosts,
            popularTags,
            userCountry: userCountry || 'Global',
            userCluster,
            currentPage: page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        });

    } catch (error) {
        console.error('Global feed error:', error);
        res.status(500).render('error', {
            title: 'Server Error',
            message: 'Failed to load the feed. Please try again later.'
        });
    }
};

/**
 * GET /post/:slug - Single post page
 * Finds post by slug, renders full content
 */
exports.getPostBySlug = async (req, res) => {
    try {
        const post = await Post.findOne({
            slug: req.params.slug,
            status: 'published'
        }).lean();

        if (!post) {
            return res.status(404).render('error', {
                title: '404 - Post Not Found',
                message: 'The article you are looking for does not exist or has been removed.'
            });
        }

        // Get related posts and popular tags in parallel
        const [relatedPosts, popularTags] = await Promise.all([
            Post.find({
                _id: { $ne: post._id },
                status: 'published',
                $or: [
                    { tags: { $in: post.tags || [] } },
                    { topicCluster: post.topicCluster }
                ]
            })
                .select('slug title tldr tags publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .limit(10) // Initial load, then 5 more via infinite scroll
                .lean(),
            getPopularTags()
        ]);

        // Calculate reading time (200 words per minute)
        const wordCount = (post.rawContent || '').split(/\s+/).length;
        const readingTime = Math.max(1, Math.ceil(wordCount / 200));

        res.render('post', {
            title: `${post.title} - GeoPolitiq`,
            metaDescription: post.metaDescription || post.tldr,
            metaTitle: post.metaTitle || post.title,
            seo: buildPageSEO({
                type: 'article',
                title: post.metaTitle || post.title,
                description: post.metaDescription || post.tldr,
                image: post.featuredImage,
                url: `/post/${post.slug}`,
                article: post
            }),
            post,
            relatedPosts,
            popularTags,
            readingTime
        });

    } catch (error) {
        console.error('Post page error:', error);
        res.status(500).render('error', {
            title: 'Server Error',
            message: 'Failed to load the article. Please try again later.'
        });
    }
};

/**
 * GET /tag/:tag - Posts filtered by tag
 */
exports.getPostsByTag = async (req, res) => {
    try {
        const tag = req.params.tag.toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // Initial load: 10 posts, then 5 more via infinite scroll
        const skip = (page - 1) * limit;

        const [posts, totalPosts, popularTags] = await Promise.all([
            Post.find({ status: 'published', tags: tag })
                .select('slug title tldr tags topicCluster publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments({ status: 'published', tags: tag }),
            getPopularTags()
        ]);

        const totalPages = Math.ceil(totalPosts / limit);

        res.render('tag', {
            title: `${tag} News & Analysis | GeoPolitiq`,
            seo: buildPageSEO({
                type: 'tag',
                title: tag,
                description: `Latest geopolitical news, analysis, and updates tagged with "${tag}". Stay informed with GeoPolitiq.`,
                url: `/tag/${tag}`
            }),
            tag,
            posts,
            popularTags,
            currentPage: page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        });
    } catch (error) {
        console.error('Tag page error:', error);
        res.status(500).render('error', {
            title: 'Server Error',
            message: 'Failed to load posts. Please try again later.'
        });
    }
};

/**
 * GET /topic/:cluster - Posts by topic cluster
 */
exports.getPostsByCluster = async (req, res) => {
    try {
        const cluster = req.params.cluster;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        // Case-insensitive regex to match variations like GLOBAL/Global/global
        const clusterRegex = new RegExp(`^${cluster}$`, 'i');

        const [posts, totalPosts, popularTags] = await Promise.all([
            Post.find({ status: 'published', topicCluster: clusterRegex })
                .select('slug title tldr tags topicCluster publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments({ status: 'published', topicCluster: clusterRegex }),
            getPopularTags()
        ]);

        const totalPages = Math.ceil(totalPosts / limit);

        // Normalize display name
        const displayCluster = ['usa', 'uk', 'eu'].includes(cluster.toLowerCase())
            ? cluster.toUpperCase()
            : cluster.charAt(0).toUpperCase() + cluster.slice(1).toLowerCase();

        res.render('topic', {
            title: `${displayCluster} Geopolitics Coverage | GeoPolitiq`,
            seo: buildPageSEO({
                type: 'topic',
                title: displayCluster,
                description: `In-depth geopolitical coverage, news, and analysis about ${displayCluster}. Expert insights from GeoPolitiq.`,
                url: `/topic/${cluster}`
            }),
            cluster: displayCluster,
            posts,
            popularTags,
            currentPage: page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        });
    } catch (error) {
        console.error('Topic page error:', error);
        res.status(500).render('error', {
            title: 'Server Error',
            message: 'Failed to load posts. Please try again later.'
        });
    }
};

/**
 * Get popular tags with counts
 */
async function getPopularTags(limit = 10) {
    try {
        const result = await Post.aggregate([
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ]);
        return result;
    } catch (error) {
        console.error('Get popular tags error:', error);
        return [];
    }
}

/**
 * GET /tags - All tags page with statistics
 */
exports.getAllTags = async (req, res) => {
    try {
        const searchQuery = req.query.q || '';

        // Get all tags with counts
        let tagsAggregation = [
            { $match: { status: 'published' } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { name: '$_id', count: 1, _id: 0 } }
        ];

        const allTags = await Post.aggregate(tagsAggregation);

        // Filter by search if provided
        let filteredTags = allTags;
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filteredTags = allTags.filter(tag =>
                tag.name.toLowerCase().includes(query)
            );
        }

        // Get popular tags for header
        const popularTags = allTags.slice(0, 10);

        res.render('tags', {
            title: 'All Tags - GeoPolitiq',
            metaDescription: 'Browse all topics and tags on GeoPolitiq.',
            tags: filteredTags,
            allTags: allTags,
            popularTags,
            searchQuery,
            totalTags: allTags.length
        });
    } catch (error) {
        console.error('Tags page error:', error);
        res.status(500).render('error', {
            title: 'Server Error',
            message: 'Failed to load tags. Please try again later.'
        });
    }
};

// ═══════════════════════════════════════════════════════════
// API ENDPOINTS FOR INFINITE SCROLL
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/posts - JSON API for infinite scroll
 * Query params: page (default 1), limit (default 5)
 */
exports.getPostsApi = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        // Parse excluded slugs (comma-separated) to prevent duplicates
        const excludeSlugs = req.query.exclude
            ? req.query.exclude.split(',').filter(Boolean)
            : [];

        const query = { status: 'published' };
        if (excludeSlugs.length > 0) {
            query.slug = { $nin: excludeSlugs };
        }

        const [posts, totalPosts] = await Promise.all([
            Post.find(query)
                .select('slug title tldr tags topicCluster publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalPosts / limit);

        res.json({
            posts,
            currentPage: page,
            totalPages,
            hasMore: page < totalPages
        });
    } catch (error) {
        console.error('API posts error:', error);
        res.status(500).json({ error: 'Failed to load posts' });
    }
};

/**
 * GET /api/posts/:slug/related - JSON API for related posts infinite scroll
 * Query params: page (default 1), limit (default 5)
 */
exports.getRelatedPostsApi = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        // Find the main post first
        const post = await Post.findOne({
            slug: req.params.slug,
            status: 'published'
        }).select('_id tags topicCluster').lean();

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // Get related posts count first
        const query = {
            _id: { $ne: post._id },
            status: 'published',
            $or: [
                { tags: { $in: post.tags || [] } },
                { topicCluster: post.topicCluster }
            ]
        };

        const [relatedPosts, totalRelated] = await Promise.all([
            Post.find(query)
                .select('slug title tldr tags publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalRelated / limit);

        res.json({
            posts: relatedPosts,
            currentPage: page,
            totalPages,
            hasMore: page < totalPages
        });
    } catch (error) {
        console.error('API related posts error:', error);
        res.status(500).json({ error: 'Failed to load related posts' });
    }
};

/**
 * GET /api/tag/:tag - JSON API for tag posts infinite scroll
 * Query params: page (default 1), limit (default 5)
 */
exports.getTagPostsApi = async (req, res) => {
    try {
        const tag = req.params.tag.toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const skip = (page - 1) * limit;

        const [posts, totalPosts] = await Promise.all([
            Post.find({ status: 'published', tags: tag })
                .select('slug title tldr tags topicCluster publishTime featuredImage imageAlt')
                .sort({ publishTime: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments({ status: 'published', tags: tag })
        ]);

        const totalPages = Math.ceil(totalPosts / limit);

        res.json({
            posts,
            currentPage: page,
            totalPages,
            hasMore: page < totalPages
        });
    } catch (error) {
        console.error('API tag posts error:', error);
        res.status(500).json({ error: 'Failed to load tag posts' });
    }
};

// Export helper for use in other controllers
exports.getPopularTags = getPopularTags;
