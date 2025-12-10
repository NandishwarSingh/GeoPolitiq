/**
 * AI Generation Log Model
 * Tracks AI content generation attempts for monitoring
 */

const mongoose = require('mongoose');

const AiGenerationLogSchema = new mongoose.Schema({
    // Timestamp
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },

    // Model used
    model: {
        type: String,
        required: true
    },

    // API key index (for debugging, not storing actual key)
    apiKeyIndex: {
        type: Number,
        default: 0
    },

    // Generation result
    success: {
        type: Boolean,
        required: true
    },

    // Number of posts generated
    postsGenerated: {
        type: Number,
        default: 0
    },

    // Post IDs generated (references)
    postIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'
    }],

    // Error message if failed
    errorMessage: {
        type: String
    },

    // Trigger type
    triggerType: {
        type: String,
        enum: ['scheduled', 'manual', 'seed'],
        default: 'scheduled'
    },

    // Processing time in ms
    processingTimeMs: {
        type: Number
    }
}, {
    timestamps: true
});

// Index for querying recent logs
AiGenerationLogSchema.index({ createdAt: -1 });

// Static method to log a generation attempt
AiGenerationLogSchema.statics.logGeneration = async function (data) {
    return await this.create(data);
};

// Static method to get recent logs
AiGenerationLogSchema.statics.getRecentLogs = async function (limit = 20) {
    return await this.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
};

// Static method to get today's stats
AiGenerationLogSchema.statics.getTodayStats = async function () {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await this.aggregate([
        { $match: { createdAt: { $gte: today } } },
        {
            $group: {
                _id: null,
                totalAttempts: { $sum: 1 },
                successfulAttempts: { $sum: { $cond: ['$success', 1, 0] } },
                totalPostsGenerated: { $sum: '$postsGenerated' },
                avgProcessingTime: { $avg: '$processingTimeMs' }
            }
        }
    ]);

    return stats[0] || {
        totalAttempts: 0,
        successfulAttempts: 0,
        totalPostsGenerated: 0,
        avgProcessingTime: 0
    };
};

module.exports = mongoose.model('AiGenerationLog', AiGenerationLogSchema);
