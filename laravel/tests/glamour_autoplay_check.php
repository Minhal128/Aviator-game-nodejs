<?php
declare(strict_types=1);
/**
 * AUTOPLAY in Glamour Spins runs through the bridge, not the game's own loop.
 * Run: php laravel/tests/glamour_autoplay_check.php
 *
 * The live behaviour is covered by tools/glamour-client.mjs (needs playwright and
 * a running site). This is the part that can be checked without a browser: the
 * geometry the tap is matched against, and that the tap still never reaches the
 * game's unpriced autoplay.
 */
$js = file_get_contents(dirname(__DIR__, 2) . '/js/tl-c3-slot.js');

/** @return array{x1:float,y1:float,x2:float,y2:float} */
function zone(string $js, string $name): array
{
    $ok = preg_match(
        '/const ' . preg_quote($name, '/') . ' = \{ x1: ([\d.]+), y1: ([\d.]+), x2: ([\d.]+), y2: ([\d.]+) \}/',
        $js,
        $m
    );
    assert($ok === 1, "$name not found");
    return ['x1' => (float) $m[1], 'y1' => (float) $m[2], 'x2' => (float) $m[3], 'y2' => (float) $m[4]];
}

$auto = zone($js, 'AUTO_ZONE');
$bet = zone($js, 'BET_ZONE');

// the point tools/glamour-client.mjs taps for AUTOPLAY has to land in the zone
$tapX = 0.50;
$tapY = 0.96;
assert($tapX >= $auto['x1'] && $tapX <= $auto['x2'], 'autoplay tap x outside AUTO_ZONE');
assert($tapY >= $auto['y1'] && $tapY <= $auto['y2'], 'autoplay tap y outside AUTO_ZONE');

// onPointer tests AUTO_ZONE before the spin ellipse, so the zone must stay off the
// spin button. The ellipse is padded on purpose; what must not be swallowed is the
// button the bridge measured by hand: fx .38-.62 by fy .82-.92.
$spinOk = preg_match('/const SPIN = \{ cx: ([\d.]+), cy: ([\d.]+), rx: ([\d.]+), ry: ([\d.]+) \}/', $js, $s) === 1;
assert($spinOk, 'SPIN ellipse missing');
[$cx, $cy] = [(float) ($s[1] ?? 0), (float) ($s[2] ?? 0)];
$BUTTON = ['x1' => 0.38, 'y1' => 0.82, 'x2' => 0.62, 'y2' => 0.92];
$hits = fn(array $z, array $t) => $t['x1'] <= $z['x2'] && $t['x2'] >= $z['x1']
    && $t['y1'] <= $z['y2'] && $t['y2'] >= $z['y1'];
assert(!$hits($auto, $BUTTON), 'AUTO_ZONE covers part of the spin button');
assert(!$hits($bet, $BUTTON), 'BET_ZONE covers part of the spin button');
$holds = fn(array $z) => $cx >= $z['x1'] && $cx <= $z['x2'] && $cy >= $z['y1'] && $cy <= $z['y2'];
assert(!$holds($auto), 'AUTO_ZONE holds the spin centre');
assert(!$holds($bet), 'BET_ZONE holds the spin centre');
assert($auto['x1'] > $bet['x2'], 'AUTO_ZONE and BET_ZONE overlap');

// the tap must still be swallowed, and the game's own autoplay still pinned off
assert(str_contains($js, 'if (inZone(f, AUTO_ZONE)) {'), 'autoplay tap not intercepted');
assert(preg_match('/inZone\(f, AUTO_ZONE\)\) \{\s*e\.stopImmediatePropagation\(\);\s*e\.preventDefault\(\);/', $js) === 1,
    'autoplay tap reaches the game');
assert(str_contains($js, 'if (g.automatico) g.automatico = 0;'), 'game autoplay no longer pinned off');
assert(str_contains($js, 'if (g.automatico_ativo) g.automatico_ativo = 0;'), 'game autoplay no longer pinned off');

// BUY FREE SPIN stays in the blanket block; AUTOPLAY must not be back in it
assert(preg_match('/const BLOCKED = \[(.*?)\];/s', $js, $b) === 1, 'BLOCKED not found');
assert(str_contains($b[1], 'BUY FREE SPIN'), 'BUY FREE SPIN unblocked');
assert(!str_contains($b[1], 'AUTOPLAY'), 'AUTOPLAY is blocked again, so it does nothing');

// autoplay may only stake down the same path as a hand tap
assert(str_contains($js, 'if (!(await beginSpin())) { auto = false; return; }'), 'autoplay does not use beginSpin');
assert(str_contains($js, 'if (TL.spinning || !TL.fresh || g.Phase !== \'wait\') continue;'), 'autoplay can stake mid-round');
assert(str_contains($js, 'if (g.Freespins > 0) {'), 'autoplay would stake during a free-spin round');

echo "glamour_autoplay_check OK\n";
echo "  AUTOPLAY tap 0.50,0.96 lands in AUTO_ZONE, clear of SPIN and BET_ZONE\n";
echo "  tap is swallowed, g.automatico stays 0, spins go through beginSpin()\n";
