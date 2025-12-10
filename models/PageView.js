/**
 * PageView Model for Analytics
 * Tracks page visits with timestamps for analytics dashboard
 */

const mongoose = require('mongoose');

const PageViewSchema = new mongoose.Schema({
    path: {
        type: String,
        required: true,
        index: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },
    // Store hashed IP for privacy
    ipHash: {
        type: String,
        required: false
    },
    // Country from IP geolocation
    country: {
        type: String,
        required: false,
        index: true
    },
    // Store user agent for debugging bot detection
    userAgent: {
        type: String,
        required: false,
        maxlength: 500
    }
}, {
    timestamps: false,
    versionKey: false
});

// Compound index for efficient date range queries
PageViewSchema.index({ timestamp: -1 });

// Compound index for IP deduplication lookups
PageViewSchema.index({ ipHash: 1, timestamp: -1 });

// Static method to get all stats at once (including week)
PageViewSchema.statics.getStats = async function () {
    const now = new Date();

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Start of week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfYear = new Date(now);
    startOfYear.setMonth(0, 1);
    startOfYear.setHours(0, 0, 0, 0);

    const [todayCount, weekCount, monthCount, yearCount, totalCount] = await Promise.all([
        this.countDocuments({ timestamp: { $gte: today } }),
        this.countDocuments({ timestamp: { $gte: startOfWeek } }),
        this.countDocuments({ timestamp: { $gte: startOfMonth } }),
        this.countDocuments({ timestamp: { $gte: startOfYear } }),
        this.countDocuments({})
    ]);

    return { todayCount, weekCount, monthCount, yearCount, totalCount };
};

// Get country breakdown with percentages
PageViewSchema.statics.getCountryBreakdown = async function (limit = 5) {
    const result = await this.aggregate([
        { $match: { country: { $exists: true, $ne: null, $ne: '' } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit + 1 } // Get one extra to calculate "Others"
    ]);

    const totalWithCountry = await this.countDocuments({
        country: { $exists: true, $ne: null, $ne: '' }
    });

    if (totalWithCountry === 0) {
        return { countries: [], total: 0 };
    }

    let countries = result.slice(0, limit).map(r => ({
        country: r._id,
        count: r.count,
        percentage: Math.round((r.count / totalWithCountry) * 100)
    }));

    // Calculate "Others" if there are more countries
    if (result.length > limit) {
        const topSum = countries.reduce((sum, c) => sum + c.count, 0);
        const othersCount = totalWithCountry - topSum;
        if (othersCount > 0) {
            countries.push({
                country: 'Others',
                count: othersCount,
                percentage: Math.round((othersCount / totalWithCountry) * 100)
            });
        }
    }

    return { countries, total: totalWithCountry };
};

module.exports = mongoose.model('PageView', PageViewSchema);

