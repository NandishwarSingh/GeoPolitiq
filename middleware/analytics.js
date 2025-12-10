/**
 * Analytics Middleware
 * Tracks page views for non-bot visitors with IP deduplication and country detection
 */

const PageView = require('../models/PageView');
const { detectBot } = require('../utils/botDetector');
const crypto = require('crypto');
const https = require('https');

// 4 hours in milliseconds
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Hash IP address for privacy
 */
function hashIP(ip) {
    if (!ip) return null;
    return crypto.createHash('sha256').update(ip + 'geopolitiq-salt').digest('hex').substring(0, 16);
}

/**
 * Get country from IP using ip-api.com (free, no API key needed)
 * Returns country code (e.g., 'India', 'United States') or null
 */
function getCountryFromIP(ip) {
    return new Promise((resolve) => {
        // Skip localhost/private IPs
        if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            resolve('Local');
            return;
        }

        // Clean IP (remove ::ffff: prefix)
        const cleanIP = ip.replace('::ffff:', '');

        const url = `http://ip-api.com/json/${cleanIP}?fields=status,country`;

        const http = require('http');
        http.get(url, { timeout: 3000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.status === 'success' && json.country) {
                        resolve(json.country);
                    } else {
                        resolve(null);
                    }
                } catch {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null))
            .on('timeout', () => resolve(null));
    });
}

/**
 * Analytics tracking middleware
 * Logs page views with IP deduplication (4 hour window) and country detection
 */
async function analyticsMiddleware(req, res, next) {
    // Only track GET requests
    if (req.method !== 'GET') {
        return next();
    }

    // Skip admin and API routes
    const path = req.path;
    if (path.startsWith('/admin') || path.startsWith('/api')) {
        return next();
    }

    // Skip static assets
    if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i)) {
        return next();
    }

    // Run bot detection
    const { isBot } = detectBot(req);
    if (isBot) {
        return next();
    }

    // Get hashed IP
    const ip = req.ip || req.connection.remoteAddress;
    const ipHash = hashIP(ip);

    // Check for duplicate visit within 4 hours
    const fourHoursAgo = new Date(Date.now() - DEDUP_WINDOW_MS);

    try {
        const recentVisit = await PageView.findOne({
            ipHash: ipHash,
            timestamp: { $gte: fourHoursAgo }
        }).lean();

        if (recentVisit) {
            // Already counted this IP in the last 4 hours, skip
            return next();
        }

        // Get country asynchronously (don't block)
        const country = await getCountryFromIP(ip);

        // Log the page view
        await PageView.create({
            path: path,
            timestamp: new Date(),
            ipHash: ipHash,
            country: country,
            userAgent: (req.get('User-Agent') || '').substring(0, 500)
        });

        console.log(`[Analytics] PageView: ${path} | Country: ${country || 'Unknown'} | IP: ${ipHash.substring(0, 8)}...`);

    } catch (err) {
        console.error('[Analytics] Error:', err.message);
    }

    next();
}

module.exports = analyticsMiddleware;
