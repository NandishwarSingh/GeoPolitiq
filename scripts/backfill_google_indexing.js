/**
 * One-off: push every published post's URL to Google's Indexing API.
 *
 * Google's quota is 200/day per project, so this safely fits any cohort
 * we've published. Runs sequentially with tiny pauses to avoid bursting.
 */

require('dotenv').config({ path: '/opt/geopolitiq/.env' });
const mongoose = require('mongoose');

(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/geopolitiq');
    const Post = require('/opt/geopolitiq/models/Post');
    const { pingGoogleIndexing, isConfigured } = require('/opt/geopolitiq/services/googleIndexingService');

    if (!isConfigured()) {
        console.error('GOOGLE_INDEXING_SERVICE_ACCOUNT not set; aborting');
        process.exit(1);
    }

    const SITE = (process.env.SITE_URL || 'https://geopolitiq.com').replace(/\/$/, '');
    const posts = await Post.find({ status: 'published' }, { slug: 1, _id: 0 }).sort({ publishTime: -1 }).lean();
    const urls = posts.map((p) => `${SITE}/post/${p.slug}`);
    console.log(`backfilling ${urls.length} URLs to Google Indexing API...`);

    // Send in chunks of 5 with small pauses to avoid burst rate-limit
    const CHUNK = 5;
    for (let i = 0; i < urls.length; i += CHUNK) {
        const slice = urls.slice(i, i + CHUNK);
        const ok = await pingGoogleIndexing(slice);
        console.log(`  batch ${i / CHUNK + 1} (${slice.length} urls): ${ok ? '✅' : '❌'}`);
        await new Promise((r) => setTimeout(r, 500));
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
});
