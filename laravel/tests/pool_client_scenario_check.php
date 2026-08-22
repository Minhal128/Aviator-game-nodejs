<?php
/**
 * Client Aviator pool rule at 5% house (was 30% → pool 700).
 *
 * Bets 10+20+25+30+50+65+100+200+500 = 1000
 * Pool = 95% = 950
 * Cashout 50@2.5 = 125, 200@2.7 = 540, paid 665 <= 950
 * Remain 285. Anyone whose bet×2.7 > 285 loses; plane crashes when
 * min(active)×mult > remaining.
 *
 * Run: php laravel/tests/pool_client_scenario_check.php
 */
require_once __DIR__ . '/../app/Services/PoolCrashEngine.php';

use App\Services\PoolCrashEngine;

$bets = [10, 20, 25, 30, 50, 65, 100, 200, 500];
assert(array_sum($bets) === 1000);

$pool = PoolCrashEngine::poolFromTotal(1000);
assert($pool === 950.0, '1000 at 5% house → 950 pool (old 30% was 700)');

$paid = 0.0;
assert(round(50 * 2.5, 2) === 125.0);
$paid += 125.0;
assert(round(200 * 2.7, 2) === 540.0);
$paid += 540.0;
assert($paid === 665.0);
assert($paid <= $pool);

$remain = round($pool - $paid, 2);
assert($remain === 285.0);

$left = [10, 20, 25, 30, 65, 100, 500];
$mult = 2.7;
$stillIn = [];
$lost = [];
foreach ($left as $b) {
    if (round($b * $mult, 2) > $remain) {
        $lost[] = $b;
    } else {
        $stillIn[] = $b;
    }
}
assert($lost === [500], '500×2.7=1350 > 285 → that bet loses');
assert($stillIn === [10, 20, 25, 30, 65, 100]);

$min = min($stillIn);
assert(round($min * $mult, 2) <= $remain, '10×2.7 still fits — plane keeps flying');
assert(round($min * 28.6, 2) > $remain, 'crash once min×mult blows past remaining pool');

echo "pool_client_scenario_check OK\n";
echo "  1000 bets → pool 950 (5%); 125+540=665 paid; remain 285; 500 loses; others ride until pool empty\n";
