/**
 * Scheduler Service for GeoPolitiq
 * Manages automated content generation using node-cron
 */

const cron = require('node-cron');
const aiConfig = require('../config/ai');
const aiContentService = require('./aiContentService');
const { runTagMigration } = require('./tagMigrationService');


// Track scheduler state
let schedulerTask = null;
let socialWorkerTask = null;
let isRunning = false;
let lastRunTime = null;
let lastRunResult = null;

/**
 * Start the content generation scheduler
 */
function startScheduler() {
    if (schedulerTask) {
        console.log('[Scheduler] Already running');
        return { success: false, message: 'Scheduler already running' };
    }

    const cronExpression = aiConfig.scheduler.cronExpression;
    console.log(`[Scheduler] Starting with cron: ${cronExpression}`);

    schedulerTask = cron.schedule(cronExpression, async () => {
        await runGeneration();
    });

    // Social repost worker — drains pending tasks every 2 minutes (separate task,
    // doesn't touch the AI cron). Idempotent and rate-limited internally.
    if (!socialWorkerTask) {
        const { drainOnce } = require('./social/socialQueue');
        socialWorkerTask = cron.schedule('*/2 * * * *', async () => {
            try {
                await drainOnce();
            } catch (err) {
                console.error('[Social] worker tick error:', err.message);
            }
        });
        console.log('[Social] Worker cron started (*/2 * * * *)');
    }

    isRunning = true;
    console.log('[Scheduler] Started successfully');
    return { success: true, message: 'Scheduler started' };
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
    if (!schedulerTask) {
        console.log('[Scheduler] Not running');
        return { success: false, message: 'Scheduler not running' };
    }

    schedulerTask.stop();
    schedulerTask = null;
    if (socialWorkerTask) {
        socialWorkerTask.stop();
        socialWorkerTask = null;
        console.log('[Social] Worker cron stopped');
    }
    isRunning = false;
    console.log('[Scheduler] Stopped');
    return { success: true, message: 'Scheduler stopped' };
}

/**
 * Run a single generation cycle
 * After AI generates and verifies posts, run tag migration to ensure
 * all posts have proper tag backlinking (including older posts with new tags)
 * Then send push notifications to subscribed users
 */
async function runGeneration() {
    console.log('[Scheduler] Running generation...');
    lastRunTime = new Date();

    try {
        const result = await aiContentService.runGeneration();

        // Run tag migration after new posts are created
        // This ensures all posts (including existing ones) have updated tag links
        if (result.success && result.count > 0) {
            console.log('[Scheduler] Running tag migration...');
            const migrationResult = await runTagMigration();
            result.tagMigration = migrationResult;
            console.log(`[Scheduler] Tag migration: ${migrationResult.updated || 0} posts updated`);

            // Send push notifications for new posts
            try {
                const { notifyUsersForPosts } = require('./pushNotificationService');
                console.log('[Scheduler] Sending push notifications...');
                const pushResult = await notifyUsersForPosts(result.posts || []);
                result.pushNotifications = pushResult;
                console.log(`[Scheduler] Push notifications: ${pushResult.sent} sent, ${pushResult.failed} failed`);
            } catch (pushError) {
                console.error('[Scheduler] Push notifications failed:', pushError.message);
                result.pushNotifications = { error: pushError.message };
            }

            // Enqueue social reposts (Phase 0 — actual posting deferred to worker cron)
            try {
                const { enqueueForPost } = require('./social/socialQueue');
                let totalInserted = 0;
                for (const p of result.posts || []) {
                    const r = await enqueueForPost(p);
                    totalInserted += r.inserted;
                }
                result.socialEnqueued = totalInserted;
                console.log(`[Scheduler] Social reposts enqueued: ${totalInserted}`);
            } catch (socialError) {
                console.error('[Scheduler] Social enqueue failed:', socialError.message);
                result.socialEnqueued = { error: socialError.message };
            }

            // Push the new URLs to IndexNow (Bing / Yandex / Naver / Seznam / Mojeek)
            try {
                const { pingIndexNow } = require('./indexNowService');
                const urls = (result.posts || []).map((p) => `${(process.env.SITE_URL || 'https://geopolitiq.com').replace(/\/$/, '')}/post/${p.slug}`);
                if (urls.length > 0) {
                    const ok = await pingIndexNow(urls);
                    result.indexNow = ok;
                    console.log(`[Scheduler] IndexNow: ${ok ? 'submitted ' + urls.length + ' urls' : 'skipped'}`);
                }
            } catch (idxErr) {
                console.error('[Scheduler] IndexNow failed:', idxErr.message);
                result.indexNow = { error: idxErr.message };
            }
        }

        lastRunResult = result;
        console.log(`[Scheduler] Generation complete: ${result.count || 0} posts`);
        return result;
    } catch (error) {
        console.error('[Scheduler] Generation failed:', error.message);
        lastRunResult = { success: false, error: error.message };
        return lastRunResult;
    }
}


/**
 * Get scheduler status
 */
function getStatus() {
    return {
        isRunning,
        cronExpression: aiConfig.scheduler.cronExpression,
        lastRunTime,
        lastRunResult,
        enabled: aiConfig.scheduler.enabled
    };
}

/**
 * Trigger a manual generation run
 */
async function triggerManualRun() {
    console.log('[Scheduler] Manual run triggered');
    return await runGeneration();
}

/**
 * Initialize scheduler on app startup if enabled
 */
function init() {
    if (aiConfig.scheduler.enabled) {
        console.log('[Scheduler] Auto-start enabled, starting...');
        startScheduler();
    } else {
        console.log('[Scheduler] Auto-start disabled');
    }
}

module.exports = {
    startScheduler,
    stopScheduler,
    getStatus,
    triggerManualRun,
    runGeneration,
    init
};
