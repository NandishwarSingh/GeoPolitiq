/**
 * Bot Detector Utility
 * Multi-layer bot detection for analytics filtering
 */

const { isbot: isbotCheck } = require('isbot');

// Extended bot patterns for Layer 2 detection
// IMPORTANT: Patterns must be specific to avoid matching real browsers
const BOT_PATTERNS = [
    // Search Engines (specific bot names)
    'googlebot', 'bingbot', 'yandexbot', 'baiduspider', 'duckduckbot',
    'slurp', 'sogou', 'exabot', 'facebot', 'ia_archiver',

    // SEO/Monitoring Tools (use specific identifiers)
    'ahrefs', 'semrush', 'moz.com', 'majestic', 'screaming frog',
    'seokicks', 'sistrix', 'dotbot', 'rogerbot', 'gigabot',
    'blexbot', 'dataforseo', 'serpstat',

    // Social/Preview Bots
    'twitterbot', 'linkedinbot', 'pinterestbot', 'whatsapp', 'telegrambot',
    'slackbot', 'discordbot', 'facebookexternalhit', 'vkshare',

    // AI/LLM Crawlers
    'gptbot', 'chatgpt-user', 'claudebot', 'anthropic-ai', 'perplexitybot',
    'cohere-ai', 'bytespider', 'ccbot', 'openai', 'diffbot',

    // Tools/Libraries (specific identifiers)
    'curl/', 'wget/', 'python-requests', 'python-urllib', 'java/',
    'go-http-client', 'axios/', 'node-fetch', 'httpclient', 'okhttp',
    'libwww-perl', 'apache-httpclient', 'httpie', 'postmanruntime', 'insomnia',

    // Headless Browsers
    'headlesschrome', 'phantomjs', 'selenium', 'puppeteer', 'playwright',
    'webdriver', 'nightmare',

    // Generic Bot Terms (with word boundaries to be safer)
    'crawler', 'spider', 'scraper', 'archiver',
    'fetcher', 'checker', 'validator', 'probe',
    'scanner', 'analyzer', 'indexer'
];

// Compile patterns into regex for faster matching
const BOT_REGEX = new RegExp(BOT_PATTERNS.join('|'), 'i');

/**
 * Detect if a request is from a bot
 * @param {Object} req - Express request object
 * @returns {Object} { isBot: boolean, reason: string }
 */
function detectBot(req) {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language');
    const acceptEncoding = req.get('Accept-Encoding');

    // Layer 1: isbot package (most accurate)
    if (isbotCheck(userAgent)) {
        return { isBot: true, reason: 'isbot-detection' };
    }

    // Layer 2: Extended pattern matching
    if (BOT_REGEX.test(userAgent)) {
        return { isBot: true, reason: 'pattern-match' };
    }

    // Layer 3: Suspicious header detection

    // Empty or very short user agent
    if (!userAgent || userAgent.length < 20) {
        return { isBot: true, reason: 'short-ua' };
    }

    // Missing Accept-Language (most browsers send this)
    if (!acceptLanguage) {
        return { isBot: true, reason: 'no-accept-language' };
    }

    // Missing Accept-Encoding (all modern browsers send this)
    if (!acceptEncoding) {
        return { isBot: true, reason: 'no-accept-encoding' };
    }

    return { isBot: false, reason: null };
}

/**
 * Quick check if user agent is a bot (simpler API)
 * @param {string} userAgent - User agent string
 * @returns {boolean}
 */
function isBot(userAgent) {
    if (!userAgent || userAgent.length < 20) return true;
    if (isbotCheck(userAgent)) return true;
    if (BOT_REGEX.test(userAgent)) return true;
    return false;
}

module.exports = {
    detectBot,
    isBot,
    BOT_PATTERNS
};
