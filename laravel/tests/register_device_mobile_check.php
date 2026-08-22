<?php
/**
 * Unique mobile + one device_key per registration.
 * Run: php laravel/tests/register_device_mobile_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Authentication;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

assert(Schema::hasColumn('users', 'device_key'), 'device_key column');

$auth = new Authentication();
$stamp = (string) time();

function regReq(array $extra): Request
{
    return Request::create('/auth/register', 'POST', array_merge([
        'name' => 'DevTest',
        'gender' => 'male',
        'email' => 'dev_' . ($extra['email_tag'] ?? uniqid()) . '@test.local',
        'password' => 'pass1234',
        'mobile' => $extra['mobile'] ?? ('9' . substr((string) time(), -9)),
        'device_key' => $extra['device_key'] ?? ('devkey' . str_pad((string) random_int(1, 99999999), 16, '0')),
        'promocode' => $extra['promocode'] ?? '',
    ], $extra));
}

// missing mobile (HTTP would 422; direct call throws)
try {
    $auth->register(regReq(['mobile' => '', 'email_tag' => 'a' . $stamp]));
    assert(false, 'empty mobile should fail');
} catch (Illuminate\Validation\ValidationException $e) {
    assert(isset($e->errors()['mobile']), 'mobile required');
}

// bad mobile length
$res = $auth->register(regReq(['mobile' => '12345', 'email_tag' => 'b' . $stamp, 'device_key' => 'abcdefghijklmnop']))->getData(true);
assert($res['isSuccess'] === false, 'short mobile rejected');

$dk1 = 'devicekeyone' . $stamp . 'xx';
$m1 = '98' . substr($stamp, -8);
$ok = $auth->register(regReq([
    'mobile' => $m1,
    'device_key' => $dk1,
    'email_tag' => 'c' . $stamp,
]))->getData(true);
assert($ok['isSuccess'] === true, 'first register ok: ' . ($ok['message'] ?? ''));
$u1 = User::where('mobile', $m1)->first();
assert($u1 && $u1->device_key === $dk1, 'device stored');

// same mobile
$dupM = $auth->register(regReq([
    'mobile' => $m1,
    'device_key' => 'devicekeytwo' . $stamp . 'yy',
    'email_tag' => 'd' . $stamp,
]))->getData(true);
assert($dupM['isSuccess'] === false && str_contains(strtolower($dupM['message']), 'mobile'), 'dup mobile');

// same device
$dupD = $auth->register(regReq([
    'mobile' => '97' . substr($stamp, -8),
    'device_key' => $dk1,
    'email_tag' => 'e' . $stamp,
]))->getData(true);
assert($dupD['isSuccess'] === false && str_contains(strtolower($dupD['message']), 'device'), 'dup device');

Wallet::where('userid', (string) $u1->id)->delete();
$u1->delete();

echo "register_device_mobile_check: ok\n";
