/**
 * Nostr Adapter
 *
 * Publishes a Kind:1 (text note) event to a list of free public relays.
 * On first call, generates a secp256k1 secret key and persists it at
 * /opt/geopolitiq/.cache/nostr_key (mode 0600). All future posts use
 * the same identity.
 *
 * Returns:
 *   remoteId  — nip-19 `note1...` bech32 of the event id
 *   remoteUrl — https://njump.me/<note1...> (web viewer that resolves
 *               from any relay, gives us a clickable permalink)
 */

const fs = require('fs');
const path = require('path');
const {
    generateSecretKey,
    getPublicKey,
    finalizeEvent,
    nip19,
    SimplePool,
} = require('nostr-tools');
const { useWebSocketImplementation } = require('nostr-tools/relay');
useWebSocketImplementation(require('ws'));

const CACHE_DIR = path.join('/opt/geopolitiq', '.cache');
const KEY_FILE = path.join(CACHE_DIR, 'nostr_key');

const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://nostr.wine',
    'wss://relay.snort.social',
    'wss://relay.primal.net',
];

const PUBLISH_TIMEOUT_MS = 8_000;

let cachedKey = null;

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    }
}

function ensureSecretKey() {
    if (cachedKey) return cachedKey;
    ensureCacheDir();
    if (fs.existsSync(KEY_FILE)) {
        const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
        cachedKey = Buffer.from(hex, 'hex');
        return cachedKey;
    }
    cachedKey = generateSecretKey(); // Uint8Array(32)
    fs.writeFileSync(KEY_FILE, Buffer.from(cachedKey).toString('hex'), { mode: 0o600 });
    const pk = getPublicKey(cachedKey);
    const npub = nip19.npubEncode(pk);
    console.log(`[Nostr] new keypair generated. npub=${npub}`);
    return cachedKey;
}

/**
 * Build hashtag tags from the payload — Nostr convention is to put each
 * hashtag in its own ['t', 'tagname'] tag, lowercase, no '#'.
 */
function buildHashtagTags(payloadText, payloadTags) {
    const set = new Set();
    // From explicit tag array
    for (const t of payloadTags || []) {
        const slug = String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (slug) set.add(slug);
    }
    // From #hashtags inside the text
    const hashRe = /#([a-z][a-z0-9_]+)/gi;
    let m;
    while ((m = hashRe.exec(payloadText || ''))) {
        set.add(m[1].toLowerCase());
    }
    // Always include the genre tag
    set.add('geopolitics');
    return [...set].slice(0, 6).map((t) => ['t', t]);
}

async function post(payload, ctx) {
    if (payload.kind !== 'microblog') {
        const err = new Error('Nostr requires microblog payload');
        err.response = { status: 400 };
        throw err;
    }
    const sk = ensureSecretKey();

    const tags = buildHashtagTags(payload.text, payload.tags);
    // Add the URL as a 'r' (URL reference) tag — convention for richer event
    if (payload.url) tags.push(['r', payload.url]);

    const evt = finalizeEvent(
        {
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: payload.text,
        },
        sk
    );

    // Publish to all relays in parallel; succeed if at least one accepts.
    // SimplePool.publish() in nostr-tools v2 returns Promise<void>[] —
    // one promise per relay, NOT a single promise.
    const pool = new SimplePool();
    const publishArray = pool.publish(RELAYS, evt);   // Promise<void>[]
    const results = await Promise.all(
        publishArray.map((p, i) =>
            Promise.race([
                p.then(
                    () => ({ url: RELAYS[i], ok: true }),
                    (err) => ({ url: RELAYS[i], ok: false, err: err?.message || String(err) })
                ),
                new Promise((resolve) =>
                    setTimeout(
                        () => resolve({ url: RELAYS[i], ok: false, err: 'timeout' }),
                        PUBLISH_TIMEOUT_MS
                    )
                ),
            ])
        )
    );
    pool.close(RELAYS);
    const successes = results.filter((r) => r.ok).map((r) => r.url);
    const failures = results.filter((r) => !r.ok);

    if (successes.length === 0) {
        const err = new Error(
            'No Nostr relay accepted the event: ' + failures.map((f) => `${f.url}=${f.err}`).join('; ')
        );
        err.response = { status: 502 };
        throw err;
    }

    console.log(`[Nostr] event published to ${successes.length}/${RELAYS.length} relays`);

    const noteId = nip19.noteEncode(evt.id);
    return {
        remoteId: noteId,
        remoteUrl: `https://njump.me/${noteId}`,
    };
}

module.exports = { post };
