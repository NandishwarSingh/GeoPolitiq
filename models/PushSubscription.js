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

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
