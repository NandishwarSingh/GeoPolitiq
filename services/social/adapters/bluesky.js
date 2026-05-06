/**
 * Bluesky Adapter (AT Protocol)
 *
 * Auth: env vars
 *   BLUESKY_HANDLE        = e.g. "geopolitiq.bsky.social"
 *   BLUESKY_APP_PASSWORD  = app password from Settings → App Passwords
 *
 * Flow:
 *   1. createSession → accessJwt + did
 *   2. uploadBlob (image) → blob descriptor (best-effort, skipped if image
 *      fetch / upload fails — post still goes out)
 *   3. createRecord (app.bsky.feed.post) with:
 *        - text  (≤300 graphemes — already enforced by contentBuilder)
 *        - facets for hashtags + URLs (byte offsets, not char offsets)
 *        - embed: app.bsky.embed.external (link card)
 *   4. Convert returned at:// URI to https://bsky.app/profile/<handle>/post/<rkey>
 *
 * Errors map cleanly to the queue's categorizer:
 *   401 → auth (no retry, alert admin)
 *   429 → rate (exponential backoff)
 *   5xx / network / timeout → transient (retry)
 *   400 → content (no retry — payload was rejected as malformed)
 */

const axios = require('axios');

const PDS = 'https://bsky.social';

const HTTP = axios.create({
    timeout: 25_000,
    maxBodyLength: 25 * 1024 * 1024,
    headers: {
        'User-Agent': 'GeoPolitiq-Repost/1.0 (+https://geopolitiq.com)',
        Accept: 'application/json',
    },
});

let cachedSession = null;        // { accessJwt, refreshJwt, did, handle, expiresAt }
const SESSION_TTL_MS = 90 * 60 * 1000;  // refresh roughly every 90 min

function makeError(message, status, data) {
    const err = new Error(message);
    err.response = { status, data };
    return err;
}

async function login() {
    const identifier = process.env.BLUESKY_HANDLE;
    const password = process.env.BLUESKY_APP_PASSWORD;
    if (!identifier || !password) {
        throw makeError('BLUESKY_HANDLE / BLUESKY_APP_PASSWORD not set', 401);
    }
    let r;
    try {
        r = await HTTP.post(`${PDS}/xrpc/com.atproto.server.createSession`, {
            identifier,
            password,
        });
    } catch (err) {
        const status = err.response?.status || 500;
        const message = err.response?.data?.message || err.response?.data?.error || err.message;
        throw makeError(`Bluesky login failed: ${message}`, status, err.response?.data);
    }
    cachedSession = {
        accessJwt: r.data.accessJwt,
        refreshJwt: r.data.refreshJwt,
        did: r.data.did,
        handle: r.data.handle,
        expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return cachedSession;
}

async function getSession() {
    if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession;
    return await login();
}

/**
 * Compute byte (UTF-8) offsets for facet entries — Bluesky requires byte
 * offsets, NOT char offsets. Includes URLs and hashtags.
 */
function buildFacets(text) {
    if (!text) return [];
    const enc = new TextEncoder();
    function byteOffset(charIdx) {
        return enc.encode(text.substring(0, charIdx)).length;
    }

    const facets = [];

    // URLs: capture the URL substring exactly (without trailing punctuation)
    const urlRe = /https?:\/\/[^\s]+/g;
    let m;
    while ((m = urlRe.exec(text)) !== null) {
        let url = m[0];
        // Strip common trailing punctuation that's not part of the URL
        let end = m.index + url.length;
        while (url.length > 0 && /[.,;:!?)]$/.test(url)) {
            url = url.slice(0, -1);
            end -= 1;
        }
        facets.push({
            index: { byteStart: byteOffset(m.index), byteEnd: byteOffset(end) },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
        });
    }

    // Hashtags
    const tagRe = /#([\p{L}][\p{L}\p{N}_]*)/gu;
    while ((m = tagRe.exec(text)) !== null) {
        facets.push({
            index: {
                byteStart: byteOffset(m.index),
                byteEnd: byteOffset(m.index + m[0].length),
            },
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[1] }],
        });
    }
    return facets;
}

/**
 * Best-effort upload of an image URL as a Bluesky blob.
 * Returns the blob descriptor (for use as embed thumb) or null on failure.
 */
async function uploadImageBlob(session, imageUrl) {
    if (!imageUrl) return null;
    try {
        const imgResp = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 20_000,
            maxContentLength: 1_000_000,  // Bluesky blob limit is 1MB
            headers: {
                'User-Agent': 'GeoPolitiq-Repost/1.0',
                Accept: 'image/*',
            },
        });
        let buffer = Buffer.from(imgResp.data);
        let contentType = imgResp.headers['content-type'] || 'image/jpeg';

        // Bluesky requires < 1MB. If we're over, skip — re-encoding/down-sampling
        // would need sharp/imagemagick which isn't worth pulling in here.
        if (buffer.length > 950_000) {
            console.warn(`[Bluesky] image ${buffer.length} bytes > 950KB, skipping thumb`);
            return null;
        }

        const r = await HTTP.post(`${PDS}/xrpc/com.atproto.repo.uploadBlob`, buffer, {
            headers: {
                Authorization: `Bearer ${session.accessJwt}`,
                'Content-Type': contentType,
            },
        });
        return r.data?.blob || null;
    } catch (err) {
        console.warn(`[Bluesky] image upload skipped: ${err.response?.status || err.code || err.message}`);
        return null;
    }
}

async function post(payload, ctx) {
    if (payload.kind !== 'microblog') {
        throw makeError('Bluesky requires microblog payload', 400);
    }

    const session = await getSession();

    // Upload thumb (best-effort)
    const thumb = await uploadImageBlob(session, payload.image);

    // Compose record
    const record = {
        $type: 'app.bsky.feed.post',
        text: payload.text || '',
        createdAt: new Date().toISOString(),
        langs: ['en'],
    };

    const facets = buildFacets(record.text);
    if (facets.length > 0) record.facets = facets;

    // Link-card embed for the article URL
    if (payload.url) {
        const external = {
            uri: payload.url,
            title: (payload.text.split('\n')[0] || 'GeoPolitiq').substring(0, 100),
            description: 'Read the full analysis on GeoPolitiq',
        };
        if (thumb) external.thumb = thumb;
        record.embed = { $type: 'app.bsky.embed.external', external };
    }

    let r;
    try {
        r = await HTTP.post(
            `${PDS}/xrpc/com.atproto.repo.createRecord`,
            {
                repo: session.did,
                collection: 'app.bsky.feed.post',
                record,
            },
            {
                headers: { Authorization: `Bearer ${session.accessJwt}` },
            }
        );
    } catch (err) {
        const status = err.response?.status || 500;
        // 401 → invalidate session so the next call relogins
        if (status === 401) cachedSession = null;
        const msg = err.response?.data?.message || err.response?.data?.error || err.message;
        throw makeError(`Bluesky createRecord: ${msg}`, status, err.response?.data);
    }

    // r.data.uri is at://did/app.bsky.feed.post/<rkey>
    const uri = r.data.uri;
    const rkey = uri.split('/').pop();
    const webUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;
    return { remoteId: uri, remoteUrl: webUrl };
}

module.exports = { post, _buildFacets: buildFacets };
