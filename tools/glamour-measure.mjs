/**
 * Measure Glamour Spins by playing it.
 *
 * The vendor shipped this game without the piece that talks to a server: its
 * Send* functions only set local variables, the bonusgame.js it loads is not in
 * the package, and the included .c3p has no Game layout. So there is no paytable
 * to read and no API to call - the win logic exists only as compiled opcodes.
 *
 * What there is, established by driving the real client:
 *   - the game consumes zero random numbers while idle;
 *   - a spin is a deterministic function of the Math.random stream: same stream,
 *     same grid, same win, byte for byte;
 *   - the win is linear in the bet (seed 12345 pays 1.2 at bet 1 and 6.0 at 5);
 *   - the stream position is only stable if the timestep is fixed. During
 *     cascades the game draws per tick, so at a different frame rate the same
 *     seed paid 4.95 instead of 4.50. Pinning game time to 1/60s per tick makes
 *     the tick count - and the draws - depend on the animation, not the display.
 *   - a seed alone is NOT enough: the outcome also depends on what the previous
 *     spin left behind, so measuring seeds back to back produced a table that
 *     only replayed if you replayed the whole sequence. Two things have to be put
 *     back, and missing either one looks like the game is non-deterministic:
 *       * the sprite instances the matching runs off - restart the Game layout.
 *         Restoring the board Array is NOT enough; that is only a mirror of them;
 *       * the globals. Those survive a layout change, and a spin leaves working
 *         state in them (Blocks, Explosions, ...). Left alone the event sheet
 *         simply refuses to start the next spin.
 *     With both restored, reset -> arm -> spin is stable to the draw count, from
 *     any previous state, across page loads, and at any bet.
 *   - read the win from resultAmount, not from the balance. The balance ticks up
 *     on an animation; sampling it too early splits one spin's win across two
 *     measurements and looks exactly like the game being random. resultAmount is
 *     also what the game prints in txt_premio, so it is what the player sees.
 *
 * So this script restarts the layout, pins the timestep, seeds the stream, and
 * records what each seed pays. The server then owns the outcome: it picks a seed
 * whose payout it already knows, settles that, and hands the seed to the client.
 * The client bridge (js/tl-c3-slot.js) has to do the same three steps in the same
 * order, or this table describes a game nobody is playing.
 *
 *   NODE_PATH=<...>/node_modules node tools/glamour-measure.mjs --seeds 2000
 *   node tools/glamour-measure.mjs --seeds 200 --headed      # watch it play
 *   node tools/glamour-measure.mjs --verify                  # the table still replays
 *
 * Writes tools/glamour-seeds.json. Re-running with more seeds extends the file.
 */
import { createRequire } from 'node:module';
// ESM ignores NODE_PATH, and playwright is usually only in the npx cache here, so
// resolve it through require: TL_PLAYWRIGHT=<abs path> or NODE_PATH=<node_modules>
const { chromium } = createRequire(import.meta.url)(process.env.TL_PLAYWRIGHT || 'playwright');
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'tools/glamour-seeds.json');
const BASE = process.env.TL_BASE || 'http://127.0.0.1:8000';
const USER = process.env.TL_USER || 'uitest.tl@example.com';
const PASS = process.env.TL_PASS || 'Test@12345';

const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const WANT = Number(arg('--seeds', 500));
const HEADED = process.argv.includes('--headed');

/** Instrumentation installed in the page: seeded stream, pinned clock, tick pump. */
function install(pump) {
    const ir = window.c3_runtimeInterface._GetLocalRuntime().GetIRuntime();
    window.TLM = { ir };
    let state = 1, pending = null, draws = 0;
    // arm(seed) makes the NEXT draw the game takes draw #1 of that seed's stream,
    // so nothing between arming and the spin can shift the alignment
    Math.random = function () {
        if (pending !== null) { state = (pending >>> 0) || 1; pending = null; draws = 0; }
        draws++;
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
        return state / 4294967296;
    };

    // fixed timestep: one tick is always 1/60s of game time
    let virt = performance.now();
    const step = 1000 / 60;
    if (pump) {
        // drive the loop from a MessageChannel instead of the display; the tick
        // count per animation is unchanged, only wall-clock time shrinks
        const mc = new MessageChannel();
        const queue = [];
        mc.port1.onmessage = () => { const cb = queue.shift(); if (cb) cb(); };
        window.requestAnimationFrame = (cb) => { queue.push(() => { virt += step; cb(virt); }); mc.port2.postMessage(0); return 0; };
    } else {
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => raf(() => { virt += step; cb(virt); });
    }
    performance.now = () => virt;

    const tap = (fx, fy) => {
        const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        for (const t of ['pointerdown', 'pointerup']) {
            c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, button: 0, buttons: t === 'pointerdown' ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        }
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    Object.assign(window.TLM, {
        globals: () => ir.globalVars,
        grid() {
            const a = [...ir.objects['Array'].instances()][0];
            const rows = [];
            for (let y = 0; y < a.height; y++) { const row = []; for (let x = 0; x < a.width; x++) row.push(a.getAt(x, y, 0)); rows.push(row.join('')); }
            return rows.join('|');
        },
        /**
         * Rebuild the Game layout. This is the whole reason the table means
         * anything: without it a spin inherits the last one's sprite state.
         */
        reset: async () => {
            ir.goToLayout('Game');
            await sleep(300);
            for (let i = 0; i < 120 && ir.globalVars.Phase !== 'wait'; i++) { tap(0.5, 0.68); await sleep(150); }
            return ir.globalVars.Phase;
        },
        /** Canonical Game-layout globals, taken once the arrival has settled. */
        snap: null,
        // the player's money, stake and settings are theirs; everything else is
        // one spin's working state and has to go back
        KEEP: ['balance', 'betAmount', 'apiUrl', 'accountid', 'gamesessionid', 'currency', 'lang', 'sound', 'som', 'musica', 'Music', 'exiturl', 'apiversion'],
        snapshot() { this.snap = Object.assign({}, ir.globalVars); return Object.keys(this.snap).length; },
        restore() {
            for (const k of Object.keys(this.snap)) {
                if (this.KEEP.indexOf(k) < 0 && ir.globalVars[k] !== this.snap[k]) ir.globalVars[k] = this.snap[k];
            }
        },
        /** Put the game back to the state every measured spin starts from. */
        hardReset: async function () {
            this.restore();
            ir.goToLayout('Game');
            await sleep(250);
            this.restore();
            for (let i = 0; i < 120 && ir.globalVars.Phase !== 'wait'; i++) { tap(0.5, 0.68); await sleep(150); }
            return ir.globalVars.Phase;
        },
        toGame: async () => {
            for (let i = 0; i < 80 && window.TLM.layoutName() !== 'Game'; i++) { tap(0.5, 0.68); await sleep(250); }
            return window.TLM.layoutName();
        },
        /**
         * One settlement: the paid spin plus any free spins it triggers.
         *
         * The round is over when the game is idle, owes no free spins, and has
         * stopped adding to resultAmount. The quiet period is long on purpose -
         * at 240ms this read the win of a spin that was still paying out, and the
         * same seed then "paid" two different amounts off an identical grid.
         */
        spin: async (seed) => {
            const g = ir.globalVars;
            while (g.Phase !== 'wait') await sleep(20);
            const bet = g.betAmount;
            const before = g.balance;
            pending = seed;                       // armed: next draw starts the stream
            tap(0.5, 0.875);
            let started = false;
            for (let k = 0; k < 60 && !started; k++) { await sleep(15); started = g.balance < before - bet / 2; }
            if (!started) return { seed, mult: null };

            let last = g.balance, quiet = 0, help = 0;
            const t0 = Date.now();
            while (Date.now() - t0 < 90000) {
                await sleep(25);
                if (g.balance !== last) { last = g.balance; quiet = 0; continue; }
                if (++quiet < 60) continue;       // 1.5s of no movement, THEN judge the state
                if (g.Freespins > 0 || g.Phase !== 'wait') {
                    if (++help > 400) break;      // a free-spin round waiting for a tap
                    tap(0.5, 0.875);
                    quiet = 0;
                    continue;
                }
                break;
            }
            await sleep(600);
            return { seed, mult: +(g.resultAmount / bet).toFixed(6), draws, grid: window.TLM.grid(), freeSpinHelp: help, ms: Date.now() - t0 };
        },
    });
    const layoutName = () => { try { return ir.layout.name; } catch (e) { return null; } };
    window.TLM.layoutName = layoutName;
    return { layout: layoutName(), balance: ir.globalVars.balance };
}

// the playwright in the npx cache has no browser registered against it, so point
// at a chromium that is already on the box (TL_CHROME overrides)
const exe = process.env.TL_CHROME
    || join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const browser = await chromium.launch({ headless: !HEADED, executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
page.on('pageerror', (e) => { if (!/DragnDrop/.test(String(e))) console.log('  page error:', String(e).slice(0, 120)); });

await page.goto(BASE + '/');
const login = await page.evaluate(async ([u, p]) => {
    const tok = document.querySelector('input[name=_token]').value;
    const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _token: tok, username: u, password: p }) });
    return r.json();
}, [USER, PASS]);
if (!login.isSuccess) throw new Error('login failed: ' + login.message);

await page.goto(BASE + '/slot-glamour/index.html?mute=1&measure=1');
await page.waitForFunction(() => {
    try { return !!window.c3_runtimeInterface._GetLocalRuntime().GetIRuntime().layout.name; } catch (e) { return false; }
}, null, { timeout: 60000 });
const state = await page.evaluate(install, true);
const layout = await page.evaluate(() => window.TLM.toGame());
if (layout !== 'Game') throw new Error('never reached the Game layout, stuck on ' + layout);
await page.waitForFunction(() => window.TLM.ir.globalVars.Phase === 'wait', null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));      // let the arrival animation finish
console.log(`  in the Game layout, demo credit ${state.balance}, ${await page.evaluate(() => window.TLM.snapshot())} globals snapshotted`);
await page.evaluate(() => window.TLM.hardReset());
await page.evaluate(() => window.TLM.spin(999999));  // warm-up, discarded

// --verify is the check on all of this: the table is only worth anything if the
// game still pays what it says, so replay a sample of it and demand an exact match
if (process.argv.includes('--verify')) {
    if (!existsSync(OUT)) throw new Error('nothing measured yet: run without --verify first');
    const table = JSON.parse(readFileSync(OUT, 'utf8'));
    if (table.regime !== 'reset-per-spin') throw new Error('table regime is ' + table.regime);
    const step = Math.max(1, Math.floor(table.seeds.length / 12));
    let bad = 0;
    for (let i = 0; i < table.seeds.length; i += step) {
        const [seed, want] = table.seeds[i];
        await page.evaluate(() => window.TLM.hardReset());
        const got = await page.evaluate((x) => window.TLM.spin(x), seed);
        const ok = got.mult === want;
        if (!ok) bad++;
        console.log(`  [${ok ? 'ok' : 'FAIL'}] seed ${seed} pays ${got.mult} (table says ${want})`);
    }
    await browser.close();
    console.log(bad === 0 ? 'glamour-measure --verify OK' : bad + ' seed(s) no longer pay what the table says');
    process.exit(bad === 0 ? 0 : 1);
}

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { seeds: [] };
const known = new Map(store.seeds.map(([s, m]) => [s, m]));
const t0 = Date.now();
let done = 0, freeSpinRounds = 0;
for (let seed = 1; known.size < WANT; seed++) {
    if (known.has(seed)) continue;
    await page.evaluate(() => window.TLM.hardReset());
    const r = await page.evaluate((s) => window.TLM.spin(s), seed);
    if (r.mult === null) { console.log(`  seed ${seed}: no clean spin, skipped`); continue; }
    known.set(seed, r.mult);
    if (r.freeSpinHelp > 0) freeSpinRounds++;
    if (++done % 25 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        const mults = [...known.values()];
        console.log(`  ${known.size}/${WANT} seeds  RTP so far ${(mults.reduce((a, b) => a + b, 0) / mults.length).toFixed(4)}  ${rate.toFixed(1)} spins/s`);
        writeFileSync(OUT, JSON.stringify(snapshot(known, freeSpinRounds), null, 0));
    }
}
writeFileSync(OUT, JSON.stringify(snapshot(known, freeSpinRounds), null, 0));
await browser.close();

function snapshot(map, freeRounds) {
    const seeds = [...map.entries()].sort((a, b) => a[0] - b[0]);
    const mults = seeds.map(([, m]) => m);
    const rtp = mults.reduce((a, b) => a + b, 0) / mults.length;
    return {
        generatedBy: 'tools/glamour-measure.mjs',
        regime: 'reset-per-spin',
        note: 'multiplier = (balance delta + bet) / bet for one settlement, free spins included',
        count: seeds.length,
        naturalRtp: +rtp.toFixed(6),
        maxMult: Math.max(...mults),
        zeroShare: +(mults.filter((m) => m === 0).length / mults.length).toFixed(4),
        freeSpinRounds: freeRounds,
        seeds,
    };
}

const finalMults = [...known.values()];
const rtp = finalMults.reduce((a, b) => a + b, 0) / finalMults.length;
console.log(`\n  ${known.size} seeds measured in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`  natural RTP ${rtp.toFixed(4)}  max ${Math.max(...finalMults)}x  losing spins ${(finalMults.filter((m) => m === 0).length / finalMults.length * 100).toFixed(1)}%`);
console.log(`  free-spin rounds seen: ${freeSpinRounds}`);
console.log(`  wrote ${OUT}`);
