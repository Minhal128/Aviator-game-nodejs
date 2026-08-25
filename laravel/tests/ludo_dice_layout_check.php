<?php
/**
 * You+die must sit inboard of the canvas edge (clipped die is untappable).
 * Run: php laravel/tests/ludo_dice_layout_check.php
 */
$layout = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/game/layout.ts');
$scene = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/game/scenes/GameBoardScene.ts');
assert($layout !== false && $scene !== false);
assert(preg_match('/leftX:\s*(\d+)/', $layout, $m) === 1, 'leftX');
assert((int) $m[1] >= 110, 'You chip still on the left edge');
assert(str_contains($scene, 'side * 108'), 'die offset still overlapping the chip');
assert(str_contains($scene, 'const y = chip.y;'), 'die must sit beside the chip, not above it');
assert(!str_contains($scene, 'chip.y - 62'), 'old Y-lift stacked the die on the board');
assert(str_contains($scene, 'DEPTH.hud + 2'), 'die under the chip — taps miss');
echo "ludo_dice_layout_check: ok\n";
