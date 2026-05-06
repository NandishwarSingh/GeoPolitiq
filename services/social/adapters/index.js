/**
 * Adapter Registry
 *
 * Maps platform name → adapter module. Phase 0 ships only stubs that
 * raise NotImplemented; subsequent phases drop in real implementations.
 *
 * Note: all 7 Mastodon-compatible platforms (mastodon, pleroma, misskey,
 * calckey, iceshrimp, friendica, gotosocial) will share a single adapter
 * once Phase 2 lands — they all speak the same API.
 */

const { NotImplementedAdapter } = require('./_base');

// Each adapter is a thin module exporting { post } — start with stubs
function stub(name) {
    const a = new NotImplementedAdapter(name);
    return { post: a.post.bind(a) };
}

const telegraphAdapter = require('./telegraph');
const nostrAdapter = require('./nostr');
const mastodonAdapter = require('./mastodon');
const blueskyAdapter = require('./bluesky');
const mediumAdapter = require('./medium');
const twitterAdapter = require('./twitter');
const tumblrAdapter = require('./tumblr');

const REGISTRY = {
    medium: mediumAdapter,
    telegraph: telegraphAdapter,
    writefreely: stub('writefreely'),

    mastodon: mastodonAdapter,
    pleroma: mastodonAdapter,
    misskey: mastodonAdapter,
    calckey: mastodonAdapter,
    iceshrimp: mastodonAdapter,
    friendica: mastodonAdapter,
    gotosocial: mastodonAdapter,

    bluesky: blueskyAdapter,
    nostr: nostrAdapter,
    twitter: twitterAdapter,

    tumblr: tumblrAdapter,
    plurk: stub('plurk'),
    mistly: stub('mistly'),
};

function getAdapter(platform) {
    return REGISTRY[platform] || null;
}

function registerAdapter(platform, impl) {
    REGISTRY[platform] = impl;
}

module.exports = { getAdapter, registerAdapter, REGISTRY };
