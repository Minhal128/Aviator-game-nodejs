<?php
/**
 * Glamour bridge: soft between-spin reset + shorter settle quiet.
 * Run: php laravel/tests/glamour_spin_gap_check.php
 */
$js = file_get_contents(dirname(__DIR__, 2) . '/js/tl-c3-slot.js');
assert($js !== false, 'missing tl-c3-slot.js');
assert(str_contains($js, 'soft path'), 'soft reset comment');
assert(str_contains($js, 'layoutName(TL.ir) === \'Game\''), 'soft Game check');
assert(str_contains($js, 'if (++quiet < 5)'), 'quiet 0.5s');
assert(str_contains($js, 'if (++grace < 5)'), 'grace 0.5s');
assert(!str_contains($js, 'if (++quiet < 15)'), 'old quiet gone');
assert(!preg_match('/await sleep\(1200\);/', $js), 'old 1200ms gone');
echo "glamour_spin_gap_check: ok\n";
