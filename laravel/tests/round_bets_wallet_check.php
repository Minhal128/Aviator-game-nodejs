<?php
/**
 * Round bets panel + unique wallet helpers.
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$api = file_get_contents(base_path('app/Http/Controllers/Adminapi.php'));
assert(str_contains($api, 'bets_is_prev'), 'liveRound exposes bets_is_prev');
assert(str_contains($api, 'Gameresult'), 'liveRound uses Gameresult for prev round');

$dash = file_get_contents(base_path('resources/views/admin/dashboard.blade.php'));
assert(str_contains($dash, 'hud_bets_label'), 'dashboard shows last-round label');
assert(str_contains($dash, 'bets_is_prev'), 'dashboard reads bets_is_prev');

$helper = file_get_contents(base_path('app/Helper.php'));
assert(str_contains($helper, 'function ensure_wallet'), 'ensure_wallet exists');
assert(str_contains($helper, 'ensure_wallet($userid)'), 'wallet() uses ensure_wallet');
assert(str_contains($helper, 'ensure_wallet($id)'), 'addwallet() uses ensure_wallet');

$ws = file_get_contents(dirname(base_path()) . '/ludo/ludo-royale/server/src/services/WalletService.ts');
assert(str_contains($ws, 'siteUserIdFor'), 'Ludo coins route through SiteWallet');

// unique index present
$idx = Illuminate\Support\Facades\DB::select("SHOW INDEX FROM wallets WHERE Key_name = 'wallets_userid_unique'");
assert(count($idx) > 0, 'wallets.userid unique index');

echo "round_bets_wallet_check OK\n";
