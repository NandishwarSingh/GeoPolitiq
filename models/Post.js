const mongoose = require('mongoose');
const slugify = require('slugify');

const PostSchema = new mongoose.Schema({
    // ═══════════════════════════════════════════════════════════
    // V1 CORE FIELDS
    // ═══════════════════════════════════════════════════════════

    slug: {
        type: String,
        required: [true, 'Slug is required'],
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },

    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxLength: [300, 'Title cannot exceed 300 characters']
    },

    tldr: {
        type: String,
        required: [true, 'TL;DR summary is required'],
        maxLength: [500, 'TL;DR cannot exceed 500 characters']
    },

    bodyHtml: {
        type: String,
        required: [true, 'Body HTML content is required']
    },

    rawContent: {
        type: String,
        required: [true, 'Raw content (Markdown) is required']
    },

    tags: [{
        type: String,
        lowercase: true,
        trim: true
    }],

    topicCluster: {
        type: String,
        trim: true,
        index: true
        // e.g., "US-China Relations", "European Energy", "Middle East Conflict"
    },

    publishTime: {
        type: Date,
        index: true
    },

    sourceUrl: {
        type: String,
        trim: true
    },

    // Author information from original source
    authorName: {
        type: String,
        trim: true
        // e.g., "John Smith" or "Reuters Staff"
    },

    authorOrg: {
        type: String,
        trim: true
        // e.g., "Reuters", "AP News", "BBC"
    },

    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft',
        index: true
    },

    // ═══════════════════════════════════════════════════════════
    // FUTURE EXTENSIBILITY FIELDS
    // ═══════════════════════════════════════════════════════════

    // Key facts/data points displayed in a sidebar box
    factBox: {
        type: Map,
        of: String
        // e.g., { "Population": "1.4B", "GDP": "$17.7T", "Leader": "Xi Jinping" }
    },

    // Named entities extracted from the content
    entities: [{
        name: { type: String, trim: true },
        type: { type: String, enum: ['person', 'org', 'location', 'event', 'other'] },
        wikiUrl: String
    }],

    // Geographic classification
    primaryCountry: {
        type: String,
        uppercase: true,
        maxLength: 2  // ISO 3166-1 alpha-2 (e.g., "US", "CN", "RU")
    },

    affectedCountries: [{
        type: String,
        uppercase: true,
        maxLength: 2
    }],

    regions: [{
        type: String,
        trim: true
        // e.g., "Asia-Pacific", "Middle East", "Eastern Europe"
    }],

    // Link to external dataset for charts/visualizations
    visualDatasetKey: {
        type: String,
        trim: true
        // Reference ID to a Dataset collection or external data source
    },

    // Engagement & trending metrics
    trendingScore: {
        type: Number,
        default: 0,
        min: 0
    },

    engagementRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },

    // ═══════════════════════════════════════════════════════════
    // ADDITIONAL METADATA
    // ═══════════════════════════════════════════════════════════

    // Featured image for cards/social sharing
    featuredImage: {
        type: String,
        trim: true
    },

    // Image source for attribution
    imageSource: {
        type: String,
        trim: true
        // e.g., "Reuters", "AP", "Getty Images", "Wikimedia Commons"
    },

    // Alt text for featured image (SEO)
    imageAlt: {
        type: String,
        trim: true,
        maxLength: 200
    },

    // Author (for multi-author support later)
    author: {
        type: String,
        trim: true,
        default: 'GeoPolitiq Editorial'
    },

    // SEO fields
    metaTitle: {
        type: String,
        maxLength: 60
    },

    metaDescription: {
        type: String,
        maxLength: 160
    },

    // Related posts (manual curation)
    relatedPosts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Post'
    }]

}, {
    timestamps: true  // Adds createdAt and updatedAt automatically
});

// ═══════════════════════════════════════════════════════════
// MIDDLEWARE (Hooks)
// ═══════════════════════════════════════════════════════════

// Auto-generate slug from title if not provided
PostSchema.pre('validate', function (next) {
    if (this.title && !this.slug) {
        this.slug = slugify(this.title, {
            lower: true,
            strict: true,
            remove: /[*+~.()'"!:@]/g
        });
    }
    next();
});

// Set publishTime when status changes to published
PostSchema.pre('save', function (next) {
    if (this.isModified('status') && this.status === 'published' && !this.publishTime) {
        this.publishTime = new Date();
    }
    next();
});

// ═══════════════════════════════════════════════════════════
// VIRTUALS
// ═══════════════════════════════════════════════════════════

// Formatted date string
PostSchema.virtual('formattedDate').get(function () {
    const date = this.publishTime || this.createdAt;
    if (!date) return '';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
});

// Relative time (e.g., "3h ago", "2d ago")
PostSchema.virtual('relativeTime').get(function () {
    const date = this.publishTime || this.createdAt;
    if (!date) return '';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return this.formattedDate;
});

// Check if post is recently published (within 24h)
PostSchema.virtual('isBreaking').get(function () {
    if (this.status !== 'published' || !this.publishTime) return false;
    const hoursSincePublish = (new Date() - this.publishTime) / 3600000;
    return hoursSincePublish < 24;
});

// Ensure virtuals are included in JSON/Object output
PostSchema.set('toJSON', { virtuals: true });
PostSchema.set('toObject', { virtuals: true });

// ═══════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════

// Primary query patterns
PostSchema.index({ status: 1, publishTime: -1 });           // Feed listing
PostSchema.index({ topicCluster: 1, publishTime: -1 });     // Topic feeds
PostSchema.index({ tags: 1, publishTime: -1 });             // Tag filtering
PostSchema.index({ primaryCountry: 1, publishTime: -1 });   // Country feeds
PostSchema.index({ affectedCountries: 1 });                 // Multi-country lookup
PostSchema.index({ regions: 1 });                           // Region filtering
PostSchema.index({ trendingScore: -1 });                    // Trending posts
PostSchema.index({ createdAt: -1 });                        // Admin listing
PostSchema.index({ updatedAt: -1 });                        // Recently updated

// Text search index
PostSchema.index(
    { title: 'text', tldr: 'text', rawContent: 'text' },
    { weights: { title: 10, tldr: 5, rawContent: 1 } }
);

// ═══════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════

// Find published posts with pagination
PostSchema.statics.findPublished = function (options = {}) {
    const { page = 1, limit = 12, sort = { publishTime: -1 } } = options;
    return this.find({ status: 'published' })
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
};

// Find by topic cluster
PostSchema.statics.findByCluster = function (cluster, options = {}) {
    const { page = 1, limit = 12 } = options;
    return this.find({ status: 'published', topicCluster: cluster })
        .sort({ publishTime: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
};

// Find trending posts
PostSchema.statics.findTrending = function (limit = 10) {
    return this.find({ status: 'published' })
        .sort({ trendingScore: -1, publishTime: -1 })
        .limit(limit)
        .lean();
};

module.exports = mongoose.model('Post', PostSchema);
