/**
 * AI Seed Script for GeoPolitiq
 * Deletes existing posts and generates fresh ones using AI
 * 
 * Usage: node scripts/aiSeed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const aiContentService = require('../services/aiContentService');
const AiGenerationLog = require('../models/AiGenerationLog');
const Post = require('../models/Post');

async function seed() {
    console.log('🚀 Starting AI seed process...\n');

    // Check for API key
    if (!process.env.OPENROUTER_API_KEY) {
        console.error('❌ Error: OPENROUTER_API_KEY not set in .env');
        console.log('\nPlease add your OpenRouter API key to .env:');
        console.log('OPENROUTER_API_KEY=your-api-key-here\n');
        process.exit(1);
    }

    try {
        // Connect to database
        console.log('📦 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/geopolitiq');
        console.log('✅ Connected to MongoDB\n');

        // DELETE ALL EXISTING POSTS
        console.log('🗑️  Deleting all existing posts...');
        const deletedCount = await aiContentService.deleteAllPosts();
        console.log(`✅ Deleted ${deletedCount} posts\n`);

        // Also clear generation logs
        await AiGenerationLog.deleteMany({});
        console.log('✅ Cleared generation logs\n');

        // Test API connection first (with retry)
        console.log('🔗 Testing OpenRouter API connection...');
        const testResult = await aiContentService.testConnection();

        if (!testResult.success) {
            console.error(`❌ API connection failed after retries: ${testResult.error}`);
            process.exit(1);
        }
        console.log(`✅ API connection successful!\n`);

        // Generate posts in 2 batches (5 posts each = 10 total)
        let totalSaved = 0;
        let totalAttempted = 0;

        for (let batch = 1; batch <= 2; batch++) {
            console.log(`\n════════════════════════════════════════`);
            console.log(`📝 Generating batch ${batch}/2 (requesting 5 posts)...`);
            console.log(`════════════════════════════════════════\n`);

            const startTime = Date.now();

            try {
                const result = await aiContentService.runGeneration();

                // Log the generation
                await AiGenerationLog.logGeneration({
                    model: require('../config/ai').primaryModel,
                    success: result.success,
                    postsGenerated: result.count || 0,
                    postIds: result.posts?.map(p => p._id) || [],
                    errorMessage: result.error,
                    triggerType: 'seed',
                    processingTimeMs: Date.now() - startTime
                });

                if (result.success) {
                    totalSaved += result.count;
                    totalAttempted += 5;
                    console.log(`\n✅ Batch ${batch} complete: ${result.count}/5 posts saved (with valid images)`);

                    // Show titles
                    if (result.posts?.length > 0) {
                        console.log('\nSaved posts:');
                        result.posts.forEach((post, i) => {
                            console.log(`   ${i + 1}. ${post.title}`);
                        });
                    }

                    // Run tag migration after posts are created
                    console.log('\n🔗 Running tag migration...');
                    try {
                        const { runTagMigration } = require('../services/tagMigrationService');
                        const tagResult = await runTagMigration();
                        console.log(`✅ Tag migration: ${tagResult.updated || 0} posts updated`);
                    } catch (tagError) {
                        console.error(`⚠️ Tag migration failed: ${tagError.message}`);
                    }

                    // Send push notifications
                    console.log('\n🔔 Sending push notifications...');
                    try {
                        const { notifyUsersForPosts, isConfigured } = require('../services/pushNotificationService');
                        if (isConfigured()) {
                            const pushResult = await notifyUsersForPosts(result.posts || []);
                            console.log(`✅ Push notifications: ${pushResult.sent} sent, ${pushResult.failed} failed`);
                        } else {
                            console.log('⚠️ Push notifications not configured (VAPID keys missing)');
                        }
                    } catch (pushError) {
                        console.error(`⚠️ Push notifications failed: ${pushError.message}`);
                    }
                } else {
                    console.error(`\n❌ Batch ${batch} failed: ${result.error}`);
                }
            } catch (error) {
                console.error(`\n❌ Batch ${batch} error: ${error.message}`);
            }

            // Wait between batches to avoid rate limiting
            if (batch < 2) {
                console.log('\n⏳ Waiting 10 seconds before next batch...');
                await sleep(10000);
            }
        }

        console.log('\n════════════════════════════════════════');
        console.log(`🎉 SEED COMPLETE!`);
        console.log(`════════════════════════════════════════`);
        console.log(`Posts saved: ${totalSaved} (only those with valid images)`);
        console.log(`Posts skipped: ${totalAttempted - totalSaved} (invalid images)`);

        // Final count
        const finalCount = await Post.countDocuments();
        console.log(`\n📊 Total posts in database: ${finalCount}`);

    } catch (error) {
        console.error('❌ Seed failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Disconnected from MongoDB');
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the seed
seed();
