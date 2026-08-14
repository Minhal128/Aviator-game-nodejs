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
//   * TOTAL BET / YOUR WIN / BALANCE boxes show ₹ (coins/100). Tap TOTAL BET to type
//     a stake; +/- steps ~₹10. lineBet = round(₹ × 100 / 243).
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
        stakeInr: 100, // exact ₹ stake (not 243×lineBet quantized)
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

    const banner = document.createElement('div');
    banner.id = 'tl-gold-msg';
    banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;'
        + 'padding:10px 18px;border-radius:999px;background:rgba(229,5,57,.92);color:#fff;'
        + 'font:600 14px/1 Roboto,system-ui,sans-serif;opacity:0;transition:opacity .2s;pointer-events:none';

    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));

    function scene() {
        const game = (typeof slotGame !== 'undefined') ? slotGame : null;
        const s = game && game.scene && game.scene.scenes && game.scene.scenes[0];
        return s && s.slotPlayer ? s : null;
    }

    function inrText(inr) {
        const n = Number(inr);
        if (!Number.isFinite(n)) return '0.00';
        return (Math.round(n * 100) / 100).toFixed(2);
    }

    function coinsToInrText(coins) {
        return inrText(Number(coins) / TL.coinsPerUnit);
    }

    /** Bitmap font hides `.` → money fields use canvas text with visible decimals. */
    function useReadableMoneyText(bmp) {
        if (!bmp) return bmp;
        if (bmp.__tlMoney) return bmp.__tlMoney;
        const sc = bmp.scene;
        const t = sc.add
            .text(bmp.x, bmp.y, '0.00', {
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '40px',
                fontStyle: '700',
                color: '#ffffff',
            })
            .setOrigin(bmp.originX, bmp.originY)
            .setDepth(bmp.depth);
        bmp.setVisible(false);
        bmp.__tlMoney = t;
        return t;
    }

    function paintBet(sc) {
        if (sc && sc.totalBetSumText && sc.totalBetSumText.setText) {
            sc.totalBetSumText.setText(inrText(TL.stakeInr));
        }
    }

    function paintWin(sc, coins) {
        if (sc && sc.winAmountText && sc.winAmountText.setText) {
            sc.winAmountText.setText(coinsToInrText(coins));
        }
    }

    function paintBal(sc, coins) {
        if (sc && sc.creditSumText && sc.creditSumText.setText) {
            sc.creditSumText.setText(coinsToInrText(coins));
        }
    }

    function showBalance(coins) {
        const s = scene();
        if (s) s.slotPlayer.setCoinsCount(Math.round(coins));
    }

    // ponytail: Gold stake floor ₹100; ceiling = live wallet.
    function minInr() {
        return 100;
    }

    function maxInr() {
        const bal = Number(wallet.balance);
        return Math.max(minInr(), Number.isFinite(bal) ? bal : minInr());
    }

    function syncMaxLineBet() {
        const s = scene();
        if (!s || !s.slotControls) return;
        s.slotControls.maxLineBet = Math.max(1, Math.ceil((maxInr() * TL.coinsPerUnit) / TL.lines));
    }

    /** Paytable multiplier only — display/charge use TL.stakeInr exactly. */
    function inrToLineBet(inr) {
        syncMaxLineBet();
        const s = scene();
        const cap = (s && s.slotControls && s.slotControls.maxLineBet) || 1;
        let lb = Math.round((Number(inr) * TL.coinsPerUnit) / TL.lines);
        return Math.max(1, Math.min(cap, lb || 1));
    }

    function stakeInr() {
        return TL.stakeInr;
    }

    function setStakeInr(raw) {
        const s = scene();
        if (!s || !s.slotControls) return;
        let inr = Number(String(raw).replace(/[^\d.]/g, ''));
        if (!Number.isFinite(inr)) return;
        inr = Math.round(inr * 100) / 100;
        TL.stakeInr = Math.max(minInr(), Math.min(maxInr(), inr));
        // keep Phaser lineBet near the stake for win multiplier / idle checks
        const lb = inrToLineBet(TL.stakeInr);
        if (s.slotControls.lineBet !== lb) s.slotControls.setLineBet(lb);
        paintBet(s.slotControls);
        TL.message('Stake set to ₹' + inrText(TL.stakeInr));
        setTimeout(() => TL.message(''), 1200);
    }

    function stepLineBet(dir) {
        setStakeInr(TL.stakeInr + dir * 10);
    }

    function editTotalBet() {
        const cur = inrText(TL.stakeInr);
        const raw = window.prompt(
            'TOTAL BET (₹) — min ' + minInr() + ', max ' + maxInr().toFixed(2) + ' (wallet)',
            cur,
        );
        if (raw === null) return;
        setStakeInr(raw);
    }

    function takeOverMoney() {
        const s = scene();
        if (!s || !s.slotControls) return false;
        const player = Object.getPrototypeOf(s.slotPlayer);
        const controls = Object.getPrototypeOf(s.slotControls);
        if (player.__tlOwned) return true;

        player.addCoins = function (count) {
            if (count > 0) settle();
        };

        const origLines = controls.setSelectedLinesCount;
        controls.setSelectedLinesCount = function (count, burn) {
            return origLines.call(this, this.linesController ? this.linesController.lines.length : count, burn);
        };

        controls.lineBetPlus_Click = function () {
            stepLineBet(1);
            this.scene.soundController.playClip('button_click');
        };
        controls.lineBetMinus_Click = function () {
            stepLineBet(-1);
            this.scene.soundController.playClip('button_click');
        };
        controls.maxBet_Click = function () {
            this.linesController.selectAllLines(true);
            setStakeInr(maxInr());
            this.scene.soundController.playClip('button_click');
        };

        // Idle money check must use exact stake, not 243×lineBet
        s.slotControls.getTotalBet = function () {
            return Math.round(TL.stakeInr * TL.coinsPerUnit);
        };

        // LINES box → CASHOUT (same row as TOTAL BET). Lines stay pinned at 243.
        if (s.slotControls.linesText) {
            s.slotControls.linesText.setText('CASHOUT');
            s.slotControls.linesText.setVisible(true);
        }
        if (s.slotControls.linesPanel) s.slotControls.linesPanel.setVisible(true);
        if (s.slotControls.linesCountText) s.slotControls.linesCountText.setVisible(true);

        // Show ₹ with a visible "." — must rebind events (old handlers write raw coins)
        const betSum = useReadableMoneyText(s.slotControls.totalBetSumText);
        const winSum = useReadableMoneyText(s.slotControls.winAmountText);
        const balSum = useReadableMoneyText(s.slotControls.creditSumText);
        const heldSum = useReadableMoneyText(s.slotControls.linesCountText);
        s.slotControls.totalBetSumText = betSum;
        s.slotControls.winAmountText = winSum;
        s.slotControls.creditSumText = balSum;
        s.slotControls.linesCountText = heldSum;

        [s.slotControls.linesPanel, s.slotControls.linesText, heldSum].forEach((o) => {
            if (!o || o.__tlCash) return;
            o.__tlCash = true;
            o.setInteractive();
            o.on('pointerdown', doCashout);
        });

        s.slotControls.changeTotalBetEvent.events = [];
        s.slotControls.changeTotalBetEvent.add(function (coins) {
            paintBet(this);
        }, s.slotControls);

        s.slotPlayer.changeCoinsEvents = [];
        s.slotPlayer.addChangeCoinsEvent(function (coins) {
            paintBal(this, coins);
        }, s.slotControls);

        s.slotPlayer.changeWinCoinsEvents = [];
        s.slotPlayer.addWinCoinsChangeEvent(function (coins) {
            paintWin(this, coins);
        }, s.slotControls);

        s.slotControls.refreshBetLines = function () {
            if (this.lineBetAmountText != null) this.lineBetAmountText.text = this.lineBet;
            paintBet(this);
        };

        // Tap TOTAL BET value (or label) → type stake
        [betSum, s.slotControls.totalBetText].forEach((txt) => {
            if (!txt || txt.__tlEdit) return;
            txt.__tlEdit = true;
            txt.setInteractive(new Phaser.Geom.Rectangle(-90, -28, 180, 56), Phaser.Geom.Rectangle.Contains);
            txt.on('pointerdown', editTotalBet);
        });

        paintBet(s.slotControls);
        paintBal(s.slotControls, s.slotPlayer.coins);
        paintWin(s.slotControls, 0);

        player.__tlOwned = true;
        return true;
    }

    const origSpinReels = window.spinReels;
    window.spinReels = function (reels, cfg, completeCallback) {
        const s = scene();
        const lineBet = s && s.slotControls ? inrToLineBet(TL.stakeInr) : 1;

        post('/game/gold/spin', {
            lineBet: lineBet,
            lines: TL.lines,
            betAmount: TL.stakeInr,
        }).then((res) => {
            if (!res || !res.isSuccess) {
                TL.message((res && res.message) || 'Spin refused by the server.');
                cfg.reels_simulate = TL.losingStops;
                origSpinReels(reels, cfg, completeCallback);
                return;
            }
            TL.message('');
            TL.pending = res.data;
            if (wallet && typeof res.data.balance === 'number') {
                wallet.balance = res.data.balance;
                if (typeof window.TL_setWallet === 'function') window.TL_setWallet(res.data.balance);
                syncMaxLineBet();
            }
            cfg.reels_simulate = res.data.stops;
            origSpinReels(reels, cfg, completeCallback);
        }).catch(() => {
            TL.message('Connection lost.');
            cfg.reels_simulate = TL.losingStops;
            origSpinReels(reels, cfg, completeCallback);
        });
    };

    function paintHeld(coins) {
        const s = scene();
        if (s && s.slotControls && s.slotControls.linesCountText && s.slotControls.linesCountText.setText) {
            s.slotControls.linesCountText.setText(coinsToInrText(coins));
        }
        paintWin(s && s.slotControls, coins);
    }

    function applyWallet(data) {
        if (!data || typeof data.balance !== 'number') return;
        wallet.balance = data.balance;
        if (typeof window.TL_setWallet === 'function') window.TL_setWallet(data.balance);
        if (typeof data.coins === 'number') showBalance(data.coins);
        syncMaxLineBet();
        if (stakeInr() > maxInr()) setStakeInr(maxInr());
    }

    function settle() {
        if (!TL.pending) return;
        applyWallet(TL.pending);
        paintHeld(TL.pending.heldCoins || 0);
        TL.pending = null;
    }

    function doCashout() {
        const s = scene();
        if (s && s.soundController) s.soundController.playClip('button_click');
        post('/game/gold/cashout').then((res) => {
            if (!res || !res.isSuccess) {
                TL.message((res && res.message) || 'Nothing to cash out.');
                setTimeout(() => TL.message(''), 1500);
                return;
            }
            applyWallet(res.data);
            paintHeld(0);
            TL.message('Cashed ₹' + inrText(res.data.cashed) + ' to wallet');
            setTimeout(() => TL.message(''), 1500);
        }).catch(() => TL.message('Connection lost.'));
    }

    let tries = 0;
    (function attach() {
        if (!takeOverMoney()) {
            if (++tries < 400) setTimeout(attach, 50);
            return;
        }
        // BIG WIN only when payout beats this spin's stake (your screenshot: 28782 < 29889)
        if (typeof slotConfig !== 'undefined') {
            const prev = slotConfig.minWin;
            Object.defineProperty(slotConfig, 'minWin', {
                configurable: true,
                get() {
                    const s = scene();
                    const bet = s && s.slotControls ? s.slotControls.getTotalBet() : prev;
                    return Math.max(prev, bet + 1);
                },
            });
        }
        fetch('/game/gold/state')
            .then((r) => r.json())
            .then((res) => {
                if (!res.isSuccess) return;
                TL.coinsPerUnit = res.data.coinsPerUnit;
                TL.lines = res.data.lines;
                TL.losingStops = res.data.losingStops;
                applyWallet(res.data);
                paintHeld(res.data.heldCoins || 0);
                setStakeInr(minInr());
                setInterval(() => {
                    const s = scene();
                    if (TL.pending && s && s.reelSpin === false) settle();
                }, 300);
                console.log('[tl] gold-egypt on the wallet, balance', res.data.balance);
            });
    })();
})();
