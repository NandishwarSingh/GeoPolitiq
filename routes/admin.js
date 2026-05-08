const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuth = require('../middleware/adminAuth');
const upload = require('../config/upload');

// ═══════════════════════════════════════════════════════════
// PUBLIC ADMIN ROUTES (No auth required)
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin
 * Admin login page
 */
router.get('/', adminController.showLogin);

/**
 * POST /admin
 * Process login
 */
router.post('/', adminController.login);

/**
 * GET /admin/logout
 * Logout and destroy session
 */
router.get('/logout', adminController.logout);

// ═══════════════════════════════════════════════════════════
// PROTECTED ADMIN ROUTES (Auth required)
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/posts
 * List all posts with title, slug, status, publishTime
 * Links to edit/delete each post
 */
router.get('/posts', adminAuth, adminController.listPosts);

/**
 * GET /admin/posts/new
 * Form to create new post
 */
router.get('/posts/new', adminAuth, adminController.showNewPostForm);

/**
 * POST /admin/posts
 * Create new post with optional image upload
 */
router.post('/posts', adminAuth, upload.single('featuredImage'), adminController.createPost);

/**
 * GET /admin/posts/:id/edit
 * Edit form for existing post
 */
router.get('/posts/:id/edit', adminAuth, adminController.showEditPostForm);

/**
 * POST /admin/posts/:id
 * Update existing post with optional image upload
 */
router.post('/posts/:id', adminAuth, upload.single('featuredImage'), adminController.updatePost);

/**
 * POST /admin/posts/:id/delete
 * Delete post
 */
router.post('/posts/:id/delete', adminAuth, adminController.deletePost);

// ═══════════════════════════════════════════════════════════
// AI CONTENT GENERATION ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/ai
 * AI generation dashboard
 */
router.get('/ai', adminAuth, adminController.showAiDashboard);

/**
 * POST /admin/ai/trigger
 * Manually trigger content generation
 */
router.post('/ai/trigger', adminAuth, adminController.triggerAiGeneration);

/**
 * POST /admin/ai/toggle
 * Enable/disable scheduler
 */
router.post('/ai/toggle', adminAuth, adminController.toggleAiScheduler);

// ═══════════════════════════════════════════════════════════
// ANALYTICS ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * GET /admin/analytics
 * Analytics dashboard
 */
router.get('/analytics', adminAuth, adminController.showAnalytics);

/**
 * GET /admin/analytics/export
 * Export analytics data as CSV
 */
router.get('/analytics/export', adminAuth, adminController.exportAnalyticsCsv);


// ═══════════════════════════════════════════════════════════
// SOCIAL REPOST DASHBOARD
// ═══════════════════════════════════════════════════════════

const socialAdmin = require('../controllers/socialAdminController');

router.get('/social', adminAuth, socialAdmin.dashboard);
router.post('/social/retry/:id', adminAuth, socialAdmin.retry);
router.post('/social/skip/:id', adminAuth, socialAdmin.skip);
router.post('/social/drain', adminAuth, socialAdmin.drain);



module.exports = router;

