<?php
/**
 * Chicken Road must honor site min/max bet settings, not the old hardcoded 50.
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$src = file_get_contents(base_path('app/Http/Controllers/RoadGame.php'));
assert(!str_contains($src, 'private const MAX_BET = 50'), 'RoadGame dropped hardcoded MAX_BET 50');
assert(str_contains($src, "setting('min_bet_amount')"), 'RoadGame uses min_bet_amount');
assert(str_contains($src, "setting('max_bet_amount')"), 'RoadGame uses max_bet_amount');

$pages = file_get_contents(base_path('app/Http/Controllers/Pages.php'));
assert(str_contains($pages, "'minBet'"), 'TL_WALLET injects minBet');
assert(str_contains($pages, "'maxBet'"), 'TL_WALLET injects maxBet');

$js = file_get_contents(dirname(base_path()) . '/Chicken-Road/Main/js/app.js');
assert(str_contains($js, 'wallet.minBet'), 'client reads minBet');
assert(str_contains($js, 'wallet.maxBet'), 'client reads maxBet');
assert(!preg_match('/const MAX_BET = 50;/', $js), 'client dropped hardcoded MAX_BET 50');

$html = file_get_contents(dirname(base_path()) . '/Chicken-Road/Main/index.html');
assert(!str_contains($html, 'max="50"'), 'input no longer hard-caps at 50');
assert(str_contains($html, 'setFixedBet(300)'), '300 shortcut present');

$min = (float) setting('min_bet_amount');
$max = (float) setting('max_bet_amount');
assert($min > 0 && $max >= 300, 'site settings allow a 300 bet');

echo "road_bet_limit_check OK (min={$min} max={$max})\n";
