<?php
/**
 * Referrer bonus only on first approved deposit ≥ ₹300.
 * Run: php laravel/tests/referral_first_deposit_check.php
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

$keys = ['referrer_bonus', 'referral_bonus', 'level1commission', 'level2commission', 'level3commission'];
$prev = [];
foreach ($keys as $k) {
    $prev[$k] = Setting::where('category', $k)->value('value');
}
Setting::where('category', 'referrer_bonus')->update(['value' => '50']);
Setting::where('category', 'referral_bonus')->update(['value' => '0']);
foreach (['level1commission', 'level2commission', 'level3commission'] as $k) {
    Setting::where('category', $k)->update(['value' => '0']);
}

function mkUser(string $prefix): User
{
    $u = new User;
    $u->name = $prefix;
    $u->email = $prefix . '_' . time() . '_' . mt_rand(100, 999) . '@test.local';
    $u->mobile = '9' . substr((string) (time() + mt_rand(1, 9999)), -9);
    $u->password = bcrypt('x');
    $u->currency = '₹';
    $u->gender = 'male';
    $u->country = 'IN';
    $u->status = '1';
    $u->save();
    $w = new Wallet;
    $w->userid = $u->id;
    $w->amount = 0;
    $w->save();
    return $u;
}

function mkDeposit(int $userid, float $amount): Transaction
{
    $trn = new Transaction;
    $trn->userid = $userid;
    $trn->platform = 'UPI';
    $trn->transactionno = 't' . time() . mt_rand(10, 99);
    $trn->type = 'credit';
    $trn->amount = $amount;
    $trn->category = 'recharge';
    $trn->remark = 'Processing';
    $trn->status = '0';
    $trn->save();
    return $trn;
}

$ref = mkUser('ref_dep');
$before = (float) wallet($ref->id, 'num');

$auth = new Authentication;
$mail = 'new_dep_' . time() . '@test.local';
$mob = '8' . substr((string) time(), -9);
$out = json_decode($auth->register(Request::create('/auth/register', 'POST', [
    'name' => 'New Dep',
    'gender' => 'male',
    'email' => $mail,
    'mobile' => $mob,
    'password' => 'secret123',
    'promocode' => (string) $ref->id,
    'device_key' => 'firstdep' . time() . 'deviceaaa',
]))->getContent(), true);
assert(($out['isSuccess'] ?? false) === true, 'register failed');
assert(abs((float) wallet($ref->id, 'num') - $before) < 0.001, 'no referrer pay on signup');

$newbie = User::where('email', $mail)->first();
assert($newbie, 'newbie');
$api = new Adminapi;

$trn = mkDeposit($newbie->id, 100);
$api->rechargeapproval('success', Request::create('/', 'POST', ['id' => $trn->id]));
assert(abs((float) wallet($ref->id, 'num') - $before) < 0.001, 'no bonus under 300');

$trn2 = mkDeposit($newbie->id, 300);
$api->rechargeapproval('success', Request::create('/', 'POST', ['id' => $trn2->id]));
assert(abs((float) wallet($ref->id, 'num') - $before) < 0.001, 'no bonus when not first deposit');

$mail2 = 'new_dep2_' . time() . '@test.local';
$mob2 = '7' . substr((string) time(), -9);
$out2 = json_decode($auth->register(Request::create('/auth/register', 'POST', [
    'name' => 'New Dep2',
    'gender' => 'male',
    'email' => $mail2,
    'mobile' => $mob2,
    'password' => 'secret123',
    'promocode' => (string) $ref->id,
    'device_key' => 'firstdep' . time() . 'devicebbb',
]))->getContent(), true);
assert(($out2['isSuccess'] ?? false) === true, 'register2 failed');
$newbie2 = User::where('email', $mail2)->first();
$trn3 = mkDeposit($newbie2->id, 300);
$before2 = (float) wallet($ref->id, 'num');
$api->rechargeapproval('success', Request::create('/', 'POST', ['id' => $trn3->id]));
assert(abs((float) wallet($ref->id, 'num') - ($before2 + 50)) < 0.001, 'bonus on first 300');
assert(Transaction::where('userid', $ref->id)->where('category', 'referrer_bonus')
    ->where('platform', (string) $newbie2->id)->exists(), 'txn tagged');

foreach ([$newbie, $newbie2, $ref] as $u) {
    if (!$u) continue;
    Transaction::where('userid', $u->id)->delete();
    Wallet::where('userid', $u->id)->delete();
    $u->delete();
}
Transaction::where('category', 'referrer_bonus')->whereIn('platform', [(string) ($newbie->id ?? 0), (string) ($newbie2->id ?? 0)])->delete();

foreach ($prev as $k => $v) {
    if ($v !== null) Setting::where('category', $k)->update(['value' => (string) $v]);
}

echo "referral_first_deposit_check: ok\n";
