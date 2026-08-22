// Bind Ludo to the Turbo Legends wallet before the Phaser client boots.
// deviceId `tl{userId}` → Node SiteWallet → Laravel /api/ludo/wallet (1 coin = ₹1).
// Always paints the gold pill from TL_WALLET (profile must not leave it at 0).
(function () {
    // bundle baked ws://13.232.99.7 — HTTPS page blocks that. Same-origin WSS;
    // Apache proxies /matchmake + Upgrade to AWS.
    var aws = '13.232.99.7';
    function tlsUrl(u) {
        u = String(u).split(aws).join(location.host);
        if (location.protocol === 'https:') u = u.replace(/^ws:/, 'wss:').replace(/^http:/, 'https:');
        return u;
    }
    var ofetch = window.fetch;
    window.fetch = function (input, init) {
        if (typeof input === 'string') input = tlsUrl(input);
        return ofetch.call(this, input, init);
    };
    var OWS = window.WebSocket;
    function WS(url, proto) {
        url = tlsUrl(url);
        return proto !== undefined ? new OWS(url, proto) : new OWS(url);
    }
    WS.prototype = OWS.prototype;
    WS.CONNECTING = OWS.CONNECTING;
    WS.OPEN = OWS.OPEN;
    WS.CLOSING = OWS.CLOSING;
    WS.CLOSED = OWS.CLOSED;
    window.WebSocket = WS;

    var w = window.TL_WALLET;
    if (!w || !w.userId) return;
    try {
        localStorage.setItem('lr_device_id', 'tl' + w.userId);
    } catch (e) { /* private mode */ }
    if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistrations().then(function (regs) {
            for (var i = 0; i < regs.length; i++) regs[i].unregister();
        });
    }

    function coins() {
        return Math.max(0, Math.floor(Number(w.balance) || 0));
    }

    function paintHud() {
        var n = coins();
        var el = document.querySelector('.lr-hud__pill--coins .lr-hud__count');
        if (el) {
            el.textContent = String(n);
            el.setAttribute('data-tl', '1');
        }
        if (typeof window.TL_setWallet === 'function') window.TL_setWallet(Number(w.balance) || 0);
    }

    setInterval(paintHud, 400);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', paintHud);
    } else {
        paintHud();
    }
})();
