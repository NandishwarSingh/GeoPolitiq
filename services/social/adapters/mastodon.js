/**
 * Mastodon-compatible Adapter
 *
 * One adapter that posts to ANY platform speaking the Mastodon API:
 *   - Mastodon, Pleroma, Akkoma, Friendica, GoToSocial — native
 *   - Misskey, Calckey, Sharkey, Firefish, Iceshrimp     — via their
 *     built-in Mastodon-compat layer
 *
 * Configuration (env):
 *   MASTODON_INSTANCES = JSON array, one entry per (instance, account):
 *     [
 *       { "host": "mastodon.social",   "token": "...", "visibility": "public" },
 *       { "host": "infosec.exchange",  "token": "..." }
 *     ]
 *
 * Routing:
 *   The queue passes `ctx.subPlatform` (the host string) — we look up the
 *   matching token. If MASTODON_INSTANCES is empty we throw a clean
 *   `config` error so the queue marks the task failed (no retry storm).
 *
 * Side effects:
 *   - Downloads featuredImage to memory, uploads it as a Mastodon media
 *     attachment. Continues without image on upload failure.
 *   - Sets visibility=public by default so the post enters the public feed.
 */

const axios = require('axios');
const FormData = require('form-data');

const HTTP = axios.create({
    timeout: 30_000,
    maxBodyLength: 25 * 1024 * 1024,
    headers: {
        'User-Agent': 'GeoPolitiq-Repost/1.0 (+https://geopolitiq.com)',
        Accept: 'application/json',
    },
});

function loadInstances() {
    const raw = process.env.MASTODON_INSTANCES;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((i) => i && i.host && i.token)
            .map((i) => ({
                host: String(i.host).replace(/^https?:\/\//, '').replace(/\/$/, ''),
                token: i.token,
                visibility: i.visibility || 'public',
                charLimit: i.charLimit || null,  // optional per-instance override
            }));
    } catch (err) {
        console.error('[Mastodon] MASTODON_INSTANCES JSON parse error:', err.message);
        return [];
    }
}

function findInstance(host) {
    if (!host) return null;
    const list = loadInstances();
    return list.find((i) => i.host === host) || null;
}

function makeError(message, status, data) {
    const err = new Error(message);
    err.response = { status, data };
    return err;
}

/**
 * Download an image from a URL and upload it to the Mastodon instance.
 * Returns the media ID, or null on any failure (we still post, just without image).
 */
async function uploadMedia(host, token, imageUrl, imageAlt) {
    if (!imageUrl) return null;
    try {
        // Step 1: fetch the image bytes
        const imgResp = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 20_000,
            maxContentLength: 10 * 1024 * 1024,
            headers: {
                'User-Agent': 'GeoPolitiq-Repost/1.0',
                Accept: 'image/*',
            },
        });
        const contentType = imgResp.headers['content-type'] || 'image/jpeg';
        const buffer = Buffer.from(imgResp.data);

        // Pick a sane filename based on content-type
        const ext =
            contentType.includes('png') ? 'png' :
            contentType.includes('webp') ? 'webp' :
            contentType.includes('gif') ? 'gif' : 'jpg';

        // Step 2: multipart upload to /api/v2/media
        const form = new FormData();
        form.append('file', buffer, { filename: `image.${ext}`, contentType });
        if (imageAlt) form.append('description', String(imageAlt).substring(0, 1500));

        const upResp = await HTTP.post(`https://${host}/api/v2/media`, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${token}`,
            },
        });

        // Mastodon may return 200 (sync) or 202 (async — still processing).
        // In both cases the media ID is usable when posting the status; the
        // server will queue the post until media finishes processing.
        if (upResp.data?.id) return upResp.data.id;
        return null;
    } catch (err) {
        console.warn(`[Mastodon@${host}] media upload failed (${err.response?.status || err.code || err.message}); posting without image`);
        return null;
    }
}

async function post(payload, ctx) {
    if (payload.kind !== 'microblog') {
        throw makeError('Mastodon adapter requires microblog payload', 400);
    }

    const host = ctx?.subPlatform;
    if (!host) {
        throw makeError('Mastodon adapter requires subPlatform (instance host)', 400);
    }

    const inst = findInstance(host);
    if (!inst) {
        throw makeError(`No MASTODON_INSTANCES entry for host=${host}`, 401);
    }

    // Optional: clip text to per-instance char limit (defaults already handled by contentBuilder).
    let text = payload.text || '';
    if (inst.charLimit && text.length > inst.charLimit) {
        text = text.substring(0, inst.charLimit - 1).trimEnd() + '…';
    }

    // Step 1: try to upload the image (best-effort).
    let mediaIds = [];
    if (payload.image) {
        const id = await uploadMedia(host, inst.token, payload.image, payload.imageAlt);
        if (id) mediaIds = [id];
    }

    // Step 2: post the status.
    const body = {
        status: text,
        visibility: inst.visibility,
        language: 'en',
    };
    if (mediaIds.length > 0) body.media_ids = mediaIds;

    const r = await HTTP.post(`https://${host}/api/v1/statuses`, body, {
        headers: {
            Authorization: `Bearer ${inst.token}`,
            'Content-Type': 'application/json',
            // Idempotency-Key prevents duplicate toots on network-level retry.
            'Idempotency-Key': `geopolitiq-${payload.url}-${host}`,
        },
    });

    if (!r.data?.id || !r.data?.url) {
        throw makeError(
            `Mastodon@${host}: unexpected response ${JSON.stringify(r.data).substring(0, 200)}`,
            500,
            r.data
        );
    }

    return {
        remoteId: r.data.id,
        remoteUrl: r.data.url,
    };
}

module.exports = { post, _loadInstances: loadInstances };
