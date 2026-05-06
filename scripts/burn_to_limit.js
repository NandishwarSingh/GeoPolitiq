/**
 * Burn-to-limit generator
 * Loops runGeneration() until OpenRouter credits run out or a hard error
 * stops us. Logs every iteration to /var/log/geopolitiq_burn.log.
 */

require('dotenv').config({ path: '/opt/geopolitiq/.env' });
const path = require('path');
process.chdir('/opt/geopolitiq');

const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');

const LOG = '/var/log/geopolitiq_burn.log';
const SAFETY = 0.03; // stop when remaining drops below this
const PAUSE_MS = 6_000; // be polite to upstream
const MAX_LOOPS = 1500; // hard ceiling; budget will normally cut us off first

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(LOG, line);
    process.stdout.write(line);
}

async function getRemaining(apiKey) {
    // Use /auth/key for the KEY-SCOPED spend cap (not the lifetime account total).
    const r = await axios.get('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10_000,
    });
    const d = r.data?.data || {};
    const limit = d.limit ?? 0;
    const used = d.usage ?? 0;
    const remaining = (d.limit_remaining ?? Math.max(0, limit - used));
    return { total: limit, used, remaining };
}

(async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) { log('ERROR: OPENROUTER_API_KEY missing'); process.exit(1); }

    // Connect to mongo
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/geopolitiq';
    await mongoose.connect(mongoUri);
    log('mongo connected');

    const Post = require('/opt/geopolitiq/models/Post');
    const aiSvc = require('/opt/geopolitiq/services/aiContentService');

    // 1) wipe all posts
    const wipe = await Post.deleteMany({});
    log(`wiped ${wipe.deletedCount} posts`);

    // 2) loop
    const start = Date.now();
    let totalRuns = 0;
    let totalSaved = 0;
    let totalCostStart = (await getRemaining(apiKey)).used;

    for (let i = 1; i <= MAX_LOOPS; i++) {
        const credit = await getRemaining(apiKey).catch((e) => {
            log(`credits-fetch error: ${e.message}`);
            return null;
        });
        if (credit === null) { await new Promise(r => setTimeout(r, 5000)); continue; }

        if (credit.remaining < SAFETY) {
            log(`STOP: remaining $${credit.remaining.toFixed(4)} < safety $${SAFETY}`);
            break;
        }

        log(`run ${i} -> remaining $${credit.remaining.toFixed(4)}, used $${credit.used.toFixed(4)}`);

        let result;
        try {
            result = await aiSvc.runGeneration();
        } catch (e) {
            log(`run ${i} threw: ${e.message}`);
            // If it's a budget/quota error from OpenRouter, give up.
            if (/quota|cap|limit|402/i.test(e.message)) {
                log('STOP: budget-related error');
                break;
            }
            await new Promise(r => setTimeout(r, 8_000));
            continue;
        }

        totalRuns += 1;
        if (result?.success) totalSaved += (result.count || 0);
        log(`  result: success=${result?.success} verified=${result?.count || 0} deleted=${result?.deleted || 0}`);

        await new Promise(r => setTimeout(r, PAUSE_MS));
    }

    const final = await getRemaining(apiKey).catch(() => null);
    const totalCostEnd = final?.used ?? totalCostStart;
    const elapsedMin = ((Date.now() - start) / 1000 / 60).toFixed(1);
    log(`DONE. runs=${totalRuns} saved=${totalSaved} elapsed=${elapsedMin}min spent=$${(totalCostEnd - totalCostStart).toFixed(4)}`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { log(`fatal: ${e.stack || e.message}`); process.exit(1); });
