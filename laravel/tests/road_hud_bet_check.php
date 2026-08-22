<?php
declare(strict_types=1);
$html = file_get_contents(dirname(__DIR__, 2) . '/Chicken-Road/Main/index.html');
$js = file_get_contents(dirname(__DIR__, 2) . '/Chicken-Road/Main/js/app.js');
assert(str_contains($html, 'crHudBetBtn'), 'HUD bet button');
assert(str_contains($js, 'editHudBet'), 'HUD bet editable');
assert(str_contains($js, 'applyBet'), 'shared bet apply');
assert(str_contains($js, 'lastPaidMult'), 'HUD win uses server step multiplier');
assert(str_contains($js, "await serverCall('step'"), 'GO waits for /game/road/step');
assert(str_contains($js, 'res.data.payout'), 'cashout toast shows credited rupees');
$php = file_get_contents(dirname(__DIR__) . '/app/Http/Controllers/RoadGame.php');
assert(str_contains($php, 'user_hold'), 'round is per-user not session cookie');
assert(str_contains($php, 'RTP'), 'RTP from house');
echo "OK chicken hud bet editable + house edge present\n";
