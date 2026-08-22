<?php
$js = file_get_contents(dirname(__DIR__, 2) . '/Chicken-Road/Main/js/app.js');
$php = file_get_contents(dirname(__DIR__) . '/app/Http/Controllers/RoadGame.php');
$routes = file_get_contents(dirname(__DIR__) . '/routes/web.php');
assert(str_contains($js, "serverCall('forfeit'"), 'client forfeits on death');
assert(str_contains($js, 'wallet && !isVisualCrashHappening'), 'cosmetic cars cannot kill a live round');
assert(str_contains($php, 'function forfeit'), 'forfeit endpoint');
assert(str_contains($php, 'forfeit orphan at step'), 'in-progress orphan is not refunded');
assert(str_contains($routes, '/game/road/forfeit'), 'forfeit route');
echo "road_forfeit_check OK\n";
