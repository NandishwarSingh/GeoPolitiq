/**
 * Tumblr Adapter
 *
 * OAuth 1.0a User Context (4 long-lived credentials, no refresh).
 *
 * Auth (env):
 *   TUMBLR_CONSUMER_KEY
 *   TUMBLR_CONSUMER_SECRET
 *   TUMBLR_OAUTH_TOKEN
 *   TUMBLR_OAUTH_TOKEN_SECRET
 *   TUMBLR_BLOG_NAME      e.g. "geopolitiq" (without .tumblr.com)
 *
 * API: NPF (Neue Post Format) — POST /v2/blog/{blog}/posts
 *
 * Layout per post:
 *   1. image block          (fetched server-side by Tumblr from our URL)
 *   2. text block           (the hook)
 *   3. text block w/ link   ("Read: <url>" with the URL as a link facet)
 *   4. tags string          (comma-separated)
 *
 * Returns:
 *   remoteId  — id_string from the API response
 *   remoteUrl — https://{blog}.tumblr.com/post/{id_string}
 */

const axios = require('axios');
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

const API_BASE = 'https://api.tumblr.com/v2';

function makeError(message, status, data) {
    const err = new Error(message);
    err.response = { status, data };
    return err;
}

function getCreds() {
    const ck = process.env.TUMBLR_CONSUMER_KEY;
    const cs = process.env.TUMBLR_CONSUMER_SECRET;
    const tk = process.env.TUMBLR_OAUTH_TOKEN;
    const ts = process.env.TUMBLR_OAUTH_TOKEN_SECRET;
    const blog = process.env.TUMBLR_BLOG_NAME;
    if (!ck || !cs || !tk || !ts || !blog) {
        throw makeError(
            'Tumblr creds missing (set TUMBLR_CONSUMER_KEY / TUMBLR_CONSUMER_SECRET / TUMBLR_OAUTH_TOKEN / TUMBLR_OAUTH_TOKEN_SECRET / TUMBLR_BLOG_NAME)',
            401
        );
    }
    return { consumerKey: ck, consumerSecret: cs, token: tk, tokenSecret: ts, blogName: blog };
}

function buildOAuthClient(consumerKey, consumerSecret) {
    return OAuth({
        consumer: { key: consumerKey, secret: consumerSecret },
        signature_method: 'HMAC-SHA1',
        hash_function(baseString, key) {
            return crypto.createHmac('sha1', key).update(baseString).digest('base64');
        },
    });
}

/**
 * Build the NPF body for a microblog payload.
 *
 * NPF structure:
 *   content = ordered array of blocks (image, text)
 *   tags    = comma-separated string
 *
 * Tumblr fetches image URLs server-side. If Tumblr can't reach the image,
 * the whole request 400s — we swallow that on retry by stripping the image.
 */
function buildNpf(payload, includeImage) {
    const blocks = [];

    if (includeImage && payload.image) {
        blocks.push({
            type: 'image',
            media: [{ url: payload.image, type: 'image/jpeg' }],
            alt_text: (payload.imageAlt || payload.tags?.[0] || 'cover image').substring(0, 200),
        });
    }

    // Split the hook off from the URL: the contentBuilder produces
    //   "<hook>\n\n<hashtags> <url>"
    // We want to render the hook as plain text and keep the link as
    // a separate block so Tumblr renders it as a clickable link.
    const text = payload.text || '';
    const url = payload.url || '';
    let hook = text;
    if (url && text.endsWith(url)) {
        hook = text.slice(0, -url.length).trimEnd();
    }

    if (hook) {
        blocks.push({ type: 'text', text: hook });
    }

    if (url) {
        const prefix = 'Read: ';
        const linkText = `${prefix}${url}`;
        // formatting indexes are character-based in NPF
        blocks.push({
            type: 'text',
            text: linkText,
            formatting: [
                { start: prefix.length, end: linkText.length, type: 'link', url },
            ],
        });
    }

    // Tags: derive from payload.tags, dedupe, lowercase, strip non-alphanumerics
    const seen = new Set();
    const tagList = [];
    for (const t of payload.tags || []) {
        const slug = String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        tagList.push(slug);
        if (tagList.length >= 10) break;
    }
    if (!tagList.includes('geopolitics')) tagList.unshift('geopolitics');

    return {
        content: blocks,
        tags: tagList.join(','),
    };
}

async function postOnce(creds, body) {
    const oauth = buildOAuthClient(creds.consumerKey, creds.consumerSecret);
    const url = `${API_BASE}/blog/${creds.blogName}/posts`;
    const tokenObj = { key: creds.token, secret: creds.tokenSecret };

    // OAuth 1.0a signature for application/json bodies: signature is over
    // the URL + method only (no body params).
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'POST' }, tokenObj));

    const r = await axios.post(url, body, {
        timeout: 25_000,
        headers: {
            ...authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'GeoPolitiq-Repost/1.0 (+https://geopolitiq.com)',
        },
    });
    return r.data;
}

async function post(payload, ctx) {
    if (payload.kind !== 'microblog') {
        throw makeError('Tumblr requires microblog payload', 400);
    }
    const creds = getCreds();

    let body = buildNpf(payload, true);
    let response;
    try {
        response = await postOnce(creds, body);
    } catch (err) {
        const status = err.response?.status || 500;
        const apiErr = err.response?.data?.errors?.[0]?.detail
            || err.response?.data?.errors?.[0]?.title
            || err.response?.data?.meta?.msg
            || err.message;

        // 400 commonly means Tumblr couldn't fetch our image — retry without it
        // (this is a best-effort fallback; if it still fails, we propagate).
        if (status === 400 && payload.image) {
            console.warn(`[Tumblr] post-with-image failed (${apiErr}); retrying without image`);
            body = buildNpf(payload, false);
            try {
                response = await postOnce(creds, body);
            } catch (err2) {
                const s2 = err2.response?.status || 500;
                const m2 = err2.response?.data?.errors?.[0]?.detail || err2.message;
                throw makeError(`Tumblr (no-image retry): ${m2}`, s2, err2.response?.data);
            }
        } else {
            throw makeError(`Tumblr post: ${apiErr}`, status, err.response?.data);
        }
    }

    const r = response?.response;
    const idStr = r?.id_string || (r?.id != null ? String(r.id) : null);
    if (!idStr) {
        throw makeError(
            `Tumblr unexpected response: ${JSON.stringify(response).substring(0, 200)}`,
            500,
            response
        );
    }

    return {
        remoteId: idStr,
        remoteUrl: `https://${creds.blogName}.tumblr.com/post/${idStr}`,
    };
}

module.exports = { post, _buildNpf: buildNpf };
