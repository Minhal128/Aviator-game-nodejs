// Bind Ludo to the Turbo Legends wallet before the Phaser client boots.
// deviceId `tl{userId}` → Node SiteWallet → Laravel /api/ludo/wallet (1 coin = ₹1).
// Always paints the gold pill from TL_WALLET (profile must not leave it at 0).
(function () {
    var w = window.TL_WALLET;
    if (!w || !w.userId) return;
    try {
        localStorage.setItem('lr_device_id', 'tl' + w.userId);
    } catch (e) { /* private mode */ }

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
