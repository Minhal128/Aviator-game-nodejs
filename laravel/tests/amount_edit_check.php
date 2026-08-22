<?php
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

$check(str_contains($depView, 'id="edit_credited_amount"'), 'deposit pencil id');
$check(str_contains($depView, 'id="select_amount_edit"'), 'deposit edit input');
$check(str_contains($depJs, 'function applyCreditedAmount'), 'deposit apply helper');
$check(str_contains($depJs, '#edit_credited_amount'), 'deposit pencil handler');
$check(str_contains($depJs, '$("#deposit_amount").val(n)'), 'deposit updates hidden amount');
$check(str_contains($wdView, 'id="edit_withdraw_amount"'), 'withdraw pencil id');
$check(str_contains($wdJs, "#edit_withdraw_amount"), 'withdraw pencil handler');
$check(str_contains($wdJs, 'parseFloat(value)'), 'withdraw compares paise not parseInt');
$check(!str_contains($wdJs, 'parseInt(value)'), 'withdraw form does not truncate rupees');
$check(!str_contains($wdJs, 'var $amt = #amount'), 'withdraw js not mangled');

echo $fail === 0 ? "amount_edit_check OK\n" : "amount_edit_check FAILED ($fail)\n";
exit($fail === 0 ? 0 : 1);
