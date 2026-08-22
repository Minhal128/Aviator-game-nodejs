<?php
/**
 * Games load via Apache static bases; Glamour boot has no fixed 2s sleep.
 * Run: php laravel/tests/game_load_fast_check.php
 */
$root = dirname(__DIR__, 2);
$pages = file_get_contents($root . '/laravel/app/Http/Controllers/Pages.php');
$c3 = file_get_contents($root . '/js/tl-c3-slot.js');
$gold = file_get_contents($root . '/js/tl-gold-egypt.js');
$main = file_get_contents($root . '/slotglamor/game/scripts/main.js');

assert(str_contains($pages, "'slot-glamour' => '/slotglamor/game/'"), 'glamour static base');
assert(str_contains($main, 'const e=false;window["c3_runtimeInterface"]'), 'main.js useWorker false');
assert(!preg_match('/await sleep\(2000\);/', $c3), 'no fixed 2s glamour boot sleep');
assert(str_contains($c3, 'spinButtonReady()'), 'boot waits on spin button');
assert(str_contains($gold, 'spinTime = 1100'), 'gold reel spin sped up');
assert(str_contains($gold, 'r.spinTime = 1100'), 'gold live reels patched');

echo "game_load_fast_check: ok\n";
