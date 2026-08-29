<?php
/**
 * Reduced-motion must still show every logical Ludo step instead of jumping.
 * Run: php laravel/tests/ludo_piece_step_animation_check.php
 */
$piece = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/game/objects/PieceView.ts');
assert($piece !== false);
assert(str_contains($piece, 'for (let i = 0; i < points.length; i++)'), 'reduced movement skips intermediate cells');
assert(str_contains($piece, 'duration: LR_MOTION.hop.perCellMs'), 'steps are not individually readable');
assert(!str_contains($piece, 'duration: LR_MOTION.hop.reducedSlideMs'), 'reduced movement still jumps to the last cell');
echo "ludo_piece_step_animation_check: ok\n";
