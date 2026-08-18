<?php
/**
 * Cashier form fields: UPI deposit asks no mobile/transaction no., bank rails
 * ask UTR instead of IFSC, and withdraw shows either bank fields or UPI - never both.
 * Run: php laravel/tests/cashier_fields_check.php
 */
$root = dirname(__DIR__, 2);
$depJs = file_get_contents($root . '/user/deposit.js');
$depView = file_get_contents($root . '/laravel/resources/views/deposite.blade.php');
$wdJs = file_get_contents($root . '/user/withdraw.js');
$wdView = file_get_contents($root . '/laravel/resources/views/withdraw.blade.php');

$fail = 0;
$check = function ($ok, $msg) use (&$fail) {
    if (!$ok) {
        echo "FAIL: $msg\n";
        $fail++;
    }
};

$branch = function (string $js, string $from, string $to): string {
    $start = strpos($js, $from);
    $end = strpos($js, $to, $start === false ? 0 : $start);
    return $start === false || $end === false ? '' : substr($js, $start, $end - $start);
};

// UPI deposit (gateway 3) drops mobile number and transaction no.
$upi = $branch($depJs, '} else if(id == 3) {', '} else if(id == 4) {');
$check($upi !== '', 'deposit.js upi branch found');
$check(str_contains($upi, "'mobile_div'"), 'upi deposit hides mobile number');
$check(str_contains($upi, "'trn_div'"), 'upi deposit hides transaction no.');
$check(str_contains($depJs, "'trn_div',"), 'trn_div re-shown for other rails');
$check(!str_contains($depView, 'name="trn" required'), 'transaction no. no longer forced by html');

// Bank rails ask for UTR, not IFSC.
$check(str_contains($depView, 'id="ifsc_code_title">UTR Code / Number'), 'deposit asks UTR');
$check(!str_contains($depView, '>IFSC Code<'), 'deposit IFSC label gone');
$check(str_contains($wdView, '>UTR Code / Number<'), 'withdraw asks UTR');
$check(!str_contains($wdView, '>IFSC Code<'), 'withdraw IFSC label gone');

// Withdraw: bank fields and UPI are mutually exclusive.
$check(str_contains($wdView, 'id="bank_name_div"'), 'withdraw bank name div is targetable');
$check(str_contains($wdJs, '#account_div, #acc_holder_name_div, #bank_name_div, #ifsc_code_div'), 'withdraw bank field group');
$check(str_contains($wdJs, 'bankFields.hide()') && str_contains($wdJs, '$("#upi_id_div").show()'), 'upi withdraw hides bank fields');
$check(str_contains($wdJs, 'bankFields.show()') && str_contains($wdJs, '$("#upi_id_div").hide()'), 'bank withdraw hides upi');
foreach (['mobile_no', 'email', 'address'] as $gone) {
    $check(!str_contains($wdView, 'name="' . $gone . '"'), "withdraw dropped $gone field");
}

// Browser must refetch the scripts after a deploy.
$check(str_contains($depView, "user/deposit.js') }}?v="), 'deposit.js cache-busted');
$check(str_contains($wdView, "user/withdraw.js')}}?v="), 'withdraw.js cache-busted');
$check(str_contains($depJs, 'copy_rail'), 'upi id has a copy control');
$check(str_contains($depJs, "#payment_rails_list .copy_rail"), 'copy is delegated so it works after ajax');

echo $fail === 0 ? "cashier_fields_check OK\n" : "cashier_fields_check FAILED ($fail)\n";
exit($fail === 0 ? 0 : 1);
