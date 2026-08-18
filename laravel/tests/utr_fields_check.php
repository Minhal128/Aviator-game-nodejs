<?php
declare(strict_types=1);
/**
 * IFSC -> UTR on the cashier forms.
 * Run: php laravel/tests/utr_fields_check.php
 *
 * Two different things are called ifsc_code in this codebase and only one of them
 * is a UTR:
 *   - what the PLAYER types on deposit/withdraw is a payment reference -> UTR;
 *   - the SITE's own bank IFSC, which the player needs in order to transfer money
 *     in, is a real IFSC and has to keep saying IFSC.
 * The column names stay put; only the labels move.
 */
$dep = file_get_contents(__DIR__ . '/../resources/views/deposite.blade.php');
$wd = file_get_contents(__DIR__ . '/../resources/views/withdraw.blade.php');
$profile = file_get_contents(__DIR__ . '/../resources/views/profile.blade.php');
$depJs = file_get_contents(dirname(__DIR__, 2) . '/user/deposit.js');
$hist = file_get_contents(__DIR__ . '/../resources/views/admin/withdrawhistory.blade.php');

/** The div ids deposit() leaves hidden for a payment rail. */
function hiddenFor(string $js, string $marker): array
{
    $at = strpos($js, $marker);
    assert($at !== false, "rail branch $marker not found");
    $ok = preg_match('/array_to_hide = \[(.*?)\]/s', substr($js, $at), $m);
    assert($ok === 1, "no hide list after $marker");
    preg_match_all("/'([a-z_]+)'/", $m[1], $ids);
    return $ids[1];
}

// what the player types is a UTR, everywhere they can type it
assert(str_contains($dep, 'id="ifsc_code_title">UTR Code / Number'), 'deposit still says IFSC');
assert(str_contains($wd, 'UTR Code / Number'), 'withdraw still says IFSC');
assert(str_contains($profile, 'UTR Code / Number'), 'profile still says IFSC');
assert(!preg_match('/>\s*IFSC Code\s*</', $dep . $wd . $profile), 'an IFSC label is left on a player form');
assert(str_contains($hist, "'UTR code / number' => \$history->ifsccode"), 'admin history still says IFSC');

// the site's own bank IFSC is NOT a UTR - the player cannot transfer without it
assert(str_contains($depJs, '">IFSC</span><span>\' + (row.ifsc_code'), 'the deposit instructions lost the site IFSC');

// UPI deposit: the screenshot is the only thing the player fills in
$upiHidden = hiddenFor($depJs, '$("#mobile_number_title").text("UPI ID")');
foreach (['mobile_div', 'trn_div', 'name_div', 'email_div', 'upi_div', 'ifsc_code_div', 'account_no_div'] as $div) {
    assert(in_array($div, $upiHidden, true), "UPI deposit still asks for $div");
}
// and it says so, in Bengali and in English, right above the file input
$note = 'পেমেন্ট সম্পন্ন করার পর';
assert(str_contains($dep, $note), 'the Bengali upload instruction is missing');
assert(str_contains($dep, 'After completing the payment, upload the screenshot'), 'the English upload instruction is missing');
assert(strpos($dep, $note) < strpos($dep, 'id="proof_div"'), 'the instruction is not above the upload');
// the host serves stale compiled blades, so deposit.js re-adds it - once, never twice
assert(str_contains($depJs, 'id="proof_note"') && str_contains($dep, 'id="proof_note"'),
    'the js fallback and the blade must share the proof_note id or the line doubles up');
assert(str_contains($depJs, '!$("#proof_note").length'), 'the js fallback is not guarded');

// net banking deposit: keeps account/UTR/bank, drops the UPI-only fields
$netHidden = hiddenFor($depJs, '$("#account_name_title").text("ACCOUNT NAME")');
assert(!in_array('ifsc_code_div', $netHidden, true), 'net banking lost the UTR field');
assert(!in_array('account_no_div', $netHidden, true), 'net banking lost the account number');
assert(in_array('upi_div', $netHidden, true), 'net banking is asking for a UPI id');
assert(in_array('mobile_div', $netHidden, true), 'net banking is asking for a mobile number');

echo "utr_fields_check OK\n";
echo "  player-typed reference says UTR on deposit, withdraw, profile and admin history\n";
echo "  the site's own bank IFSC still says IFSC on the deposit instructions\n";
echo "  UPI deposit asks: screenshot only, under a Bengali + English instruction\n";
echo "  net banking asks: transaction no, account, holder, UTR, bank, screenshot\n";
