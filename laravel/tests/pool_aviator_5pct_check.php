<?php
/**
 * User scenario: total bets 1000, house margin 5% → pool 950.
 * Cashouts 50@2.5 + 200@2.7 = 665 fit; plane flies until pool can't pay.
 * Run: php laravel/tests/pool_aviator_5pct_check.php
 */
function pool(float $t, float $housePct = 5.0): float
{
    return round($t * (100.0 - $housePct) / 100.0, 2);
}

function can(float $bet, float $mult, float $rem): bool
{
    return round($bet * $mult, 2) <= $rem;
}

$p = pool(1000);
assert($p === 950.0, '1000 bets → 950 pool at 5% house');

$paid = 0.0;
assert(can(50, 2.5, $p - $paid) === true);   // 125
$paid += 125.0;
assert(can(200, 2.7, $p - $paid) === true);  // 540
$paid += 540.0;
assert($paid === 665.0);
assert(($p - $paid) === 285.0);              // remaining for others

// a 500 bet cannot cash at 1.00x once remaining is 285
assert(can(500, 1.0, $p - $paid) === false);

// old 30% house was pool 700 — still the prior formula
assert(pool(1000, 30.0) === 700.0);

echo "pool_aviator_5pct_check: ok\n";
