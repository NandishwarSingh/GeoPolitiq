/**
 * Push Notification Service for GeoPolitiq
 * Handles sending web push notifications to subscribed users
 */

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure web-push with VAPID keys (only if keys are configured)
function initVapid() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@geopolitiq.com';

    if (publicKey && privateKey) {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        console.log('[Push] VAPID configured successfully');
        return true;
    } else {
        console.log('[Push] VAPID keys not configured - push notifications disabled');
        return false;
    }
}

// Initialize on module load
const vapidConfigured = initVapid();

/**
 * Send notification to a single subscription
 */
async function sendNotification(subscription, payload) {
    if (!vapidConfigured) return false;

    try {
        await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: subscription.keys
        }, JSON.stringify(payload));
        return true;
    } catch (error) {
        // Handle expired/invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`[Push] Removing expired subscription: ${subscription.endpoint.substring(0, 50)}...`);
            await PushSubscription.deleteOne({ _id: subscription._id });
        } else {
            console.error(`[Push] Failed to send: ${error.message}`);
        }
        return false;
    }
}

/**
 * Send notification to subscriptions matching the post's topicCluster
 */
async function notifyUsersForPost(post) {
    if (!vapidConfigured) {
        console.log('[Push] Skipping - VAPID not configured');
        return { sent: 0, failed: 0 };
    }

    const cluster = post.topicCluster;
    if (!cluster) {
        console.log('[Push] Skipping post without topicCluster');
        return { sent: 0, failed: 0 };
    }

    // Find subscriptions that want this country's news
    const subscriptions = await PushSubscription.find({
        preferredCountries: cluster.toUpperCase()
    });

    console.log(`[Push] Found ${subscriptions.length} subscribers for ${cluster}`);

    if (subscriptions.length === 0) {
        return { sent: 0, failed: 0 };
    }

    const payload = {
        title: `📰 ${cluster} News`,
        body: post.title,
        url: `/post/${post.slug}`,
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: post._id.toString()
    };

    let sent = 0, failed = 0;

    for (const sub of subscriptions) {
        const success = await sendNotification(sub, payload);
        if (success) {
            sent++;
            sub.lastNotified = new Date();
            await sub.save();
        } else {
            failed++;
        }
    }

    console.log(`[Push] Sent: ${sent}, Failed: ${failed}`);
    return { sent, failed };
}

/**
 * Send notifications for multiple posts (batch after AI generation)
 */
async function notifyUsersForPosts(posts) {
    if (!vapidConfigured) {
        console.log('[Push] Skipping batch - VAPID not configured');
        return { total: 0, sent: 0, failed: 0 };
    }

    const results = { total: 0, sent: 0, failed: 0 };

    for (const post of posts) {
        const result = await notifyUsersForPost(post);
        results.total++;
        results.sent += result.sent;
        results.failed += result.failed;
    }

    console.log(`[Push] Batch complete: ${results.sent} notifications for ${results.total} posts`);
    return results;
}

/**
 * Get VAPID public key for client
 */
function getPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Check if push notifications are properly configured
 */
function isConfigured() {
    return vapidConfigured;
}

module.exports = {
    notifyUsersForPost,
    notifyUsersForPosts,
    getPublicKey,
    isConfigured
};
