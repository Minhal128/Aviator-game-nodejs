<?php
/**
 * Gold Big Win popup shows ₹ (coins/100), not raw coins.
 * Run: php laravel/tests/gold_bigwin_inr_check.php
 */
$js = file_get_contents(dirname(__DIR__, 2) . '/js/tl-gold-egypt.js');
assert($js !== false, 'missing tl-gold-egypt.js');
assert(str_contains($js, "wrap('showBigWinMessage')"), 'big win wrapped');
assert(str_contains($js, 'coinsToInrText(winCoins)'), 'inr conversion');
assert(str_contains($js, 'YOUR WIN: ₹'), 'win message inr');
echo "gold_bigwin_inr_check: ok\n";
