const Post = require('../models/Post');
const AiGenerationLog = require('../models/AiGenerationLog');
const PageView = require('../models/PageView');
const { marked } = require('marked');
const slugify = require('slugify');
const fs = require('fs');
const path = require('path');

// AI Services
const scheduler = require('../services/scheduler');
const aiContentService = require('../services/aiContentService');
const aiConfig = require('../config/ai');

// ═══════════════════════════════════════════════════════════
// AI SETTINGS
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/settings
 * Show AI settings page with model selection
 */
exports.showSettings = (req, res) => {
    try {
        res.render('admin/settings', {
            title: 'AI Settings - Admin',
            layout: false,
            models: aiConfig.availableModels,
            selectedModel: aiConfig.selectedModelKey,
            currentModel: aiConfig.getModelInfo(aiConfig.selectedModelKey),
            schedulerEnabled: aiConfig.scheduler.enabled,
            success: req.query.success === 'true'
        });
    } catch (error) {
        console.error('Settings page error:', error);
        res.render('admin/error', {
            error: error.message,
            layout: 'layouts/admin'
        });
    }
};

/**
 * POST /admin/settings
 * Save AI settings (model selection)
 */
exports.saveSettings = (req, res) => {
    try {
        const { model } = req.body;

        if (model && aiConfig.setModel(model)) {
            console.log(`[Admin] AI model changed to: ${model}`);
        }

        res.redirect('/admin/settings?success=true');
    } catch (error) {
        console.error('Save settings error:', error);
        res.redirect('/admin/settings?error=' + encodeURIComponent(error.message));
    }
};

// ═══════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin
 * Show admin login page
 */
exports.showLogin = (req, res) => {
    // Redirect to posts list if already logged in
    if (req.session && req.session.isAdmin) {
        return res.redirect('/admin/posts');
    }

    res.render('admin/login', {
        title: 'Admin Login - GeoPolitiq',
        layout: 'layouts/admin',
        error: req.query.error || null
    });
};

/**
 * POST /admin
 * Process login with hardcoded password check
 */
exports.login = (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === adminPassword) {
        req.session.isAdmin = true;
        const returnTo = req.session.returnTo || '/admin/posts';
        delete req.session.returnTo;
        return res.redirect(returnTo);
    }

    res.redirect('/admin?error=Invalid password');
};

/**
 * GET /admin/logout
 * Destroy session and redirect to login
 */
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/admin');
    });
};

// ═══════════════════════════════════════════════════════════
// POST MANAGEMENT
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/posts
 * List all posts with pagination and search
 */
exports.listPosts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 15;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search || '';

        // Build search filter
        let filter = {};
        if (searchQuery) {
            filter = {
                $or: [
                    { title: { $regex: searchQuery, $options: 'i' } },
                    { topicCluster: { $regex: searchQuery, $options: 'i' } },
                    { tags: { $in: [new RegExp(searchQuery, 'i')] } }
                ]
            };
        }

        const [posts, totalPosts] = await Promise.all([
            Post.find(filter)
                .select('title slug status topicCluster publishTime createdAt updatedAt featuredImage')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Post.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(totalPosts / limit);

        res.render('admin/posts', {
            title: 'Manage Posts - GeoPolitiq Admin',
            layout: 'layouts/admin',
            activePage: 'posts',
            posts,
            currentPage: page,
            totalPages,
            totalPosts,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            searchQuery,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error('Admin list posts error:', error);
        res.status(500).render('admin/error', {
            title: 'Error',
            layout: 'layouts/admin',
            message: 'Failed to load posts'
        });
    }
};

/**
 * GET /admin/posts/new
 * Show form to create new post
 */
exports.showNewPostForm = (req, res) => {
    res.render('admin/form', {
        title: 'New Post - GeoPolitiq Admin',
        layout: 'layouts/admin',
        activePage: 'new',
        post: null,
        isEdit: false,
        error: null
    });
};

/**
 * POST /admin/posts
 * Create new post with optional image upload
 */
exports.createPost = async (req, res) => {
    try {
        const { title, slug, tldr, rawContent, tags, topicCluster, publishTime, status, sourceUrl, imageAlt, featuredImageUrl } = req.body;

        // Generate slug if not provided
        const finalSlug = slug || slugify(title, { lower: true, strict: true });

        // Check for duplicate slug
        const existing = await Post.findOne({ slug: finalSlug });
        if (existing) {
            // Delete uploaded file if exists
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.render('admin/form', {
                title: 'New Post - GeoPolitiq Admin',
                layout: 'layouts/admin',
                post: req.body,
                isEdit: false,
                error: 'A post with this slug already exists'
            });
        }

        // Convert Markdown to HTML
        const bodyHtml = marked(rawContent || '');

        // Parse comma-separated tags
        const tagArray = tags
            ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
            : [];

        // Determine featured image (uploaded file takes priority over URL)
        let featuredImage = null;
        if (req.file) {
            featuredImage = '/uploads/' + req.file.filename;
        } else if (featuredImageUrl) {
            featuredImage = featuredImageUrl;
        }

        // Generate default alt text from title if not provided
        const finalImageAlt = imageAlt || title;

        // Create post
        const post = new Post({
            title,
            slug: finalSlug,
            tldr,
            rawContent,
            bodyHtml,
            tags: tagArray,
            topicCluster: topicCluster || null,
            publishTime: publishTime ? new Date(publishTime) : null,
            status: status || 'draft',
            sourceUrl: sourceUrl || null,
            featuredImage,
            imageAlt: finalImageAlt
        });

        await post.save();

        res.redirect('/admin/posts?success=Post created successfully');
    } catch (error) {
        console.error('Create post error:', error);
        // Delete uploaded file if exists
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
        res.render('admin/form', {
            title: 'New Post - GeoPolitiq Admin',
            layout: 'layouts/admin',
            post: req.body,
            isEdit: false,
            error: error.message
        });
    }
};

/**
 * GET /admin/posts/:id/edit
 * Show edit form for existing post
 */
exports.showEditPostForm = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id).lean();

        if (!post) {
            return res.status(404).render('admin/error', {
                title: 'Not Found',
                layout: 'layouts/admin',
                message: 'Post not found'
            });
        }

        // Convert tags array to comma-separated string for form
        post.tagsString = post.tags ? post.tags.join(', ') : '';

        // Format publishTime for datetime-local input
        if (post.publishTime) {
            post.publishTimeFormatted = new Date(post.publishTime).toISOString().slice(0, 16);
        }

        res.render('admin/form', {
            title: `Edit: ${post.title} - GeoPolitiq Admin`,
            layout: 'layouts/admin',
            post,
            isEdit: true,
            error: null
        });
    } catch (error) {
        console.error('Edit post form error:', error);
        res.redirect('/admin/posts');
    }
};

/**
 * POST /admin/posts/:id
 * Update existing post with optional image upload
 */
exports.updatePost = async (req, res) => {
    try {
        const { title, slug, tldr, rawContent, tags, topicCluster, publishTime, status, sourceUrl, imageAlt, featuredImageUrl, removeImage } = req.body;

        // Check for duplicate slug (excluding current post)
        const existing = await Post.findOne({ slug, _id: { $ne: req.params.id } });
        if (existing) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            const post = await Post.findById(req.params.id).lean();
            post.tagsString = tags;
            return res.render('admin/form', {
                title: `Edit: ${title} - GeoPolitiq Admin`,
                layout: 'layouts/admin',
                post: { ...post, ...req.body },
                isEdit: true,
                error: 'A post with this slug already exists'
            });
        }

        // Get current post to check for existing image
        const currentPost = await Post.findById(req.params.id).lean();

        // Convert Markdown to HTML
        const bodyHtml = marked(rawContent || '');

        // Parse comma-separated tags
        const tagArray = tags
            ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
            : [];

        // Determine featured image
        let featuredImage = currentPost.featuredImage;

        // Handle image removal
        if (removeImage === 'true') {
            // Delete old uploaded file if it exists
            if (featuredImage && featuredImage.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, '../public', featuredImage);
                try { fs.unlinkSync(oldPath); } catch (e) { }
            }
            featuredImage = null;
        }

        // New upload takes priority
        if (req.file) {
            // Delete old uploaded file if exists
            if (currentPost.featuredImage && currentPost.featuredImage.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, '../public', currentPost.featuredImage);
                try { fs.unlinkSync(oldPath); } catch (e) { }
            }
            featuredImage = '/uploads/' + req.file.filename;
        } else if (featuredImageUrl && featuredImageUrl !== currentPost.featuredImage) {
            // Delete old uploaded file if switching to URL
            if (currentPost.featuredImage && currentPost.featuredImage.startsWith('/uploads/')) {
                const oldPath = path.join(__dirname, '../public', currentPost.featuredImage);
                try { fs.unlinkSync(oldPath); } catch (e) { }
            }
            featuredImage = featuredImageUrl;
        }

        // Generate default alt text from title if not provided
        const finalImageAlt = imageAlt || title;

        // Update post
        const post = await Post.findByIdAndUpdate(
            req.params.id,
            {
                title,
                slug,
                tldr,
                rawContent,
                bodyHtml,
                tags: tagArray,
                topicCluster: topicCluster || null,
                publishTime: publishTime ? new Date(publishTime) : null,
                status,
                sourceUrl: sourceUrl || null,
                featuredImage,
                imageAlt: finalImageAlt
            },
            { new: true, runValidators: true }
        );

        if (!post) {
            return res.status(404).render('admin/error', {
                title: 'Not Found',
                layout: 'layouts/admin',
                message: 'Post not found'
            });
        }

        res.redirect('/admin/posts?success=Post updated successfully');
    } catch (error) {
        console.error('Update post error:', error);
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
        const post = await Post.findById(req.params.id).lean();
        res.render('admin/form', {
            title: 'Edit Post - GeoPolitiq Admin',
            layout: 'layouts/admin',
            post: { ...post, ...req.body },
            isEdit: true,
            error: error.message
        });
    }
};

/**
 * POST /admin/posts/:id/delete
 * Delete post and its uploaded image
 */
exports.deletePost = async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);

        if (!post) {
            return res.redirect('/admin/posts?error=Post not found');
        }

        // Delete uploaded image if exists
        if (post.featuredImage && post.featuredImage.startsWith('/uploads/')) {
            const imagePath = path.join(__dirname, '../public', post.featuredImage);
            try { fs.unlinkSync(imagePath); } catch (e) { }
        }

        await Post.findByIdAndDelete(req.params.id);

        res.redirect('/admin/posts?success=Post deleted successfully');
    } catch (error) {
        console.error('Delete post error:', error);
        res.redirect('/admin/posts?error=Failed to delete post');
    }
};

// ═══════════════════════════════════════════════════════════
// AI CONTENT GENERATION
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/ai
 * Show AI generation dashboard
 */
exports.showAiDashboard = async (req, res) => {
    try {
        const status = scheduler.getStatus();
        const logs = await AiGenerationLog.getRecentLogs(20);
        const todayStats = await AiGenerationLog.getTodayStats();

        // Handle flash messages from query params
        let message = null;
        if (req.query.success) {
            message = { type: 'success', text: req.query.success };
        } else if (req.query.error) {
            message = { type: 'error', text: req.query.error };
        }

        res.render('admin/ai-dashboard', {
            title: 'AI Content Generation - GeoPolitiq',
            layout: 'layouts/admin',
            activePage: 'ai',
            status,
            logs,
            todayStats,
            message
        });
    } catch (error) {
        console.error('AI dashboard error:', error);
        res.render('admin/ai-dashboard', {
            title: 'AI Content Generation - GeoPolitiq',
            layout: 'layouts/admin',
            activePage: 'ai',
            status: scheduler.getStatus(),
            logs: [],
            todayStats: { totalAttempts: 0, successfulAttempts: 0, totalPostsGenerated: 0, avgProcessingTime: 0 },
            message: { type: 'error', text: 'Failed to load dashboard data' }
        });
    }
};

/**
 * POST /admin/ai/trigger
 * Manually trigger AI content generation
 */
exports.triggerAiGeneration = async (req, res) => {
    const startTime = Date.now();

    try {
        console.log('[Admin] Manual AI generation triggered');

        const result = await aiContentService.runGeneration();

        // Log the generation attempt
        await AiGenerationLog.logGeneration({
            model: require('../config/ai').primaryModel,
            success: result.success,
            postsGenerated: result.count || 0,
            postIds: result.posts?.map(p => p._id) || [],
            errorMessage: result.error,
            triggerType: 'manual',
            processingTimeMs: Date.now() - startTime
        });

        if (result.success) {
            res.redirect(`/admin/ai?success=Generated ${result.count} posts successfully`);
        } else {
            res.redirect(`/admin/ai?error=Generation failed: ${result.error}`);
        }
    } catch (error) {
        console.error('Trigger AI generation error:', error);

        // Log the failed attempt
        await AiGenerationLog.logGeneration({
            model: require('../config/ai').primaryModel,
            success: false,
            errorMessage: error.message,
            triggerType: 'manual',
            processingTimeMs: Date.now() - startTime
        });

        res.redirect(`/admin/ai?error=Generation failed: ${error.message}`);
    }
};

/**
 * POST /admin/ai/toggle
 * Toggle AI scheduler on/off
 */
exports.toggleAiScheduler = (req, res) => {
    try {
        const status = scheduler.getStatus();

        if (status.running) {
            scheduler.stop();
            res.redirect('/admin/ai?success=Scheduler stopped');
        } else {
            scheduler.start();
            res.redirect('/admin/ai?success=Scheduler started');
        }
    } catch (error) {
        console.error('Toggle scheduler error:', error);
        res.redirect(`/admin/ai?error=Failed to toggle scheduler: ${error.message}`);
    }
};

// ═══════════════════════════════════════════════════════════
// ANALYTICS DASHBOARD
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/analytics
 * Show analytics dashboard with visitor stats, popular posts, and notifications
 */
exports.showAnalytics = async (req, res) => {
    try {
        const PushSubscription = require('../models/PushSubscription');
        const RejectedView = require('../models/RejectedView');

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
            stats,
            countryData,
            dailyHistory,
            popularPostsRaw,
            notificationStats,
            referrerBreakdownRaw,
            topReferrersRaw,
            rejectionBreakdown,
            recentRejections,
        ] = await Promise.all([
            PageView.getStats(),
            PageView.getCountryBreakdown(5),
            PageView.getDailyHistory(30),
            PageView.getPopularPosts(10),
            PushSubscription.getStats(),
            // Referrer source buckets — direct, internal, search, social, news, external
            PageView.aggregate([
                { $match: { timestamp: { $gte: sevenDaysAgo } } },
                { $group: { _id: { $ifNull: ['$refSource', 'unknown'] }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            // Top external referer URLs (unique senders)
            PageView.aggregate([
                {
                    $match: {
                        timestamp: { $gte: sevenDaysAgo },
                        refSource: { $in: ['search', 'social', 'news', 'external'] },
                        referer: { $ne: '' },
                    },
                },
                { $group: { _id: '$referer', count: { $sum: 1 }, source: { $first: '$refSource' } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ]),
            RejectedView.getReasonBreakdown(sevenDaysAgo),
            RejectedView.getRecent(20),
        ]);

        // Enrich popular posts with titles from database
        const slugs = popularPostsRaw.map(p => p.slug);
        const posts = await Post.find({ slug: { $in: slugs } })
            .select('slug title')
            .lean();

        const titleMap = {};
        posts.forEach(p => { titleMap[p.slug] = p.title; });

        // Drop pageviews for slugs that no longer exist as published posts
        // (bots and stale crawls hit /post/<random> and the URL appears in raw analytics).
        const popularPosts = popularPostsRaw
            .filter(p => titleMap[p.slug])
            .map(p => ({ ...p, title: titleMap[p.slug] }));

        // Compute totals for the bot-filter widget.
        const totalRejections7d = rejectionBreakdown.reduce((acc, r) => acc + r.count, 0);
        const totalReferrerHits = referrerBreakdownRaw.reduce((acc, r) => acc + r.count, 0);
        const referrerBreakdown = referrerBreakdownRaw.map((r) => ({
            source: r._id,
            count: r.count,
            percentage: totalReferrerHits > 0 ? Math.round((r.count / totalReferrerHits) * 100) : 0,
        }));
        const topReferrers = topReferrersRaw.map((r) => ({ url: r._id, count: r.count, source: r.source }));

        res.render('admin/analytics', {
            title: 'Analytics - Admin',
            layout: 'layouts/admin',
            activePage: 'analytics',
            stats,
            countryData,
            dailyHistory,
            popularPosts,
            notificationStats,
            referrerBreakdown,
            topReferrers,
            rejectionBreakdown,
            recentRejections,
            totalRejections7d,
        });
    } catch (error) {
        console.error('Analytics dashboard error:', error);
        res.status(500).render('admin/error', {
            title: 'Error',
            layout: 'layouts/admin',
            message: 'Failed to load analytics'
        });
    }
};

/**
 * GET /admin/analytics/export
 * Export daily traffic data as CSV
 */
exports.exportAnalyticsCsv = async (req, res) => {
    try {
        const dailyHistory = await PageView.getDailyHistory(30);

        const csvRows = ['Date,Views,Growth %'];
        dailyHistory.forEach(day => {
            csvRows.push(`${day.date},${day.views},${day.growth}%`);
        });

        const csv = csvRows.join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=geopolitiq-analytics.csv');
        res.send(csv);
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ error: 'Failed to export analytics' });
    }
};
