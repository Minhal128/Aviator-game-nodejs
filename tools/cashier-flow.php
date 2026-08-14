<?php
/**
 * The money path through the cashier, end to end.
 *
 * A deposit is a claim with a screenshot attached; a withdrawal is a promise the
 * admin keeps by hand. Neither touches the wallet when the player submits it -
 * only approval does. This asserts exactly that, plus the three ways it used to
 * be able to leak money:
 *   - approving the same request twice credited/debited twice
 *   - a withdrawal for the exact balance created a request that was never funded
 *   - a player could spend the balance between asking and being approved
 *
 * Runs the controllers directly with a primed session (that is where the money
 * logic lives) and the kernel for the guest checks (that is where the auth lives).
 * Rolls the wallet back and deletes its own rows on the way out.
 *
 * Run: cd laravel && php ../tools/cashier-flow.php
 */
require __DIR__ . '/../laravel/vendor/autoload.php';
$app = require __DIR__ . '/../laravel/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Admin;
use App\Http\Controllers\Adminapi;
use App\Models\Transaction;
use App\Models\Wallet;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

$fail = 0;
function check(string $what, bool $ok, string $detail = ''): void
{
    global $fail;
    printf("  [%s] %s%s\n", $ok ? 'ok' : 'FAIL', $what, $detail === '' ? '' : "  ($detail)");
    if (!$ok) {
        $fail++;
    }
}

$user = App\Models\User::where('isadmin', null)->orderBy('id', 'desc')->first();
if (!$user) {
    exit("no non-admin user to test with\n");
}
$uid = $user->id;
$bal = fn() => round((float) wallet($uid, 'num'), 2);
$restore = $bal();
$created = [];
echo "test player $uid, balance $restore\n";

// a real (tiny) PNG, because the controller checks the extension and the size
$png = sys_get_temp_dir() . '/cashier-proof.png';
file_put_contents($png, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='));
$upload = fn() => new UploadedFile($png, 'receipt.png', 'image/png', null, true);

$api = new Adminapi();
$asPlayer = function (string $uri, array $post, array $files = []) use ($api, $user, $uid) {
    session()->put('userlogin', $user->toArray());
    $r = Request::create($uri, 'POST', $post, [], $files);
    $method = $uri === '/depositNow' ? 'depositNow' : 'withdrawal_query';
    return $api->$method($r);
};
/** the redirect target the controller chose, e.g. "proof" out of /deposit?msg=proof */
$msg = function ($response): string {
    parse_str((string) parse_url($response->getTargetUrl(), PHP_URL_QUERY), $q);
    return $q['msg'] ?? '';
};
$newest = fn(string $cat) => Transaction::where('userid', $uid)->where('category', $cat)->orderBy('id', 'desc')->first();
$approve = function (string $cat, $id, string $event) use ($api) {
    $r = Request::create('/admin/api/' . $cat, 'POST', ['id' => $id]);
    $m = $cat === 'recharge' ? 'rechargeapproval' : 'withdrawalapproval';
    return json_decode($api->$m($event, $r)->getContent(), true);
};

$minDep = (float) setting('min_recharge');
$minWd = (float) setting('min_withdrawal');

echo "\n== a deposit request needs a screenshot ==\n";
$before = Transaction::where('userid', $uid)->count();
check('no file is refused', $msg($asPlayer('/depositNow', ['amount' => $minDep])) === 'proof');
check('under the minimum is refused', $msg($asPlayer('/depositNow', ['amount' => $minDep - 1], ['proof' => $upload()])) === 'min');
check('a .txt pretending to be a receipt is refused',
    $msg($asPlayer('/depositNow', ['amount' => $minDep], ['proof' => new UploadedFile($png, 'receipt.txt', 'text/plain', null, true)])) === 'proof');
check('none of those wrote a row', Transaction::where('userid', $uid)->count() === $before);

echo "\n== a good deposit request is stored, and pays nothing yet ==\n";
$was = $bal();
check('accepted', $msg($asPlayer('/depositNow', ['amount' => $minDep, 'trn' => 'CHK' . time()], ['proof' => $upload()])) === 'Success');
$dep = $newest('recharge');
$created[] = $dep->id;
check('the row is pending', $dep->status === '0', 'status ' . $dep->status);
check('the wallet has not moved', $bal() === $was, $was . ' -> ' . $bal());
check('the screenshot is on disk', (bool) $dep->proof && Storage::disk('local')->exists($dep->proof), (string) $dep->proof);
// storage/app is not under the web root, and there is no route that serves it
check('the screenshot is not on the public disk', !Storage::disk('public')->exists($dep->proof));

echo "\n== only an admin can see it ==\n";
session()->forget('adminlogin');
check('a guest is turned away from the proof', $kernel->handle(Request::create('/admin/proof/' . $dep->id))->getStatusCode() === 302);
session()->put('adminlogin', App\Models\User::where('isadmin', '1')->first());
$file = (new Admin())->proof($dep->id);
check('an admin gets the image', $file->getStatusCode() === 200 && str_starts_with((string) $file->headers->get('Content-Type'), 'image/'),
    (string) $file->headers->get('Content-Type'));

echo "\n== approving the deposit is what credits it ==\n";
$was = $bal();
$res = $approve('recharge', $dep->id, 'success');
check('approved', ($res['status'] ?? 0) === 1, $res['message'] ?? '');
check('credited exactly the requested amount', $bal() === round($was + $minDep, 2), $was . ' -> ' . $bal());
$was = $bal();
$res = $approve('recharge', $dep->id, 'success');
check('approving it again is refused', ($res['status'] ?? 1) === 0, $res['title'] ?? '');
check('and credits nothing a second time', $bal() === $was, $was . ' -> ' . $bal());

echo "\n== a withdrawal request holds nothing back ==\n";
Wallet::where('userid', $uid)->update(['amount' => $minWd * 2]);
check('under the minimum is refused', $msg($asPlayer('/insert/withdrawal', ['amount' => $minWd - 1])) === 'min');
check('more than the balance is refused', $msg($asPlayer('/insert/withdrawal', ['amount' => $minWd * 3])) === 'balance');
$was = $bal();
// the exact balance is the case the old code silently failed to fund
check('the exact balance is accepted', $msg($asPlayer('/insert/withdrawal', ['amount' => $was, 'bank_name' => 'Test', 'account_no' => '1', 'ifsc_code' => 'X'])) === 'Success');
$wd = $newest('withdraw');
$created[] = $wd->id;
check('the wallet has not moved', $bal() === $was, $was . ' -> ' . $bal());

echo "\n== approving the withdrawal is what debits it ==\n";
$res = $approve('withdraw', $wd->id, 'success');
check('approved', ($res['status'] ?? 0) === 1, $res['message'] ?? '');
check('debited the full balance, to zero', $bal() === 0.0, 'balance ' . $bal());
$res = $approve('withdraw', $wd->id, 'success');
check('approving it again is refused', ($res['status'] ?? 1) === 0, $res['title'] ?? '');
check('the wallet cannot go negative that way', $bal() === 0.0, 'balance ' . $bal());

echo "\n== a player who spends the money first cannot be paid ==\n";
Wallet::where('userid', $uid)->update(['amount' => $minWd]);
check('request accepted', $msg($asPlayer('/insert/withdrawal', ['amount' => $minWd, 'bank_name' => 'Test', 'account_no' => '1', 'ifsc_code' => 'X'])) === 'Success');
$wd2 = $newest('withdraw');
$created[] = $wd2->id;
addwallet($uid, $minWd, '-');                 // spent it in a game meanwhile
$res = $approve('withdraw', $wd2->id, 'success');
check('approval is refused, not forced through', ($res['status'] ?? 1) === 0, $res['title'] ?? '');
check('the wallet is still zero, not negative', $bal() === 0.0, 'balance ' . $bal());
check('the request is still pending for the admin to cancel', Transaction::where('id', $wd2->id)->first()->status === '0');

echo "\n== cancelling a withdrawal refunds nothing, because nothing was taken ==\n";
$was = $bal();
$res = $approve('withdraw', $wd2->id, 'cancel');
check('cancelled', ($res['status'] ?? 0) === 1, $res['message'] ?? '');
check('no phantom refund', $bal() === $was, $was . ' -> ' . $bal());

echo "\n== the details the player is told to pay into are the admin's ==\n";
$bank = App\Models\Bankdetail::where('id', '1')->first();
$shown = json_decode($kernel->handle(Request::create('/payment_gateway_details', 'GET', ['id' => 6]))->getContent(), true);
check('the deposit page reads them from bankdetails', ($shown['data']['account_number'] ?? null) === $bank->account_no,
    (string) ($shown['data']['account_number'] ?? 'none'));
check('/admin/bank-detail is where they are edited', str_contains(file_get_contents(__DIR__ . '/../laravel/routes/web.php'), "'/bankdetail', [Adminapi::class, \"editbankdetail\"]"));
// the QR the admin uploads is stored as /storage/... - without the production
// symlink that path only resolves because of the /storage/{path} route
$was = $bank->barcode;
$qr = Request::create('/admin/api/bankdetail', 'POST', [
    'holdername' => $bank->account_holder_name, 'mobile_no' => $bank->mobile_no, 'upi_id' => $bank->upi_id,
    'account_no' => $bank->account_no, 'ifsccode' => $bank->ifsc_code, 'bank_name' => $bank->bank_name,
], [], ['barcode' => new UploadedFile($png, 'qr.png', 'image/png', null, true)]);
check('an uploaded QR saves', (json_decode($api->editbankdetail($qr)->getContent(), true)['status'] ?? 0) === 1);
$saved = App\Models\Bankdetail::where('id', '1')->first()->barcode;
check('and the path it saved actually serves', $kernel->handle(Request::create($saved))->getStatusCode() === 200, $saved);
check('a path climbing out of the disk is 404, not 500', $kernel->handle(Request::create('/storage/../../.env'))->getStatusCode() === 404);
App\Models\Bankdetail::where('id', '1')->update(['barcode' => $was]);

// --- put the account back the way it was ---
Transaction::whereIn('id', $created)->delete();
foreach ($created as $id) {
    // the proof file belongs to a row that no longer exists
    $p = 'deposit-proof';
    foreach (Storage::disk('local')->files($p) as $f) {
        if (str_starts_with(basename($f), $id . '-')) {
            Storage::disk('local')->delete($f);
        }
    }
}
Wallet::where('userid', $uid)->update(['amount' => $restore]);
@unlink($png);
echo "\nrolled back: " . count($created) . " rows removed, balance back to " . $bal() . "\n";

echo $fail === 0 ? "\ncashier-flow OK\n" : "\n$fail problem(s)\n";
exit($fail === 0 ? 0 : 1);
