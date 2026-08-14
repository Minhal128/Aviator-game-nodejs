<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$w = App\Models\Wallet::orderByDesc(DB::raw('amount+0'))->first();
$uid = (int) $w->userid;
$bal = (float) wallet($uid, 'num');
echo "uid={$uid} bal={$bal}\n";

// SiteWallet endpoint
$c = new App\Http\Controllers\LudoWallet();
$r = Illuminate\Http\Request::create('/api/ludo/wallet', 'POST', [
    'action' => 'balance',
    'userId' => $uid,
]);
$r->headers->set('X-TL-Ludo-Key', env('LUDO_WALLET_KEY'));
$out = $c->handle($r)->getData(true);
assert(!empty($out['isSuccess']), 'balance ok');
assert(abs($out['data']['balance'] - $bal) < 0.01, 'balance matches');

// ludo-api guest + profile with tl device
$guest = file_get_contents('http://127.0.0.1:8110/api/v1/auth/guest', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\nX-TL-User-Id: {$uid}\r\n",
        'content' => json_encode(['deviceId' => 'tl' . $uid]),
        'ignore_errors' => true,
    ],
]));
$g = json_decode($guest, true);
assert(!empty($g['access']), 'guest access: ' . substr($guest, 0, 200));
echo 'guest_coins=' . ($g['user']['coins'] ?? '?') . "\n";
assert((int) ($g['user']['coins'] ?? -1) === (int) floor($bal), 'guest coins = floor(site bal)');

$prof = file_get_contents('http://127.0.0.1:8110/api/v1/profile', false, stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => "Authorization: Bearer {$g['access']}\r\nAccept: application/json\r\n",
        'ignore_errors' => true,
    ],
]));
$p = json_decode($prof, true);
echo 'profile_coins=' . ($p['wallet']['coins'] ?? '?') . "\n";
assert((int) ($p['wallet']['coins'] ?? -1) === (int) floor($bal), 'profile coins = floor(site bal)');

echo "ludo_paisa_check OK\n";
