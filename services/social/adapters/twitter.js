/**
 * Twitter / X Adapter
 *
 * Auth (env) — OAuth 1.0a User Context (4 long-lived credentials, no
 * refresh dance):
 *   TWITTER_CONSUMER_KEY
 *   TWITTER_CONSUMER_SECRET
 *   TWITTER_ACCESS_TOKEN
 *   TWITTER_ACCESS_SECRET
 *
 * Flow:
 *   1. Resolve our own user @screen_name once (cached) so we can return
 *      a clean https://twitter.com/<handle>/status/<id> URL.
 *   2. If payload.image exists, fetch bytes and upload via v1.1 media
 *      endpoint (still required — v2 doesn't have media upload yet).
 *   3. Post via v2 /tweets with optional media_ids.
 *
 * Free-tier reality (Nov 2024):
 *   1,500 tweets/month (≈50/day). At our cadence (≈4/day) we're well under.
 *   429s are rare but possible — categorize as 'rate' for queue backoff.
 *
 * Error mapping:
 *   401 / 403          → auth
 *   429                → rate
 *   5xx / network      → transient
 *   400 / 422          → content (no retry — payload was rejected)
 */

const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');

let cachedClient = null;
let cachedHandle = null;

function makeError(message, status, data) {
    const err = new Error(message);
    err.response = { status, data };
    return err;
}

function getClient() {
    if (cachedClient) return cachedClient;
    const ck = process.env.TWITTER_CONSUMER_KEY;
    const cs = process.env.TWITTER_CONSUMER_SECRET;
    const ak = process.env.TWITTER_ACCESS_TOKEN;
    const as = process.env.TWITTER_ACCESS_SECRET;
    if (!ck || !cs || !ak || !as) {
        throw makeError(
            'Twitter creds missing (set TWITTER_CONSUMER_KEY / TWITTER_CONSUMER_SECRET / TWITTER_ACCESS_TOKEN / TWITTER_ACCESS_SECRET)',
            401
        );
    }
    cachedClient = new TwitterApi({
        appKey: ck,
        appSecret: cs,
        accessToken: ak,
        accessSecret: as,
    });
    return cachedClient;
}

async function getHandle(client) {
    if (cachedHandle) return cachedHandle;
    try {
        const me = await client.v2.me();
        cachedHandle = me.data?.username || null;
        return cachedHandle;
    } catch (err) {
        // Non-fatal — we'll return the i/web/status fallback URL
        console.warn(`[Twitter] /me failed (${err.code || err.message}); using fallback URL pattern`);
        return null;
    }
}

/**
 * Fetch the image at imageUrl and return { buffer, mimeType }, or null on failure.
 */
async function fetchImage(imageUrl) {
    if (!imageUrl) return null;
    try {
        const r = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 20_000,
            maxContentLength: 5_000_000,  // Twitter image limit is 5MB
            headers: {
                'User-Agent': 'GeoPolitiq-Repost/1.0',
                Accept: 'image/*',
            },
        });
        const mimeType = r.headers['content-type'] || 'image/jpeg';
        const buffer = Buffer.from(r.data);
        if (buffer.length > 4_900_000) {
            console.warn(`[Twitter] image ${buffer.length} bytes > 4.9MB, skipping`);
            return null;
        }
        return { buffer, mimeType };
    } catch (err) {
        console.warn(`[Twitter] image fetch failed: ${err.code || err.message}`);
        return null;
    }
}

async function post(payload, ctx) {
    if (payload.kind !== 'microblog') {
        throw makeError('Twitter requires microblog payload', 400);
    }

    const client = getClient();
    const handle = await getHandle(client);

    // 1) Best-effort image upload via v1.1 media endpoint
    let mediaIds = [];
    const img = await fetchImage(payload.image);
    if (img) {
        try {
            const id = await client.v1.uploadMedia(img.buffer, { mimeType: img.mimeType });
            if (id) mediaIds = [id];
        } catch (err) {
            console.warn(`[Twitter] media upload failed: ${err.code || err.message}`);
        }
    }

    // 2) Compose tweet via v2 /tweets
    const tweetReq = { text: payload.text };
    if (mediaIds.length > 0) tweetReq.media = { media_ids: mediaIds };
    if (payload.imageAlt && mediaIds.length > 0) {
        // Best-effort alt text (can fail on some accounts; ignore failures)
        try {
            await client.v1.createMediaMetadata(mediaIds[0], {
                alt_text: { text: String(payload.imageAlt).substring(0, 1000) },
            });
        } catch (e) {
            // not fatal
        }
    }

    let resp;
    try {
        resp = await client.v2.tweet(tweetReq);
    } catch (err) {
        // twitter-api-v2 errors carry .code (HTTP status), .data, .errors
        const status = err.code || err.response?.status || 500;
        // 401/403 → invalidate client so next call re-auths
        if (status === 401 || status === 403) cachedClient = null;
        const apiMsg =
            err.errors?.[0]?.message ||
            err.data?.detail ||
            err.data?.title ||
            err.message ||
            'unknown';
        throw makeError(`Twitter tweet failed: ${apiMsg}`, status, err.data);
    }

    const tweetId = resp.data?.id;
    if (!tweetId) {
        throw makeError(`Twitter unexpected response: ${JSON.stringify(resp).substring(0, 200)}`, 500, resp);
    }

    const remoteUrl = handle
        ? `https://twitter.com/${handle}/status/${tweetId}`
        : `https://twitter.com/i/web/status/${tweetId}`;

    return { remoteId: tweetId, remoteUrl };
}

module.exports = { post };
