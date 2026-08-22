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
//     a stake; +/- steps by the site's configured minimum. lineBet = round(₹ × 100 / 243).
//   * the bet buttons bind their handler at scene-create time, so overriding the
//     SlotControls prototype is too late - their clickEvent is replaced instead.
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
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': wallet.token },
            body: JSON.stringify(body || {}),
        });
        return res.json();
    };

    const TL = {
        coinsPerUnit: 100,
        lines: 243,
        stakeInr: Math.max(1, Number(wallet.minBet) || 1), // exact ₹ stake (not 243×lineBet quantized)
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

    // ---- portrait phones ---------------------------------------------------
    // slotGame.js builds a fixed 1850x1080 landscape canvas on Scale.FIT, and there
    // is no portrait layout in the build. On a 375px-wide phone FIT gives a 219px
    // band - about a fifth of the screen - and the TOTAL BET +/- sprites come out
    // 129 * (375/1850) = 26 CSS px, well under a thumb.
    //
    // ponytail: auto landscape — try orientation.lock, else CSS-rotate the page
    // (never ask the user to turn the phone). Phaser maps pointers via pageX/Y, so
    // CSS-rotate remaps them before transformPointer. Do not transform the canvas
    // alone (AABB would still break hits).
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    function isPortrait() {
        return window.innerHeight > window.innerWidth;
    }

    function lockLandscape() {
        const el = document.documentElement;
        const lock = () => {
            try {
                if (screen.orientation && screen.orientation.lock) {
                    return screen.orientation.lock('landscape').catch(function () {});
                }
            } catch (e) {}
            return Promise.resolve();
        };
        if (document.fullscreenElement) return lock();
        if (el.requestFullscreen) {
            return el.requestFullscreen().then(lock, lock);
        }
        return lock();
    }

    (function injectCssLand() {
        if (document.getElementById('tl-gold-css-land')) return;
        const s = document.createElement('style');
        s.id = 'tl-gold-css-land';
        s.textContent = 'html.tl-gold-css-land,html.tl-gold-css-land body{width:100vh!important;height:100vw!important;'
            + 'overflow:hidden!important;margin:0!important;padding:0!important}'
            + 'html.tl-gold-css-land body{position:absolute!important;top:-100vw!important;left:0!important;'
            + 'transform:rotate(90deg);transform-origin:bottom left}';
        document.head.appendChild(s);
    })();

    function patchPhaserPointers() {
        const game = typeof slotGame !== 'undefined' ? slotGame : null;
        if (!game || !game.input || !game.input.manager || game.input.manager.__tlLand) return;
        const mgr = game.input.manager;
        mgr.__tlLand = true;
        const orig = mgr.transformPointer.bind(mgr);
        mgr.transformPointer = function (pointer, pageX, pageY, wasMove) {
            if (document.documentElement.classList.contains('tl-gold-css-land')) {
                const x = pageY;
                const y = window.innerWidth - pageX;
                return orig(pointer, x, y, wasMove);
            }
            return orig(pointer, pageX, pageY, wasMove);
        };
    }

    function syncLandscape() {
        if (!touch) {
            document.documentElement.classList.remove('tl-gold-css-land');
            return;
        }
        if (!isPortrait()) {
            document.documentElement.classList.remove('tl-gold-css-land');
            return;
        }
        // ponytail: no Promise.finally — old Android WebViews lack it
        lockLandscape().then(afterLock, afterLock);
        function afterLock() {
            if (isPortrait()) document.documentElement.classList.add('tl-gold-css-land');
            else document.documentElement.classList.remove('tl-gold-css-land');
            patchPhaserPointers();
            if (typeof slotGame !== 'undefined' && slotGame && slotGame.scale) slotGame.scale.refresh();
        }
    }

    document.addEventListener('DOMContentLoaded', syncLandscape);
    window.addEventListener('resize', syncLandscape);
    window.addEventListener('orientationchange', syncLandscape);
    document.addEventListener('pointerdown', function () {
        if (touch && isPortrait()) lockLandscape().then(syncLandscape, syncLandscape);
    }, true);
    setInterval(patchPhaserPointers, 500);

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

    /** Bitmap font hides `.` / some letters → canvas text for money + CASHOUT. */
    function useReadableMoneyText(bmp, fontSize) {
        if (!bmp) return bmp;
        if (bmp.__tlMoney) return bmp.__tlMoney;
        const sc = bmp.scene;
        const t = sc.add
            .text(bmp.x, bmp.y, '0.00', {
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: (fontSize || 40) + 'px',
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

    // Match the same site-wide floor used by every other game; ceiling = live wallet.
    function minInr() {
        const min = Number(wallet.minBet);
        return Number.isFinite(min) && min > 0 ? min : 1;
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

    function stepStake(dir) {
        setStakeInr(TL.stakeInr + dir * minInr());
        const s = scene();
        if (s && s.soundController) s.soundController.playClip('button_click');
    }

    /** WebView wrappers often swallow window.prompt → own overlay. */
    function editTotalBet() {
        if (document.getElementById('tl-gold-stake')) return;
        const btn = 'flex:1;padding:10px;border:0;border-radius:8px;font:600 14px Roboto,system-ui,sans-serif';
        const wrap = document.createElement('div');
        wrap.id = 'tl-gold-stake';
        wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;'
            + 'justify-content:center;background:rgba(0,0,0,.65)';
        wrap.innerHTML = '<div style="background:#1c1b24;color:#fff;padding:18px;border-radius:14px;width:250px;'
            + 'text-align:center;font:600 14px Roboto,system-ui,sans-serif">'
            + '<div style="margin-bottom:10px">TOTAL BET (₹)</div>'
            + '<input type="number" inputmode="decimal" step="' + minInr() + '" style="width:100%;box-sizing:border-box;'
            + 'padding:10px;border:0;border-radius:8px;font-size:20px;text-align:center">'
            + '<div style="margin:8px 0 12px;opacity:.65;font-size:12px">min ' + minInr()
            + ' · max ' + inrText(maxInr()) + '</div>'
            + '<div style="display:flex;gap:8px">'
            + '<button data-no style="' + btn + ';background:#3a3946;color:#fff">CANCEL</button>'
            + '<button data-ok style="' + btn + ';background:#e50539;color:#fff">OK</button>'
            + '</div></div>';
        document.body.appendChild(wrap);

        const input = wrap.querySelector('input');
        input.value = inrText(TL.stakeInr);
        input.focus();
        input.select();
        const close = () => wrap.remove();
        const apply = () => { setStakeInr(input.value); close(); };
        wrap.querySelector('[data-ok]').onclick = apply;
        wrap.querySelector('[data-no]').onclick = close;
        wrap.onclick = (e) => { if (e.target === wrap) close(); };
        input.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
    }

    /** Buttons captured their handler at create time → replace on the instance. */
    function rebindClick(button, handler) {
        if (!button) return;
        button.clickEvent.events = [];
        button.addClickEvent(handler, null);
    }

    function takeOverMoney() {
        const s = scene();
        if (!s || !s.slotControls || !s.slotControls.totalBetPlusButton) return false;
        const player = Object.getPrototypeOf(s.slotPlayer);
        const controls = Object.getPrototypeOf(s.slotControls);
        if (player.__tlOwned) return true;

        try {
        player.addCoins = function (count) {
            if (count > 0) settle();
        };

        const origLines = controls.setSelectedLinesCount;
        controls.setSelectedLinesCount = function (count, burn) {
            return origLines.call(this, this.linesController ? this.linesController.lines.length : count, burn);
        };

        rebindClick(s.slotControls.totalBetPlusButton, () => stepStake(1));
        rebindClick(s.slotControls.totalBetMinusButton, () => stepStake(-1));
        // CASHOUT lives on the native MAX BET button (no HTML overlay)
        const cashLab = useReadableMoneyText(s.slotControls.maxBetText, 28);
        if (cashLab && cashLab.setText) cashLab.setText('CASHOUT');
        s.slotControls.__tlCashAmt = useReadableMoneyText(s.slotControls.maxBetText1, 30);
        if (s.slotControls.__tlCashAmt && s.slotControls.__tlCashAmt.setText) {
            s.slotControls.__tlCashAmt.setText('0.00');
        }
        rebindClick(s.slotControls.slotMaxBetButton, doCashout);

        // Idle money check must use exact stake, not 243×lineBet
        s.slotControls.getTotalBet = function () {
            return Math.round(TL.stakeInr * TL.coinsPerUnit);
        };

        // Left panel mirrors held ₹ (label stays LINES — bitmap may lack H/D for HELD)
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

        s.slotControls.changeTotalBetEvent.events = [];
        s.slotControls.changeTotalBetEvent.add(function (coins) {
            paintBet(this);
        }, s.slotControls);

        s.slotPlayer.changeCoinsEvents = [];
        s.slotPlayer.addChangeCoinsEvent(function (coins) {
            paintBal(this, coins);
        }, s.slotControls);

        s.slotPlayer.changeWinCoinsEvents = [];
        s.slotPlayer.addWinCoinsChangeEvent(function () {
            paintHeld((TL.pending && TL.pending.heldCoins) || 0);
        }, s.slotControls);

        s.slotControls.refreshBetLines = function () {
            if (this.lineBetAmountText != null) this.lineBetAmountText.text = this.lineBet;
            paintBet(this);
        };

        // Tap TOTAL BET value (or label) → type stake. ponytail: text only — the
        // panel sprite sits under the +/- buttons and would swallow their clicks.
        [betSum, s.slotControls.totalBetText].forEach((o) => {
            if (!o || o.__tlEdit) return;
            o.__tlEdit = true;
            o.setInteractive({ useHandCursor: true });
            o.on('pointerdown', editTotalBet);
        });

        paintBet(s.slotControls);
        paintBal(s.slotControls, s.slotPlayer.coins);
        paintWin(s.slotControls, 0);

        player.__tlOwned = true;
        return true;
        } catch (e) {
            console.warn('[tl] gold takeover failed', e);
            return false;
        }
    }

    function abortSpin(reels, cfg, completeCallback, msg) {
        TL.message(msg);
        const s = scene();
        if (s) {
            s.reelSpin = false;
            if (s.soundController) s.soundController.stopSounds();
            if (s.slotControls && s.slotControls.resetAutoSpinsMode) s.slotControls.resetAutoSpinsMode();
        }
        // Must land on a known loser before the win-search step, or unpaid wins flash on screen.
        cfg.reels_simulate = TL.losingStops || [0, 0, 0, 0, 0];
        const prev = reels.map((r) => r.spinTime);
        reels.forEach((r) => { r.spinTime = 40; });
        origSpinReels(reels, cfg, () => {
            reels.forEach((r, i) => { r.spinTime = prev[i]; });
            completeCallback();
        });
    }

    const origSpinReels = window.spinReels;
    window.spinReels = function (reels, cfg, completeCallback) {
        const s = scene();
        const lineBet = s && s.slotControls ? inrToLineBet(TL.stakeInr) : 1;
        const free = !!(s && (s.isFreeSpin || (s.slotControls && s.slotControls.hasFreeSpin && s.slotControls.hasFreeSpin())));
        if (!free && Number(wallet.balance) + 1e-9 < Number(TL.stakeInr)) {
            abortSpin(reels, cfg, completeCallback, 'Not enough balance for this spin.');
            return;
        }

        post('/game/gold/spin', {
            lineBet: lineBet,
            lines: TL.lines,
            betAmount: TL.stakeInr,
        }).then((res) => {
            if (!res || !res.isSuccess) {
                abortSpin(reels, cfg, completeCallback, (res && res.message) || 'Spin refused by the server.');
                return;
            }
            TL.message('');
            TL.pending = res.data;
            // paint balance as soon as the server takes the stake (don't wait for reel stop)
            applyWallet(res.data);
            cfg.reels_simulate = res.data.stops;
            origSpinReels(reels, cfg, completeCallback);
        }).catch(() => {
            abortSpin(reels, cfg, completeCallback, 'Connection lost.');
        });
    };

    function paintHeld(coins) {
        const s = scene();
        const amt = coinsToInrText(coins);
        if (s && s.slotControls && s.slotControls.linesCountText && s.slotControls.linesCountText.setText) {
            s.slotControls.linesCountText.setText(amt);
        }
        if (s && s.slotControls && s.slotControls.__tlCashAmt && s.slotControls.__tlCashAmt.setText) {
            s.slotControls.__tlCashAmt.setText(amt);
        }
        paintWin(s && s.slotControls, coins);
    }

    function applyWallet(data) {
        if (!data) return;
        const bal = Number(data.balance);
        if (!Number.isFinite(bal)) return;
        wallet.balance = bal;
        if (typeof window.TL_setWallet === 'function') window.TL_setWallet(bal);
        if (data.coins != null && Number.isFinite(Number(data.coins))) showBalance(Number(data.coins));
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

    // ponytail: mobile assets are huge — never give up waiting for Phaser controls
    (function attach() {
        if (!takeOverMoney()) {
            setTimeout(attach, 100);
            return;
        }
        // Block runSlot before the reels sequence starts (client coins can lag the wallet HUD).
        const sc0 = scene();
        if (sc0 && !sc0.__tlRunGuard) {
            sc0.__tlRunGuard = true;
            const origRun = sc0.runSlot.bind(sc0);
            sc0.runSlot = function () {
                const free = !!(this.isFreeSpin || (this.slotControls && this.slotControls.hasFreeSpin && this.slotControls.hasFreeSpin()));
                if (!free && Number(wallet.balance) + 1e-9 < Number(TL.stakeInr)) {
                    TL.message('Not enough balance for this spin.');
                    if (this.slotControls && this.slotControls.resetAutoSpinsMode) this.slotControls.resetAutoSpinsMode();
                    return;
                }
                return origRun();
            };
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
            // ponytail: vendor defaults are 2000/3000ms; feel snappier without touching game files
            slotConfig.spinTime = 1100;
            slotConfig.winShowTime = 1400;
            slotConfig.winMessageTime = 1200;
        }
        // Popup showed raw coins (3000) while wallet credited coins/100 (₹30).
        // ponytail: patch the three message entry points; leave game files alone.
        const sc = scene();
        if (sc && Array.isArray(sc.reels)) {
            sc.reels.forEach((r) => { if (r) r.spinTime = 1100; });
        }
        if (sc && !sc.__tlWinMsg) {
            sc.__tlWinMsg = true;
            const wrap = (name) => {
                const orig = sc[name].bind(sc);
                sc[name] = function (winCoins, time) {
                    return orig(coinsToInrText(winCoins), time);
                };
            };
            wrap('showBigWinMessage');
            wrap('showJackpotWinMessage');
            sc.showWinCoinsMessage = function (winCoins, time) {
                const msg = this.guiController.showMessage(
                    'CONGRATULATION!',
                    'YOUR WIN: ₹' + coinsToInrText(winCoins) + '!',
                    this,
                    () => {
                        if (this.timeoutMess) clearTimeout(this.timeoutMess);
                        this.timeoutMess = null;
                        this.guiController.closePopUp(msg);
                    }
                );
                if (time && time > 0) {
                    this.timeoutMess = setTimeout(() => this.guiController.closePopUp(msg), time);
                }
            };
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
