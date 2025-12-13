/**
 * Push Subscription Model for GeoPolitiq
 * Stores push notification subscriptions with country preferences
 */

const mongoose = require('mongoose');

const PushSubscriptionSchema = new mongoose.Schema({
    endpoint: {
        type: String,
        required: true,
        unique: true
    },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true }
    },
    // User's preferred countries for notifications (maps to topicCluster)
    preferredCountries: [{
        type: String,
        enum: ['USA', 'INDIA', 'UK', 'EU', 'GLOBAL'],
        uppercase: true
    }],
    lastNotified: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes for efficient querying
PushSubscriptionSchema.index({ preferredCountries: 1 });
PushSubscriptionSchema.index({ endpoint: 1 });

// Get notification subscription statistics
PushSubscriptionSchema.statics.getStats = async function () {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [total, active, byCountry] = await Promise.all([
        this.countDocuments({}),
        this.countDocuments({ lastNotified: { $gte: thirtyDaysAgo } }),
        this.aggregate([
            { $unwind: '$preferredCountries' },
            { $group: { _id: '$preferredCountries', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ])
    ]);

    return {
        total,
        active,
        byCountry: byCountry.map(c => ({ country: c._id, count: c.count }))
    };
};

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);

