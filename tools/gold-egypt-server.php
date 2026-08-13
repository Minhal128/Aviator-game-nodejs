<?php
/**
 * The server settles Gold of Egypt, so its paytable read has to agree with the
 * enumerator that proved the 30% margin - every line of GoldEgypt::evaluate() is a
 * transcription of gold-egypt-rtp.mjs, and a transcription can be wrong. The first
 * run of this check caught exactly that: $combo was filled from the last reel back,
 * so the matcher was handed the reels reversed and paid 369 where the game paid 51.
 *
 *   php tools/gold-egypt-server.php
 *
 * What it checks:
 *  1. the three stop combinations captured from real spins in the browser, plus 40
 *     random ones, pay the same in PHP as in the enumerator;
 *  2. the server's reel draw covers every stop position and is flat, which is the
 *     assumption the enumerated 0.6999 RTP rests on;
 *  3. a spin costs a sane amount of wallet money.
 *
 * The margin itself is not measured here - gold-egypt-rtp.mjs --check does that
 * exhaustively over all 460,800 combinations, and a Monte Carlo of a 1-in-3846
 * jackpot would need millions of spins to say anything the enumeration doesn't.
 */
require __DIR__ . '/../laravel/vendor/autoload.php';
$app = require_once __DIR__ . '/../laravel/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\GoldEgypt;

$fail = 0;
function check(string $label, bool $ok): void
{
    global $fail;
    echo '  [' . ($ok ? 'ok' : 'FAIL') . "] $label\n";
    if (!$ok) {
        $fail++;
    }
}

/**
 * Total line pay per stop combination, straight from the JS enumerator. One call
 * for all of them: the enumerator's --stops path skips the exhaustive count.
 *
 * @param  array<int, array<int, int>> $combos
 * @return array<int, int> pay per combination, in the same order
 */
function jsLinePay(array $combos): array
{
    $arg = implode(';', array_map(fn ($c) => implode(',', $c), $combos));
    $cmd = 'node ' . escapeshellarg(__DIR__ . '/gold-egypt-rtp.mjs') . ' --stops ' . escapeshellarg($arg);
    exec($cmd . ' 2>&1', $out, $code);
    $text = implode("\n", $out);
    if ($code !== 0 || !preg_match_all('/-> line pay (\d+)/', $text, $m)) {
        throw new RuntimeException("enumerator failed: $text");
    }
    return array_map('intval', $m[1]);
}

/** model() is private, and a check has no business making it public. */
function model(): array
{
    $ref = new ReflectionMethod(GoldEgypt::class, 'model');
    $ref->setAccessible(true);
    return $ref->invoke(null);
}

echo "== PHP paytable vs the JS enumerator ==\n";
$combos = [[4, 8, 1, 7, 3], [0, 1, 0, 10, 5], [2, 6, 8, 15, 11]];   // captured in the browser
for ($i = 0; $i < 40; $i++) {
    $combos[] = GoldEgypt::drawStops();
}
$expected = jsLinePay($combos);
$diff = 0;
$paying = 0;
foreach ($combos as $i => $stops) {
    $php = GoldEgypt::evaluate($stops)['line'];
    if ($php !== $expected[$i]) {
        echo '       ' . implode(',', $stops) . ": php $php, node {$expected[$i]}\n";
        $diff++;
    }
    if ($expected[$i] > 0) {
        $paying++;
    }
}
check(count($combos) . " stop combinations pay the same in PHP and node ($paying of them pay at all)", $diff === 0);
check('the sample is not all zeroes', $paying >= 5);

echo "== reel draw ==\n";
$draws = 40000;
$lengths = array_map(fn ($r) => count($r['symbolImages']), model()['reels']);
$seen = array_map(fn () => [], $lengths);
for ($i = 0; $i < $draws; $i++) {
    foreach (GoldEgypt::drawStops() as $ri => $stop) {
        $seen[$ri][$stop] = ($seen[$ri][$stop] ?? 0) + 1;
    }
}
foreach ($lengths as $ri => $len) {
    $expect = $draws / $len;
    $off = max(array_map(fn ($c) => abs($c - $expect) / $expect, $seen[$ri]));
    printf("  reel %d: %d/%d positions hit, worst position %.1f%% off flat\n", $ri, count($seen[$ri]), $len, $off * 100);
    check("reel $ri covers every stop, within 15% of flat", count($seen[$ri]) === $len && $off < 0.15);
}

echo "== bet sizing ==\n";
$minSpin = GoldEgypt::LINES / GoldEgypt::COINS_PER_UNIT;
printf("  spin costs %.2f at lineBet 1, %.2f at lineBet %d\n", $minSpin, $minSpin * model()['lineBetMaxValue'], model()['lineBetMaxValue']);
check('minimum spin under 5.00', $minSpin < 5.0);
check('the exported model matches the game config', model()['rtp'] < 0.705 && model()['rtp'] > 0.695);

echo $fail === 0 ? "\ngold-egypt-server OK\n" : "\n$fail problem(s)\n";
exit($fail === 0 ? 0 : 1);
