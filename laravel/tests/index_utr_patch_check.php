<?php
// exercise the two regexes exactly as index.php applies them
$patch = function (string $html): string {
    $html = preg_replace('/(id="ifsc_code_title"[^>]*>)\s*IFSC[^<]*/i', '$1UTR Code / Number', $html) ?? $html;
    return preg_replace('/(<label[^>]*for="ifsc_code"[^>]*>)\s*IFSC[^<]*/i', '$1UTR Code / Number', $html) ?? $html;
};

// 1. the stale deposit label (what the host is serving today)
$stale = '<label for="staticEmail" class="col-form-label" id="ifsc_code_title">IFSC Code</label>';
$out = $patch($stale);
assert(str_contains($out, '>UTR Code / Number</label>'), 'deposit label not patched');
assert(!preg_match('/IFSC(?![_a-z])/i', $out), 'IFSC left in the deposit label');

// uppercase variant too
assert(str_contains($patch('<label id="ifsc_code_title">IFSC CODE</label>'), 'UTR Code / Number'));

// 2. the stale withdraw label
$wd = '<label for="ifsc_code" class="form-label text-dark ">IFSC Code</label>';
assert(str_contains($patch($wd), '>UTR Code / Number</label>'), 'withdraw label not patched');

// 3. already-correct markup must come out unchanged
$good = '<label id="ifsc_code_title">UTR Code / Number</label>';
assert($patch($good) === $good, 'a correct label was rewritten');

// 4. the SITE's own bank IFSC must survive - the player transfers money using it
$rail = '<span class="text-muted">IFSC</span><span>SBIN0001234</span>';
assert($patch($rail) === $rail, 'the deposit instructions lost the site IFSC');

// 5. the input itself keeps its name/id - the server still reads ifsc_code
$input = '<input type="text" id="ifsc_code" name="ifsc_code">';
assert($patch($input) === $input, 'the field name was rewritten');

echo "index_utr_patch_check OK\n";
echo "  stale IFSC label -> UTR on both deposit and withdraw\n";
echo "  correct markup, the site's own bank IFSC, and the field name all untouched\n";
