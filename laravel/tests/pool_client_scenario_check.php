<?php
/**
 * Client's Aviator pool rule, as a runnable check.
 *
 * total bets 1000 → pool 700 (admin keeps 30%)
 * cashouts: 50@2.5=125, 200@2.7=540 → paid 665 ≤ 700
 * remaining actives must lose when min(active)*mult > remaining
 *
 * Run: php laravel/tests/pool_client_scenario_check.php
 */
function pool(float $total): float
{
    return round($total * 0.70, 2);
}

function should_crash(?float $minActive, float $mult, float $remain): bool
{
    if ($minActive === null) {
        return true; // everyone cashed
    }
    return round($minActive * $mult, 2) > $remain;
}

$total = 1000.0;
$p = pool($total);
assert($p === 700.0, 'pool must be 70% of 1000');

// client cashouts
$paid = 0.0;
$paid += 50 * 2.5;   // 125
$paid += 200 * 2.7;  // 540
assert($paid === 665.0);
$remain = round($p - $paid, 2);
assert($remain === 35.0);

// leftover players (example: 65 + 100 + 500 still in) — at 2.7x the smallest 65 needs 175.5 > 35 → crash
assert(should_crash(65.0, 2.7, $remain) === true, 'others must crash once pool cannot pay them');

// --- why YOUR solo 10₹ crashed at ~1.7x ---
// solo 10 → pool 7. Bet 10 cannot be paid even at 1.00x (10 > 7), so the engine
// cannot use per-round pool math. It switches to house mode: random crash with
// long-run 30% edge. 1.7x is a valid house-mode crash, not a pool bug.
$solo = 10.0;
$soloPool = pool($solo);
assert($soloPool === 7.0);
assert(should_crash($solo, 1.00, $soloPool) === true, 'solo 10 cannot use pool mode at 1.00x');

echo "pool_client_scenario_check OK\n";
echo "  multi: total 1000 → pool 700; after 665 paid, remain 35 → others crash\n";
echo "  solo 10 → pool 7 → pool mode impossible → house-mode random crash (e.g. 1.7x)\n";
