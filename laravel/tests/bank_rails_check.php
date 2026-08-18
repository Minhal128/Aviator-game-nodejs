<?php
/**
 * UPI-only deposit rails smoke check.
 * Run: php laravel/tests/bank_rails_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Adminapi;
use App\Models\Bankdetail;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

$api = new Adminapi;
$tag = bin2hex(random_bytes(4));
$upiId = "smoke-$tag@upi";
$accountNo = '99' . (string) hexdec($tag);
$qr = tempnam(sys_get_temp_dir(), 'qr');
file_put_contents($qr, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='));

$upi = Request::create('/admin/api/bankdetail', 'POST', [
    'id' => 0,
    'rail' => 'upi',
    'upi_id' => $upiId,
    'holdername' => 'Smoke UPI',
    'mobile_no' => '9999999999',
], [], ['barcode' => new UploadedFile($qr, 'qr.png', 'image/png', null, true)]);
$res = json_decode($api->editbankdetail($upi)->getContent(), true);
@unlink($qr);
assert(($res['status'] ?? 0) === 1, 'add upi failed');
$upiRow = Bankdetail::where('upi_id', $upiId)->where('rail', 'upi')->orderByDesc('id')->first();
assert($upiRow, 'upi row missing');
assert(str_starts_with($upiRow->barcode, '/storage/admin/bankdetail/'), 'upi QR path missing');
Storage::disk('public')->delete(str_replace('/storage/', '', $upiRow->barcode));

$bank = Request::create('/admin/api/bankdetail', 'POST', [
    'id' => 0,
    'rail' => 'bank',
    'bank_name' => 'Smoke Bank',
    'account_no' => $accountNo,
    'holdername' => 'Smoke Bank Holder',
    'ifsccode' => 'SMOK0001234',
]);
$res = json_decode($api->editbankdetail($bank)->getContent(), true);
assert(($res['status'] ?? 1) === 0, 'bank rail can still be added');
assert(!Bankdetail::where('account_no', $accountNo)->exists(), 'blocked bank row was created');

$gwUpi = json_decode($api->payment_gateway(Request::create('/payment_gateway_details', 'GET', ['id' => 3]))->getContent(), true);
assert(($gwUpi['isSuccess'] ?? false) === true, 'upi gateway empty');
assert(count($gwUpi['list'] ?? []) >= 1, 'upi list empty');
$ids = array_column($gwUpi['list'], 'id');
assert(in_array($upiRow->id, $ids, true), 'new upi not in list');

$gwBank = json_decode($api->payment_gateway(Request::create('/payment_gateway_details', 'GET', ['id' => 6]))->getContent(), true);
assert(($gwBank['isSuccess'] ?? true) === false, 'bank gateway still available');

$bankDeposit = $api->depositNow(Request::create('/depositNow', 'POST', [
    'payment_gateway_type' => 6,
    'amount' => 1000,
]));
assert(str_ends_with($bankDeposit->getTargetUrl(), '/deposit?msg=upi'), 'bank deposit bypassed gateway policy');

$largeDeposit = $api->depositNow(Request::create('/depositNow', 'POST', [
    'payment_gateway_type' => 3,
    'amount' => Adminapi::MAX_DEPOSIT + 1,
]));
assert(str_ends_with($largeDeposit->getTargetUrl(), '/deposit?msg=max'), 'deposit exceeded ₹1 lakh');

$del = Request::create('/admin/api/bankdetail/delete', 'POST', ['id' => $upiRow->id, 'rail' => 'upi']);
assert((json_decode($api->deletebankdetail($del)->getContent(), true)['status'] ?? 0) === 1, 'delete upi failed');
assert(!Bankdetail::where('id', $upiRow->id)->exists(), 'upi still there');

echo "bank_rails_check OK\n";
