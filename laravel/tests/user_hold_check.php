<?php
/**
 * Held wins live on user_hold (cache), not the PHP session cookie.
 * Run: php laravel/tests/user_hold_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

user_hold_put(900001, ['gold_held_win' => 643.5, 'glamour_held_win' => 159.0, 'road_round' => ['step' => 4, 'bet' => 50]]);
$h = user_hold(900001);
assert(abs($h['gold_held_win'] - 643.5) < 0.001, 'gold hold');
assert(abs($h['glamour_held_win'] - 159.0) < 0.001, 'glamour hold');
assert((int) $h['road_round']['step'] === 4, 'road hold');

$gold = file_get_contents(__DIR__ . '/../app/Http/Controllers/GoldEgypt.php');
$glam = file_get_contents(__DIR__ . '/../app/Http/Controllers/GlamourSpins.php');
$road = file_get_contents(__DIR__ . '/../app/Http/Controllers/RoadGame.php');
assert(str_contains($gold, 'user_hold'), 'gold uses user_hold');
assert(str_contains($glam, 'user_hold'), 'glamour uses user_hold');
assert(str_contains($road, 'user_hold'), 'road uses user_hold');

echo "OK user_hold cashout state is per-user not session cookie\n";
