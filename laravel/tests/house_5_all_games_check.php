<?php
/**
 * 5% house on every title + mobile cashout posts that credit the wallet.
 * Run: php laravel/tests/house_5_all_games_check.php
 */
$root = dirname(__DIR__, 2);
$h = file_get_contents($root . '/laravel/app/Helper.php');
assert(str_contains($h, 'return 95.0'), 'win_pct locked to 95 (5% house)');

$avi = file_get_contents($root . '/laravel/app/Services/PoolCrashEngine.php');
$road = file_get_contents($root . '/laravel/app/Http/Controllers/RoadGame.php');
$gold = file_get_contents($root . '/laravel/app/Http/Controllers/GoldEgypt.php');
$glam = file_get_contents($root . '/laravel/app/Http/Controllers/GlamourSpins.php');
assert(str_contains($avi, 'HOUSE_PCT = 5.0'), 'aviator 5%');
assert(str_contains($avi, 'poolFromTotal'), 'aviator pool = 95% of bets');
assert(str_contains($road, 'HOUSE_PCT = 5.0'), 'chicken 5%');
assert(str_contains($gold, '* 0.95 / self::NATURAL_RTP'), 'gold scaled to 95% RTP');
assert(str_contains($glam, 'TARGET_RTP = 0.95'), 'glamour 95%');
assert(str_contains($glam, 'draw(self::TARGET_RTP)'), 'glamour draw not admin pct');

$gjs = file_get_contents($root . '/js/tl-gold-egypt.js');
$c3 = file_get_contents($root . '/js/tl-c3-slot.js');
$cr = file_get_contents($root . '/Chicken-Road/Main/js/app.js');
$av = file_get_contents($root . '/user/aviatorold.js');
assert(str_contains($gjs, "post('/game/gold/cashout')"), 'gold cashout url');
assert(str_contains($gjs, 'applyWallet(res.data)'), 'gold paints wallet');
assert(str_contains($gjs, 'pointerdown'), 'gold mobile pointer');
assert(str_contains($c3, "post('/game/glamour/cashout')"), 'glamour cashout url');
assert(str_contains($c3, 'syncHud(res.data.balance)'), 'glamour paints wallet');
assert(str_contains($c3, 'pointerdown'), 'glamour mobile pointer');
assert(str_contains($cr, "serverCall('cashout'"), 'chicken cashout');
assert(str_contains($cr, 'pointerdown'), 'chicken mobile pointer');
assert(str_contains($av, "url: '/cash_out'"), 'aviator cashout');
assert(str_contains($av, 'applyWalletCredit'), 'aviator paints wallet');
assert(str_contains($av, "pointerdown', '#cashout_button'"), 'aviator mobile pointer');

echo "OK 5% house all games + mobile cashout → wallet\n";
