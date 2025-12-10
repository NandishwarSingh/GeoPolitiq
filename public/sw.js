/**
 * Service Worker for GeoPolitiq Push Notifications
 * Handles push events and notification clicks
 */

// Handle push notifications
self.addEventListener('push', function (event) {
    if (!event.data) {
        console.log('[SW] Push received but no data');
        return;
    }

    let data;
    try {
        data = event.data.json();
    } catch (e) {
        data = { title: 'GeoPolitiq', body: event.data.text() };
    }

    const options = {
        body: data.body || 'New article available',
        icon: data.icon || '/favicon.png',
        badge: data.badge || '/favicon.png',
        tag: data.tag || 'geopolitiq-notification',
        data: { url: data.url || '/' },
        requireInteraction: false,
        vibrate: [100, 50, 100]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'GeoPolitiq', options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    const url = event.notification.data?.url || '/';
    const fullUrl = new URL(url, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Try to focus an existing window
            for (const client of windowClients) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    client.navigate(fullUrl);
                    return client.focus();
                }
            }
            // Open a new window if none exists
            return clients.openWindow(fullUrl);
        })
    );
});

// Handle service worker activation
self.addEventListener('activate', function (event) {
    console.log('[SW] Activated');
    event.waitUntil(clients.claim());
});

// Handle service worker installation
self.addEventListener('install', function (event) {
    console.log('[SW] Installed');
    self.skipWaiting();
});
