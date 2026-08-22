<?php
/**
 * Full pool-crash scenario self-check.
 * Scenario blocks keep housePct=30 (historical). Engine HOUSE_PCT is now 5%.
 * Run: php laravel/tests/pool_crash_check.php
 */
function pool(float $total, float $housePct = 30.0): float
{
    return round($total * (100.0 - $housePct) / 100.0, 2);
}

function remaining(float $pool, float $paid): float
{
    return round(max(0, $pool - $paid), 2);
}

function should_crash(float $minActive, float $mult, float $remain): bool
{
    return round($minActive * $mult, 2) > $remain;
}

function can_cashout(float $bet, float $mult, float $remain): bool
{
    return round($bet * $mult, 2) <= $remain;
}

function admin_credit(float $total, float $paid): float
{
    return round(max(0, $total - $paid), 2);
}

// --- basic math (30% house scenarios) ---
assert(pool(770, 30) === 539.0);
assert(remaining(539, 510) === 29.0);
assert(should_crash(10, 5.1, 29.0) === true);
assert(should_crash(10, 5.0, 539.0) === false);
assert(admin_credit(770, 510) === 260.0);

$toast = 1000 * 5.71;
assert(abs($toast - 5710.0) < 0.001);

$soloPool = pool(1000, 30);
assert($soloPool === 700.0);
assert(should_crash(1000, 0.70, $soloPool) === false);
assert(should_crash(1000, 0.71, $soloPool) === true);

$total = 100 + 670;
$p = pool($total, 30);
assert($p === 539.0);
assert(should_crash(100, 2.56, $p) === false);
assert(can_cashout(100, 2.56, $p) === true);
assert(can_cashout(670, 2.56, $p) === false);

$paid = 256.0;
$rem = remaining($p, $paid);
assert($rem === 283.0);
assert(should_crash(670, 2.56, $rem) === true);

$pool378 = pool(1670, 30);
assert($pool378 === 1169.0);
assert(should_crash(1000, 1.17, $pool378) === true);
assert(should_crash(670, 1.17, $pool378) === false);

require_once __DIR__ . '/../app/Services/PoolCrashEngine.php';
$engine = 'App\Services\PoolCrashEngine';

assert($engine::HOUSE_PCT === 5.0, 'engine house margin is 5%');
assert($engine::poolFromTotal(1000) === 950.0);

$t2 = log(2.0) / $engine::GROWTH_PER_MS;
assert($t2 > 5000 && $t2 < 9000, "2x should land ~7s, got {$t2}ms");

assert($engine::usePoolMode(null, 700.0) === false);
assert($engine::usePoolMode(10.0, pool(20, 30)) === false);
assert($engine::usePoolMode(100.0, pool(770, 30)) === true);
assert($engine::usePoolMode(10.0, 30.0) === true);
assert($engine::usePoolMode(10.0, 29.99) === false);

// 5% house → ~95% RTP on house-mode crash curve
$rounds = 200000;
$target = 2.0;
$paidTotal = 0.0;
$bust = 0;
$maxSeen = 0.0;
$rtpTarget = (100.0 - $engine::HOUSE_PCT) / 100.0;
for ($i = 0; $i < $rounds; $i++) {
    $c = $engine::houseCrashPoint($rtpTarget * 100.0);
    assert($c >= 1.0 && $c <= $engine::MAX_MULT);
    $maxSeen = max($maxSeen, $c);
    if ($c <= 1.0) {
        $bust++;
    }
    if ($c > $target) {
        $paidTotal += $target;
    }
}
$rtp = $paidTotal / $rounds;
assert(abs($rtp - $rtpTarget) < 0.02, "house RTP $rtp is not ~$rtpTarget");
assert(abs(($bust / $rounds) - (1.0 - $rtpTarget)) < 0.02, 'bust rate off');
printf("  house mode: RTP %.3f (target %.3f), bust@1.00x %.1f%%, max %.2fx\n", $rtp, $rtpTarget, 100 * $bust / $rounds, $maxSeen);

echo "pool_crash_check OK — all scenarios passed\n";
