<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

assert(is_file(dirname(base_path()) . '/js/tl-back.js'), 'tl-back.js');
assert(str_contains(file_get_contents(base_path('app/Http/Controllers/Pages.php')), '/js/tl-back.js'), 'gameStatic injects back');
assert(str_contains(file_get_contents(base_path('resources/views/crash.blade.php')), '/js/tl-back.js'), 'aviator has back');
assert(is_file(dirname(base_path()) . '/images/app-logo/netbankinglogo.png'), 'netbanking logo file');
assert(str_contains(file_get_contents(base_path('resources/views/deposite.blade.php')), 'netbankinglogo.png'), 'deposit uses new logo');
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
    assert(str_contains($r->getContent(), 'base href="/chicken-road/"'), 'chicken base');
}

echo "game_static_check OK\n";
