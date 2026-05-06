/**
 * IndexNow Service
 *
 * Pushes URLs to IndexNow (Bing / Yandex / Naver / Seznam / Mojeek) the
 * moment a new post is published. Avoids waiting for sitemap recrawl.
 *
 * Setup (one-time, automatic on boot):
 *   - generates a 32-char hex key
 *   - serves it at https://geopolitiq.com/<KEY>.txt (the verification file)
 *   - persists the key in IndexNow.key so we use the same one across restarts
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const KEY_FILE_NAME = 'indexnow-key.txt';

let cachedKey = null;

function ensureKey() {
    if (cachedKey) return cachedKey;
    // Persisted key file inside public/ so it's auto-served at /<key>.txt
    const stateFile = path.join(PUBLIC_DIR, KEY_FILE_NAME);
    if (fs.existsSync(stateFile)) {
        cachedKey = fs.readFileSync(stateFile, 'utf8').trim();
        return cachedKey;
    }
    // First run — generate and persist
    cachedKey = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(stateFile, cachedKey);
    // Also write the key-named file IndexNow expects at /<key>.txt
    const verifyFile = path.join(PUBLIC_DIR, `${cachedKey}.txt`);
    fs.writeFileSync(verifyFile, cachedKey);
    console.log(`[IndexNow] generated key, verification file at /${cachedKey}.txt`);
    return cachedKey;
}

/**
 * Push one or more URLs to IndexNow.
 * Returns true on 200/202, false otherwise. Never throws — IndexNow is
 * best-effort and shouldn't block publishing.
 */
async function pingIndexNow(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return false;

    let key;
    try {
        key = ensureKey();
    } catch (err) {
        console.error('[IndexNow] could not prepare key file:', err.message);
        return false;
    }

    const host = (process.env.SITE_URL || 'https://geopolitiq.com')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '');

    const body = {
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList: urls,
    };

    try {
        const r = await axios.post(INDEXNOW_ENDPOINT, body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10_000,
        });
        if (r.status === 200 || r.status === 202) return true;
        console.warn(`[IndexNow] unexpected status ${r.status}`);
        return false;
    } catch (err) {
        const status = err.response?.status;
        const data = err.response?.data;
        console.warn(`[IndexNow] failed: status=${status} body=${JSON.stringify(data || {}).substring(0, 200)} msg=${err.message}`);
        return false;
    }
}

module.exports = { pingIndexNow, ensureKey };
