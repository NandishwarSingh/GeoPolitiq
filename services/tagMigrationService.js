/**
 * Tag Migration Service
 * Applies tag backlinking to all published posts
 * Called automatically after AI content generation
 */

const { marked } = require('marked');
const Post = require('../models/Post');
const tagMatcher = require('./tagMatcher');
const { sanitizeTables } = require('../utils/tableSanitizer');

/**
 * Run tag migration on all published posts
 * Rebuilds the tag index and re-applies tag links to all posts
 * @returns {Object} Migration results
 */
async function runTagMigration() {
    console.log('[TagMigration] Starting tag backlinking migration...');

    try {
        // Build tag index from all published posts
        const allTags = await Post.distinct('tags', { status: 'published' });
        await tagMatcher.buildIndex(allTags);
        const stats = tagMatcher.getStats();
        console.log(`[TagMigration] Indexed ${stats.tagCount} tags`);

        // Fetch all published posts
        const posts = await Post.find({ status: 'published' });
        console.log(`[TagMigration] Processing ${posts.length} posts...`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const post of posts) {
            try {
                const rawContent = post.rawContent;
                if (!rawContent) {
                    skipped++;
                    continue;
                }

                // Sanitize tables and convert markdown
                const cleanContent = sanitizeTables(rawContent);
                let newBodyHtml = marked(cleanContent);
                newBodyHtml = tagMatcher.linkify(newBodyHtml);

                // Only update if changed
                if (newBodyHtml !== post.bodyHtml) {
                    post.bodyHtml = newBodyHtml;
                    await post.save();
                    updated++;
                } else {
                    skipped++;
                }
            } catch (err) {
                console.error(`[TagMigration] Error on "${post.title.substring(0, 40)}...": ${err.message}`);
                errors++;
            }
        }

        console.log(`[TagMigration] Complete: ${updated} updated, ${skipped} skipped, ${errors} errors`);

        return {
            success: true,
            updated,
            skipped,
            errors,
            totalTags: stats.tagCount
        };
    } catch (error) {
        console.error('[TagMigration] Failed:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    runTagMigration
};
