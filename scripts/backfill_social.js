/**
 * One-off: backfill social-repost tasks for posts that were generated
 * via manual trigger before the routing fix. Finds published posts that
 * have ZERO socialreposts rows and enqueues them.
 *
 * Also drops the 4 stale "Post no longer published" failed rows.
 */

require('dotenv').config({ path: '/opt/geopolitiq/.env' });
const mongoose = require('mongoose');

(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/geopolitiq');
    const Post = require('/opt/geopolitiq/models/Post');
    const SocialRepost = require('/opt/geopolitiq/models/SocialRepost');
    const { enqueueForPost } = require('/opt/geopolitiq/services/social/socialQueue');

    // 1) Drop the stale "Post no longer published" rows
    const dropped = await SocialRepost.deleteMany({
        errorMessage: { $regex: /Post no longer published/ },
    });
    console.log(`[backfill] dropped ${dropped.deletedCount} stale 'Post no longer published' rows`);

    // 2) Find published posts with no associated SocialRepost rows
    const allPublished = await Post.find({ status: 'published' }, { _id: 1, slug: 1, publishTime: 1 })
        .sort({ publishTime: -1 })
        .lean();

    let backfilled = 0;
    for (const p of allPublished) {
        const existing = await SocialRepost.countDocuments({ postId: p._id });
        if (existing === 0) {
            console.log(`[backfill] enqueueing ${p.slug.substring(0, 60)}`);
            const r = await enqueueForPost(p);
            backfilled += r.inserted;
        }
    }
    console.log(`[backfill] enqueued ${backfilled} new task(s)`);

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
});
