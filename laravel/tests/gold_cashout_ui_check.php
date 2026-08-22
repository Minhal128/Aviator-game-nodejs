<?php
/**
 * Gold Egypt: native MAX BET + HTML cashout chip (mobile thumbs).
 * Run: php laravel/tests/gold_cashout_ui_check.php
 */
$js = file_get_contents(dirname(__DIR__, 2) . '/js/tl-gold-egypt.js');
assert($js !== false, 'missing tl-gold-egypt.js');
assert(str_contains($js, 'id = \'tl-gold-cash\''), 'HTML cashout for mobile thumbs');
assert(str_contains($js, 'tl-slot-cash'), 'tappable cash chip');
assert(!str_contains($js, 'mountCashBtn'), 'HTML mount removed');
assert(str_contains($js, "setText('CASHOUT')"), 'CASHOUT on MAX BET label');
assert(str_contains($js, '__tlCashAmt'), 'held amount on MAX BET line 2');
assert(str_contains($js, 'rebindClick(s.slotControls.slotMaxBetButton, doCashout)'), 'MAX BET → cashout');
assert(str_contains($js, 'setTimeout(attach, 100)'), 'mobile attach keeps retrying');
assert(!str_contains($js, 'tries < 400'), 'must not give up after 20s on mobile');
assert(str_contains($js, 'function abortSpin'), 'abortSpin on refuse');
assert(str_contains($js, '__tlRunGuard'), 'runSlot balance guard');
assert(str_contains($js, '/game/gold/cashout'), 'cashout endpoint');
assert(str_contains($js, 'applyWallet(res.data)'), 'balance paints on spin debit');

$pages = file_get_contents(dirname(__DIR__) . '/app/Http/Controllers/Pages.php');
assert(str_contains($pages, 'tl-gold-egypt.js?v=20260822-cashchip'), 'cache bust');

$glamour = file_get_contents(dirname(__DIR__, 2) . '/js/tl-c3-slot.js');
assert(!str_contains($glamour, 'tries < 400'), 'glamour must keep waiting on mobile');

$road = file_get_contents(dirname(__DIR__) . '/app/Http/Controllers/RoadGame.php');
assert(str_contains($road, 'orphan round refund'), 'road refunds orphan stake');

$helper = file_get_contents(dirname(__DIR__) . '/app/Helper.php');
assert(str_contains($helper, "Schema::hasColumn('wallets', 'bonus')"), 'addwallet safe without bonus cols');

echo "gold_cashout_ui_check: ok\n";
