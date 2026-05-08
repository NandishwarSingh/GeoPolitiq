/**
 * Resolve the Tumblr blog name from the OAuth credentials, then write
 * all 5 values into /opt/geopolitiq/.env and add tumblr to SOCIAL_TARGETS.
 *
 * /v2/user/info returns user.blogs[]. We pick the first non-secondary blog
 * (or fall back to the first one).
 */

const axios = require('axios');
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const fs = require('fs');

const CK = process.env.TUMBLR_CONSUMER_KEY || '<REPLACE_ME>';
const CS = process.env.TUMBLR_CONSUMER_SECRET || '<REPLACE_ME>';
const TK = process.env.TUMBLR_OAUTH_TOKEN || '<REPLACE_ME>';
const TS = process.env.TUMBLR_OAUTH_TOKEN_SECRET || '<REPLACE_ME>';

const oauth = OAuth({
    consumer: { key: CK, secret: CS },
    signature_method: 'HMAC-SHA1',
    hash_function(base, key) {
        return crypto.createHmac('sha1', key).update(base).digest('base64');
    },
});

(async () => {
    const url = 'https://api.tumblr.com/v2/user/info';
    const auth = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, { key: TK, secret: TS }));
    let r;
    try {
        r = await axios.get(url, { headers: { ...auth, Accept: 'application/json' }, timeout: 15_000 });
    } catch (err) {
        console.error('Tumblr /user/info failed:', err.response?.status, err.response?.data || err.message);
        process.exit(1);
    }

    const blogs = r.data?.response?.user?.blogs || [];
    if (blogs.length === 0) {
        console.error('No blogs returned for this account');
        process.exit(1);
    }

    console.log('Blogs on this account:');
    blogs.forEach((b, i) => {
        console.log(`  ${i === 0 ? '★' : ' '} ${b.name.padEnd(20)} primary=${b.primary || false}  url=${b.url}`);
    });

    // Pick primary blog if marked, else first
    const primary = blogs.find((b) => b.primary) || blogs[0];
    const blogName = primary.name;
    console.log(`\nresolved blog name: ${blogName}`);

    // Write to .env
    const envPath = '/opt/geopolitiq/.env';
    let env = fs.readFileSync(envPath, 'utf8');
    function setKv(k, v) {
        const re = new RegExp(`^${k}=.*$`, 'm');
        if (re.test(env)) env = env.replace(re, `${k}=${v}`);
        else env += `\n${k}=${v}`;
    }
    setKv('TUMBLR_BLOG_NAME', blogName);
    setKv('TUMBLR_CONSUMER_KEY', CK);
    setKv('TUMBLR_CONSUMER_SECRET', CS);
    setKv('TUMBLR_OAUTH_TOKEN', TK);
    setKv('TUMBLR_OAUTH_TOKEN_SECRET', TS);

    // Add tumblr to SOCIAL_TARGETS if not already there
    const currentTargets = JSON.parse(
        env.match(/^SOCIAL_TARGETS=(.*)$/m)?.[1] || '[]'
    );
    if (!currentTargets.find((t) => t.platform === 'tumblr')) {
        currentTargets.push({ platform: 'tumblr', subPlatform: '' });
        setKv('SOCIAL_TARGETS', JSON.stringify(currentTargets));
        console.log('added tumblr to SOCIAL_TARGETS');
    }

    fs.writeFileSync(envPath, env);
    console.log('\n.env updated');
})();
