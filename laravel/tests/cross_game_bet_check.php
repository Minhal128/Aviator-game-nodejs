<?php
/**
 * Cross-game bet limits: free-form games honor site settings; slots offer 300.
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$min = (float) setting('min_bet_amount');
$max = (float) setting('max_bet_amount');
assert($min > 0 && $max >= 300, 'site settings allow 300');

// Aviator server must enforce the same band the client already uses
$gs = file_get_contents(base_path('app/Http/Controllers/Gamesetting.php'));
assert(str_contains($gs, "setting('min_bet_amount')"), 'betNow checks min');
assert(str_contains($gs, "setting('max_bet_amount')"), 'betNow checks max');

// Chicken Road shortcuts include 300 and sit at/above site min
$html = file_get_contents(dirname(base_path()) . '/Chicken-Road/Main/index.html');
assert(str_contains($html, 'setFixedBet(300)'), 'chicken has 300 shortcut');
assert(!str_contains($html, 'setFixedBet(2)'), 'chicken dropped sub-min 2 shortcut');

// Glamour: presets for +/- ladder; custom bet via EDIT BET; hold-win cashout
assert(in_array(300, App\Http\Controllers\GlamourSpins::BETS, true), 'glamour BETS has 300');
$c3 = file_get_contents(dirname(base_path()) . '/js/tl-c3-slot.js');
assert(str_contains($c3, 'betlimits1'), 'glamour bridge writes betlimits');
assert(str_contains($c3, 'editBet'), 'glamour edit bet');
assert(str_contains($c3, 'CASHOUT_BOX'), 'cashout covers BUY FREE SPIN');
assert(str_contains($c3, 'placeCashBtn'), 'cashout placed on canvas');
assert(str_contains($c3, 'BET_ZONE'), 'tap coin bet to edit');
assert(str_contains($c3, '/game/glamour/cashout'), 'glamour cashout client');
$glamour = file_get_contents(base_path('app/Http/Controllers/GlamourSpins.php'));
assert(str_contains($glamour, 'glamour_held_win'), 'glamour holds wins');
assert(str_contains($glamour, 'HOUSE_PCT = 30'), 'glamour 30% house');
assert(str_contains(file_get_contents(base_path('routes/web.php')), '/game/glamour/cashout'), 'glamour cashout route');

// Gold Egypt: site minimum, max = wallet (server + bridge)
$gold = file_get_contents(base_path('app/Http/Controllers/GoldEgypt.php'));
assert(str_contains($gold, "setting('min_bet_amount')"), 'gold server ignores site min');
assert(str_contains($gold, '$bal < $betAmount'), 'gold server max is wallet');
$tlGold = file_get_contents(dirname(base_path()) . '/js/tl-gold-egypt.js');
assert(str_contains($tlGold, 'Number(wallet.minBet)'), 'gold bridge ignores site min');
assert(str_contains($tlGold, 'wallet.balance'), 'gold bridge max is wallet');

assert(is_file(dirname(base_path()) . '/js/tl-ludo.js'), 'ludo bridge script');
assert(str_contains(file_get_contents(base_path('app/Http/Controllers/Pages.php')), 'tl-ludo.js'), 'ludo inject');

echo "cross_game_bet_check OK (min={$min} max={$max})\n";
