/**
 * Google Indexing Pinger
 *
 * Calls Google's Indexing API to request URL_UPDATED notification for
 * each newly verified post URL. The API requires:
 *   - A Google Cloud service account
 *   - That service account added as Owner in Search Console for our property
 *   - Indexing API enabled in the Cloud project
 *
 * Auth (env):
 *   GOOGLE_INDEXING_SERVICE_ACCOUNT — the full JSON content of the
 *     downloaded service account key, on a single line, escaped as a
 *     normal env var value.
 *
 * Caveat (read this once):
 *   Google's official ToS for the Indexing API says it's intended for
 *   JobPosting and BroadcastEvent schema content only. Many news sites
 *   use it for general content anyway and Google often honors the
 *   request, but Google reserves the right to ignore or deprioritize
 *   non-conforming requests. We use it as a *speed-up signal* on top of
 *   the standard sitemap+crawl path — if Google ignores it, we lose
 *   nothing; if Google honors it, new posts hit the index in minutes
 *   instead of days.
 *
 * Quota: 200 URLs/day default. Plenty for our 4 posts/day cadence.
 *
 * Returns true if at least one URL was accepted (HTTP 200), false otherwise.
 * Never throws — best-effort like IndexNow.
 */

const { GoogleAuth } = require('google-auth-library');

const ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

let cachedAuth = null;
let cachedClient = null;

function isConfigured() {
    return !!process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT;
}

function getAuth() {
    if (cachedAuth) return cachedAuth;
    const raw = process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT;
    if (!raw) throw new Error('GOOGLE_INDEXING_SERVICE_ACCOUNT not set');

    let credentials;
    try {
        credentials = JSON.parse(raw);
    } catch (err) {
        // Try base64-decode as fallback (some users prefer base64-encoding the JSON)
        try {
            credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        } catch (err2) {
            throw new Error('GOOGLE_INDEXING_SERVICE_ACCOUNT must be valid JSON or base64-encoded JSON');
        }
    }
    if (!credentials.client_email || !credentials.private_key) {
        throw new Error('Service account JSON is missing client_email or private_key');
    }

    cachedAuth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    return cachedAuth;
}

async function getClient() {
    if (cachedClient) return cachedClient;
    cachedClient = await getAuth().getClient();
    return cachedClient;
}

/**
 * Notify Google about each URL. type can be 'URL_UPDATED' or 'URL_DELETED'.
 */
async function pingGoogleIndexing(urls, type = 'URL_UPDATED') {
    if (!isConfigured()) return false;
    if (!Array.isArray(urls) || urls.length === 0) return false;

    let client;
    try {
        client = await getClient();
    } catch (err) {
        console.error('[GoogleIndexing] auth error:', err.message);
        return false;
    }

    let successCount = 0;
    let lastError = null;
    for (const url of urls) {
        try {
            await client.request({
                url: ENDPOINT,
                method: 'POST',
                data: { url, type },
                timeout: 15_000,
            });
            successCount++;
        } catch (err) {
            const status = err.response?.status;
            const detail = err.response?.data?.error?.message || err.message;
            console.warn(`[GoogleIndexing] ${status || '?'} for ${url}: ${String(detail).substring(0, 200)}`);
            lastError = detail;
            // 429 = quota — stop the loop, no point continuing today
            if (status === 429) break;
        }
    }

    if (successCount > 0) {
        console.log(`[GoogleIndexing] ${successCount}/${urls.length} URLs accepted`);
        return true;
    }
    if (lastError) console.warn(`[GoogleIndexing] all ${urls.length} URLs failed; last error: ${String(lastError).substring(0, 120)}`);
    return false;
}

module.exports = { pingGoogleIndexing, isConfigured };
