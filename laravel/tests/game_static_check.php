<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

assert(is_file(dirname(base_path()) . '/js/tl-back.js'), 'tl-back.js');
assert(str_contains(file_get_contents(base_path('app/Http/Controllers/Pages.php')), '/js/tl-back.js'), 'gameStatic injects back');
assert(str_contains(file_get_contents(base_path('routes/web.php')), 'withoutMiddleware($gameAssetNoSession)'), 'game assets skip session');
assert(str_contains(file_get_contents(dirname(base_path()) . '/ludo/.htaccess'), 'REQUEST_FILENAME} -f'), 'ludo htaccess serves real files');
assert(str_contains(file_get_contents(base_path('resources/views/crash.blade.php')), '/js/tl-back.js'), 'aviator has back');
assert(is_file(dirname(base_path()) . '/images/app-logo/netbankinglogo.png'), 'netbanking logo file');
assert(!str_contains(file_get_contents(base_path('resources/views/deposite.blade.php')), 'netbankinglogo.png'), 'deposit still offers net banking');
assert(str_contains(file_get_contents(base_path('resources/views/withdraw.blade.php')), 'netbankinglogo.png'), 'withdraw uses new logo');

$c = new App\Http\Controllers\Pages();
$uid = App\Models\User::where('isadmin', null)->value('id');
assert(str_contains(file_get_contents(dirname(base_path()) . '/js/tl-back.js'), 'tl-wallet-hud'), 'wallet hud in tl-back');
assert(str_contains(file_get_contents(dirname(base_path()) . '/js/tl-back.js'), 'TL_setWallet'), 'TL_setWallet export');
if ($uid) {
    session()->put('userlogin', ['id' => $uid, 'currency' => '₹']);
    $r = $c->gameStatic('chicken-road', null);
    assert($r->getStatusCode() === 200, 'chicken index status');
    assert(str_contains($r->getContent(), '/js/tl-back.js'), 'chicken lobby back');
    assert(str_contains($r->getContent(), 'TL_WALLET'), 'chicken gets TL_WALLET');
    assert(str_contains($r->getContent(), 'minBet'), 'chicken TL_WALLET has minBet');
    assert(str_contains($r->getContent(), 'maxBet'), 'chicken TL_WALLET has maxBet');
    assert(str_contains($r->getContent(), 'base href="/Chicken-Road/Main/"'), 'chicken base');

    $l = $c->gameStatic('ludo', null);
    if ($l->getStatusCode() === 200) {
        assert(str_contains($l->getContent(), 'base href="/ludo/ludo-royale/client/dist/"'), 'ludo base points at dist');
    }

    // Egypt's art is served straight off disk by Apache, not through this controller
    $e = $c->gameStatic('gold-egypt', null);
    assert(str_contains($e->getContent(), 'base href="/goldegypt/game/"'), 'egypt base points at the static folder');
    assert(is_file(dirname(base_path()) . '/goldegypt/game/png/Symbols/Wick.png'), 'egypt static base resolves to real files');
    // Glamour same as Egypt: Apache serves art; main.js is patched on disk (useWorker:false)
    $g = $c->gameStatic('slot-glamour', null);
    assert(str_contains($g->getContent(), 'base href="/slotglamor/game/"'), 'slot-glamour base points at the static folder');
    assert(is_file(dirname(base_path()) . '/slotglamor/game/scripts/main.js'), 'glamour static base resolves');
    assert(str_contains(file_get_contents(dirname(base_path()) . '/slotglamor/game/scripts/main.js'), 'const e=false;window["c3_runtimeInterface"]'), 'glamour main.js useWorker false on disk');
}

echo "game_static_check OK\n";
