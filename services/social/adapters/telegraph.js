/**
 * Telegra.ph Adapter (v2 — with retry/backoff)
 *
 * Telegraph's free API is intermittent — ECONNRESET / status=000 are common,
 * especially under load. We wrap each call in a retry loop with exponential
 * backoff up to MAX_RETRIES.
 *
 * On first call, creates an anonymous "GeoPolitiq" account and persists the
 * access_token at /opt/geopolitiq/.cache/telegraph_token (mode 0600).
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API = 'https://api.telegra.ph';
const CACHE_DIR = path.join('/opt/geopolitiq', '.cache');
const TOKEN_FILE = path.join(CACHE_DIR, 'telegraph_token');

const SHORT_NAME = 'GeoPolitiq';
const AUTHOR_NAME = 'GeoPolitiq';
const AUTHOR_URL = (process.env.SITE_URL || 'https://geopolitiq.com').replace(/\/$/, '');

const MAX_RETRIES = 4;
const HTTP = axios.create({
    timeout: 30_000,
    maxBodyLength: 10 * 1024 * 1024,
    headers: {
        'User-Agent': 'GeoPolitiq-Repost/1.0 (+https://geopolitiq.com)',
        Accept: 'application/json',
    },
    // Retry-friendly: don't keep idle connections that the upstream may drop
    httpsAgent: new (require('https').Agent)({ keepAlive: false }),
});

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    }
}

function isTransientNetErr(err) {
    if (!err) return false;
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') return true;
    if (err.code === 'EAI_AGAIN' || err.code === 'ENETUNREACH') return true;
    if (err.message && /socket hang up/i.test(err.message)) return true;
    if (err.response?.status >= 500) return true;
    return false;
}

async function withRetry(fn, label) {
    let lastErr;
    for (let i = 1; i <= MAX_RETRIES; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (!isTransientNetErr(err) || i === MAX_RETRIES) throw err;
            const wait = 1500 * i + Math.floor(Math.random() * 800);
            console.warn(`[Telegraph] ${label} attempt ${i}/${MAX_RETRIES} failed (${err.code || err.message}); retrying in ${wait}ms`);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw lastErr;
}

async function createAccount() {
    const form = new URLSearchParams();
    form.set('short_name', SHORT_NAME);
    form.set('author_name', AUTHOR_NAME);
    form.set('author_url', AUTHOR_URL);

    const r = await HTTP.post(`${API}/createAccount`, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!r.data?.ok) {
        throw new Error(`Telegraph createAccount: ${JSON.stringify(r.data).substring(0, 200)}`);
    }
    return r.data.result.access_token;
}

async function ensureAccessToken(forceRefresh = false) {
    if (process.env.TELEGRAPH_ACCESS_TOKEN) return process.env.TELEGRAPH_ACCESS_TOKEN;

    ensureCacheDir();
    if (!forceRefresh && fs.existsSync(TOKEN_FILE)) {
        const tok = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        if (tok && tok.length >= 20) return tok;
    }

    const token = await withRetry(() => createAccount(), 'createAccount');
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
    console.log('[Telegraph] anonymous account created, token persisted');
    return token;
}

/* ---------- markdown → Telegraph node array ---------- */

function parseInline(text) {
    if (!text) return [];
    const nodes = [];
    const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let lastIndex = 0;
    let m;
    while ((m = linkRe.exec(text)) !== null) {
        if (m.index > lastIndex) nodes.push(...parseEmphasis(text.slice(lastIndex, m.index)));
        nodes.push({ tag: 'a', attrs: { href: m[2] }, children: parseEmphasis(m[1]) });
        lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) nodes.push(...parseEmphasis(text.slice(lastIndex)));
    return nodes;
}

function parseEmphasis(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
        if (text.startsWith('**', i)) {
            const end = text.indexOf('**', i + 2);
            if (end !== -1) {
                out.push({ tag: 'strong', children: [text.slice(i + 2, end)] });
                i = end + 2;
                continue;
            }
        }
        if (text[i] === '*' && text[i + 1] !== '*') {
            const end = text.indexOf('*', i + 1);
            if (end !== -1) {
                out.push({ tag: 'em', children: [text.slice(i + 1, end)] });
                i = end + 1;
                continue;
            }
        }
        let j = i;
        while (j < text.length && text[j] !== '*' && !text.startsWith('**', j) && text[j] !== '[') j++;
        if (j === i) { out.push(text[i]); i++; }
        else { out.push(text.slice(i, j)); i = j; }
    }
    return out.length === 0 ? [text] : out;
}

function markdownToTelegraphNodes(md) {
    if (!md || typeof md !== 'string') return [];
    const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
    const nodes = [];

    for (const blockRaw of blocks) {
        const block = blockRaw.trim();
        if (!block) continue;

        if (block.startsWith('## ')) {
            nodes.push({ tag: 'h3', children: parseInline(block.slice(3).trim()) });
            continue;
        }
        if (block.startsWith('### ')) {
            nodes.push({ tag: 'h4', children: parseInline(block.slice(4).trim()) });
            continue;
        }
        if (block.startsWith('# ')) {
            nodes.push({ tag: 'h3', children: parseInline(block.slice(2).trim()) });
            continue;
        }
        if (/^- /.test(block)) {
            const items = block.split('\n').filter((l) => l.startsWith('- '));
            nodes.push({
                tag: 'ul',
                children: items.map((i) => ({ tag: 'li', children: parseInline(i.slice(2).trim()) })),
            });
            continue;
        }
        if (/^\d+\. /.test(block)) {
            const items = block.split('\n').filter((l) => /^\d+\. /.test(l));
            nodes.push({
                tag: 'ol',
                children: items.map((i) => ({
                    tag: 'li',
                    children: parseInline(i.replace(/^\d+\. /, '').trim()),
                })),
            });
            continue;
        }
        if (block.startsWith('> ')) {
            const text = block.split('\n').map((l) => l.replace(/^> ?/, '')).join(' ');
            nodes.push({ tag: 'blockquote', children: parseInline(text) });
            continue;
        }
        if (block.includes('|---') || /^\|.+\|$/m.test(block)) {
            const lines = block.split('\n').filter((l) => l.trim() && !/^[\s|:-]+$/.test(l));
            for (const line of lines) {
                const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
                if (cells.length === 0) continue;
                nodes.push({ tag: 'p', children: parseInline(cells.join(' · ')) });
            }
            continue;
        }
        nodes.push({ tag: 'p', children: parseInline(block) });
    }
    return nodes;
}

/* ---------- public adapter API ---------- */

async function createPageOnce(token, title, nodes) {
    const form = new URLSearchParams();
    form.set('access_token', token);
    form.set('title', title.substring(0, 256));
    form.set('author_name', AUTHOR_NAME);
    form.set('author_url', AUTHOR_URL);
    form.set('content', JSON.stringify(nodes));
    form.set('return_content', 'false');

    const r = await HTTP.post(`${API}/createPage`, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!r.data?.ok) {
        const err = new Error(r.data?.error || 'Telegraph createPage error');
        err.response = { status: 400, data: r.data };
        throw err;
    }
    return r.data.result;
}

async function post(payload, ctx) {
    if (payload.kind !== 'article') {
        const err = new Error('Telegraph requires article payload');
        err.response = { status: 400 };
        throw err;
    }

    const body = payload.bodyMarkdown || payload.bodyHtml || payload.subtitle || '';
    const nodes = markdownToTelegraphNodes(body);

    if (payload.canonicalUrl) {
        nodes.push({ tag: 'hr' });
        nodes.push({
            tag: 'p',
            children: [
                'Originally published at ',
                {
                    tag: 'a',
                    attrs: {
                        href:
                            payload.canonicalUrl +
                            '?utm_source=telegraph&utm_medium=social&utm_campaign=auto_repost',
                    },
                    children: [payload.canonicalUrl],
                },
            ],
        });
    }
    if (nodes.length === 0) {
        nodes.push({ tag: 'p', children: [payload.subtitle || payload.title || ''] });
    }

    let token = await ensureAccessToken();
    let result;
    try {
        result = await withRetry(
            () => createPageOnce(token, payload.title || 'Untitled', nodes),
            'createPage'
        );
    } catch (err) {
        // If our cached token is invalid (e.g. expired or never persisted correctly),
        // refresh once and retry.
        if (err.response?.data?.error === 'ACCESS_TOKEN_INVALID') {
            console.warn('[Telegraph] token invalid, refreshing…');
            token = await ensureAccessToken(true);
            result = await withRetry(
                () => createPageOnce(token, payload.title || 'Untitled', nodes),
                'createPage(retry-after-refresh)'
            );
        } else {
            throw err;
        }
    }

    return { remoteId: result.path, remoteUrl: result.url };
}

module.exports = { post, _markdownToTelegraphNodes: markdownToTelegraphNodes };
