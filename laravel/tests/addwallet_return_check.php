<?php
/**
 * addwallet return must equal DB balance (old bug: returned balance+$amount after update).
 * Run: php laravel/tests/addwallet_return_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\User;
use App\Models\Wallet;

$user = User::where('isadmin', null)->orderBy('id')->first();
if (!$user) {
    echo "skip: no player\n";
    exit(0);
}
$w = Wallet::where('userid', $user->id)->first();
if (!$w) {
    $w = new Wallet;
    $w->userid = $user->id;
    $w->amount = 100;
    $w->save();
}

$before = (float) wallet($user->id, 'num');
$ret = addwallet($user->id, 5.0, '+');
$db = (float) wallet($user->id, 'num');
assert(abs($ret - $db) < 0.001, "addwallet + return $ret != db $db");
assert(abs($db - ($before + 5)) < 0.001);

$ret2 = addwallet($user->id, 5.0, '-');
$db2 = (float) wallet($user->id, 'num');
assert(abs($ret2 - $db2) < 0.001, "addwallet - return $ret2 != db $db2");
assert(abs($db2 - $before) < 0.001);

echo "addwallet_return_check OK\n";
