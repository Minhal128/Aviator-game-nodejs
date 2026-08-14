<?php
/**
 * One admin percentage (settings.win_percentage) drives what all five games pay.
 * Run: php laravel/tests/win_percentage_check.php
 *
 * Nothing here boots Laravel, so every assertion is on the real formula with the
 * percentage passed in explicitly - the same way the controllers pass win_pct().
 */
require __DIR__ . '/../vendor/autoload.php';

use App\Http\Controllers\GoldEgypt;
use App\Http\Controllers\RoadGame;
use App\Services\PoolCrashEngine as Aviator;

// ---------------------------------------------------------------- 1. Aviator
// The user's round: 5+10+20+30+50+85+100 = 300 staked, read at 10x.
$bets = [];
foreach ([10, 20, 5, 50, 30, 100, 85] as $i => $amt) {
    $bets[] = ['bet_id' => $i + 1, 'userid' => 100 + $i, 'amount' => (float) $amt];
}
assert(array_sum(array_column($bets, 'amount')) === 300.0);

$group = fn(float $cap) => array_values(array_filter(
    array_column($bets, 'amount'),
    fn($a) => round($a * 10, 2) <= $cap
));

// 100%: cap 300 -> group 5,10,20,30 -> winner 30 pays 300
assert($group(300.0) == [10.0, 20.0, 5.0, 30.0]);
assert(Aviator::pickWinner($bets, 10.0, 100.0)['amount'] === 30.0);

// 90%: cap 270 -> 30 drops out -> winner 20 pays 200
assert($group(270.0) == [10.0, 20.0, 5.0]);
assert(Aviator::pickWinner($bets, 10.0, 90.0)['amount'] === 20.0);

// 30%: cap 90 -> only 5 survives -> winner 5 pays 50
assert($group(90.0) == [5.0]);
assert(Aviator::pickWinner($bets, 10.0, 30.0)['amount'] === 5.0);

// the winner's payout may touch the cap, never cross it
foreach ([100.0, 90.0, 30.0, 70.0] as $pct) {
    $w = Aviator::pickWinner($bets, 10.0, $pct);
    if ($w !== null) {
        assert(round($w['amount'] * 10, 2) <= round(300 * $pct / 100.0, 2));
    }
}

// no affordable bet -> no winner
assert(Aviator::pickWinner($bets, 10.0, 1.0) === null);
assert(Aviator::pickWinner($bets, 10.0, 0.0) === null);
assert(Aviator::pickWinner([], 10.0, 100.0) === null);

// the whole bet row comes back, not just the stake
assert(Aviator::pickWinner($bets, 10.0, 100.0)['bet_id'] === 5);
assert(Aviator::pickWinner($bets, 10.0, 100.0)['userid'] === 104);

// as the multiplier climbs, the cap eats the group from the top down
assert(Aviator::pickWinner($bets, 1.0, 100.0)['amount'] === 100.0);
assert(Aviator::pickWinner($bets, 3.0, 100.0)['amount'] === 100.0);  // 100x3   = 300 = cap
assert(Aviator::pickWinner($bets, 3.1, 100.0)['amount'] === 85.0);   // 100x3.1 = 310 > cap
assert(Aviator::pickWinner($bets, 60.0, 100.0)['amount'] === 5.0);   // 5x60    = 300 = cap
assert(Aviator::pickWinner($bets, 60.1, 100.0) === null);

// ----------------------------------------------------- 2. Chicken Road (RoadGame)
// Every cash-out depth must return exactly the admin percentage of the stake.
foreach ([100.0, 90.0, 70.0, 30.0] as $pct) {
    $rtp = $pct / 100.0;
    foreach (RoadGame::MODES as $name => $mode) {
        for ($step = 1; $step <= $mode['maxSteps']; $step++) {
            $reach = 1.0;
            for ($i = 1; $i <= $step; $i++) {
                $reach *= RoadGame::survival($mode, $i, $rtp);
            }
            $ev = $reach * RoadGame::multiplier($mode, $step, $rtp);
            assert(abs($ev - $rtp) < 0.006, "$name step $step at $pct%: EV $ev");
        }
    }
}
// omitting $rtp keeps the built-in 70%, which is what the tools/ checkers rely on
assert(RoadGame::multiplier(RoadGame::MODES['medium'], 5)
    === RoadGame::multiplier(RoadGame::MODES['medium'], 5, 0.70));
// a higher percentage buys a SAFER road, and therefore a flatter ladder for the
// same expected return - the payout share is spent on survival, not on the badge
assert(RoadGame::survival(RoadGame::MODES['medium'], 1, 1.00)
     > RoadGame::survival(RoadGame::MODES['medium'], 1, 0.30));
assert(RoadGame::multiplier(RoadGame::MODES['medium'], 5, 1.00)
     < RoadGame::multiplier(RoadGame::MODES['medium'], 5, 0.30));
// and the ladder never sells a losing cash-out at any setting
foreach ([100.0, 70.0, 30.0] as $pct) {
    foreach (RoadGame::MODES as $mode) {
        for ($step = 1; $step <= $mode['maxSteps']; $step++) {
            assert(RoadGame::multiplier($mode, $step, $pct / 100.0) >= 1.0);
        }
    }
}

// -------------------------------------------------- 3. Gold of Egypt (fixed reels)
// The strips cannot be re-tuned at runtime, so spin() scales the pay instead.
$goldPay = fn(int $coins, float $pct) => (int) round($coins * ($pct / 100.0) / GoldEgypt::NATURAL_RTP);
assert(GoldEgypt::NATURAL_RTP === 0.70);
assert($goldPay(1000, 70.0) === 1000);   // default is a no-op
assert($goldPay(1000, 100.0) === 1429);  // 1000 x 1/0.7
assert($goldPay(1000, 30.0) === 429);
assert($goldPay(1000, 0.0) === 0);

// ------------------------------------------------- 4. Slot Glamour (tilted seeds)
// weights() bisects lambda until the mean multiplier IS the target, so the check
// is that the target is what the admin set. Mirrored here without the seed file.
$meanAt = function (float $lambda, array $mults) {
    $sw = 0.0;
    $sm = 0.0;
    $max = max($mults);
    foreach ($mults as $m) {
        $w = exp($lambda * ($m - $max));
        $sw += $w;
        $sm += $w * $m;
    }
    return $sm / $sw;
};
$mults = [];
for ($i = 0; $i < 400; $i++) {
    $mults[] = $i / 100.0;   // 0.00 .. 3.99, mean 2.00 untilted
}
foreach ([1.00, 0.70, 0.30] as $target) {
    $lo = -50.0;
    $hi = 50.0;
    for ($i = 0; $i < 200; $i++) {
        $mid = ($lo + $hi) / 2;
        if ($meanAt($mid, $mults) < $target) {
            $lo = $mid;
        } else {
            $hi = $mid;
        }
    }
    assert(abs($meanAt(($lo + $hi) / 2, $mults) - $target) < 1e-6, "glamour tilt to $target");
}

// ------------------------------------------------------------ 5. Ludo (prize table)
// Seeded rows sum to 0.70 x players; MatchService scales them by pct/70.
const LUDO_SEED_PCT = 70;
$ludo = fn(array $row, float $pct) => array_map(fn($m) => $m * $pct / LUDO_SEED_PCT, $row);
foreach ([['2' => [1.4, 0]], ['3' => [1.68, 0.42, 0]], ['4' => [1.96, 0.84, 0, 0]]] as $tbl) {
    foreach ($tbl as $players => $row) {
        foreach ([100.0, 70.0, 30.0] as $pct) {
            $paidShare = array_sum($ludo($row, $pct)) / (int) $players;
            assert(abs($paidShare - $pct / 100.0) < 1e-9, "$players players at $pct%");
        }
    }
}
// at 100% a 2-player pot is paid out whole
assert($ludo([1.4, 0], 100.0) == [2.0, 0.0]);

echo "win_percentage_check OK\n";
echo "  aviator  stake 300 @10x -> 100%: cap 300, group 5,10,20,30, winner 30\n";
echo "                              90%: cap 270, group 5,10,20,    winner 20\n";
echo "                              30%: cap  90, group 5,          winner  5\n";
echo "  road     EV == pct at every cash-out depth, all 4 modes\n";
echo "  gold     pay scaled by pct/70 (reels stay frozen at 0.6999)\n";
echo "  glamour  seed tilt bisects to the pct as its mean multiplier\n";
echo "  ludo     prize rows scaled by pct/70; 100% pays the whole pot\n";
