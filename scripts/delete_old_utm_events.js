/**
 * One-off: delete old GeoPolitiq Nostr events that contain UTM tracking
 * params. Sends a NIP-09 (kind:5) delete request listing each offending
 * event id. Most clients honor it and stop showing the post; many relays
 * also drop the underlying event from storage.
 *
 * Run from the VPS:
 *   cd /opt/geopolitiq && node scripts/delete_old_utm_events.js
 */

const fs = require('fs');
const path = require('path');
const {
    getPublicKey,
    finalizeEvent,
    nip19,
    SimplePool,
} = require('nostr-tools');
const { useWebSocketImplementation } = require('nostr-tools/relay');
useWebSocketImplementation(require('ws'));

const KEY_FILE = path.join('/opt/geopolitiq', '.cache', 'nostr_key');
const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
];

(async () => {
    if (!fs.existsSync(KEY_FILE)) {
        console.error('No Nostr key file at ' + KEY_FILE);
        process.exit(1);
    }
    const sk = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    const pubkey = getPublicKey(sk);
    console.log('npub:', nip19.npubEncode(pubkey));

    const pool = new SimplePool();

    // Pull all Kind:1 events authored by our pubkey
    console.log('\n[1/3] querying relays for our past notes...');
    const events = await pool.querySync(
        RELAYS,
        { authors: [pubkey], kinds: [1], limit: 200 },
        { maxWait: 10_000 }
    );
    console.log(`  found ${events.length} kind:1 events`);

    // Filter to ones containing UTM tracking
    const flagged = events.filter((e) => /utm_(?:source|medium|campaign|content|term)/.test(e.content || ''));
    console.log(`\n[2/3] ${flagged.length} of those carry UTM tracking — will be deleted:`);
    for (const e of flagged.slice(0, 20)) {
        const preview = (e.content || '').replace(/\s+/g, ' ').substring(0, 70);
        console.log(`  - ${e.id.substring(0, 12)}... ${preview}…`);
    }

    if (flagged.length === 0) {
        console.log('\nnothing to delete — exiting.');
        pool.close(RELAYS);
        process.exit(0);
    }

    // Build a single NIP-09 delete request listing all flagged event ids
    const deleteEvent = finalizeEvent(
        {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: flagged.map((e) => ['e', e.id]),
            content: 'Removed: contained tracking parameters that have since been stripped from our pipeline.',
        },
        sk
    );

    console.log('\n[3/3] publishing kind:5 delete request to relays...');
    const publishArray = pool.publish(RELAYS, deleteEvent);
    const results = await Promise.all(
        publishArray.map((p, i) =>
            Promise.race([
                p.then(
                    () => ({ url: RELAYS[i], ok: true }),
                    (err) => ({ url: RELAYS[i], ok: false, err: err?.message || String(err) })
                ),
                new Promise((resolve) =>
                    setTimeout(() => resolve({ url: RELAYS[i], ok: false, err: 'timeout' }), 8_000)
                ),
            ])
        )
    );
    pool.close(RELAYS);

    for (const r of results) {
        console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.url + (r.err ? ' (' + r.err + ')' : ''));
    }
    const ok = results.filter((r) => r.ok).length;
    console.log(`\n${ok}/${RELAYS.length} relays accepted the delete request.`);
    console.log('Most clients (Damus, Snort, Primal, Iris, Amethyst) will hide these posts within seconds.');
    process.exit(ok > 0 ? 0 : 1);
})().catch((e) => {
    console.error('fatal:', e.stack || e.message);
    process.exit(1);
});
