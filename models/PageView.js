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

// Static method to get all stats at once (including comparisons)
PageViewSchema.statics.getStats = async function () {
    const now = new Date();

    // Current periods
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Yesterday
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayEnd = new Date(today);

    // Start of this week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    // Start of last week
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    const endOfLastWeek = new Date(startOfWeek);

    // Start of this month
    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Start of last month
    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    const endOfLastMonth = new Date(startOfMonth);

    // Start of this year
    const startOfYear = new Date(now);
    startOfYear.setMonth(0, 1);
    startOfYear.setHours(0, 0, 0, 0);

    // Start of last year
    const startOfLastYear = new Date(startOfYear);
    startOfLastYear.setFullYear(startOfLastYear.getFullYear() - 1);
    const endOfLastYear = new Date(startOfYear);

    const [
        todayCount,
        yesterdayCount,
        weekCount,
        lastWeekCount,
        monthCount,
        lastMonthCount,
        yearCount,
        lastYearCount,
        totalCount
    ] = await Promise.all([
        this.countDocuments({ timestamp: { $gte: today } }),
        this.countDocuments({ timestamp: { $gte: yesterday, $lt: yesterdayEnd } }),
        this.countDocuments({ timestamp: { $gte: startOfWeek } }),
        this.countDocuments({ timestamp: { $gte: startOfLastWeek, $lt: endOfLastWeek } }),
        this.countDocuments({ timestamp: { $gte: startOfMonth } }),
        this.countDocuments({ timestamp: { $gte: startOfLastMonth, $lt: endOfLastMonth } }),
        this.countDocuments({ timestamp: { $gte: startOfYear } }),
        this.countDocuments({ timestamp: { $gte: startOfLastYear, $lt: endOfLastYear } }),
        this.countDocuments({})
    ]);

    // Calculate percentage changes
    const calcChange = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
    };

    return {
        todayCount,
        yesterdayCount,
        weekCount,
        lastWeekCount,
        monthCount,
        lastMonthCount,
        yearCount,
        lastYearCount,
        totalCount,
        // Percentage changes
        dayChange: calcChange(todayCount, yesterdayCount),
        weekChange: calcChange(weekCount, lastWeekCount),
        monthChange: calcChange(monthCount, lastMonthCount),
        yearChange: calcChange(yearCount, lastYearCount)
    };
};

// Get country breakdown with percentages (includes Unknown in Others)
PageViewSchema.statics.getCountryBreakdown = async function (limit = 5) {
    // Get all visits total
    const totalVisits = await this.countDocuments({});

    if (totalVisits === 0) {
        return { countries: [], total: 0 };
    }

    // Get country breakdown (excluding Local, Unknown, and empty)
    const result = await this.aggregate([
        {
            $match: {
                country: {
                    $exists: true,
                    $ne: null,
                    $ne: '',
                    $ne: 'Local',
                    $ne: 'Unknown'
                }
            }
        },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit + 1 } // Get one extra to check if there are more
    ]);

    let countries = result.slice(0, limit).map(r => ({
        country: r._id,
        count: r.count,
        percentage: Math.round((r.count / totalVisits) * 100)
    }));

    // Calculate "Others" - includes remaining countries + Local + Unknown + empty
    const topSum = countries.reduce((sum, c) => sum + c.count, 0);
    const othersCount = totalVisits - topSum;

    if (othersCount > 0) {
        countries.push({
            country: 'Others',
            count: othersCount,
            percentage: Math.round((othersCount / totalVisits) * 100)
        });
    }

    return { countries, total: totalVisits };
};

module.exports = mongoose.model('PageView', PageViewSchema);

