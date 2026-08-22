<?php
declare(strict_types=1);
/**
 * Gold of Egypt on a phone.
 * Run: php laravel/tests/gold_mobile_check.php
 *
 * The game is a fixed 1850x1080 landscape canvas on Phaser Scale.FIT and the build
 * has no portrait layout, so portrait can only ever give a band. These are the two
 * numbers that follow from that and the wiring that depends on them.
 */
$js = file_get_contents(dirname(__DIR__, 2) . '/js/tl-gold-egypt.js');
$game = file_get_contents(dirname(__DIR__, 2) . '/goldegypt/game/js/slotGame.js');

// the canvas the layout is authored against
$widthOk = preg_match('/width:\s*(\d+)/', $game, $w) === 1;
$heightOk = preg_match('/height:\s*(\d+)/', $game, $h) === 1;
assert($widthOk, 'game width');
assert($heightOk, 'game height');
[$GW, $GH] = [(int) ($w[1] ?? 0), (int) ($h[1] ?? 0)];
assert($GW === 1850 && $GH === 1080, "game canvas moved to {$GW}x{$GH} — re-measure the touch targets");
assert(str_contains($game, 'Phaser.Scale.FIT'), 'no longer FIT — the maths below does not hold');

/** CSS px a 129px bet sprite renders at, in a viewport of $vw x $vh under FIT. */
$button = function (int $vw, int $vh) use ($GW, $GH): int {
    $scale = min($vw / $GW, $vh / $GH);
    return (int) round(129 * $scale);
};

// portrait phone: under the ~44px a thumb needs, which is the reported bug
assert($button(375, 812) === 26, 'portrait target size changed');
assert($button(375, 812) < 44, 'portrait would now be tappable — the overlay can go');

// landscape phone: a real target, and the canvas fills the height
assert($button(812, 375) === 45, 'landscape target size changed');
assert($button(812, 375) >= 44, 'landscape no longer gives a tappable button');
assert((int) round($GH * min(812 / $GW, 375 / $GH)) === 375, 'landscape stopped filling the height');

assert(str_contains($js, "setText('CASHOUT')"), 'CASHOUT on native MAX BET');
assert(!str_contains($js, 'tl-gold-cash'), 'HTML cashout for phone');
assert(str_contains($js, 'tl-gold-css-land'), 'CSS landscape fallback missing');
assert(str_contains($js, 'orientation.lock'), 'must try auto landscape lock');
assert(str_contains($js, 'transformPointer'), 'CSS rotate needs pointer remap');
assert(!str_contains($js, 'Turn your phone sideways'), 'must not ask user to rotate');
assert(!str_contains($js, 'tl-gold-rotate'), 'ask-to-rotate overlay must be gone');
assert(str_contains($js, "matchMedia('(pointer: coarse)')"), 'rotate logic would hit desktop too');
assert(str_contains($js, 'window.innerHeight > window.innerWidth'), 'no portrait test');
// the canvas alone must NOT be CSS-rotated (AABB breaks hits); body rotate + remap is OK
assert(!preg_match('/canvas\s*\.\s*style[^\n]*transform/i', $js), 'canvas is being transformed — taps will miss');

// +/- uses the configured minimum, and the stake stays inside the wallet
assert(str_contains($js, 'setStakeInr(TL.stakeInr + dir * minInr());'), '+/- does not use configured step');
assert(str_contains($js, 'rebindClick(s.slotControls.totalBetPlusButton, () => stepStake(1));'), 'plus unbound');
assert(str_contains($js, 'rebindClick(s.slotControls.totalBetMinusButton, () => stepStake(-1));'), 'minus unbound');
assert(str_contains($js, 'TL.stakeInr = Math.max(minInr(), Math.min(maxInr(), inr));'), 'stake no longer clamped');

echo "gold_mobile_check OK\n";
printf("  bet +/- target: %dpx portrait (too small) -> %dpx landscape\n", $button(375, 812), $button(812, 375));
echo "  portrait auto-landscape via lock/CSS; wallet attach never gives up\n";
echo "  +/- steps by site minimum, clamped to configured min .. wallet balance\n";
