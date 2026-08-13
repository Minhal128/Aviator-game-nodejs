/**
 * The check on js/tl-c3-slot.js: does a real click on the real page move the real
 * wallet by the amount the screen shows?
 *
 *   NODE_PATH=<...>/node_modules node tools/glamour-client.mjs
 *
 * glamour-measure.mjs --verify proves the seed table still replays. This proves
 * the other half - that the browser and the wallet agree - and it drives the page
 * the way a player does, through the bridge, not through a test harness.
 *
 * The three things it will not take on trust:
 *
 *  1. the wallet delta equals win - bet, and what the game printed as the win
 *     (resultAmount) is the multiplier the server says it paid. If these ever come
 *     apart, a player is being shown one number and paid another.
 *  2. nothing outside the intercepted region starts a spin. The bridge finds the
 *     spin button by measured coordinates, because the runtime's own
 *     layerToCssPx() is a third of a screen out; if a future build moves that
 *     button, taps would reach the game directly and spin for free. So this taps a
 *     ring around the ellipse and demands that the game ignore every point.
 *  3. BUY FREE SPIN and AUTOPLAY stay unreachable. Neither has a price in the
 *     measured table.
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.TL_PLAYWRIGHT || 'playwright');
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.TL_BASE || 'http://127.0.0.1:8000';
const USER = process.env.TL_USER || 'uitest.tl@example.com';
const PASS = process.env.TL_PASS || 'Test@12345';
const HEADED = process.argv.includes('--headed');

let fail = 0;
const check = (label, ok) => { console.log(`  [${ok ? 'ok' : 'FAIL'}] ${label}`); if (!ok) fail++; };

const exe = process.env.TL_CHROME
    || join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const browser = await chromium.launch({ headless: !HEADED, executablePath: existsSync(exe) ? exe : undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
page.on('pageerror', (e) => { if (!/DragnDrop/.test(String(e))) console.log('  page error:', String(e).slice(0, 120)); });

await page.goto(BASE + '/');
const login = await page.evaluate(async ([u, p]) => {
    const tok = document.querySelector('input[name=_token]').value;
    const r = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _token: tok, username: u, password: p }),
    });
    return r.json();
}, [USER, PASS]);
if (!login.isSuccess) throw new Error('login failed: ' + login.message);

// no ?measure=1: this is the page a player gets, bridge and all
await page.goto(BASE + '/slot-glamour/index.html?mute=1');
/** Click the way a player does: a real mouse press on the page. */
async function clickFrac(fx, fy) {
    const r = await page.evaluate(() => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        return { left: c.left, top: c.top, width: c.width, height: c.height };
    });
    await page.mouse.click(r.left + r.width * fx, r.top + r.height * fy);
}

console.log('== the bridge attaches ==');
await page.waitForFunction(() => !!window.TL_C3, null, { timeout: 60000 });
// The game opens on a splash and a menu; tap through the way a player does, and
// keep tapping until the bridge reports itself ready rather than until the layout
// name changes - the layout arrives several seconds before the bridge has its
// snapshot and its opening balance.
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
    const at = await page.evaluate(() => {
        let layout = null;
        try { layout = window.TL_C3.ir.layout.name; } catch (e) { layout = null; }
        return { layout: layout, ready: !!window.TL_C3.ready };
    });
    ready = at.ready;
    if (!ready && at.layout !== 'Game') await clickFrac(0.5, 0.68);
    if (!ready) await page.waitForTimeout(500);
}
if (!ready) throw new Error('the bridge never became ready');
const boot = await page.evaluate(() => {
    const g = window.TL_C3.ir.globalVars;
    return { balance: g.balance, bet: g.betAmount, apiUrl: g.apiUrl, snap: Object.keys(window.TL_C3.snap || {}).length };
});
check('the game is on the wallet, not the demo credit (balance ' + boot.balance + ')', boot.balance < 100000);
check('the operator callout is contained (' + boot.apiUrl + ')', boot.apiUrl.startsWith(BASE));
check('the reset snapshot was taken (' + boot.snap + ' globals)', boot.snap > 50);

const server = () => page.evaluate(() => fetch('/game/glamour/state').then((r) => r.json()));
const walletNow = async () => (await server()).data.balance;

console.log('== spins settle through the wallet ==');
// Several spins, not one: a losing spin makes "the screen shows what was paid"
// compare 0 against 0, which would pass even if the reels never turned. So this
// also watches the game leave its idle phase, and insists on seeing a real win.
let wins = 0;
let mismatches = 0;
let neverSpun = 0;
const betsSeen = new Set();
for (let n = 0; n < 8; n++) {
    // one spin at a raised stake: the server pays multiplier x bet, and the game
    // works its own win out separately, so the two have to agree at more than one
    // stake or the table only happens to be right at the minimum
    if (n === 7) {
        await clickFrac(0.67, 0.90);                  // the game's own bet-up button
        await page.waitForTimeout(600);
    }
    const before = await walletNow();
    const bet = await page.evaluate(() => window.TL_C3.ir.globalVars.betAmount);
    betsSeen.add(bet);
    await page.evaluate(() => { window.__left = false; });
    // watch for the game actually leaving 'wait' - that is the reels turning
    await page.evaluate(() => {
        const g = window.TL_C3.ir.globalVars;
        const id = setInterval(() => { if (g.Phase !== 'wait') { window.__left = true; clearInterval(id); } }, 50);
        setTimeout(() => clearInterval(id), 120000);
    });
    await clickFrac(0.50, 0.87);
    await page.waitForFunction(() => window.TL_C3.spinning === true, null, { timeout: 30000 })
        .catch(() => { throw new Error('the bridge never started spin ' + (n + 1)); });

    // A free-spin round waits for the player to tap on, and the bridge deliberately
    // does not intercept those taps - the round was already paid for by the spin
    // that triggered it. So tap it along, the way a player would.
    let settled = false;
    for (let i = 0; i < 300 && !settled; i++) {
        const st = await page.evaluate(() => {
            const g = window.TL_C3.ir.globalVars;
            return { spinning: window.TL_C3.spinning, free: g.Freespins, phase: g.Phase };
        });
        settled = st.spinning === false;
        if (settled) break;
        // tap on anything the game is waiting on: a free-spin round shows its
        // banner with the game back in 'wait', so Freespins alone is not the signal
        if (st.phase === 'wait') await clickFrac(0.50, 0.87);
        await page.waitForTimeout(500);
    }
    if (!settled) throw new Error('spin ' + (n + 1) + ' never settled');

    const after = await walletNow();
    const seen = await page.evaluate(() => ({
        // the highest the game's own win counter reached this round; it clears it as
        // the round closes, so the bridge keeps the peak
        multiplier: window.TL_C3.lastShown,
        balance: window.TL_C3.ir.globalVars.balance,
        left: window.__left,
    }));
    const win = +(after - before + bet).toFixed(2);
    const onScreen = +(seen.multiplier * bet).toFixed(2);
    const ok = Math.abs(onScreen - win) < 0.005 && Math.abs((after - before) - (win - bet)) < 0.005
        && Math.abs(seen.balance - after) < 0.005;
    if (!ok) mismatches++;
    if (!seen.left) neverSpun++;
    if (win > 0) wins++;
    console.log(`  spin ${n + 1}: bet ${bet}, wallet ${before} -> ${after}, won ${win}, screen showed ${onScreen}`
        + `${seen.left ? '' : ', REELS NEVER TURNED'}${ok ? '' : ', MISMATCH'}`);
    // let the between-spins reset finish, the way a player pausing would
    await page.waitForFunction(() => window.TL_C3.fresh === true, null, { timeout: 30000 })
        .catch(() => { throw new Error('the bridge never reset for the next spin'); });
}
check(`the stake was raised and still agreed (bets seen: ${[...betsSeen].join(', ')})`, betsSeen.size > 1);
check('every spin turned the reels', neverSpun === 0);
check('every spin paid exactly what the screen showed', mismatches === 0);
check(`at least one spin actually won, so the comparison meant something (${wins} of 8)`, wins > 0);

console.log('== nothing outside the intercepted region can spin ==');
// a ring just outside the ellipse the bridge covers: every one of these has to be
// ignored by the game, or it is a spin the server never priced
const ring = [];
for (let a = 0; a < 360; a += 30) {
    const t = a * Math.PI / 180;
    ring.push([0.50 + 0.152 * Math.cos(t), 0.87 + 0.077 * Math.sin(t)]);
}
let leaked = 0;
for (const [fx, fy] of ring) {
    const bal = await page.evaluate(() => window.TL_C3.ir.globalVars.balance);
    await clickFrac(fx, fy);
    const moved = await page.evaluate(async (b) => {
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 50));
            const g = window.TL_C3.ir.globalVars;
            if (g.Phase !== 'wait' || g.balance !== b) return true;
        }
        return false;
    }, bal);
    if (moved) { leaked++; console.log(`       a tap at ${fx.toFixed(3)},${fy.toFixed(3)} started something`); }
}
check(`${ring.length} taps around the edge of the intercepted region, none spun`, leaked === 0);

console.log('== the unpriced controls stay unreachable ==');
for (const [label, fx, fy] of [['BUY FREE SPIN', 0.18, 0.08], ['AUTOPLAY', 0.50, 0.96]]) {
    const bal = await walletNow();
    await clickFrac(fx, fy);
    await page.waitForTimeout(1500);
    const g = await page.evaluate(() => {
        const v = window.TL_C3.ir.globalVars;
        return { phase: v.Phase, autom: v.automatico_ativo, compra: v.comprourodadas };
    });
    check(`${label} did nothing (phase ${g.phase}, autoplay ${g.autom}, bought ${g.compra})`,
        g.phase === 'wait' && !g.autom && !g.compra && (await walletNow()) === bal);
}

await browser.close();
console.log(fail === 0 ? '\nglamour-client OK\n' : `\n${fail} problem(s)\n`);
process.exit(fail === 0 ? 0 : 1);
