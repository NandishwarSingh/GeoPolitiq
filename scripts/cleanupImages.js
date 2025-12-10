/**
 * Cleanup Script: Remove posts with invalid/broken images
 * 
 * Usage: node scripts/cleanupImages.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Post = require('../models/Post');

// Blocked domains that don't allow hotlinking
const BLOCKED_DOMAINS = [
    'reuters.com', 'gettyimages.com', 'shutterstock.com',
    'alamy.com', 'istockphoto.com', 'depositphotos.com',
    'dreamstime.com', 'stock.adobe.com', 'newscom.com'
];

/**
 * Validate if an image URL is accessible
 */
async function validateImageUrl(imageUrl) {
    try {
        if (!imageUrl || !imageUrl.startsWith('http')) {
            return false;
        }

        // Skip blocked domains
        for (const domain of BLOCKED_DOMAINS) {
            if (imageUrl.includes(domain)) {
                return false;
            }
        }

        // Make HEAD request
        const response = await axios.head(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 8000,
            maxRedirects: 3
        });

        // Check status and content type
        if (response.status !== 200) return false;

        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) return false;

        return true;
    } catch (error) {
        return false;
    }
}

async function cleanup() {
    console.log('🧹 Image Cleanup Script\n');
    console.log('═'.repeat(50));

    try {
        // Connect to database
        console.log('\n📦 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/geopolitiq');
        console.log('✅ Connected\n');

        // Get all posts
        const posts = await Post.find({});
        console.log(`📊 Found ${posts.length} posts to check\n`);

        let validCount = 0;
        let invalidCount = 0;
        const invalidPosts = [];

        // Check each post's image
        for (const post of posts) {
            process.stdout.write(`Checking: ${post.title.substring(0, 40)}...`);

            const isValid = await validateImageUrl(post.featuredImage);

            if (isValid) {
                console.log(' ✅');
                validCount++;
            } else {
                console.log(' ❌ INVALID');
                invalidCount++;
                invalidPosts.push({
                    id: post._id,
                    title: post.title,
                    image: post.featuredImage
                });
            }
        }

        console.log('\n' + '═'.repeat(50));
        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Valid images: ${validCount}`);
        console.log(`   ❌ Invalid images: ${invalidCount}`);

        if (invalidPosts.length > 0) {
            console.log(`\n🗑️  Deleting ${invalidPosts.length} posts with invalid images...\n`);

            for (const post of invalidPosts) {
                await Post.findByIdAndDelete(post.id);
                console.log(`   Deleted: ${post.title.substring(0, 50)}...`);
            }

            console.log(`\n✅ Deleted ${invalidPosts.length} posts`);
        } else {
            console.log('\n✨ All posts have valid images!');
        }

        // Final count
        const remaining = await Post.countDocuments();
        console.log(`\n📊 Posts remaining: ${remaining}`);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n👋 Done!');
    }
}

// Run
cleanup();
