<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$c = new App\Http\Controllers\Pages();

$r = $c->gameStatic('chicken-road', null);
assert($r->getStatusCode() === 200, 'chicken index status');
assert(str_contains($r->getContent(), 'Chicken Road'), 'chicken title');
assert(str_contains($r->getContent(), 'base href="/chicken-road/"'), 'chicken base');

$r2 = $c->gameStatic('chicken-road', 'js/app.js');
assert($r2->getStatusCode() === 200, 'chicken js');

$r3 = $c->gameStatic('ludo', null);
assert($r3->getStatusCode() === 200, 'ludo index');
assert(str_contains($r3->getContent(), 'base href="/ludo/"'), 'ludo base');

echo "game_static_check OK\n";
