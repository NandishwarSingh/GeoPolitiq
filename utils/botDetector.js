/**
 * Bot Detector Utility
 * Multi-layer bot detection for analytics filtering.
 *
 * Layered checks (cheapest first, most expensive last):
 *  1. isbot package (high-precision UA dictionary)
 *  2. Extended UA pattern list
 *  3. Header-shape heuristics (Accept-Language, Accept-Encoding, length)
 *  4. Modern-browser fingerprint checks (Sec-Fetch-*, Sec-CH-UA)
 *  5. UA-vintage check (very old major versions in 2026 are almost always scrapers)
 *  6. Direct-hit + cold-IP combo for known-scraper UA shapes
 */

const { isbot: isbotCheck } = require('isbot');

const BOT_PATTERNS = [
    // Search engines
    'googlebot', 'bingbot', 'yandexbot', 'baiduspider', 'duckduckbot',
    'slurp', 'sogou', 'exabot', 'facebot', 'ia_archiver', 'applebot',
    'petalbot', 'mj12bot', 'seznambot',

    // SEO / monitoring tools
    'ahrefs', 'semrush', 'moz.com', 'majestic', 'screaming frog',
    'seokicks', 'sistrix', 'dotbot', 'rogerbot', 'gigabot',
    'blexbot', 'dataforseo', 'serpstat', 'semrushbot', 'mojeekbot',
    'netcraft', 'sitelock', 'pingdom', 'uptimerobot', 'statuscake',

    // Social / preview bots
    'twitterbot', 'linkedinbot', 'pinterestbot', 'whatsapp', 'telegrambot',
    'slackbot', 'discordbot', 'facebookexternalhit', 'vkshare', 'redditbot',

    // AI / LLM crawlers
    'gptbot', 'chatgpt-user', 'claudebot', 'anthropic-ai', 'perplexitybot',
    'cohere-ai', 'bytespider', 'ccbot', 'openai', 'diffbot',
    'imagesiftbot', 'omgili', 'youbot', 'ai2bot', 'meta-externalagent',
    'amazonbot', 'webmaster.gpt', 'bingpreview',

    // Scraper / scanner libraries
    'curl/', 'wget/', 'python-requests', 'python-urllib', 'java/',
    'go-http-client', 'axios/', 'node-fetch', 'httpclient', 'okhttp',
    'libwww-perl', 'apache-httpclient', 'httpie', 'postmanruntime', 'insomnia',
    'scrapy', 'colly', 'aiohttp', 'urllib3', 'mechanize', 'restsharp',
    'reqwest', 'rust-reqwest',

    // Security scanners (cert transparency follow-up traffic)
    'censysinspect', 'shodan', 'masscan', 'nuclei', 'zgrab', 'nmap',
    'nikto', 'acunetix', 'qualys', 'sslyze', 'openvas', 'paloalto',
    'expanse', 'binaryedge', 'leakix', 'researchscan', 'wpcrawler',

    // Headless browsers / automation
    'headlesschrome', 'phantomjs', 'selenium', 'puppeteer', 'playwright',
    'webdriver', 'nightmare', 'cypress', 'splash', 'electron',

    // Generic terms
    'crawler', 'spider', 'scraper', 'archiver',
    'fetcher', 'checker', 'validator', 'probe',
    'scanner', 'analyzer', 'indexer', 'monitor',
];

const BOT_REGEX = new RegExp(BOT_PATTERNS.join('|'), 'i');

/**
 * Pull the major version of a known browser engine out of a UA string.
 * Returns { name, major } or null.
 */
function parseBrowserVersion(ua) {
    const lower = ua.toLowerCase();

    // Chrome / Edge / Opera (all share Chrome/N.N…)
    let m = ua.match(/Chrome\/(\d+)/);
    if (m && !lower.includes('headless')) {
        return { name: 'chrome', major: parseInt(m[1], 10) };
    }

    // Safari (Version/N.N…)
    if (lower.includes('safari') && !lower.includes('chrome')) {
        m = ua.match(/Version\/(\d+)/);
        if (m) return { name: 'safari', major: parseInt(m[1], 10) };
    }

    // Firefox
    m = ua.match(/Firefox\/(\d+)/);
    if (m) return { name: 'firefox', major: parseInt(m[1], 10) };

    return null;
}

/**
 * Versions older than these majors in 2026 are very likely scraper UA pools.
 * Tuned conservatively — real visitors on neglected devices may run a few
 * majors behind, but nothing on the global stable channel is this far back.
 */
const MIN_BROWSER_MAJOR = {
    chrome: 100,    // Chrome 100 = March 2022
    firefox: 100,   // Firefox 100 = May 2022
    safari: 15,     // Safari 15 = Sep 2021
};

function isAncientBrowser(ua) {
    const v = parseBrowserVersion(ua);
    if (!v) return false;
    const min = MIN_BROWSER_MAJOR[v.name];
    return min != null && v.major < min;
}

/**
 * Detect whether the request looks like a real browser.
 *
 * Returns: { isBot: boolean, reason: string|null }
 */
function detectBot(req) {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language');
    const acceptEncoding = req.get('Accept-Encoding');
    const accept = req.get('Accept') || '';
    const secFetchSite = req.get('Sec-Fetch-Site');
    const secFetchMode = req.get('Sec-Fetch-Mode');
    const secFetchDest = req.get('Sec-Fetch-Dest');
    const secChUa = req.get('Sec-CH-UA');
    const referer = req.get('Referer') || '';

    // ---- Layer 1: isbot package ----
    if (isbotCheck(userAgent)) {
        return { isBot: true, reason: 'isbot-dictionary' };
    }

    // ---- Layer 2: pattern list ----
    if (BOT_REGEX.test(userAgent)) {
        return { isBot: true, reason: 'pattern-match' };
    }

    // ---- Layer 3: header shape ----
    if (!userAgent || userAgent.length < 20) {
        return { isBot: true, reason: 'ua-too-short' };
    }
    if (!acceptLanguage) {
        return { isBot: true, reason: 'missing-accept-language' };
    }
    if (!acceptEncoding) {
        return { isBot: true, reason: 'missing-accept-encoding' };
    }
    if (!accept.includes('text/html')) {
        return { isBot: true, reason: 'no-html-accept' };
    }

    // ---- Layer 4: modern-browser fingerprint ----
    // Every Chromium browser since 2020 sends the Sec-Fetch-* triplet on
    // navigations. Safari 16+ and Firefox 90+ also send Sec-Fetch-Site.
    // A "browser" UA without any of these is almost always a scripted client.
    const hasAnySecFetch = !!(secFetchSite || secFetchMode || secFetchDest);
    if (!hasAnySecFetch) {
        return { isBot: true, reason: 'missing-sec-fetch' };
    }

    // Chrome/Edge/Opera also send Sec-CH-UA. Safari/Firefox don't, so we only
    // demand it when the UA claims to be Chrome.
    if (/Chrome\//.test(userAgent) && !/Chromium|HeadlessChrome/.test(userAgent) && !secChUa) {
        return { isBot: true, reason: 'chrome-without-sec-ch-ua' };
    }

    // ---- Layer 5: ancient browser claim ----
    if (isAncientBrowser(userAgent)) {
        return { isBot: true, reason: 'browser-version-ancient' };
    }

    // ---- Layer 6: Sec-Fetch-Site=none + no referer + ancient-style UA ----
    // Real direct visitors land with Sec-Fetch-Site=none AND a current UA.
    // Cert-transparency scanners and SEO bots hit / cold with a stale UA pool.
    if (secFetchSite === 'none' && !referer && /iPhone OS 1[0-3]_|Chrome\/(8[0-9]|9[0-9])\./.test(userAgent)) {
        return { isBot: true, reason: 'cold-hit-stale-ua' };
    }

    return { isBot: false, reason: null };
}

function isBot(userAgent) {
    if (!userAgent || userAgent.length < 20) return true;
    if (isbotCheck(userAgent)) return true;
    if (BOT_REGEX.test(userAgent)) return true;
    if (isAncientBrowser(userAgent)) return true;
    return false;
}

module.exports = {
    detectBot,
    isBot,
    BOT_PATTERNS,
    isAncientBrowser,
    parseBrowserVersion,
};
