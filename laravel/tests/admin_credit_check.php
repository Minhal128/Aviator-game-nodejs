<?php
/**
 * Smoke check: admin credit path must ADD (not overwrite) and leave a ledger row.
 * Run: php laravel/tests/admin_credit_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Transaction;
use App\Models\User;
use App\Models\Wallet;

$user = User::where('isadmin', null)->orderBy('id')->first();
if (!$user) {
    fwrite(STDERR, "skip: no player user in db\n");
    exit(0);
}

$w = Wallet::where('userid', $user->id)->first();
if (!$w) {
    $w = new Wallet;
    $w->userid = $user->id;
    $w->amount = 0;
    $w->save();
}

$before = (float) wallet($user->id, 'num');
$add = 17.0;
addwallet($user->id, $add, '+');
addtransaction($user->id, 'Admin', date('ydmhsi'), 'credit', $add, 'admin_credit', 'Admin topped up', '1');
$after = (float) wallet($user->id, 'num');

assert(abs($after - ($before + $add)) < 0.001, "expected {$before}+{$add}={$after}");
$led = Transaction::where('userid', $user->id)->where('category', 'admin_credit')->orderByDesc('id')->first();
assert($led && (float) $led->amount === $add, 'ledger row missing');

// undo so the check is reversible
addwallet($user->id, $add, '-');
$led->delete();

echo "admin_credit_check OK — addwallet + ledger for user {$user->id}\n";
