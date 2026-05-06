/**
 * One-off: set / update the Nostr profile metadata for our existing key.
 * Publishes a Kind:0 event (NIP-01 metadata) to the same relay set the
 * adapter uses, signed with the persisted /opt/geopolitiq/.cache/nostr_key.
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
    'wss://nostr.wine',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
];

const PROFILE = {
    name: 'geopolitiq',
    display_name: 'GeoPolitiq',
    about: 'Geopolitical intelligence and analysis. Coverage: USA, Europe, India, UK, Middle East. https://geopolitiq.com',
    picture: 'https://geopolitiq.com/favicon.png',
    website: 'https://geopolitiq.com',
    nip05: '',
};

(async () => {
    if (!fs.existsSync(KEY_FILE)) {
        console.error('No Nostr key file at ' + KEY_FILE + ' — adapter must run at least once first.');
        process.exit(1);
    }
    const sk = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    const pk = getPublicKey(sk);
    const npub = nip19.npubEncode(pk);
    console.log('npub:', npub);
    console.log('updating profile to:', JSON.stringify(PROFILE, null, 2));

    const evt = finalizeEvent(
        {
            kind: 0,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: JSON.stringify(PROFILE),
        },
        sk
    );

    const pool = new SimplePool();
    const promises = pool.publish(RELAYS, evt);
    const results = await Promise.all(
        promises.map((p, i) =>
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
    console.log(`\n${ok}/${RELAYS.length} relays accepted Kind:0 metadata event`);
    console.log('view profile: https://njump.me/' + npub);
    process.exit(ok > 0 ? 0 : 1);
})();
