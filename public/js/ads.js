/**
 * Deferred Adsterra ad loader.
 *
 * Adsterra's `invoke.js` scripts call `document.write` synchronously, which
 * blocks the HTML parser when included inline. We sidestep that by leaving
 * empty placeholder divs in the page and injecting each ad into its own
 * sandboxed `<iframe srcdoc="...">` AFTER the main page is interactive.
 *
 * Result: the article renders immediately; ads stream in afterwards without
 * blocking layout, paint, or interactivity.
 */
(function () {
    'use strict';

    var BANNER_468x60_KEY = 'f01ebf098315cc39ada5fbbcc31b536e';
    var BANNER_160x300_KEY = '1029f72a3202f6a45462942df7265c89';
    var NATIVE_CONTAINER_ID = '4e51ef11d0cf2e976f6199f2068a061b';

    function buildIframeAd(width, height, key) {
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:' + width + 'px;height:' + height + 'px;border:0;display:block;background:transparent;';
        iframe.scrolling = 'no';
        iframe.frameBorder = '0';
        iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('aria-hidden', 'true');
        var src = 'https://www.highperformanceformat.com/' + key + '/invoke.js';
        var html =
            '<!doctype html><html><head><meta charset="utf-8">' +
            '<base target="_top">' +
            '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}</style>' +
            '</head><body>' +
            '<scr' + 'ipt>atOptions={"key":"' + key + '","format":"iframe","height":' + height + ',"width":' + width + ',"params":{}};</scr' + 'ipt>' +
            '<scr' + 'ipt src="' + src + '"></scr' + 'ipt>' +
            '</body></html>';
        iframe.srcdoc = html;
        return iframe;
    }

    function buildNativeIframeAd(width, height) {
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:' + width + 'px;height:' + height + 'px;border:0;display:block;background:transparent;';
        iframe.scrolling = 'no';
        iframe.frameBorder = '0';
        iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('aria-hidden', 'true');
        var src = 'https://pl29390169.profitablecpmratenetwork.com/' + NATIVE_CONTAINER_ID + '/invoke.js';
        var html =
            '<!doctype html><html><head><meta charset="utf-8"><base target="_top">' +
            '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}' +
            '#container-' + NATIVE_CONTAINER_ID + '{width:100%;}</style>' +
            '</head><body>' +
            '<scr' + 'ipt async data-cfasync="false" src="' + src + '"></scr' + 'ipt>' +
            '<div id="container-' + NATIVE_CONTAINER_ID + '"></div>' +
            '</body></html>';
        iframe.srcdoc = html;
        return iframe;
    }

    function fillSlot(slot) {
        if (slot.getAttribute('data-ad-loaded') === '1') return;
        slot.setAttribute('data-ad-loaded', '1');
        var kind = slot.getAttribute('data-ad');

        if (kind === 'header-468x60') {
            slot.appendChild(buildIframeAd(468, 60, BANNER_468x60_KEY));
        } else if (kind === 'rail-160x300') {
            slot.appendChild(buildIframeAd(160, 300, BANNER_160x300_KEY));
        } else if (kind === 'rail-native') {
            slot.appendChild(buildNativeIframeAd(220, 880));
        } else if (kind === 'inline-native') {
            // Inline mobile/tablet ad — width follows the article column
            // (clamped between 280px and 720px), height fixed for stability.
            var w = Math.min(slot.clientWidth || 320, 720);
            if (w < 280) w = 280;
            slot.appendChild(buildNativeIframeAd(w, 250));
        }
    }

    function loadAds() {
        var slots = document.querySelectorAll('[data-ad]');
        for (var i = 0; i < slots.length; i++) {
            fillSlot(slots[i]);
        }
    }

    function schedule() {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(loadAds, { timeout: 2500 });
        } else {
            setTimeout(loadAds, 200);
        }
    }

    if (document.readyState === 'complete') {
        schedule();
    } else {
        window.addEventListener('load', schedule, { once: true });
    }
})();
