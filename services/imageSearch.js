/**
 * Image Search Helpers
 * Tries multiple free sources in order of quality:
 *   1. The article's own source URL (OG image / first big <img>)
 *   2. DuckDuckGo image search (free, no key)
 *   3. Wikimedia Commons (high-quality, public domain)
 *   4. Pexels generic fallback (last resort, topic-aware)
 */

const axios = require('axios');

const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// Domains that block hot-linking and should be skipped even if they appear.
const BLOCKED_DOMAINS = [
    'reuters.com',
    'gettyimages.com',
    'shutterstock.com',
    'apnews.com',
    'bloomberg.com',
];

const PEXELS_FALLBACKS = {
    politics: 'https://images.pexels.com/photos/1202723/pexels-photo-1202723.jpeg?w=1280',
    economy: 'https://images.pexels.com/photos/789750/pexels-photo-789750.jpeg?w=1280',
    military: 'https://images.pexels.com/photos/77171/pexels-photo-77171.jpeg?w=1280',
    tech: 'https://images.pexels.com/photos/3617500/pexels-photo-3617500.jpeg?w=1280',
    energy: 'https://images.pexels.com/photos/2770933/pexels-photo-2770933.jpeg?w=1280',
    default: 'https://images.pexels.com/photos/1098460/pexels-photo-1098460.jpeg?w=1280',
};

function pickPexelsFallback(title = '') {
    const t = title.toLowerCase();
    if (/election|congress|parliament|senate|prime minister|president|policy/.test(t)) return PEXELS_FALLBACKS.politics;
    if (/economy|inflation|gdp|trade|tariff|market|stock/.test(t)) return PEXELS_FALLBACKS.economy;
    if (/military|defense|defence|weapon|war|missile|navy|army/.test(t)) return PEXELS_FALLBACKS.military;
    if (/ai|tech|chip|semiconductor|cyber|software|silicon/.test(t)) return PEXELS_FALLBACKS.tech;
    if (/oil|gas|energy|pipeline|opec|electricity|nuclear/.test(t)) return PEXELS_FALLBACKS.energy;
    return PEXELS_FALLBACKS.default;
}

function isBlockedDomain(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return BLOCKED_DOMAINS.some((d) => host.endsWith(d));
    } catch {
        return true;
    }
}

async function validateImage(url, opts = {}) {
    const { minBytes = 5_000, maxBytes = 10_000_000 } = opts;
    if (!url || !url.startsWith('https://') || isBlockedDomain(url)) return false;
    try {
        const head = await axios.head(url, {
            timeout: 8_000,
            maxRedirects: 3,
            headers: { 'User-Agent': CHROME_UA },
        });
        const ct = String(head.headers['content-type'] || '').toLowerCase();
        if (!ct.startsWith('image/')) return false;
        const len = parseInt(head.headers['content-length'] || '0', 10);
        if (len && (len < minBytes || len > maxBytes)) return false;
        return true;
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------ *
 *  1. Source-URL OG-image scrape
 * ------------------------------------------------------------------ */

// Domains that almost always serve generic report-cover art on og:image.
// Skipping them forces the cascade to fall through to image search, which
// returns actual journalism photos.
const COVER_ART_DOMAINS = [
    'csis.org', 'wellington.com', 'capitaleconomics.com', 'ey.com',
    'enterprisebank.com', 'instituteofgeoeconomics.org', 'mckinsey.com',
    'bcg.com', 'deloitte.com', 'pwc.com', 'kpmg.com', 'accenture.com',
    'brookings.edu', 'rand.org', 'cfr.org', 'iiss.org', 'chathamhouse.org',
    'iea.org', 'imf.org', 'worldbank.org', 'oecd.org', 'weforum.org',
    'youtube.com', 'youtu.be',
];

const THUMB_PATTERNS = /(thumb|thumbnail|preview|small|cover|placeholder|default|logo|icon|fallback)/i;

function isCoverArtDomain(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return COVER_ART_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
    } catch {
        return false;
    }
}

async function fetchOgImage(sourceUrl) {
    if (!sourceUrl || !sourceUrl.startsWith('http')) return null;
    if (isCoverArtDomain(sourceUrl)) return null;
    try {
        const resp = await axios.get(sourceUrl, {
            timeout: 10_000,
            maxRedirects: 5,
            headers: { 'User-Agent': CHROME_UA, Accept: 'text/html' },
        });
        const html = String(resp.data || '');

        // og:image, twitter:image, og:image:url
        const patterns = [
            /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m && m[1]) {
                let img = m[1].trim();
                if (img.startsWith('//')) img = 'https:' + img;
                if (img.startsWith('http://')) img = img.replace('http://', 'https://');
                if (THUMB_PATTERNS.test(img)) continue;
                if (await validateImage(img, { minBytes: 25_000 })) return img;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ *
 *  2. Google Images scraping (best when not 429-throttled)
 * ------------------------------------------------------------------ */

async function googleImagesScrape(query) {
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&safe=active`;
        const resp = await axios.get(url, {
            timeout: 12000,
            headers: {
                'User-Agent': CHROME_UA,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
        });
        const html = String(resp.data || '');
        const re = /\["(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))[^"]*",\d+,\d+\]/gi;
        const matches = [...html.matchAll(re)];
        for (const m of matches.slice(0, 12)) {
            const u = m[1];
            if (!u || u.includes('google.com') || u.includes('gstatic.com') || u.length > 500) continue;
            if (isBlockedDomain(u)) continue;
            if (await validateImage(u)) return u;
        }
        return null;
    } catch (err) {
        const code = err.response?.status || err.code || err.message;
        console.log('[Image]   google err:', code);
        return null;
    }
}

/* ------------------------------------------------------------------ *
 *  3. DuckDuckGo image search
 *     Two-step: get vqd token from HTML, then hit i.js
 * ------------------------------------------------------------------ */

async function ddgImage(query) {
    try {
        const tokenResp = await axios.get('https://duckduckgo.com/', {
            params: { q: query },
            timeout: 8_000,
            headers: { 'User-Agent': CHROME_UA },
        });
        const vqdMatch = String(tokenResp.data).match(/vqd=["']?(\d-\d+(?:-\d+)?)["']?/);
        if (!vqdMatch) return null;
        const vqd = vqdMatch[1];

        const resp = await axios.get('https://duckduckgo.com/i.js', {
            timeout: 10_000,
            headers: {
                'User-Agent': CHROME_UA,
                Referer: 'https://duckduckgo.com/',
                'X-Requested-With': 'XMLHttpRequest',
            },
            params: {
                l: 'us-en',
                o: 'json',
                q: query,
                vqd,
                f: ',type:photo,size:Large',
                p: '1',
                v7exp: 'a',
            },
        });
        const results = resp.data?.results || [];
        for (const r of results.slice(0, 12)) {
            const img = r.image || r.thumbnail;
            if (!img) continue;
            if (isBlockedDomain(img)) continue;
            if (await validateImage(img)) return img;
        }
        return null;
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ *
 *  4. Wikimedia Commons
 * ------------------------------------------------------------------ */

async function wikimediaImage(query) {
    try {
        const resp = await axios.get('https://en.wikipedia.org/w/api.php', {
            timeout: 10_000,
            headers: { 'User-Agent': CHROME_UA },
            params: {
                action: 'query',
                generator: 'search',
                gsrsearch: query,
                gsrlimit: 5,
                prop: 'pageimages',
                pithumbsize: 1280,
                format: 'json',
                origin: '*',
            },
        });
        const pages = resp.data?.query?.pages || {};
        for (const k of Object.keys(pages)) {
            const src = pages[k]?.thumbnail?.source;
            if (src && (await validateImage(src))) return src;
        }
        return null;
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ *
 *  Public entry point — tries everything in order
 * ------------------------------------------------------------------ */

function buildSearchQuery(title) {
    return String(title || '')
        .replace(/[!?'"`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 80);
}

async function searchNewsImage(title, sourceUrl) {
    const q = buildSearchQuery(title);
    if (!q) return { url: PEXELS_FALLBACKS.default, source: 'pexels' };

    // 1) DuckDuckGo first — free, fast, returns photo-quality images
    console.log(`[Image] ddg: "${q}"`);
    const ddg = await ddgImage(q);
    if (ddg) {
        console.log('[Image]   -> ddg hit');
        return { url: ddg, source: 'duckduckgo' };
    }

    // 2) Google Images
    console.log(`[Image] google: "${q}"`);
    const g = await googleImagesScrape(q);
    if (g) {
        console.log('[Image]   -> google hit');
        return { url: g, source: 'google' };
    }

    // 3) Source-OG (with cover-art skiplist + thumbnail filter)
    if (sourceUrl) {
        console.log(`[Image] og: ${sourceUrl.substring(0, 80)}`);
        const og = await fetchOgImage(sourceUrl);
        if (og) {
            console.log('[Image]   -> og:image hit');
            return { url: og, source: 'source-og' };
        }
    }

    // 4) Wikimedia Commons
    console.log(`[Image] wikimedia: "${q}"`);
    const wm = await wikimediaImage(q);
    if (wm) {
        console.log('[Image]   -> wikimedia hit');
        return { url: wm, source: 'wikimedia' };
    }

    // 5) Pexels topic-aware fallback
    const fallback = pickPexelsFallback(title);
    console.log('[Image]   -> pexels fallback');
    return { url: fallback, source: 'pexels' };
}

module.exports = {
    searchNewsImage,
    fetchOgImage,
    ddgImage,
    wikimediaImage,
    validateImage,
    PEXELS_FALLBACKS,
    pickPexelsFallback,
};
