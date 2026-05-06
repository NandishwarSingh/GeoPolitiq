/**
 * Medium Adapter
 *
 * Full-article syndication via Medium's official API.
 *
 * Auth (env):
 *   MEDIUM_INTEGRATION_TOKEN — generate at medium.com → Settings →
 *     Security and apps → "Integration tokens" → "Get integration token"
 *
 * Critical SEO behavior:
 *   We set `canonicalUrl` to the original geopolitiq.com URL. Medium
 *   echoes this in a <link rel="canonical"> tag, telling Google that
 *   our site is the source of truth — so the Medium copy doesn't
 *   compete with us in search rankings.
 *
 * Important Medium API notes:
 *   - Title max 100 chars (our titles run 60–90, safe)
 *   - Tags array max 5
 *   - publishStatus: 'public' | 'draft' | 'unlisted'
 *   - First request to /me caches the user id at .cache/medium_user_id
 *
 * Caveat: Medium's integration token feature was deprecated for *new*
 * users in 2023. Existing tokens keep working; new users may not see
 * the "Get integration token" button. If the user can't generate a
 * token, this adapter cannot be activated.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API = 'https://api.medium.com/v1';
const CACHE_DIR = path.join('/opt/geopolitiq', '.cache');
const USER_FILE = path.join(CACHE_DIR, 'medium_user_id');

const HTTP = axios.create({
    timeout: 30_000,
    maxBodyLength: 10 * 1024 * 1024,
    headers: {
        'User-Agent': 'GeoPolitiq-Repost/1.0 (+https://geopolitiq.com)',
        Accept: 'application/json',
    },
});

let cachedUserId = null;

function makeError(message, status, data) {
    const err = new Error(message);
    err.response = { status, data };
    return err;
}

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    }
}

async function getUserId(token) {
    if (cachedUserId) return cachedUserId;
    ensureCacheDir();
    if (fs.existsSync(USER_FILE)) {
        const id = fs.readFileSync(USER_FILE, 'utf8').trim();
        if (id) {
            cachedUserId = id;
            return id;
        }
    }
    let r;
    try {
        r = await HTTP.get(`${API}/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
    } catch (err) {
        const status = err.response?.status || 500;
        if (status === 401) throw makeError('Medium token rejected (401)', 401, err.response?.data);
        throw err;
    }
    const id = r.data?.data?.id;
    if (!id) throw makeError('Medium /me returned no id', 500, r.data);
    cachedUserId = id;
    fs.writeFileSync(USER_FILE, id, { mode: 0o600 });
    console.log(`[Medium] resolved userId: ${id}`);
    return id;
}

/**
 * Build the Medium markdown body.
 * Layout:
 *   ![alt](image)        ← optional featured image
 *
 *   [original markdown body]
 *
 *   ---
 *   *Originally published at [geopolitiq.com/post/<slug>](url-with-utm)*
 */
function buildMediumMarkdown(payload) {
    const parts = [];

    if (payload.image) {
        const alt = (payload.imageAlt || payload.title || 'image').replace(/[\[\]]/g, '');
        parts.push(`![${alt}](${payload.image})`);
        parts.push('');
    }

    if (payload.subtitle) {
        // Medium treats the first paragraph specially (subtitle)
        parts.push(`*${payload.subtitle}*`);
        parts.push('');
    }

    parts.push((payload.bodyMarkdown || payload.bodyHtml || '').trim());

    if (payload.canonicalUrl) {
        const utmUrl =
            payload.canonicalUrl + '?utm_source=medium&utm_medium=syndication&utm_campaign=auto_repost';
        parts.push('');
        parts.push('---');
        parts.push(`*Originally published at [${payload.canonicalUrl}](${utmUrl}).*`);
    }

    return parts.join('\n');
}

async function post(payload, ctx) {
    if (payload.kind !== 'article') {
        throw makeError('Medium adapter requires article payload', 400);
    }

    const token = process.env.MEDIUM_INTEGRATION_TOKEN;
    if (!token) throw makeError('MEDIUM_INTEGRATION_TOKEN not set', 401);

    const userId = await getUserId(token);

    const body = {
        title: (payload.title || 'Untitled').substring(0, 100),
        contentFormat: 'markdown',
        content: buildMediumMarkdown(payload),
        canonicalUrl: payload.canonicalUrl,
        tags: (payload.tags || []).slice(0, 5).map((t) => String(t).substring(0, 25)),
        publishStatus: 'public',
        notifyFollowers: false,  // Don't spam followers — automated posts shouldn't notify
        license: 'all-rights-reserved',
    };

    let r;
    try {
        r = await HTTP.post(`${API}/users/${userId}/posts`, body, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
    } catch (err) {
        const status = err.response?.status || 500;
        // 401 → invalidate cached userId so next call retries from /me
        if (status === 401) cachedUserId = null;
        const msg = err.response?.data?.errors?.[0]?.message
            || err.response?.data?.message
            || err.response?.data?.error
            || err.message;
        throw makeError(`Medium createPost: ${msg}`, status, err.response?.data);
    }

    const data = r.data?.data;
    if (!data?.url) {
        throw makeError(
            `Medium: unexpected response ${JSON.stringify(r.data).substring(0, 200)}`,
            500,
            r.data
        );
    }

    return {
        remoteId: data.id,
        remoteUrl: data.url,
    };
}

module.exports = { post, _buildMediumMarkdown: buildMediumMarkdown };
