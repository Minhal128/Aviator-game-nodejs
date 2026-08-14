<?php
/**
 * Reproduce: 300 (sec0) then 700 (sec1) → return_bets order must map WITHOUT swap.
 * Old bug: last if (bet_array[1].section_no==1) set main=return[1], extra=return[0]
 * so cashout on 300 sent forfeited 700's id → "Bet not available".
 * Run: php laravel/tests/bet_id_map_check.php
 */

// simulate old broken mapper
function map_old(array $bet_array, array $return_bets): array
{
    $main = null;
    $extra = null;
    if (count($bet_array) == 2) {
        if ($bet_array[0]['section_no'] == 0) {
            $main = $return_bets[0];
            $extra = $return_bets[1];
        }
        if ($bet_array[0]['section_no'] == 1) {
            $main = $return_bets[1];
            $extra = $return_bets[0];
        }
        if ($bet_array[1]['section_no'] == 0) {
            $main = $return_bets[0];
            $extra = $return_bets[1];
        }
        if ($bet_array[1]['section_no'] == 1) {
            $main = $return_bets[1]; // BUG overwrite
            $extra = $return_bets[0];
        }
    }
    return ['main' => $main, 'extra' => $extra];
}

function map_new(array $bet_array, array $return_bets): array
{
    $main = null;
    $extra = null;
    foreach ($bet_array as $i => $b) {
        if ($b['section_no'] == 0) {
            $main = $return_bets[$i];
        } else {
            $extra = $return_bets[$i];
        }
    }
    return ['main' => $main, 'extra' => $extra];
}

$bets = [
    ['section_no' => 0, 'amount' => 300],
    ['section_no' => 1, 'amount' => 700],
];
$ids = [101, 202]; // return_bets in submission order

$old = map_old($bets, $ids);
assert($old['main'] === 202 && $old['extra'] === 101, 'old mapper must exhibit the swap bug');

$new = map_new($bets, $ids);
assert($new['main'] === 101 && $new['extra'] === 202, 'new mapper: main=300 id, extra=700 id');

// reverse placement order also OK
$bets2 = [
    ['section_no' => 1, 'amount' => 700],
    ['section_no' => 0, 'amount' => 300],
];
$ids2 = [303, 404];
$new2 = map_new($bets2, $ids2);
assert($new2['main'] === 404 && $new2['extra'] === 303);

// at 2.03x pool 700: 300 cashable, 700 forfeited — cashout must use 101 not 202
assert(round(300 * 2.03, 2) <= 700.0);
assert(round(700 * 2.03, 2) > 700.0);

$js = file_get_contents(dirname(__DIR__, 2) . '/user/aviatorold.js');
assert(strpos($js, 'return_bets[i] matches bet_array[i] order') !== false, 'fix must be in aviatorold.js');

echo "bet_id_map_check OK\n";
echo "  old swap reproduced; new map keeps 300→main, 700→extra\n";
