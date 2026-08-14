<?php
/**
 * User scenario: 300 + 700 = 1000 → pool 700
 * 300 can cash ~2.33x; 700 cannot above 1.00x
 * Run: php laravel/tests/pool_300_700_check.php
 */
function pool(float $t): float { return round($t * 0.70, 2); }
function can(float $b, float $m, float $r): bool { return round($b * $m, 2) <= $r; }
function need(float $b, float $m): float { return round($b * $m, 2); }

$p = pool(1000);
assert($p === 700.0);

assert(can(300, 2.33, $p) === true);   // 699 <= 700
assert(can(300, 2.34, $p) === false);  // 702 > 700
assert(can(700, 1.00, $p) === true);   // 700 <= 700
assert(can(700, 1.01, $p) === false);  // 707 > 700
assert(can(700, 1.70, $p) === false);  // must NOT pay

// forfeit payload shape (tick.forfeited[])
$sample = ['bet_id' => 1, 'section_no' => 1, 'userid' => 42, 'amount' => 700.0];
assert(isset($sample['bet_id'], $sample['section_no'], $sample['userid'], $sample['amount']));

// forfeit 700 at 1.01, 300 still flies
assert(need(300, 1.01) <= $p);

// cash 300 @ 2.33 then 700 cannot
$paid = need(300, 2.33);
$rem = round($p - $paid, 2);
assert($paid === 699.0);
assert($rem === 1.0);
assert(can(700, 1.00, $rem) === false);

echo "pool_300_700_check OK\n";
echo "  pool=700; 300 max~2.33x; 700 max=1.00x; 1.7x cashout of 700 REJECTED\n";
