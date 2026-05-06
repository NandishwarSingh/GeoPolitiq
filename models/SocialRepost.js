/**
 * SocialRepost Model
 *
 * One row per (post, platform, subPlatform) — the unique compound index
 * IS the idempotency guarantee. Duplicate enqueues are silently rejected
 * by the database, not by application code.
 *
 * Status machine:
 *   pending  → in_flight → success
 *                       → failed (transient) → pending (retry until maxAttempts)
 *                       → failed (permanent)        — terminal
 *   pending  → skipped (dry run, content too long, etc.)
 *   pending  → paused  (circuit breaker tripped) — auto-resumes on cooldown
 */

const mongoose = require('mongoose');

const PLATFORMS = [
    'medium', 'telegraph', 'writefreely',
    'mastodon', 'pleroma', 'misskey', 'calckey', 'iceshrimp', 'friendica', 'gotosocial',
    'bluesky', 'nostr', 'twitter',
    'tumblr', 'plurk', 'mistly',
];

const ERROR_CATEGORIES = ['', 'auth', 'rate', 'transient', 'content', 'config'];

const SocialRepostSchema = new mongoose.Schema(
    {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
        postSlug: { type: String, required: true },

        platform: { type: String, required: true, enum: PLATFORMS, index: true },
        // For multi-instance platforms (Mastodon family): the instance host, e.g. 'mastodon.social'.
        // For single-network platforms (Bluesky, Medium): empty string.
        subPlatform: { type: String, default: '' },

        status: {
            type: String,
            enum: ['pending', 'in_flight', 'success', 'failed', 'skipped', 'paused'],
            default: 'pending',
            index: true,
        },

        // When this task is allowed to fire. Throttling sets this in the future.
        scheduledFor: { type: Date, default: Date.now, index: true },

        attempts: { type: Number, default: 0 },
        maxAttempts: { type: Number, default: 5 },
        lastAttemptAt: Date,
        nextAttemptAt: Date,

        // Set after a successful post. remoteUrl is the permalink we surface in admin.
        remoteId: String,
        remoteUrl: String,

        // Set after any failure. Category drives retry policy.
        errorMessage: String,
        errorCategory: { type: String, enum: ERROR_CATEGORIES, default: '' },

        // Exact payload sent to the platform — kept for forensic re-runs.
        payload: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: true }
);

// Idempotency: one row per (post, platform, subPlatform).
// Duplicate enqueueForPost() calls trip an E11000 from Mongo and we ignore it.
SocialRepostSchema.index({ postId: 1, platform: 1, subPlatform: 1 }, { unique: true });

// Worker query: pending tasks ready to run, oldest first.
SocialRepostSchema.index({ status: 1, scheduledFor: 1 });

// Admin dashboard query.
SocialRepostSchema.index({ createdAt: -1 });

/**
 * Atomic claim: flip a single pending task to 'in_flight' so two worker ticks
 * never run the same task. Returns the claimed doc or null if nothing to do.
 *
 * Filter: pending + scheduledFor <= now + (optional) platform filter.
 */
SocialRepostSchema.statics.claimNext = async function (filter = {}) {
    const now = new Date();
    const query = {
        status: 'pending',
        scheduledFor: { $lte: now },
        ...filter,
    };
    return this.findOneAndUpdate(
        query,
        {
            $set: { status: 'in_flight', lastAttemptAt: now },
            $inc: { attempts: 1 },
        },
        { sort: { scheduledFor: 1 }, new: true }
    );
};

/**
 * Mark a task succeeded.
 */
SocialRepostSchema.statics.markSuccess = async function (id, { remoteId, remoteUrl, payload }) {
    return this.findByIdAndUpdate(
        id,
        {
            $set: {
                status: 'success',
                remoteId,
                remoteUrl,
                payload,
                errorMessage: '',
                errorCategory: '',
            },
        },
        { new: true }
    );
};

/**
 * Mark a task failed. Auto-retry up to maxAttempts unless category is permanent.
 *
 * Permanent categories (no retry):
 *   - auth     (token rejected → admin must fix)
 *   - content  (e.g. payload too long → re-enqueue won't help)
 *   - config   (instance URL missing, etc.)
 *
 * Retryable categories:
 *   - rate       (429/420 — exponential backoff capped at 1h)
 *   - transient  (network 5xx, timeout, etc.)
 */
SocialRepostSchema.statics.markFailure = async function (id, { errorMessage, errorCategory }) {
    const doc = await this.findById(id);
    if (!doc) return null;

    const permanent = ['auth', 'content', 'config'].includes(errorCategory);
    const exhausted = doc.attempts >= doc.maxAttempts;

    if (permanent || exhausted) {
        doc.status = 'failed';
        doc.errorMessage = errorMessage;
        doc.errorCategory = errorCategory;
        await doc.save();
        return doc;
    }

    // Retryable: schedule next attempt with exponential backoff
    const delayMs =
        errorCategory === 'rate'
            ? Math.min(60_000 * Math.pow(2, doc.attempts), 60 * 60_000)   // up to 1h
            : Math.min(15_000 * Math.pow(2, doc.attempts), 30 * 60_000);  // up to 30 min

    doc.status = 'pending';
    doc.scheduledFor = new Date(Date.now() + delayMs);
    doc.nextAttemptAt = doc.scheduledFor;
    doc.errorMessage = errorMessage;
    doc.errorCategory = errorCategory;
    await doc.save();
    return doc;
};

/**
 * Per-platform aggregate stats for the admin dashboard.
 */
SocialRepostSchema.statics.getStatsByPlatform = async function (sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    return this.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
            $group: {
                _id: { platform: '$platform', status: '$status' },
                count: { $sum: 1 },
            },
        },
        {
            $group: {
                _id: '$_id.platform',
                statuses: { $push: { k: '$_id.status', v: '$count' } },
                total: { $sum: '$count' },
            },
        },
        {
            $project: {
                _id: 0,
                platform: '$_id',
                total: 1,
                statuses: { $arrayToObject: '$statuses' },
            },
        },
        { $sort: { total: -1 } },
    ]);
};

SocialRepostSchema.statics.getRecent = async function (limit = 50) {
    return this.find({}, {
        _id: 1, postSlug: 1, platform: 1, subPlatform: 1, status: 1,
        attempts: 1, scheduledFor: 1, lastAttemptAt: 1,
        remoteUrl: 1, errorMessage: 1, errorCategory: 1, createdAt: 1,
    })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
};

module.exports = mongoose.model('SocialRepost', SocialRepostSchema);
module.exports.PLATFORMS = PLATFORMS;
