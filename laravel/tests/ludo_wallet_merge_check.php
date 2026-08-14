<?php
/**
 * Ludo is on the Turbo Legends wallet: TL bind + Node SiteWallet + Laravel endpoint.
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

assert(is_file(dirname(base_path()) . '/js/tl-ludo.js'), 'tl-ludo.js');
$tl = file_get_contents(dirname(base_path()) . '/js/tl-ludo.js');
assert(str_contains($tl, 'lr-hud__pill--coins'), 'tl-ludo paints coin pill');
assert(str_contains(file_get_contents(dirname(base_path()) . '/ludo/ludo-royale/client/src/meta/store.ts'), 'seedFromSiteWallet'), 'client seeds site wallet');
$pages = file_get_contents(base_path('app/Http/Controllers/Pages.php'));
assert(str_contains($pages, 'tl-ludo.js'), 'Pages injects tl-ludo');

$api = file_get_contents(base_path('routes/api.php'));
assert(str_contains($api, 'ludo/wallet'), 'api route /ludo/wallet');
assert(str_contains($api, 'X-TL-User-Id'), 'proxy stamps X-TL-User-Id');
assert(str_contains($api, 'X-TL-Wallet-Balance'), 'proxy stamps wallet balance');
assert(str_contains($api, "'expect' => false"), 'proxy disables Expect 100-continue');

assert(class_exists(App\Http\Controllers\LudoWallet::class), 'LudoWallet controller');
assert(is_file(dirname(base_path()) . '/ludo/ludo-royale/server/src/services/SiteWallet.ts'), 'SiteWallet.ts');

$ms = file_get_contents(dirname(base_path()) . '/ludo/ludo-royale/server/src/services/MatchService.ts');
assert(str_contains($ms, 'SiteWallet'), 'MatchService uses SiteWallet');
assert(str_contains($ms, 'ludo_entry_'), 'match entry refs');

$id = file_get_contents(dirname(base_path()) . '/ludo/ludo-royale/client/src/game/net/identity.ts');
assert(str_contains($id, 'TL_WALLET'), 'client binds TL_WALLET deviceId');

$key = env('LUDO_WALLET_KEY');
assert(is_string($key) && $key !== '', 'LUDO_WALLET_KEY set');

$csrf = file_get_contents(base_path('app/Http/Middleware/VerifyCsrfToken.php'));
assert(str_contains($csrf, 'api/v1/*'), 'CSRF excepts Ludo proxy POSTs');

echo "ludo_wallet_merge_check OK\n";
