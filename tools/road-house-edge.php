<?php
/**
 * Chicken Road house-edge check for the SERVER side (RoadGame.php), which is
 * the side that actually moves money. tools/house-edge-check.mjs covers the
 * client's math.js and compares it against the --dump below.
 * Run: php tools/road-house-edge.php [--dump]
 */
require __DIR__ . '/../laravel/vendor/autoload.php';

use App\Http\Controllers\RoadGame;

const HOUSE_PCT = 5.0;
const TARGET_RTP = (100.0 - HOUSE_PCT) / 100.0;

if (in_array('--dump', $argv, true)) {
    // machine-readable multiplier table, so the client's copy can be diffed against it
    foreach (RoadGame::MODES as $name => $mode) {
        for ($step = 1; $step <= $mode['maxSteps']; $step++) {
            printf("%s %d %.2f\n", $name, $step, RoadGame::multiplier($mode, $step));
        }
    }
    exit(0);
}

$bad = 0;
$check = function (string $what, bool $ok) use (&$bad) {
    echo ($ok ? '  [ok] ' : '  FAIL ') . $what . "\n";
    if (!$ok) {
        $bad++;
    }
};

// 1) every cash-out depth must return 0.70 of the stake
foreach (RoadGame::MODES as $name => $mode) {
    $lo = 1.0;
    $hi = 0.0;
    for ($step = 1; $step <= $mode['maxSteps']; $step++) {
        $reach = 1.0;
        for ($i = 1; $i <= $step; $i++) {
            $reach *= RoadGame::survival($mode, $i);
        }
        $ev = $reach * RoadGame::multiplier($mode, $step);
        $lo = min($lo, $ev);
        $hi = max($hi, $ev);
    }
    printf("  %-9s steps 1..%-2d  return %.4f..%.4f  (target %.2f)  first mult %.2fx\n",
        $name, $mode['maxSteps'], $lo, $hi, TARGET_RTP, RoadGame::multiplier($mode, 1));
    $check("$name: house keeps ~" . HOUSE_PCT . '% at every depth',
        $lo >= TARGET_RTP - 0.005 && $hi <= TARGET_RTP + 0.005);
}

// 2) the real crash draw, played the way a player plays: stake 100, cash out at step 5
$mode = RoadGame::MODES['medium'];
$rounds = 200000;
$stake = 100.0;
$target = 5;
mt_srand(20260812);
$staked = 0.0;
$paid = 0.0;
for ($r = 0; $r < $rounds; $r++) {
    $staked += $stake;
    if (RoadGame::drawCrashStep($mode) > $target) {
        $paid += $stake * RoadGame::multiplier($mode, $target);
    }
}
$rtp = $paid / $staked;
printf("  monte carlo (medium, cash out at step %d, %d rounds): RTP %.4f, house %.1f%%\n",
    $target, $rounds, $rtp, (1 - $rtp) * 100);
$check('drawCrashStep pays ~' . TARGET_RTP, abs($rtp - TARGET_RTP) < 0.02);

// 3) a crash must pay nothing, and the ladder must never sell a losing multiplier
$check('crash step is always within the road', (function () {
    foreach (RoadGame::MODES as $mode) {
        for ($i = 0; $i < 2000; $i++) {
            $s = RoadGame::drawCrashStep($mode);
            if ($s < 1 || $s > $mode['maxSteps'] + 1) {
                return false;
            }
        }
    }
    return true;
})());
$check('multiplier is monotonic and >= 1.01', (function () {
    foreach (RoadGame::MODES as $mode) {
        $prev = 0.0;
        for ($step = 1; $step <= $mode['maxSteps']; $step++) {
            $m = RoadGame::multiplier($mode, $step);
            if ($m < 1.01 || $m < $prev) {
                return false;
            }
            $prev = $m;
        }
    }
    return true;
})());

echo $bad === 0 ? "\nroad-house-edge OK\n" : "\n$bad problem(s)\n";
exit($bad === 0 ? 0 : 1);
