<?php
/**
 * Gold Egypt: cashout button + insufficient-balance guard present.
 * Run: php laravel/tests/gold_cashout_ui_check.php
 */
$js = file_get_contents(dirname(__DIR__, 2) . '/js/tl-gold-egypt.js');
assert($js !== false, 'missing tl-gold-egypt.js');
assert(str_contains($js, "id = 'tl-gold-cash'"), 'DOM cashout button');
assert(str_contains($js, 'function abortSpin'), 'abortSpin on refuse');
assert(str_contains($js, '__tlRunGuard'), 'runSlot balance guard');
assert(str_contains($js, '/game/gold/cashout'), 'cashout endpoint');

$pages = file_get_contents(dirname(__DIR__) . '/app/Http/Controllers/Pages.php');
assert(str_contains($pages, 'tl-gold-egypt.js?v=20260821-cash'), 'cache bust');

$road = file_get_contents(dirname(__DIR__) . '/app/Http/Controllers/RoadGame.php');
assert(str_contains($road, 'orphan round refund'), 'road refunds orphan stake');

$helper = file_get_contents(dirname(__DIR__) . '/app/Helper.php');
assert(str_contains($helper, "Schema::hasColumn('wallets', 'bonus')"), 'addwallet safe without bonus cols');

echo "gold_cashout_ui_check: ok\n";
