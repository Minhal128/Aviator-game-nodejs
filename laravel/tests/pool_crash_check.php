<?php
/**
 * Full pool-crash scenario self-check.
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

// --- basic math ---
assert(pool(770) === 539.0);
assert(remaining(539, 510) === 29.0);
assert(should_crash(10, 5.1, 29.0) === true);
assert(should_crash(10, 5.0, 539.0) === false);
assert(admin_credit(770, 510) === 260.0);

// --- toast bug: never /80 ---
$toast = 1000 * 5.71;
assert(abs($toast - 5710.0) < 0.001);
assert(abs(($toast / 80) - 71.375) < 0.001); // old wrong value

// --- solo 1000: crash ~0.7x ---
$soloPool = pool(1000);
assert($soloPool === 700.0);
assert(should_crash(1000, 0.70, $soloPool) === false); // 700 <= 700
assert(should_crash(1000, 0.71, $soloPool) === true);  // 710 > 700
assert(can_cashout(1000, 0.70, $soloPool) === true);
assert(can_cashout(1000, 0.71, $soloPool) === false);

// --- TEST SCENARIO: 100 + 670 ---
$total = 100 + 670;
$p = pool($total);
assert($total === 770);
assert($p === 539.0);

// at 2.56x before any cashout: min=100 → 256 <= 539, no crash
assert(should_crash(100, 2.56, $p) === false);
assert(can_cashout(100, 2.56, $p) === true);   // 256 <= 539
assert(can_cashout(670, 2.56, $p) === false);  // 1715.2 > 539 → would silent-crash if clicked

// cashout 100 @ 2.56 → pay 256, remain 283
$paid = 256.0;
$rem = remaining($p, $paid);
assert($rem === 283.0);
// remaining active min=670 → must crash
assert(should_crash(670, 2.56, $rem) === true);
assert(admin_credit($total, $paid) === 514.0); // 770-256

// cashout 100 @ 2.00 → pay 200, remain 339, still crash (670*2=1340>339)
$paid2 = 200.0;
$rem2 = remaining($p, $paid2);
assert($rem2 === 339.0);
assert(should_crash(670, 2.00, $rem2) === true);
assert(can_cashout(100, 2.00, $p) === true);

// at 5.1x: 100 can cash (510<=539), then remain 29, crash
assert(can_cashout(100, 5.1, $p) === true);
assert(should_crash(100, 5.1, $p) === false); // min still 100, 510<=539
$rem3 = remaining($p, 510);
assert($rem3 === 29.0);
assert(should_crash(670, 5.1, $rem3) === true);

// pool sync: if state wrongly had only 100 (pool 70), sync to 770 fixes cashout
$wrongPool = pool(100);
assert($wrongPool === 70.0);
assert(can_cashout(100, 2.56, $wrongPool) === false); // bug case
$fixed = pool(770);
assert(can_cashout(100, 2.56, $fixed) === true);

echo "pool_crash_check OK — all scenarios passed\n";
