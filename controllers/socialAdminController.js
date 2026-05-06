/**
 * Admin controller for /admin/social
 *
 * GET    /admin/social             dashboard
 * POST   /admin/social/retry/:id   reset a failed task to pending now
 * POST   /admin/social/skip/:id    mark a task as skipped (won't retry)
 * POST   /admin/social/drain       force one drain tick (debug)
 */

const SocialRepost = require('../models/SocialRepost');
const { drainOnce } = require('../services/social/socialQueue');
const { listPlatformConfigs } = require('../services/social/platformConfig');

exports.dashboard = async (req, res) => {
    try {
        const [stats, recent] = await Promise.all([
            SocialRepost.getStatsByPlatform(30),
            SocialRepost.getRecent(50),
        ]);

        const configured = listPlatformConfigs();
        const dryRun = process.env.SOCIAL_DRY_RUN === 'true';

        res.render('admin/social', {
            title: 'Social Reposts - Admin',
            layout: 'layouts/admin',
            activePage: 'social',
            stats,
            recent,
            configured,
            dryRun,
            flashSuccess: req.query.success || '',
            flashError: req.query.error || '',
        });
    } catch (err) {
        console.error('[admin/social] dashboard error:', err);
        res.status(500).render('admin/error', {
            title: 'Error',
            layout: 'layouts/admin',
            message: 'Failed to load social dashboard',
        });
    }
};

exports.retry = async (req, res) => {
    try {
        const doc = await SocialRepost.findById(req.params.id);
        if (!doc) return res.redirect('/admin/social?error=not_found');
        doc.status = 'pending';
        doc.scheduledFor = new Date();
        doc.errorMessage = '';
        doc.errorCategory = '';
        await doc.save();
        res.redirect('/admin/social?success=retry_queued');
    } catch (err) {
        console.error('[admin/social] retry error:', err);
        res.redirect('/admin/social?error=retry_failed');
    }
};

exports.skip = async (req, res) => {
    try {
        await SocialRepost.findByIdAndUpdate(req.params.id, {
            $set: { status: 'skipped', errorMessage: 'Manually skipped' },
        });
        res.redirect('/admin/social?success=skipped');
    } catch (err) {
        console.error('[admin/social] skip error:', err);
        res.redirect('/admin/social?error=skip_failed');
    }
};

exports.drain = async (req, res) => {
    try {
        const n = await drainOnce();
        res.redirect(`/admin/social?success=drained_${n}`);
    } catch (err) {
        console.error('[admin/social] drain error:', err);
        res.redirect('/admin/social?error=drain_failed');
    }
};
