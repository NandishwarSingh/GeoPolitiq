#!/usr/bin/env node
/**
 * Migration Script: Apply Tag Backlinking to Existing Posts
 * 
 * This script updates all existing posts to include tag backlinks
 * using the Aho-Corasick tag matcher.
 * 
 * Usage: node scripts/migrateTagLinks.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { marked } = require('marked');
const Post = require('../models/Post');
const tagMatcher = require('../services/tagMatcher');
const { sanitizeTables } = require('../utils/tableSanitizer');

async function migrate() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║   Tag Backlinking & Table Fix Migration                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    try {
        // Connect to database
        console.log('[1/4] Connecting to database...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/geopolitiq');
        console.log('      ✓ Connected\n');

        // Build tag index
        console.log('[2/4] Building tag index...');
        const allTags = await Post.distinct('tags', { status: 'published' });
        await tagMatcher.buildIndex(allTags);
        const stats = tagMatcher.getStats();
        console.log(`      ✓ Indexed ${stats.tagCount} tags\n`);

        // Fetch all posts
        console.log('[3/4] Fetching posts...');
        const posts = await Post.find({ status: 'published' });
        console.log(`      ✓ Found ${posts.length} posts\n`);

        // Update each post
        console.log('[4/4] Applying table fixes & tag links...\n');
        let updated = 0;
        let skipped = 0;

        for (const post of posts) {
            try {
                // Re-convert markdown and apply tag links
                const rawContent = post.rawContent;
                if (!rawContent) {
                    console.log(`      ⚠ Skip (no rawContent): ${post.title.substring(0, 50)}...`);
                    skipped++;
                    continue;
                }

                // Sanitize tables before markdown conversion
                const cleanContent = sanitizeTables(rawContent);
                let newBodyHtml = marked(cleanContent);
                newBodyHtml = tagMatcher.linkify(newBodyHtml);

                // Only update if changed
                if (newBodyHtml !== post.bodyHtml) {
                    post.bodyHtml = newBodyHtml;
                    await post.save();
                    updated++;
                    console.log(`      ✓ Updated: ${post.title.substring(0, 50)}...`);
                } else {
                    skipped++;
                }
            } catch (err) {
                console.log(`      ✗ Error: ${post.title.substring(0, 40)}... - ${err.message}`);
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(`   Migration Complete!`);
        console.log(`   Updated: ${updated} posts`);
        console.log(`   Skipped: ${skipped} posts`);
        console.log('═══════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n✗ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed.');
    }
}

migrate();
