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
// The money is settled BEFORE the seed arrives. That is deliberate: a client that
// knew the seed first could replay it against its own copy of the game - it IS
// the simulator - and only stake big on the good ones. So the spin button is
// intercepted, the server takes the bet and pays the win, and only then does the
// browser learn what to animate.
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
        serverBalance: 0, shown: 0, lastShown: null,
        fresh: false,        // a reset has happened since the last spin
        resetting: false,
    };
    window.TL_C3 = TL;

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
    // Two entry points the server has no price for. Buying a free-spin round is a
    // stake the table never measured, and autoplay would start spins without
    // going through the interception below.
    const BLOCKED = [
        { x1: 0.00, y1: 0.00, x2: 0.40, y2: 0.17 },             // BUY FREE SPIN
        { x1: 0.33, y1: 0.93, x2: 0.67, y2: 1.00 },             // AUTOPLAY
    ];



    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;'
        + 'padding:10px 18px;border-radius:999px;background:rgba(229,5,57,.92);color:#fff;'
        + 'font:600 14px/1 Roboto,system-ui,sans-serif;opacity:0;transition:opacity .2s;pointer-events:none';
    const say = (text) => { banner.textContent = text; banner.style.opacity = text ? '1' : '0'; };
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));

    const post = (url, body) => fetch(url, {
        method: 'POST',
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
        TL.ir.goToLayout('Game');
        // Phase is one of the globals we put back, so it says 'wait' immediately and
        // proves nothing - wait on the rebuilt button and on real ticks instead
        await sleep(1200);
        restore();
        for (let i = 0; i < 60 && !spinButtonReady(); i++) await sleep(50);
        // the button existing is not the same as the event sheet answering it; the
        // measured timing that always works is a little over a second and a half
        await sleep(600);
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
            return;                                  // reels never move: nothing was staked
        }
        say('');
        TL.fresh = false;
        TL.serverBalance = res.data.balance;
        // the game debits the bet and credits the win itself, with the same numbers
        // the server just used, so start it from the pre-spin balance
        g.balance = res.data.balance + res.data.bet - res.data.win;
        TL.paid = res.data;
        TL.shown = 0;
        arm(res.data.seed);
        TL.armed = true;
        if (!(await tapSpinButton())) {
            // the money is already settled and the balance already says so; all that
            // is lost is the animation, and the report below will record it
            say('The reels did not start - your balance is already up to date.');
        }
    }

    function onPointer(e) {
        if (replaying || !TL.ready) return;
        const f = frac(e);
        if (!f) return;
        if (inBlocked(f)) { e.stopImmediatePropagation(); e.preventDefault(); return; }
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
                if (++quiet < 15) return;              // 1.5s with the balance still
                if (++grace < 20) return;              // and 2s more with nothing pending
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
                    if (res.isSuccess) TL.serverBalance = res.data.balance;
                }).catch(() => null);
            }
        }, 100);
    }

    // ---- boot --------------------------------------------------------------
    /** ir.layout throws outright until a layout is running, so never read it bare. */
    const layoutName = (ir) => { try { return ir.layout.name; } catch (e) { return null; } };

    let tries = 0;
    (async function attach() {
        let ir = null;
        try { ir = iface._GetLocalRuntime().GetIRuntime(); } catch (e) { ir = null; }
        if (!ir || !ir.globalVars) {
            if (++tries < 400) setTimeout(attach, 50);
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
        await sleep(2000);                            // let the arrival animation finish
        TL.snap = Object.assign({}, g);               // the state every spin starts from

        const s = await fetch('/game/glamour/state').then((r) => r.json()).catch(() => null);
        if (!s || !s.isSuccess) { say('Wallet unavailable.'); return; }
        TL.serverBalance = s.data.balance;
        g.balance = s.data.balance;
        await hardReset();                            // the first spin needs one too
        g.balance = s.data.balance;
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

        console.log('[tl] glamour spins on the wallet, balance', s.data.balance, 'rtp', s.data.rtp);
    })();
})();
