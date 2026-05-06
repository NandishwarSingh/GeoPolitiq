/**
 * Analytics Middleware
 * Tracks page views for non-bot visitors with IP deduplication and country detection.
 * Bot rejections are persisted to RejectedView for visibility in the admin dashboard.
 */

const PageView = require('../models/PageView');
const RejectedView = require('../models/RejectedView');
const { detectBot } = require('../utils/botDetector');
const crypto = require('crypto');

const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

function hashIP(ip) {
    if (!ip) return null;
    return crypto.createHash('sha256').update(ip + 'geopolitiq-salt').digest('hex').substring(0, 16);
}

function getCountryFromIP(ip) {
    return new Promise((resolve) => {
        if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            resolve('Local');
            return;
        }
        const cleanIP = ip.replace('::ffff:', '');
        const url = `http://ip-api.com/json/${cleanIP}?fields=status,country`;
        const http = require('http');
        const req = http
            .get(url, { timeout: 3000 }, (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.status === 'success' && json.country ? json.country : null);
                    } catch {
                        resolve(null);
                    }
                });
            })
            .on('error', () => resolve(null))
            .on('timeout', () => {
                req.destroy();
                resolve(null);
            });
    });
}

function classifyReferrer(referer, host) {
    if (!referer) return 'direct';
    let url;
    try {
        url = new URL(referer);
    } catch {
        return 'direct';
    }
    const refHost = url.hostname.toLowerCase();
    if (host && refHost === host.toLowerCase()) return 'internal';
    if (/google\.|bing\.|duckduckgo\.|yandex\.|baidu\.|brave\.com/.test(refHost)) return 'search';
    if (/twitter\.com|x\.com|t\.co|facebook\.|instagram\.|linkedin\.|reddit\.|threads\.net|news\.ycombinator/.test(refHost)) {
        return 'social';
    }
    if (/news\.|substack\.|medium\.com/.test(refHost)) return 'news';
    return 'external';
}

async function analyticsMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();

    const path = req.path;
    if (path.startsWith('/admin') || path.startsWith('/api')) return next();
    if (/\.(js|css|png|jpg|jpeg|gif|ico|svg|webp|avif|woff|woff2|ttf|eot|map|mp4|webm|xml|txt|json)$/i.test(path)) {
        return next();
    }

    const detection = detectBot(req);
    const ip = req.ip || req.connection.remoteAddress;
    const ipHash = hashIP(ip);

    if (detection.isBot) {
        // Persist a rejection record so the admin can see *what* is being filtered.
        // Country lookup is fire-and-forget so we don't block the response.
        getCountryFromIP(ip)
            .then((country) =>
                RejectedView.create({
                    path,
                    timestamp: new Date(),
                    reason: detection.reason,
                    ipHash,
                    country,
                    userAgent: (req.get('User-Agent') || '').substring(0, 500),
                    referer: (req.get('Referer') || '').substring(0, 500),
                })
            )
            .catch((err) => console.error('[Analytics] reject-log error:', err.message));

        console.log(
            `[Analytics] reject ${path} reason=${detection.reason} ua="${(req.get('User-Agent') || '').substring(0, 80)}"`
        );
        return next();
    }

    // ---- Accepted: dedupe by IP within 4 hours ----
    const fourHoursAgo = new Date(Date.now() - DEDUP_WINDOW_MS);
    try {
        const recent = await PageView.findOne({ ipHash, timestamp: { $gte: fourHoursAgo } }).lean();
        if (recent) return next();

        const country = await getCountryFromIP(ip);
        const referer = req.get('Referer') || '';
        let refSource = classifyReferrer(referer, req.hostname);

        // utm_source overrides referer-based classification when present.
        // This is how social-app traffic (where Referer is often stripped)
        // still attributes correctly back to the originating platform.
        const utmSource = (req.query && typeof req.query.utm_source === 'string')
            ? req.query.utm_source.toLowerCase().substring(0, 32)
            : '';
        if (utmSource) refSource = utmSource;

        await PageView.create({
            path,
            timestamp: new Date(),
            ipHash,
            country,
            userAgent: (req.get('User-Agent') || '').substring(0, 500),
            referer: referer.substring(0, 500),
            refSource,
        });

        console.log(
            `[Analytics] PageView: ${path} | ${country || 'Unknown'} | ${refSource}${
                referer ? ' (' + referer.substring(0, 60) + ')' : ''
            }`
        );
    } catch (err) {
        console.error('[Analytics] Error:', err.message);
    }

    next();
}

module.exports = analyticsMiddleware;
