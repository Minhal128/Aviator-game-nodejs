<?php
/**
 * Self-check: pool crash rules (no Laravel boot).
 * Run: php laravel/tests/pool_crash_check.php
 */
function remaining_pool(float $total, float $paid, float $housePct = 30.0): float
{
    $pool = round($total * (100.0 - $housePct) / 100.0, 2);
    return round(max(0, $pool - $paid), 2);
}

function should_crash(float $minActiveBet, float $mult, float $remaining): bool
{
    return round($minActiveBet * $mult, 2) > $remaining;
}

function admin_credit(float $total, float $paid): float
{
    return round(max(0, $total - $paid), 2);
}

// Example: total 770, pool 539
assert(remaining_pool(770, 0) === 539.0);
assert(remaining_pool(770, 510) === 29.0);

// After user4 cashout 510 @ 5.1x, min remaining bet 10 → crash
assert(should_crash(10, 5.1, 29.0) === true);

// Before that cashout, at 5.0x with full pool, min 10 can still cash (50 <= 539)
assert(should_crash(10, 5.0, 539.0) === false);

// Nobody cashed: crash when min_bet * m > pool (10 * 53.9 = 539, not yet; 54.0 >)
assert(should_crash(10, 53.9, 539.0) === false);
assert(should_crash(10, 54.0, 539.0) === true);

// Admin money: 770 - 510 = 260 (NOT 930)
assert(admin_credit(770, 510) === 260.0);

echo "pool_crash_check OK\n";
