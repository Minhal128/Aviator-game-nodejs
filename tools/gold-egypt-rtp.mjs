/**
 * Exact RTP for Gold of Egypt by enumerating every reel stop combination.
 * Reads the game's own slotConfig3x5.js, so it fails the moment the paytable
 * or the reel strips are retuned.
 *   node tools/gold-egypt-rtp.mjs            # measure + self-check
 *   node tools/gold-egypt-rtp.mjs --check    # exit 1 unless house keeps 30%
 *   node tools/gold-egypt-rtp.mjs --tune     # integer paytable that hits 70% RTP
 *
 * Faithfulness notes (verified against the game source):
 *  - stop position is uniform over the strip: getRandomOrderPosition() ->
 *    Phaser.Math.Between(0, symbols.length - 1)   (slot_classes.js:489)
 *  - window = symbols[(pos + row) % len] for row 0..2 (getWindowsSymbols)
 *  - all 3^5 = 243 lines are played (config has no `lines`, so
 *    getAllPossibleLines() builds every row combo) and total bet is
 *    selectedLinesCount * lineBet (getTotalBet, slot_classes.js:1692)
 *  - win = (lineWin + scatterWin) * lineBet, so RTP = E[sum of line pays] / 243
 *  - ponytail: LineBehavior.findWin compares `this.win.Pay` but WinData only
 *    has `pay`, so the comparison is always false and the FIRST matching
 *    payline wins, not the best one. That vendor bug is replicated here on
 *    purpose - we measure the game that ships, not the one that was meant.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOUSE_PCT = 30;
const TARGET_RTP = (100 - HOUSE_PCT) / 100;
const TOLERANCE = 0.005;

// one class at the tail of the config extends Phaser, so stub just that path
const src = readFileSync(join(root, 'goldegypt/game/js/slotConfig3x5.js'), 'utf8');
const sandbox = { Phaser: { GameObjects: { Particles: { Particle: class {} } } }, coinSpinAnim: null };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const cfg = sandbox.slotConfig3x5;

const WILD = cfg.wild;
const substitutable = new Set(cfg.symbols.filter((s) => s.useWildSubstitute).map((s) => s.name));
const names = cfg.symbols.map((s) => s.name);
const id = new Map(names.map((n, i) => [n, i]));
const N = names.length;
const ANY = -1;
const POW = [1, N, N ** 2, N ** 3, N ** 4];

/** createFullPaytable() + PayLine.getWildLines(), same order, tagged with the base payline. */
function buildPayTable() {
    const out = [];
    cfg.payLines.forEach((pl, owner) => {
        const base = pl.line.map((n) => (n === 'any' ? ANY : id.get(n)));
        out.push({ line: base, owner });
        if (!cfg.useWild) return;
        const wPoss = [];
        let counter = 0;
        for (let i = 0; i < pl.line.length; i++) {
            const n = pl.line[i];
            if (n === 'any' || n === WILD) continue;
            if (counter === 0) { counter++; continue; } // useWildInFirstPosition: false
            if (substitutable.has(n)) wPoss.push(i);
            counter++;
        }
        for (let mask = 1; mask < 1 << wPoss.length; mask++) {
            const line = base.slice();
            for (let b = 0; b < wPoss.length; b++) if (mask & (1 << b)) line[wPoss[b]] = id.get(WILD);
            out.push({ line, owner });
        }
    });
    return out;
}

/** owner[lineKey] = index of the paying base payline, or -1. First match wins. */
function buildLineLookup(payTable) {
    const bySymbol0 = Array.from({ length: N }, () => []);
    for (const e of payTable) bySymbol0[e.line[0]].push(e);
    const owner = new Int16Array(N ** 5).fill(-1);
    const s = [0, 0, 0, 0, 0];
    for (s[0] = 0; s[0] < N; s[0]++) {
        const candidates = bySymbol0[s[0]];
        if (candidates.length === 0) continue;
        for (s[1] = 0; s[1] < N; s[1]++)
            for (s[2] = 0; s[2] < N; s[2]++)
                for (s[3] = 0; s[3] < N; s[3]++)
                    for (s[4] = 0; s[4] < N; s[4]++)
                        for (const e of candidates) {
                            let hit = true;
                            for (let i = 1; i < 5 && hit; i++) if (e.line[i] !== ANY && e.line[i] !== s[i]) hit = false;
                            if (hit) { owner[s[0] + s[1] * POW[1] + s[2] * POW[2] + s[3] * POW[3] + s[4] * POW[4]] = e.owner; break; }
                        }
    }
    return owner;
}

const owner = buildLineLookup(buildPayTable());
const key = (...s) => s.reduce((k, v, i) => k + id.get(v) * POW[i], 0);
const payOf = (...s) => { const o = owner[key(...s)]; return o < 0 ? 0 : cfg.payLines[o].pay; };

// --- self-check: the lookup must agree with the config read by hand ---------
assert.equal(payOf('Wick', 'Wick', 'Wick', 'Wick', 'Wick'), cfg.payLines[0].pay, '5x Wick');
assert.equal(payOf('Wick', 'Wick', 'Wick', 'Wick', 'Q'), cfg.payLines[1].pay, '4x Wick');
assert.equal(payOf('Wick', 'Wick', 'Wick', 'Q', 'A'), cfg.payLines[2].pay, '3x Wick');
assert.equal(payOf('Wick', 'Wild', 'Wick', 'Wick', 'Wick'), cfg.payLines[0].pay, 'wild substitutes mid-line');
assert.equal(payOf('Wild', 'Wick', 'Wick', 'Wick', 'Wick'), 0, 'useWildInFirstPosition: false');
assert.equal(payOf('Wick', 'Wick', 'Q', 'A', 'J'), 0, 'two of a kind pays nothing');
assert.equal(payOf('Shen', 'Shen', 'Shen', 'Shen', 'Shen'), cfg.payLines[3].pay, '5x Shen');

/** Expected number of lines per spin that pay through each base payline. */
function countLines() {
    const strips = cfg.reels.map((r) => r.symbolImages.map((n) => id.get(n)));
    const rows = cfg.reels.map((r) => r.windowsCount);
    const scatterId = id.get(cfg.scatter);
    const jackpotId = id.get(cfg.jackpot.symbolName);
    const scatterRule = cfg.scatterPayTable.find((r) => r.scattersCount > 0);
    const windows = strips.map((strip, r) =>
        strip.map((_, pos) => Array.from({ length: rows[r] }, (_, row) => strip[(pos + row) % strip.length])));

    const counts = new Float64Array(cfg.payLines.length);
    let combos = 0, scatterHits = 0, jackpotHits = 0;
    const [w0s, w1s, w2s, w3s, w4s] = windows;
    for (const w0 of w0s) for (const w1 of w1s) for (const w2 of w2s) for (const w3 of w3s) for (const w4 of w4s) {
        combos++;
        let sc = 0, jp = 0;
        for (const w of [w0, w1, w2, w3, w4]) for (const s of w) { if (s === scatterId) sc++; else if (s === jackpotId) jp++; }
        if (sc === scatterRule.scattersCount) scatterHits++;   // WinController uses == not >=
        if (jp === cfg.jackpot.symbolsCount) jackpotHits++;
        for (const a of w0) for (const b of w1) {
            const k1 = a + b * POW[1];
            for (const c of w2) {
                const k2 = k1 + c * POW[2];
                for (const d of w3) {
                    const k3 = k2 + d * POW[3];
                    for (const e of w4) { const o = owner[k3 + e * POW[4]]; if (o >= 0) counts[o]++; }
                }
            }
        }
    }
    const lineCount = rows.reduce((a, b) => a * b, 1);
    return { counts, combos, lineCount, pScatter: scatterHits / combos, pJackpot: jackpotHits / combos, freeSpins: scatterRule.freeSpins };
}

// --stops "4,8,1,7,3;0,1,0,10,5" : total line pay per stop combination, so the
// model can be diffed against the live game and against the PHP that settles it.
// Runs before the exhaustive count, which a cross-check does not need.
if (process.argv.includes('--stops')) {
    const arg = process.argv[process.argv.indexOf('--stops') + 1] || '';
    for (const combo of arg.split(';').filter(Boolean)) {
        const pos = combo.split(',').map(Number);
        const win = cfg.reels.map((r, i) => {
            const strip = r.symbolImages.map((n) => id.get(n));
            return Array.from({ length: r.windowsCount }, (_, row) => strip[(pos[i] + row) % strip.length]);
        });
        let total = 0;
        let lines = 0;
        for (const a of win[0]) for (const b of win[1]) for (const c of win[2]) for (const d of win[3]) for (const e of win[4]) {
            const o = owner[a + b * POW[1] + c * POW[2] + d * POW[3] + e * POW[4]];
            if (o >= 0) { total += cfg.payLines[o].pay; lines++; }
        }
        console.log(`  stops ${pos.join(',')} -> line pay ${total} from ${lines} winning lines`);
    }
    process.exit(0);
}

const st = countLines();
// a free spin costs nothing and can retrigger: 1/(1 - f*p) paid spins worth of play
const chain = 1 / (1 - st.freeSpins * st.pScatter);

// The jackpot pays a flat coin pot, so unlike a line win it does NOT scale with
// lineBet - its share of RTP is largest at lineBet 1. Tune for that worst case
// and the house keeps a shade more at every higher stake.
// It is only a fixed term because increaseValue is 0; a pot that grows needs a
// funded contribution or the RTP starts depending on how long since the last hit.
const jackpotTerm = (lineBet) => st.pJackpot * cfg.jackpot.defaultAmount / (st.lineCount * lineBet);
const rtpOf = (pays, lineBet = 1) =>
    (pays.reduce((sum, p, j) => sum + p * st.counts[j], 0) / (st.combos * st.lineCount) + jackpotTerm(lineBet)) * chain;

const current = cfg.payLines.map((p) => p.pay);
const rtp = rtpOf(current);
const pct = (x) => (x * 100).toFixed(2) + '%';
console.log(`  stop combos       ${st.combos.toLocaleString()} (exhaustive), lines ${st.lineCount}`);
console.log(`  scatter ${st.freeSpins} free spins  p=${pct(st.pScatter)} -> x${chain.toFixed(4)} play`);
console.log(`  total RTP         ${rtp.toFixed(4)}   house ${pct(1 - rtp)}`);
console.log(`  jackpot (${cfg.jackpot.symbolsCount} symbols) p=${st.pJackpot.toExponential(2)} pot ${cfg.jackpot.defaultAmount} -> +${(jackpotTerm(1) * 100).toFixed(2)}pp at lineBet 1, +${(jackpotTerm(20) * 100).toFixed(2)}pp at 20`);
console.log(`  RTP at lineBet 20 ${rtpOf(current, 20).toFixed(4)}   house ${pct(1 - rtpOf(current, 20))}`);
if (cfg.jackpot.increaseValue !== 0) {
    console.log(`  WARNING jackpot.increaseValue is ${cfg.jackpot.increaseValue}; a growing pot is not in this RTP`);
}

if (process.argv.includes('--json')) {
    const out = join(root, 'tools/gold-egypt-model.json');
    writeFileSync(out, JSON.stringify({
        generatedBy: 'tools/gold-egypt-rtp.mjs --json',
        rtp: Number(rtp.toFixed(4)),
        symbols: cfg.symbols.map((s) => ({ name: s.name, useWildSubstitute: !!s.useWildSubstitute })),
        wild: cfg.wild,
        useWild: cfg.useWild,
        useWildInFirstPosition: cfg.useWildInFirstPosition,
        useLineBetMultiplier: cfg.useLineBetMultiplier,
        lineBetMaxValue: cfg.lineBetMaxValue,
        payLines: cfg.payLines.map((p) => ({ line: p.line, pay: p.pay })),
        reels: cfg.reels.map((r) => ({ symbolImages: r.symbolImages, windowsCount: r.windowsCount })),
        scatter: cfg.scatter,
        scatterPayTable: cfg.scatterPayTable,
        jackpot: cfg.jackpot,
    }, null, 1));
    console.log(`  wrote ${out}`);
}

if (process.argv.includes('--tune')) {
    // keep the paytable's shape, scale it until integer pays land on 70%
    let best = null;
    for (let k = 0.1; k < 40; k += 0.0001) {
        const pays = current.map((p) => Math.max(1, Math.round(p * k)));
        const off = Math.abs(rtpOf(pays) - TARGET_RTP);
        if (!best || off < best.off) best = { k, pays, off, rtp: rtpOf(pays) };
    }
    console.log(`\n  best scale x${best.k.toFixed(4)} -> RTP ${best.rtp.toFixed(4)} (house ${pct(1 - best.rtp)}), off by ${(best.off * 100).toFixed(3)} pp`);
    cfg.payLines.forEach((pl, j) => {
        console.log(`    ${String(pl.line.join(',')).padEnd(34)} pay ${String(current[j]).padStart(3)} -> ${best.pays[j]}`);
    });
}

if (process.argv.includes('--check')) {
    if (Math.abs(rtp - TARGET_RTP) > TOLERANCE) {
        console.log(`\nFAIL gold-egypt: RTP ${rtp.toFixed(4)}, want ${TARGET_RTP} +-${TOLERANCE} (house must keep ${HOUSE_PCT}%)`);
        process.exit(1);
    }
    console.log(`\ngold-egypt house edge OK — ${pct(1 - rtp)} kept`);
}
