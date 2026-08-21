<?php
/**
 * Bonus is playable; withdrawable only after game wager clears wager_left.
 * Run: php laravel/tests/bonus_wager_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Setting;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Support\Facades\Schema;

assert(Schema::hasColumn('wallets', 'bonus'), 'wallets.bonus column');
assert(Schema::hasColumn('wallets', 'wager_left'), 'wallets.wager_left column');
assert(function_exists('credit_bonus') && function_exists('withdrawable'), 'helpers');

$prevMult = Setting::where('category', 'bonus_wager_mult')->value('value');
$row = Setting::where('category', 'bonus_wager_mult')->first();
if ($row) {
    $row->value = '1';
    $row->save();
} else {
    $row = new Setting;
    $row->category = 'bonus_wager_mult';
    $row->value = '1';
    $row->status = '1';
    $row->save();
}

$user = new User;
$user->name = 'BonusWagerTest';
$user->email = 'bonus_wager_' . time() . '@test.local';
$user->mobile = '9' . substr((string) time(), -9);
$user->password = bcrypt('x');
$user->currency = '₹';
$user->status = '1';
$user->save();
$uid = (string) $user->id;

credit_bonus($uid, 100);
$row = ensure_wallet($uid);
assert(abs((float) $row->amount - 100) < 0.01, 'amount 100');
assert(abs((float) $row->bonus - 100) < 0.01, 'bonus locked 100');
assert(abs((float) $row->wager_left - 100) < 0.01, 'wager 100');
assert(abs(withdrawable($uid, 'num')) < 0.01, 'nothing withdrawable yet');

// deposit/cash credit does not lock
addwallet($uid, 50, '+');
assert(abs(withdrawable($uid, 'num') - 50) < 0.01, 'cash 50 withdrawable');

// game bet counts toward wager
addwallet($uid, 40, '-', true);
$row = ensure_wallet($uid);
assert(abs((float) $row->wager_left - 60) < 0.01, 'wager left 60');
assert((float) $row->bonus > 0, 'still locked');

// finish wager → unlock
addwallet($uid, 60, '-', true);
$row = ensure_wallet($uid);
assert(abs((float) $row->wager_left) < 0.01, 'wager cleared');
assert(abs((float) $row->bonus) < 0.01, 'bonus unlocked');
assert(abs(withdrawable($uid, 'num') - (float) $row->amount) < 0.01, 'full balance withdrawable');

// cash withdraw must NOT count as wager (re-lock then cash debit)
credit_bonus($uid, 20);
$beforeWager = (float) ensure_wallet($uid)->wager_left;
addwallet($uid, 5, '-'); // no wager flag
assert(abs((float) ensure_wallet($uid)->wager_left - $beforeWager) < 0.01, 'withdraw does not reduce wager');

Wallet::where('userid', $uid)->delete();
$user->delete();
if ($prevMult !== null) {
    Setting::where('category', 'bonus_wager_mult')->update(['value' => (string) $prevMult]);
}

echo "bonus_wager_check: ok\n";
