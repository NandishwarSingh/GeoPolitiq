/**
 * Social Repost Queue
 *
 * Two responsibilities:
 *   1. enqueueForPost(post)     — create one pending task per configured platform
 *   2. drainOnce()              — claim+execute pending tasks (called by worker cron)
 *
 * Throttling is per-platform: we never fire two posts to the same platform
 * within THROTTLE_MS. Implemented by setting scheduledFor on enqueue based
 * on the most recent success on that platform.
 *
 * Circuit breaker: if a platform has 5 consecutive failures, all its pending
 * tasks are paused for COOLDOWN_MS. Auto-resumes when that window passes.
 */

const SocialRepost = require('../../models/SocialRepost');
const adapters = require('./adapters');
const { buildPayload } = require('./contentBuilder');
const { listPlatformConfigs } = require('./platformConfig');

const THROTTLE_MS = 30 * 60 * 1000;       // 30 min between same-platform posts
const COOLDOWN_MS = 60 * 60 * 1000;       // 1h pause after 5 consecutive failures
const MAX_TASKS_PER_TICK = 8;             // safety: don't drain more than this per tick
const FAILURE_STREAK_THRESHOLD = 5;

const DRY_RUN = () => process.env.SOCIAL_DRY_RUN === 'true';

/**
 * Enqueue one task per (configured platform × instance) for this post.
 * Idempotent: relies on the unique compound index in the model.
 */
async function enqueueForPost(post) {
    const configs = listPlatformConfigs();
    if (configs.length === 0) return { inserted: 0, skipped: 0 };

    // For throttling, find the latest successful attempt per platform
    // so we can stagger scheduledFor across the queue.
    const lastSuccess = await SocialRepost.aggregate([
        { $match: { status: 'success' } },
        { $sort: { lastAttemptAt: -1 } },
        { $group: { _id: { platform: '$platform', subPlatform: '$subPlatform' }, ts: { $first: '$lastAttemptAt' } } },
    ]);
    const lastSuccessMap = new Map();
    for (const row of lastSuccess) {
        lastSuccessMap.set(`${row._id.platform}|${row._id.subPlatform}`, row.ts);
    }

    const tasks = configs.map((cfg) => {
        const key = `${cfg.platform}|${cfg.subPlatform || ''}`;
        const last = lastSuccessMap.get(key);
        const earliest = last ? new Date(last.getTime() + THROTTLE_MS) : new Date();
        return {
            postId: post._id,
            postSlug: post.slug,
            platform: cfg.platform,
            subPlatform: cfg.subPlatform || '',
            status: 'pending',
            scheduledFor: earliest > new Date() ? earliest : new Date(),
        };
    });

    let inserted = 0;
    let skipped = 0;
    try {
        const r = await SocialRepost.insertMany(tasks, { ordered: false });
        inserted = r.length;
    } catch (err) {
        // BulkWriteError: some duplicates rejected by unique index — that's expected
        if (err.writeErrors) {
            inserted = (err.insertedDocs || []).length;
            skipped = err.writeErrors.length;
        } else {
            throw err;
        }
    }
    console.log(`[Social] Enqueued post=${post.slug} inserted=${inserted} skipped(dup)=${skipped}`);
    return { inserted, skipped };
}

/**
 * Check whether a platform is in cool-down due to recent failure streak.
 * Returns { paused: bool, until: Date|null }.
 */
async function platformCircuitState(platform, subPlatform) {
    // Look at last FAILURE_STREAK_THRESHOLD attempts in chronological order.
    const recent = await SocialRepost.find(
        { platform, subPlatform, status: { $in: ['success', 'failed'] } },
        { status: 1, lastAttemptAt: 1 }
    )
        .sort({ lastAttemptAt: -1 })
        .limit(FAILURE_STREAK_THRESHOLD)
        .lean();

    if (recent.length < FAILURE_STREAK_THRESHOLD) return { paused: false, until: null };
    const allFailed = recent.every((r) => r.status === 'failed');
    if (!allFailed) return { paused: false, until: null };

    const lastFail = recent[0].lastAttemptAt;
    const until = new Date(lastFail.getTime() + COOLDOWN_MS);
    return { paused: until > new Date(), until };
}

/**
 * Drain at most MAX_TASKS_PER_TICK tasks. Called every 2 min by the worker cron.
 * Per-platform safety: at most one task per platform-subPlatform per tick.
 */
async function drainOnce() {
    const platformsTouched = new Set();
    let processed = 0;

    for (let i = 0; i < MAX_TASKS_PER_TICK; i++) {
        // Find the oldest pending task whose platform we haven't touched this tick.
        const claimed = await SocialRepost.claimNext({
            $and: [
                { platform: { $nin: [...platformsTouched].map((k) => k.split('|')[0]) } },
            ],
        });
        if (!claimed) break;

        const platformKey = `${claimed.platform}|${claimed.subPlatform}`;
        platformsTouched.add(platformKey);

        // Circuit breaker check — if tripped, mark this task paused and continue.
        const { paused, until } = await platformCircuitState(claimed.platform, claimed.subPlatform);
        if (paused) {
            claimed.status = 'paused';
            claimed.scheduledFor = until;  // auto-resume at cooldown end
            claimed.errorMessage = `Circuit breaker open until ${until.toISOString()}`;
            claimed.errorCategory = 'transient';
            await claimed.save();
            console.log(`[Social] paused ${claimed.platform} until ${until.toISOString()}`);
            continue;
        }

        await executeTask(claimed);
        processed++;
    }

    if (processed > 0) console.log(`[Social] drainOnce: processed ${processed} task(s)`);
    return processed;
}

/**
 * Execute a single claimed task.
 *
 * Resolves the post, builds the payload via contentBuilder, hands it to
 * the platform's adapter, then writes back success/failure.
 */
async function executeTask(task) {
    const Post = require('../../models/Post');
    const post = await Post.findById(task.postId).lean();
    if (!post || post.status !== 'published') {
        await SocialRepost.markFailure(task._id, {
            errorMessage: 'Post no longer published',
            errorCategory: 'config',
        });
        return;
    }

    const adapter = adapters.getAdapter(task.platform);
    if (!adapter) {
        await SocialRepost.markFailure(task._id, {
            errorMessage: `No adapter for ${task.platform}`,
            errorCategory: 'config',
        });
        return;
    }

    let payload;
    try {
        payload = buildPayload(post, { platform: task.platform, subPlatform: task.subPlatform });
    } catch (err) {
        await SocialRepost.markFailure(task._id, {
            errorMessage: `Content build failed: ${err.message}`,
            errorCategory: 'content',
        });
        return;
    }

    if (DRY_RUN()) {
        console.log(`[Social][DRY_RUN] ${task.platform}${task.subPlatform ? '@' + task.subPlatform : ''}: would post`,
            JSON.stringify(payload).substring(0, 220));
        await SocialRepost.markSuccess(task._id, {
            remoteId: 'dry-run-' + task._id,
            remoteUrl: 'about:blank',
            payload,
        });
        return;
    }

    try {
        const result = await adapter.post(payload, { subPlatform: task.subPlatform });
        await SocialRepost.markSuccess(task._id, {
            remoteId: result.remoteId,
            remoteUrl: result.remoteUrl,
            payload,
        });
        console.log(`[Social] OK ${task.platform}${task.subPlatform ? '@' + task.subPlatform : ''} -> ${result.remoteUrl}`);
    } catch (err) {
        const category = categorizeError(err);
        const msg = (err.response?.data?.error || err.response?.statusText || err.message || 'unknown').toString().substring(0, 500);
        console.error(`[Social] FAIL ${task.platform} (${category}): ${msg}`);
        await SocialRepost.markFailure(task._id, { errorMessage: msg, errorCategory: category });
    }
}

function categorizeError(err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return 'auth';
    if (status === 402) return 'auth';
    if (status === 429) return 'rate';
    if (status >= 500 && status < 600) return 'transient';
    if (status === 400 || status === 422) return 'content';
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH') return 'transient';
    return 'transient';
}

module.exports = { enqueueForPost, drainOnce, executeTask };
