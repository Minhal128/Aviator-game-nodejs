<?php
/**
 * Multi UPI / bank rails smoke check.
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
$created = [];
$qr = tempnam(sys_get_temp_dir(), 'qr');
file_put_contents($qr, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='));

$upi = Request::create('/admin/api/bankdetail', 'POST', [
    'id' => 0,
    'rail' => 'upi',
    'upi_id' => 'smoke@upi',
    'holdername' => 'Smoke UPI',
    'mobile_no' => '9999999999',
], [], ['barcode' => new UploadedFile($qr, 'qr.png', 'image/png', null, true)]);
$res = json_decode($api->editbankdetail($upi)->getContent(), true);
@unlink($qr);
assert(($res['status'] ?? 0) === 1, 'add upi failed');
$upiRow = Bankdetail::where('upi_id', 'smoke@upi')->where('rail', 'upi')->orderByDesc('id')->first();
assert($upiRow, 'upi row missing');
assert(str_starts_with($upiRow->barcode, '/storage/admin/bankdetail/'), 'upi QR path missing');
Storage::disk('public')->delete(str_replace('/storage/', '', $upiRow->barcode));
$created[] = $upiRow->id;

$bank = Request::create('/admin/api/bankdetail', 'POST', [
    'id' => 0,
    'rail' => 'bank',
    'bank_name' => 'Smoke Bank',
    'account_no' => '111122223333',
    'holdername' => 'Smoke Bank Holder',
    'ifsccode' => 'SMOK0001234',
]);
$res = json_decode($api->editbankdetail($bank)->getContent(), true);
assert(($res['status'] ?? 0) === 1, 'add bank failed');
$bankRow = Bankdetail::where('account_no', '111122223333')->where('rail', 'bank')->orderByDesc('id')->first();
assert($bankRow, 'bank row missing');
$created[] = $bankRow->id;

$gwUpi = json_decode($api->payment_gateway(Request::create('/payment_gateway_details', 'GET', ['id' => 3]))->getContent(), true);
assert(($gwUpi['isSuccess'] ?? false) === true, 'upi gateway empty');
assert(count($gwUpi['list'] ?? []) >= 1, 'upi list empty');
$ids = array_column($gwUpi['list'], 'id');
assert(in_array($upiRow->id, $ids, true), 'new upi not in list');

$gwBank = json_decode($api->payment_gateway(Request::create('/payment_gateway_details', 'GET', ['id' => 6]))->getContent(), true);
assert(($gwBank['isSuccess'] ?? false) === true, 'bank gateway empty');
$ids = array_column($gwBank['list'], 'id');
assert(in_array($bankRow->id, $ids, true), 'new bank not in list');

$del = Request::create('/admin/api/bankdetail/delete', 'POST', ['id' => $upiRow->id, 'rail' => 'upi']);
assert((json_decode($api->deletebankdetail($del)->getContent(), true)['status'] ?? 0) === 1, 'delete upi failed');
assert(!Bankdetail::where('id', $upiRow->id)->exists(), 'upi still there');

$del = Request::create('/admin/api/bankdetail/delete', 'POST', ['id' => $bankRow->id, 'rail' => 'bank']);
assert((json_decode($api->deletebankdetail($del)->getContent(), true)['status'] ?? 0) === 1, 'delete bank failed');
assert(!Bankdetail::where('id', $bankRow->id)->exists(), 'bank still there');

echo "bank_rails_check OK\n";
