/**
 * GeoPolitiq - Main JavaScript
 * Optimized for fast loading
 */

// ═══════════════════════════════════════════════════════
// DARK MODE TOGGLE - Runs immediately
// ═══════════════════════════════════════════════════════

(function () {
    var themeToggle = document.getElementById('theme-toggle');
    var html = document.documentElement;
    var body = document.body;

    function getPreferredTheme() {
        var saved = localStorage.getItem('theme');
        if (saved) return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        if (theme === 'dark') {
            html.classList.add('dark-mode');
            if (body) body.classList.add('dark-mode');
        } else {
            html.classList.remove('dark-mode');
            if (body) body.classList.remove('dark-mode');
        }
    }

    // Apply theme immediately
    applyTheme(getPreferredTheme());

    // Handle toggle click
    if (themeToggle) {
        themeToggle.addEventListener('click', function () {
            var isDark = html.classList.contains('dark-mode');
            var newTheme = isDark ? 'light' : 'dark';
            applyTheme(newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
})();

// ═══════════════════════════════════════════════════════
// DOM READY FUNCTIONS
// ═══════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
    // Mobile menu toggle
    var mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    var headerNav = document.querySelector('.header-nav');

    if (mobileMenuBtn && headerNav) {
        mobileMenuBtn.addEventListener('click', function () {
            headerNav.classList.toggle('mobile-open');
            this.textContent = headerNav.classList.contains('mobile-open') ? '✕' : '☰';
        });
    }

    // Copy link button
    var copyButtons = document.querySelectorAll('.share-copy');
    copyButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var url = window.location.origin + this.dataset.url;
            navigator.clipboard.writeText(url).then(function () {
                btn.textContent = 'Copied!';
                setTimeout(function () {
                    btn.textContent = 'Copy Link';
                }, 2000);
            }).catch(function (err) {
                console.error('Failed to copy:', err);
            });
        });
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
        anchor.addEventListener('click', function (e) {
            var href = this.getAttribute('href');
            if (href === '#') return;
            e.preventDefault();
            var target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // Update relative times
    function updateRelativeTimes() {
        var times = document.querySelectorAll('time[datetime]');
        times.forEach(function (el) {
            var date = new Date(el.getAttribute('datetime'));
            var now = new Date();
            var diffMs = now - date;
            var diffMins = Math.floor(diffMs / 60000);
            var diffHours = Math.floor(diffMs / 3600000);
            var diffDays = Math.floor(diffMs / 86400000);

            var text;
            if (diffMins < 1) {
                text = 'Just now';
            } else if (diffMins < 60) {
                text = diffMins + 'm ago';
            } else if (diffHours < 24) {
                text = diffHours + 'h ago';
            } else if (diffDays < 7) {
                text = diffDays + 'd ago';
            } else {
                return;
            }

            if (el.classList.contains('post-card-time') ||
                el.classList.contains('featured-time') ||
                el.classList.contains('latest-time')) {
                el.textContent = text;
            }
        });
    }

    updateRelativeTimes();
    setInterval(updateRelativeTimes, 60000);
});

// ═══════════════════════════════════════════════════════
// PUSH NOTIFICATIONS - AUTO-ENABLE BY DEFAULT
// ═══════════════════════════════════════════════════════

const PushNotifications = {
    async init() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log('[Push] Not supported in this browser');
            return;
        }

        try {
            // Register service worker
            await navigator.serviceWorker.register('/sw.js');
            console.log('[Push] Service worker registered');

            // AUTO-ENABLE: Prompt on first visit if not already decided
            if (!localStorage.getItem('pushDecided')) {
                // 5 second delay to not interrupt initial page load
                setTimeout(() => this.promptAutoSubscribe(), 5000);
            }

            this.updateFooterUI();
        } catch (error) {
            console.error('[Push] Service worker registration failed:', error);
        }
    },

    async promptAutoSubscribe() {
        // Check if permission already granted/denied
        const permission = Notification.permission;

        if (permission === 'default') {
            // First visit - request permission and subscribe with ALL countries
            const result = await Notification.requestPermission();
            localStorage.setItem('pushDecided', 'true');

            if (result === 'granted') {
                await this.subscribe(['USA', 'INDIA', 'UK', 'EU', 'GLOBAL']);
                console.log('[Push] Auto-subscribed to all regions');
            }
        }
        this.updateFooterUI();
    },

    async subscribe(preferredCountries) {
        if (!preferredCountries) {
            preferredCountries = ['USA', 'INDIA', 'UK', 'EU', 'GLOBAL'];
        }

        try {
            const registration = await navigator.serviceWorker.ready;

            // Get VAPID key from server
            const response = await fetch('/api/push/vapid-key');
            if (!response.ok) {
                console.log('[Push] Server not configured for push');
                return false;
            }
            const { publicKey } = await response.json();

            // Subscribe with Push Manager
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(publicKey)
            });

            // Send subscription to server
            await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription: subscription.toJSON(),
                    preferredCountries: preferredCountries
                })
            });

            localStorage.setItem('pushEnabled', 'true');
            localStorage.setItem('pushCountries', JSON.stringify(preferredCountries));
            this.updateFooterUI();
            console.log('[Push] Subscribed successfully');
            return true;
        } catch (error) {
            console.error('[Push] Subscription failed:', error);
            return false;
        }
    },

    async unsubscribe() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();

            if (subscription) {
                const endpoint = subscription.endpoint;
                await subscription.unsubscribe();

                await fetch('/api/push/unsubscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: endpoint })
                });
            }

            localStorage.setItem('pushEnabled', 'false');
            localStorage.removeItem('pushCountries');
            this.updateFooterUI();
            console.log('[Push] Unsubscribed successfully');
            return true;
        } catch (error) {
            console.error('[Push] Unsubscribe failed:', error);
            return false;
        }
    },

    updateFooterUI() {
        const toggle = document.getElementById('pushToggle');
        if (!toggle) return;

        const enabled = this.isEnabled();
        toggle.innerHTML = enabled ? '🔔 Notifications On' : '🔕 Notifications Off';
        toggle.classList.toggle('push-enabled', enabled);
    },

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    },

    isEnabled() {
        return localStorage.getItem('pushEnabled') === 'true';
    }
};

// Toggle function for footer button
async function togglePushNotifications() {
    if (typeof PushNotifications === 'undefined') return;

    if (PushNotifications.isEnabled()) {
        await PushNotifications.unsubscribe();
    } else {
        const permission = await Notification.requestPermission();
        localStorage.setItem('pushDecided', 'true');
        if (permission === 'granted') {
            await PushNotifications.subscribe(['USA', 'INDIA', 'UK', 'EU', 'GLOBAL']);
        }
    }
}

// Initialize push notifications on page load
document.addEventListener('DOMContentLoaded', function () {
    PushNotifications.init();
});
