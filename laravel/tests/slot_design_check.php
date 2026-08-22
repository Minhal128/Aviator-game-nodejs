<?php
/**
 * Slot shell CSS + Pages inject + lobby slot cards.
 * Run: php laravel/tests/slot_design_check.php
 */
$root = dirname(__DIR__, 2);
$css = file_get_contents($root . '/css/tl-slots.css');
assert($css !== false && str_contains($css, 'tl-slot-egypt'), 'tl-slots.css egypt');
assert(str_contains($css, 'tl-slot-glamour'), 'tl-slots.css glamour');
assert(str_contains($css, '.tl-slot-cash'), 'cash style');

$pages = file_get_contents($root . '/laravel/app/Http/Controllers/Pages.php');
assert(str_contains($pages, 'tl-slots.css'), 'Pages injects css');
assert(str_contains($pages, 'tl-slot-brand'), 'Pages injects brand');
assert(str_contains($pages, 'tl-gold-egypt.js?v=20260820-slot'), 'egypt cache bust');
assert(str_contains($pages, 'tl-c3-slot.js?v=20260820-slot'), 'glamour cache bust');

$ui = file_get_contents($root . '/css/tl-ui.css');
assert(str_contains($ui, 'tl-card--slot'), 'lobby slot cards');
assert(str_contains($ui, 'tl-card--glamour'), 'glamour card');

$welcome = file_get_contents($root . '/laravel/resources/views/welcome.blade.php');
assert(str_contains($welcome, 'tl-card--slot'), 'welcome slot class');

$js = file_get_contents($root . '/js/tl-c3-slot.js');
assert(str_contains($js, "className = 'tl-slot-cash'"), 'cash class');

assert(is_file($root . '/images/tile-gold-egypt.jpg'), 'egypt tile');
assert(is_file($root . '/images/tile-slot-glamour.jpg'), 'glamour tile');

echo "slot_design_check: ok\n";
