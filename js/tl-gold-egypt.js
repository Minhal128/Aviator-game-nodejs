// Bridge between Gold of Egypt (Phaser) and the Turbo Legends wallet.
//
// The game shipped as a standalone demo: it minted its own 100,000 coins and drew
// its own reel stops, so nothing it did could be trusted with money. The server
// now draws the stops and settles them (App\Http\Controllers\GoldEgypt), and this
// file is only the seam - it changes no game file:
//
//   * spinReels() is a plain function declaration in slotGame.js, so it lands on
//     window and can be wrapped. The wrapper asks the server first, writes the
//     answer into slotConfig.reels_simulate - a hook the config already documents
//     for testing - and lets the original animation run onto those stops.
//   * the coin counter is written from the wallet balance the server reports, so
//     the display follows the money instead of the other way round.
//   * the lines +/- buttons are pinned to all 243. Fewer lines shrinks the bet but
//     not the scatter or jackpot pays; at one line the jackpot alone is worth
//     about a quarter of turnover.
//
// ponytail: no round table. A refresh mid free-spin keeps the server's count (it
// lives in the session) but loses the on-screen counter. Add a table if free-spin
// state has to survive a browser crash.
(function () {
    const wallet = window.TL_WALLET;
    if (!wallet) return;                 // opened outside the site: leave the demo alone

    const post = async (url, body) => {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': wallet.token },
            body: JSON.stringify(body || {}),
        });
        return res.json();
    };

    const TL = {
        coinsPerUnit: 100,
        lines: 243,
        losingStops: null,
        pending: null,
        message: (text) => {
            const el = document.getElementById('tl-gold-msg');
            if (!el) return;
            el.textContent = text;
            el.style.opacity = text ? '1' : '0';
        },
    };
    window.TL_GOLD = TL;

    // The idle state already refuses to spin when the displayed balance is short,
    // so this banner is for the cases it cannot see: a server refusal, a stale
    // display, a dropped connection.
    const banner = document.createElement('div');
    banner.id = 'tl-gold-msg';
    banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;'
        + 'padding:10px 18px;border-radius:999px;background:rgba(229,5,57,.92);color:#fff;'
        + 'font:600 14px/1 Roboto,system-ui,sans-serif;opacity:0;transition:opacity .2s;pointer-events:none';
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));

    /**
     * The game keeps its player and controls on the scene. slotGame is declared with
     * `let` at the top of slotGame.js, so it is a global *lexical* binding: reachable
     * by bare name from a later classic script, but never a property of window.
     */
    function scene() {
        const game = (typeof slotGame !== 'undefined') ? slotGame : null;
        const s = game && game.scene && game.scene.scenes && game.scene.scenes[0];
        return s && s.slotPlayer ? s : null;
    }

    function showBalance(coins) {
        const s = scene();
        if (s) s.slotPlayer.setCoinsCount(Math.round(coins));
    }

    // ---- take the balance away from the client -------------------------------
    // The client debited the bet and credited the win into its own counter. Left
    // alone it stacked its win on top of the server balance we had just written,
    // so a 355 win showed as 710. addCoins becomes a no-op: the server is the only
    // thing that moves money, and the game only gets to say WHEN to reveal it.
    function takeOverMoney() {
        const s = scene();
        if (!s || !s.slotControls) return false;
        const player = Object.getPrototypeOf(s.slotPlayer);
        const controls = Object.getPrototypeOf(s.slotControls);
        if (player.__tlOwned) return true;

        player.addCoins = function (count) {
            // a positive amount is the win credit, which is the moment the player
            // is meant to see the new balance - the reels have stopped by then
            if (count > 0) settle();
        };

        // pin the lines: fewer lines shrinks the bet but not the scatter or jackpot
        const origLines = controls.setSelectedLinesCount;
        controls.setSelectedLinesCount = function (count, burn) {
            return origLines.call(this, this.linesController ? this.linesController.lines.length : count, burn);
        };

        player.__tlOwned = true;
        return true;
    }

    // ---- the spin itself ----------------------------------------------------
    const origSpinReels = window.spinReels;
    window.spinReels = function (reels, cfg, completeCallback) {
        const s = scene();
        const lineBet = s && s.slotControls ? s.slotControls.lineBet : 1;

        post('/game/gold/spin', { lineBet: lineBet, lines: TL.lines }).then((res) => {
            if (!res || !res.isSuccess) {
                TL.message((res && res.message) || 'Spin refused by the server.');
                // the state machine waits on this callback, so the reels have to land -
                // but on a combination that pays nothing, or the player would watch a
                // win animation for money that was never staked or credited
                cfg.reels_simulate = TL.losingStops;
                origSpinReels(reels, cfg, completeCallback);
                return;
            }
            TL.message('');
            TL.pending = res.data;
            cfg.reels_simulate = res.data.stops;      // the reels land where the server paid
            origSpinReels(reels, cfg, completeCallback);
        }).catch(() => {
            TL.message('Connection lost.');
            cfg.reels_simulate = TL.losingStops;
            origSpinReels(reels, cfg, completeCallback);
        });
    };

    /** Show the balance the server already settled. */
    function settle() {
        if (!TL.pending) return;
        showBalance(TL.pending.coins);
        TL.pending = null;
    }

    // ---- boot ---------------------------------------------------------------
    let tries = 0;
    (function attach() {
        if (!takeOverMoney()) {
            if (++tries < 400) setTimeout(attach, 50);
            return;
        }
        fetch('/game/gold/state')
            .then((r) => r.json())
            .then((res) => {
                if (!res.isSuccess) return;
                TL.coinsPerUnit = res.data.coinsPerUnit;
                TL.lines = res.data.lines;
                TL.losingStops = res.data.losingStops;
                showBalance(res.data.coins);
                // a losing spin never reaches the win credit, and the game clears
                // reelSpin only on that path, so it doubles as the lose signal
                setInterval(() => {
                    const s = scene();
                    if (TL.pending && s && s.reelSpin === false) settle();
                }, 300);
                console.log('[tl] gold-egypt on the wallet, balance', res.data.balance);
            });
    })();
})();
