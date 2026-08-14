<?php
/**
 * Referral + referrer bonus settings + signup credit path.
 * Run: php laravel/tests/referral_bonus_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Adminapi;
use App\Http\Controllers\Authentication;
use App\Models\Setting;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Http\Request;

$prevRef = Setting::where('category', 'referral_bonus')->value('value');
$prevRer = Setting::where('category', 'referrer_bonus')->value('value');

$api = new Adminapi;
$res = json_decode($api->referral(Request::create('/admin/api/referral', 'POST', [
    'referral_bonus' => 100,
    'referrer_bonus' => 50,
]))->getContent(), true);
assert(($res['status'] ?? 0) === 1, 'save failed');
assert((string) setting('referral_bonus') === '100', 'referral_bonus');
assert((string) setting('referrer_bonus') === '50', 'referrer_bonus');

$bad = json_decode($api->referral(Request::create('/admin/api/referral', 'POST', [
    'referral_bonus' => -1,
    'referrer_bonus' => 10,
]))->getContent(), true);
assert(($bad['status'] ?? 1) === 0, 'negative should fail');

// signup with referral credits both wallets
$ref = new User;
$ref->name = 'Ref Smoke';
$ref->email = 'ref_smoke_' . time() . '@test.local';
$ref->mobile = '9' . substr((string) time(), -9);
$ref->password = bcrypt('x');
$ref->currency = '₹';
$ref->gender = 'male';
$ref->country = 'IN';
$ref->status = '1';
$ref->save();
$rw = new Wallet;
$rw->userid = $ref->id;
$rw->amount = 0;
$rw->save();
$before = (float) wallet($ref->id, 'num');

$auth = new Authentication;
$mail = 'new_smoke_' . time() . '@test.local';
$mob = '8' . substr((string) time(), -9);
$out = json_decode($auth->register(Request::create('/auth/register', 'POST', [
    'name' => 'New Smoke',
    'gender' => 'male',
    'email' => $mail,
    'mobile' => $mob,
    'password' => 'secret123',
    'promocode' => (string) $ref->id,
]))->getContent(), true);
assert(($out['isSuccess'] ?? false) === true, 'register failed: ' . ($out['message'] ?? ''));

$newbie = User::where('email', $mail)->first();
assert($newbie, 'newbie missing');
assert(abs((float) wallet($newbie->id, 'num') - 100) < 0.001, 'newbie wallet');
assert(abs((float) wallet($ref->id, 'num') - ($before + 50)) < 0.001, 'referrer wallet');
assert(Transaction::where('userid', $newbie->id)->where('category', 'referral_bonus')->exists(), 'newbie txn');
assert(Transaction::where('userid', $ref->id)->where('category', 'referrer_bonus')->exists(), 'referrer txn');

// cleanup
Transaction::where('userid', $newbie->id)->where('category', 'referral_bonus')->delete();
Transaction::where('userid', $ref->id)->where('category', 'referrer_bonus')->delete();
Wallet::where('userid', $newbie->id)->delete();
Wallet::where('userid', $ref->id)->delete();
$newbie->delete();
$ref->delete();

if ($prevRef !== null) {
    Setting::where('category', 'referral_bonus')->update(['value' => (string) $prevRef]);
}
if ($prevRer !== null) {
    Setting::where('category', 'referrer_bonus')->update(['value' => (string) $prevRer]);
}

echo "referral_bonus_check: ok\n";
