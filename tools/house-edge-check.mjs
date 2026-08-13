/**
 * Chicken Road house-edge check — imports the game's own math.js, so it fails
 * the moment someone retunes GAME_MODES away from a 30% margin.
 * Run: node tools/house-edge-check.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GAME_MODES, calculateMultiplierForIndex, initPRNG, getRNG } from '../Chicken-Road/Main/js/math.js';

const HOUSE_PCT = 30;
const TARGET_RTP = (100 - HOUSE_PCT) / 100;

/** Same survival curve the game uses in checkIsCrashLane(). */
const survivalAt = (mode, step) => Math.max(0.05, mode.baseSurvival - step * mode.decay);

let worst = 0;
for (const [name, mode] of Object.entries(GAME_MODES)) {
  let reach = 1;
  const evs = [];
  for (let k = 1; k <= mode.maxSteps; k++) {
    reach *= survivalAt(mode, k);
    const mult = parseFloat(calculateMultiplierForIndex(k, name));
    evs.push(reach * mult);
  }
  const lo = Math.min(...evs), hi = Math.max(...evs);
  worst = Math.max(worst, Math.abs(hi - TARGET_RTP), Math.abs(lo - TARGET_RTP));
  assert.ok(lo >= TARGET_RTP - 0.005, `${name}: cash-out at some depth returns only ${lo.toFixed(4)}`);
  assert.ok(hi <= TARGET_RTP + 0.005, `${name}: cash-out at some depth returns ${hi.toFixed(4)} — house keeps < ${HOUSE_PCT}%`);
  console.log(`  ${name.padEnd(9)} steps 1..${String(mode.maxSteps).padEnd(2)}  return ${lo.toFixed(4)}..${hi.toFixed(4)}  (target ${TARGET_RTP})  first mult ${calculateMultiplierForIndex(1, name)}`);
}

// Monte Carlo on the real RNG path: everyone targets step 5, stake 100.
const TARGET_STEP = 5, ROUNDS = 200000, STAKE = 100;
initPRNG('SRV_check', 'CLIENT_check', 1);
let staked = 0, paid = 0;
for (let r = 0; r < ROUNDS; r++) {
  staked += STAKE;
  const mode = GAME_MODES.medium;
  let alive = true;
  for (let k = 1; k <= TARGET_STEP && alive; k++) {
    if (getRNG() > survivalAt(mode, k)) alive = false;
  }
  if (alive) paid += STAKE * parseFloat(calculateMultiplierForIndex(TARGET_STEP, 'medium'));
}
const rtp = paid / staked;
console.log(`  monte carlo (medium, cash out at step ${TARGET_STEP}, ${ROUNDS} rounds): RTP ${rtp.toFixed(4)}, house ${((1 - rtp) * 100).toFixed(1)}%`);
assert.ok(Math.abs(rtp - TARGET_RTP) < 0.02, `monte carlo RTP ${rtp} is not ~${TARGET_RTP}`);

// the server pays out, the client only displays: a drift between the two is a bug
// players would see as "it said 1.55x but paid 1.52x". Diff the whole ladder.
const dump = execFileSync('php', [fileURLToPath(new URL('road-house-edge.php', import.meta.url)), '--dump'], { encoding: 'utf8' });
let compared = 0;
for (const row of dump.trim().split(/\r?\n/)) {
  const [mode, step, mult] = row.split(' ');
  const js = parseFloat(calculateMultiplierForIndex(Number(step), mode)).toFixed(2);
  assert.equal(mult, js, `${mode} step ${step}: server pays ${mult}x, client shows ${js}x`);
  compared++;
}
console.log(`  server RoadGame.php matches math.js on all ${compared} rungs`);

console.log(`chicken-road house edge OK — worst deviation ${(worst * 100).toFixed(2)} pp`);
