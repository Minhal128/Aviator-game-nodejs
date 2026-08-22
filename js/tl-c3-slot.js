// Bridge between Glamour Spins (Construct 3) and the Turbo Legends wallet.
//
// This game is a black box: its win logic ships as compiled opcodes in data.json,
// there is no paytable to read, and there is no protocol to implement - its Send*
// functions only assign local variables ("SendResult: Result sent successfully."
// is a canned string), so the balance moved in the browser and nothing was ever
// sent. The margin therefore cannot come from modelling the game. It comes from
// deciding WHICH spin happens, out of a few thousand measured in advance.
// App\Http\Controllers\GlamourSpins holds that table and the tilt that makes it
// average 70%.
//
// For that to be honest, the same seed has to mean the same spin every time.
// Three things make it so, and all three are load-bearing:
//
//   1. a fixed timestep. The game draws random numbers per tick during cascades,
//      so at a different frame rate the same seed pays something else. Game time
//      advances exactly 1/60s per frame here, whatever the display does.
//   2. a reset between spins - restart the Game layout AND put the globals back.
//      The layout restart rebuilds the sprite instances the matching runs off
//      (restoring the board Array is not enough, that is only a mirror of them);
//      the globals have to be restored separately because they survive a layout
//      change, and a spin leaves working state in them - left alone, the event
//      sheet simply refuses to start the next spin.
//      The reset runs while the game is idle, right after the previous spin, not
//      when the player presses spin. Two reasons: the new layout needs a good
//      second of ticks before its buttons answer at all (the measuring harness
//      never noticed, because it runs the game about sixteen times real speed and
//      so always gave it plenty), and doing it on the press would put a visible
//      pause between pressing and the reels moving. Idling after a reset is free:
//      the game draws no random numbers at all while it waits, so a seed armed
//      after half a second and a seed armed after twelve pay exactly the same.
//   3. arming the stream after the reset, so the spin's first draw is the seed's
//      first draw.
//
// tools/glamour-measure.mjs measures with exactly this sequence and --verify
// replays it. If this file and that script ever disagree, the table describes a
// game nobody is playing.
//
// The bet is settled BEFORE the seed arrives. That is deliberate: a client that
// knew the seed first could replay it against its own copy of the game - it IS
// the simulator - and only stake big on the good ones. So the spin button is
// intercepted, the server takes the bet (wins stay held until CASHOUT), and only
// then does the browser learn what to animate.
(function () {
    const wallet = window.TL_WALLET;
    if (!wallet) return;                 // opened outside the site: leave the demo alone

    // tools/glamour-measure.mjs installs its own stream and clock on this page
    if (new URLSearchParams(location.search).has('measure')) return;

    const iface = window.c3_runtimeInterface;
    if (!iface || iface.UsesWorker()) {
        // Pages::gameStatic() serves main.js with useWorker:false and no-store; a
        // cached copy used to bring the worker back and silently detach this
        console.warn('[tl] C3 runtime is in a worker, glamour spins not bridged');
        return;
    }

    const TL = {
        spinning: false, armed: false, paid: null, ir: null, snap: null, ready: false,
        serverBalance: 0, shown: 0, lastShown: null, heldWin: 0,
        minBet: 10, maxBet: 3000000,
        fresh: false,        // a reset has happened since the last spin
        resetting: false,
    };
    window.TL_C3 = TL;

    function syncHud(n) {
        var v = Number(n);
        if (!Number.isFinite(v)) return;
        wallet.balance = v;
        if (typeof window.TL_setWallet === 'function') window.TL_setWallet(v);
    }

    function paintHeld() {
        const el = document.getElementById('tl-g-held');
        if (el) el.textContent = '₹' + Number(TL.heldWin || 0).toFixed(2);
    }

    // ---- the deterministic stream ------------------------------------------
    // Seeded from crypto so the idle animations are not identical for every
    // player; every measured spin gets its seed from the server anyway.
    let rng = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
    let pending = null;
    Math.random = function () {
        if (pending !== null) { rng = pending; pending = null; }
        rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0;
        return rng / 4294967296;
    };
    /** The next draw the game takes becomes draw #1 of this seed's stream. */
    const arm = (seed) => { pending = (seed >>> 0) || 1; };

    // ---- the fixed timestep ------------------------------------------------
    // One frame is always 1/60s of game time, whatever the display does. This is
    // what makes a seed mean one thing: the game draws random numbers per tick
    // during cascades, so on a real clock the same seed pays differently at a
    // different frame rate.
    //
    // ponytail: no frame pacing. Game time advances one step per frame, so above
    // 60Hz the animation plays proportionally faster (the payout does not change -
    // the tick count per animation is identical, which is the whole point). An
    // earlier version dropped frames to hold it to real time and the game stopped
    // responding to the spin button altogether; pacing is not worth that. If it
    // matters on a 120Hz screen, pace by skipping whole frames BEFORE calling
    // requestAnimationFrame again, not from inside the callback.
    const STEP = 1000 / 60;
    let virt = performance.now();
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
        return raf(function () {
            virt += STEP;
            // the game clears its win counter as the round closes, sometimes inside a
            // single poll interval, so the peak is taken here where we see every frame
            if (TL.paid && TL.ir) {
                const won = TL.ir.globalVars.resultAmount;
                if (won > TL.shown) TL.shown = won;
            }
            cb(virt);
        });
    };
    performance.now = () => virt;

    // ---- where the controls are --------------------------------------------
    // Measured by tapping a grid and watching what the game did, because the
    // runtime's own layerToCssPx() reports this button a third of the screen to
    // the right of where it actually responds. The true spin region is
    // fx .38-.62 by fy .82-.92; this ellipse covers it with a margin, and
    // tools/glamour-client.mjs re-checks that the game still agrees.
    const SPIN = { cx: 0.50, cy: 0.87, rx: 0.15, ry: 0.075 };
    // Buying a free-spin round is a stake the table never measured, so it stays shut.
    const BLOCKED = [
        { x1: 0.00, y1: 0.00, x2: 0.40, y2: 0.16 },             // BUY FREE SPIN (covered by CASHOUT)
    ];
    // AUTOPLAY. The game's own autoplay drives its internal loop, which never
    // reaches beginSpin() - it would spin without the server taking the bet or
    // choosing the seed, so the tap is still swallowed before the game sees it and
    // g.automatico stays pinned at 0 by the belt at the bottom of this file. What
    // the tap does instead is toggle the loop below, so every autoplayed round goes
    // down exactly the same paid path as a hand tap.
    const AUTO_ZONE = { x1: 0.33, y1: 0.93, x2: 0.67, y2: 1.00 };
    // Exact canvas box of BUY FREE SPIN — yellow CASHOUT fills this entirely
    const CASHOUT_BOX = { x1: 0.008, y1: 0.008, x2: 0.355, y2: 0.145 };
    // Coin / bet row → type stake
    const BET_ZONE = { x1: 0.00, y1: 0.895, x2: 0.28, y2: 0.975 };

    const banner = document.createElement('div');
    banner.id = 'tl-g-msg';
    banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;'
        + 'padding:10px 18px;border-radius:999px;background:linear-gradient(180deg,#ff4d8d,#e50539);color:#fff;'
        + 'font:600 14px/1 Roboto,system-ui,sans-serif;opacity:0;transition:opacity .2s;pointer-events:none;'
        + 'border:1px solid rgba(255,255,255,.22);box-shadow:0 10px 28px rgba(229,5,57,.4);letter-spacing:.04em';
    const say = (text) => { banner.textContent = text; banner.style.opacity = text ? '1' : '0'; };

    // Covers BUY FREE SPIN — shiny gold pill only (no maroon frame)
    const cashBtn = document.createElement('button');
    cashBtn.id = 'tl-g-cash';
    cashBtn.type = 'button';
    cashBtn.className = 'tl-slot-cash';
    cashBtn.innerHTML = 'CASHOUT <span id="tl-g-held">₹0.00</span>';

    function placeCashBtn() {
        const c = document.querySelector('canvas');
        if (!c || !cashBtn.isConnected) return;
        const r = c.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const b = CASHOUT_BOX;
        const left = r.left + r.width * b.x1;
        const top = r.top + r.height * b.y1;
        const w = r.width * (b.x2 - b.x1);
        const h = r.height * (b.y2 - b.y1);
        // layout only — look lives in css/tl-slots.css (.tl-slot-cash)
        cashBtn.style.cssText = 'position:fixed;left:' + left + 'px;top:' + top + 'px;width:' + w + 'px;height:' + h + 'px;'
            + 'z-index:2147483000;display:flex;align-items:center;justify-content:center;gap:8px;'
            + 'padding:0 12px;cursor:pointer;box-sizing:border-box;pointer-events:auto';
    }

    function editBet() {
        if (TL.spinning || !TL.ir) return;
        const g = TL.ir.globalVars;
        const max = Math.max(TL.minBet, Math.min(TL.maxBet, Number(wallet.balance) || TL.minBet));
        const raw = window.prompt(
            'Bet (₹) — min ' + TL.minBet + ', max ' + max.toFixed(2),
            String(g.betAmount || TL.minBet),
        );
        if (raw === null) return;
        let n = Number(String(raw).replace(/[^\d.]/g, ''));
        if (!Number.isFinite(n)) return;
        n = Math.round(n * 100) / 100;
        n = Math.max(TL.minBet, Math.min(max, n));
        g.betAmount = n;
        if (TL.snap) TL.snap.betAmount = n;
        say('Bet ₹' + n.toFixed(2));
        setTimeout(() => say(''), 1200);
    }

    function doCashout() {
        // Prefer live label if TL.heldWin lagged after a stuck spin
        const fromLabel = cashBtn.querySelector('#tl-g-held');
        const labeled = fromLabel ? Number(String(fromLabel.textContent).replace(/[^\d.]/g, '')) : 0;
        const held = Math.max(Number(TL.heldWin) || 0, Number.isFinite(labeled) ? labeled : 0);
        if (held <= 0) {
            say('Nothing to cash out.');
            setTimeout(() => say(''), 1200);
            return;
        }
        if (cashBtn.disabled) return;
        cashBtn.disabled = true;
        post('/game/glamour/cashout').then((res) => {
            if (!res || !res.isSuccess) {
                say((res && res.message) || 'Nothing to cash out.');
                setTimeout(() => say(''), 1500);
                return;
            }
            TL.heldWin = 0;
            TL.spinning = false;
            TL.armed = false;
            TL.paid = null;
            TL.serverBalance = res.data.balance;
            syncHud(res.data.balance);
            if (TL.ir) TL.ir.globalVars.balance = res.data.balance;
            paintHeld();
            say('+₹' + Number(res.data.cashed).toFixed(2) + ' → wallet ₹' + Number(res.data.balance).toFixed(2));
            setTimeout(() => say(''), 1800);
            if (!TL.fresh && !TL.resetting) hardReset();
        }).catch(() => say('Connection lost.')).finally(() => { cashBtn.disabled = false; });
    }

    function mountUi() {
        document.body.appendChild(banner);
        document.body.appendChild(cashBtn);
        // pointerdown — click alone was eaten by the canvas capture blocker
        cashBtn.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            doCashout();
        });
        cashBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
        });
        paintHeld();
        placeCashBtn();
        window.addEventListener('resize', placeCashBtn);
        setInterval(placeCashBtn, 400);
    }
    if (document.body) mountUi();
    else document.addEventListener('DOMContentLoaded', mountUi);

    const post = (url, body) => fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': wallet.token },
        body: JSON.stringify(body || {}),
        keepalive: true,
    }).then((r) => r.json());

    // ---- reset -------------------------------------------------------------
    // The player's money, stake and settings are theirs. Everything else in the
    // globals is one spin's working state and has to go back, or the next spin
    // inherits it.
    const KEEP = ['balance', 'betAmount', 'apiUrl', 'accountid', 'gamesessionid', 'currency',
        'lang', 'sound', 'som', 'musica', 'Music', 'exiturl', 'apiversion'];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function restore() {
        const g = TL.ir.globalVars;
        for (const k of Object.keys(TL.snap)) {
            if (KEEP.indexOf(k) < 0 && g[k] !== TL.snap[k]) g[k] = TL.snap[k];
        }
    }

    /** Is the spin button rebuilt and on screen? The one honest sign the layout is up. */
    function spinButtonReady() {
        try {
            for (const i of TL.ir.objects.bt_play.instances()) {
                if (i.isVisible) return true;
            }
        } catch (e) { /* objects come and go across a layout change */ }
        return false;
    }

    async function hardReset() {
        if (TL.resetting) return;
        TL.resetting = true;
        TL.fresh = false;
        restore();
        // Between spins we are already on Game + wait — only wipe globals.
        // Full goToLayout was ~1.8s dead air after every settle.
        // ponytail: soft path; hard path if soft leaves the button dead.
        if (layoutName(TL.ir) === 'Game' && TL.ir.globalVars.Phase === 'wait' && spinButtonReady()) {
            await sleep(120);
            restore();
            TL.fresh = spinButtonReady();
            TL.resetting = false;
            if (TL.fresh) return;
            TL.resetting = true;
            TL.fresh = false;
        }
        TL.ir.goToLayout('Game');
        // Phase is one of the globals we put back, so it says 'wait' immediately and
        // proves nothing - wait on the rebuilt button and on real ticks instead
        await sleep(400);
        restore();
        for (let i = 0; i < 40 && !spinButtonReady(); i++) await sleep(40);
        await sleep(200);
        TL.fresh = spinButtonReady();
        TL.resetting = false;
        if (!TL.fresh) say('Still getting ready...');
    }

    // ---- taps --------------------------------------------------------------
    const canvas = () => document.querySelector('canvas');

    /** Where a page-space point falls on the canvas, as fractions, or null. */
    function frac(e) {
        const c = canvas();
        if (!c) return null;
        const r = c.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const x = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX);
        const y = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY);
        if (x === undefined || y === undefined) return null;
        const fx = (x - r.left) / r.width;
        const fy = (y - r.top) / r.height;
        return (fx < 0 || fx > 1 || fy < 0 || fy > 1) ? null : { fx: fx, fy: fy };
    }

    const inSpin = (f) => Math.pow((f.fx - SPIN.cx) / SPIN.rx, 2) + Math.pow((f.fy - SPIN.cy) / SPIN.ry, 2) <= 1;
    const inBlocked = (f) => BLOCKED.some((b) => f.fx >= b.x1 && f.fx <= b.x2 && f.fy >= b.y1 && f.fy <= b.y2);
    const inZone = (f, z) => f.fx >= z.x1 && f.fx <= z.x2 && f.fy >= z.y1 && f.fy <= z.y2;

    let replaying = false;
    function dispatchTap() {
        const c = canvas();
        const r = c.getBoundingClientRect();
        const x = r.left + r.width * SPIN.cx;
        const y = r.top + r.height * SPIN.cy;
        replaying = true;
        for (const type of ['pointerdown', 'pointerup']) {
            c.dispatchEvent(new PointerEvent(type, {
                clientX: x, clientY: y, bubbles: true, button: 0,
                buttons: type === 'pointerdown' ? 1 : 0,
                pointerId: 1, pointerType: 'mouse', isPrimary: true,
            }));
        }
        replaying = false;
    }

    /**
     * Start the spin the server already paid for, and make sure it really started.
     * The retry is safe because it only fires while the game is still idle - once it
     * has taken the tap it is no longer in 'wait', so it cannot be spun twice.
     */
    async function tapSpinButton() {
        const g = TL.ir.globalVars;
        for (let attempt = 0; attempt < 4; attempt++) {
            dispatchTap();
            for (let i = 0; i < 12; i++) {
                await sleep(50);
                if (g.Phase !== 'wait') return true;
            }
        }
        return false;
    }

    /**
     * A press on the spin button: reset and settle first, then hand the browser
     * the seed and let the game's own animation play out what was already paid.
     */
    async function beginSpin() {
        if (TL.spinning) return;
        if (!TL.fresh) {
            // the between-spins reset has not finished; without it the game would
            // inherit the last spin's state and pay something other than the table
            say(TL.resetting ? 'Still getting ready...' : 'One moment...');
            if (!TL.resetting) hardReset();
            return;
        }
        TL.spinning = true;
        const g = TL.ir.globalVars;
        const bet = g.betAmount;
        const res = await post('/game/glamour/spin', { bet: bet }).catch(() => null);
        if (!res || !res.isSuccess) {
            say((res && res.message) || 'Spin refused by the server.');
            TL.spinning = false;
            return false;                            // reels never move: nothing was staked
        }
        say('');
        TL.fresh = false;
        TL.serverBalance = res.data.balance;
        TL.heldWin = Number(res.data.heldWin);
        if (!Number.isFinite(TL.heldWin)) TL.heldWin = 0;
        syncHud(res.data.balance);
        paintHeld();
        // Hold model: wallet has only lost the bet. Start the game at post-debit
        // balance so its own credit animation lands on balance+win, then we snap
        // back to the wallet (win stays in HELD until CASHOUT).
        g.balance = res.data.balance;
        TL.paid = res.data;
        TL.shown = 0;
        arm(res.data.seed);
        TL.armed = true;
        if (!(await tapSpinButton())) {
            // Bet already taken, win already held — unlock cashout / next spin.
            say('Reels stuck — win is held. Tap CASHOUT.');
            TL.spinning = false;
            TL.armed = false;
            TL.paid = null;
            hardReset();
            return false;
        }
        return true;
    }

    // ---- autoplay ----------------------------------------------------------
    // Just beginSpin() on a timer. Every guard the hand path relies on is re-read
    // each pass instead of being tracked, so the loop cannot get ahead of the game:
    // it only stakes when the round is finished, the reset has landed and the
    // server has not refused anything.
    let auto = false;
    const AUTO_MSG = 'Autoplay ON — tap AUTOPLAY to stop';

    function setAuto(on) {
        if (auto === on) return;
        auto = on;
        say(on ? AUTO_MSG : '');
        if (on) autoLoop();
    }

    async function autoLoop() {
        while (auto) {
            await sleep(250);
            if (!auto || !TL.ready || !TL.ir) continue;
            // beginSpin clears the banner each round; repaint, but never over a
            // message the player still needs to read
            if (!banner.textContent || banner.textContent === AUTO_MSG) say(AUTO_MSG);
            const g = TL.ir.globalVars;
            // A free-spin round was already bought by the spin that triggered it, and
            // the settle below waits for it to finish - so nothing may stake here.
            // Advancing it is exactly what a hand tap does, so replay that tap.
            if (g.Freespins > 0) {
                if (g.Phase === 'wait') dispatchTap();
                continue;
            }
            if (TL.spinning || !TL.fresh || g.Phase !== 'wait') continue;
            // beginSpin has already put the reason on screen; leave it there
            if (!(await beginSpin())) { auto = false; return; }
        }
    }

    function onPointer(e) {
        if (replaying || !TL.ready) return;
        // HTML CASHOUT / toast — never steal their events (BLOCKED box sits under the button)
        if (e.target && (e.target === cashBtn || cashBtn.contains(e.target) || e.target === banner || banner.contains(e.target))) {
            return;
        }
        const f = frac(e);
        if (!f) return;
        if (inBlocked(f)) { e.stopImmediatePropagation(); e.preventDefault(); return; }
        if (inZone(f, AUTO_ZONE)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            if (e.type === 'pointerdown') setAuto(!auto);
            return;
        }
        if (inZone(f, BET_ZONE)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            if (e.type === 'pointerdown' || e.type === 'touchstart' || e.type === 'mousedown') editBet();
            return;
        }
        if (!inSpin(f)) return;                       // bet +/-, sound, settings: the game's own
        const g = TL.ir.globalVars;
        // during a free-spin round the same button advances it, and that round was
        // already paid for as part of the spin that triggered it
        if (g.Phase !== 'wait' || g.Freespins > 0) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        if (e.type === 'pointerdown') beginSpin();
    }
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
        window.addEventListener(type, onPointer, true);
    }

    // ---- settle ------------------------------------------------------------
    // The server already moved the money. This keeps the display honest about it
    // and reports what the screen actually showed, which is the one thing that can
    // go wrong with the whole design.
    //
    // The invariant is simple and does the work of several special cases: whenever
    // the game is idle, the balance on screen is the balance in the wallet. That
    // covers a win the game books after we stopped watching, a spin that somehow
    // started without a seed, and a dropped connection - none of them can leave a
    // number on screen that the wallet does not back.
    function watch() {
        const g = TL.ir.globalVars;
        let last = g.balance;
        let quiet = 0;
        let grace = 0;

        /**
         * Is the round completely finished? Not just idle - a free-spin round shows
         * its banner while the game is back in 'wait' with the balance untouched,
         * and settling in that gap read a win of zero off a spin that went on to
         * pay 2.1x.
         */
        const roundDone = () => g.Phase === 'wait' && !g.Freespins && !g.janela_rodadas_gratis;

        setInterval(() => {
            if (TL.spinning) {
                if (g.balance !== last || !roundDone()) {
                    last = g.balance;
                    quiet = 0;
                    grace = 0;
                    return;
                }
                if (++quiet < 5) return;               // 0.5s balance quiet
                if (++grace < 5) return;               // +0.5s nothing pending
                const paid = TL.paid;
                TL.spinning = false;
                TL.armed = false;
                grace = 0;
                quiet = 0;
                if (paid) {
                    TL.lastShown = paid.bet ? +(TL.shown / paid.bet).toFixed(6) : -1;
                    post('/game/glamour/report', {
                        seed: paid.seed,
                        multiplier: paid.multiplier,
                        shown: TL.lastShown,
                    }).catch(() => null);
                }
                TL.paid = null;                        // stops the frame-rate peak capture
                g.balance = TL.serverBalance;
                last = g.balance;
                syncHud(TL.serverBalance);
                hardReset();                           // ready for the next press
                return;
            }

            if (!TL.ready) return;
            if (roundDone()) {
                if (Math.abs(g.balance - TL.serverBalance) > 0.005) {
                    g.balance = TL.serverBalance;
                    last = g.balance;
                }
                return;
            }
            // a spin in flight that nothing armed is a spin the server never priced.
            // It cannot be stopped, but it must not be believed.
            if (!TL.armed && !TL.resetting) {
                say('That spin did not count.');
                fetch('/game/glamour/state').then((r) => r.json()).then((res) => {
                    if (res.isSuccess) {
                        TL.serverBalance = res.data.balance;
                        syncHud(res.data.balance);
                    }
                }).catch(() => null);
            }
        }, 100);
    }

    // ---- boot --------------------------------------------------------------
    /** ir.layout throws outright until a layout is running, so never read it bare. */
    const layoutName = (ir) => { try { return ir.layout.name; } catch (e) { return null; } };

    (async function attach() {
        let ir = null;
        try { ir = iface._GetLocalRuntime().GetIRuntime(); } catch (e) { ir = null; }
        if (!ir || !ir.globalVars) {
            setTimeout(attach, 100);
            return;
        }
        TL.ir = ir;
        const g = ir.globalVars;

        // keep the operator callout inside this box: it ships pointing at
        // https://1700700.net/betclipapi/match3/callback.asp with accountid,
        // gamesessionid and betAmount beside it
        g.apiUrl = new URL('/game/slot-api', location.origin).toString();
        g.accountid = String(wallet.userId);
        g.gamesessionid = wallet.token;
        g.currency = wallet.currency;

        // the game opens on its menu and the player decides when to start, so this
        // waits as long as it takes rather than giving up
        if (layoutName(ir) !== 'Game' || g.Phase !== 'wait') { setTimeout(attach, 200); return; }
        // ponytail: was sleep(2000); spin button ready is the real signal
        for (let i = 0; i < 50 && !spinButtonReady(); i++) await sleep(40);
        TL.snap = Object.assign({}, g);               // the state every spin starts from

        const s = await fetch('/game/glamour/state').then((r) => r.json()).catch(() => null);
        if (!s || !s.isSuccess) { say('Wallet unavailable.'); return; }
        TL.serverBalance = s.data.balance;
        TL.heldWin = Number(s.data.heldWin) || 0;
        TL.minBet = Number(s.data.minBet) || 10;
        TL.maxBet = Number(s.data.maxBet) || 3000000;
        g.balance = s.data.balance;
        // keep the +/- ladder on the same amounts the server will accept
        const bets = Array.isArray(s.data.bets) ? s.data.bets : null;
        if (bets && bets.length >= 5) {
            g.betlimits1 = bets[0]; g.betlimits2 = bets[1]; g.betlimits3 = bets[2];
            g.betlimits4 = bets[3]; g.betlimits5 = bets[4];
            g.betAmount = bets.includes(g.betAmount) ? g.betAmount : bets[0];
            TL.snap.betlimits1 = bets[0]; TL.snap.betlimits2 = bets[1]; TL.snap.betlimits3 = bets[2];
            TL.snap.betlimits4 = bets[3]; TL.snap.betlimits5 = bets[4];
            TL.snap.betAmount = g.betAmount;
        }
        syncHud(s.data.balance);
        paintHeld();
        await hardReset();                            // the first spin needs one too
        g.balance = s.data.balance;
        // betAmount is in KEEP, so a layout restart can leave the demo stake; pin it
        if (bets && bets.length >= 5) {
            g.betAmount = (TL.snap && TL.snap.betAmount) || (bets.includes(g.betAmount) ? g.betAmount : bets[0]);
        }
        TL.ready = true;
        watch();

        // belt to the geometry's braces: even if a blocked control is reached
        // somewhere this file does not cover, it cannot run while the game is idle
        setInterval(() => {
            if (TL.spinning || g.Phase !== 'wait' || g.Freespins > 0) return;
            if (g.automatico) g.automatico = 0;
            if (g.automatico_ativo) g.automatico_ativo = 0;
            if (g.comprourodadas) g.comprourodadas = 0;
        }, 200);

        console.log('[tl] glamour spins on the wallet, balance', s.data.balance, 'rtp', s.data.rtp, 'house', s.data.housePct);
    })();
})();
