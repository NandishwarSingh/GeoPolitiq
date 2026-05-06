/**
 * RejectedView Model
 * Persists requests that the bot detector rejected so the admin dashboard
 * can show *what* is being filtered out.
 *
 * Documents auto-expire after 7 days via a TTL index, so the collection
 * never grows unbounded.
 */

const mongoose = require('mongoose');

const RejectedViewSchema = new mongoose.Schema(
    {
        path: { type: String, required: true },
        timestamp: { type: Date, default: Date.now, index: true },
        reason: {
            type: String,
            required: true,
            enum: [
                'isbot-dictionary',
                'pattern-match',
                'ua-too-short',
                'missing-accept-language',
                'missing-accept-encoding',
                'no-html-accept',
                'missing-sec-fetch',
                'chrome-without-sec-ch-ua',
                'browser-version-ancient',
                'cold-hit-stale-ua',
            ],
            index: true,
        },
        ipHash: { type: String, required: false },
        country: { type: String, required: false },
        userAgent: { type: String, required: false, maxlength: 500 },
        referer: { type: String, required: false, maxlength: 500 },
    },
    { timestamps: false, versionKey: false }
);

// Auto-delete documents 7 days after creation.
RejectedViewSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

RejectedViewSchema.statics.getReasonBreakdown = async function (since) {
    const match = since ? { timestamp: { $gte: since } } : {};
    return this.aggregate([
        { $match: match },
        { $group: { _id: '$reason', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
    ]);
};

RejectedViewSchema.statics.getRecent = async function (limit = 25) {
    return this.find({}, { _id: 0, path: 1, reason: 1, timestamp: 1, country: 1, userAgent: 1, referer: 1 })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
};

module.exports = mongoose.model('RejectedView', RejectedViewSchema);
