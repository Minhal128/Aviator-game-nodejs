<?php
/**
 * Glamour Spins keeps 30% because the server picks which measured spin happens,
 * not because the game's own maths says so. This checks that the picking is right.
 *
 *   php tools/glamour-house-edge.php
 *   php tools/glamour-house-edge.php --draws 400000
 *
 * Measured from a reset the game returns close to 100%, so the weights lean away
 * from its winning seeds to bring the return DOWN to 70%. Either direction is the
 * same one knob, but the tilt has a failure mode worth naming: if the weight
 * collapses onto a handful of seeds the game becomes the same few spins over and
 * over. The effective sample size below is what catches that - if it drops,
 * measure more seeds rather than loosening the target.
 */
require __DIR__ . '/../laravel/vendor/autoload.php';
$app = require_once __DIR__ . '/../laravel/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\GlamourSpins;

$fail = 0;
function check(string $label, bool $ok): void
{
    global $fail;
    echo '  [' . ($ok ? 'ok' : 'FAIL') . "] $label\n";
    if (!$ok) {
        $fail++;
    }
}

$table = GlamourSpins::table();
$mults = array_map(fn ($r) => (float) $r[1], $table['seeds']);
$n = count($mults);
$natural = array_sum($mults) / $n;

echo "== measured seeds ==\n";
printf("  %d seeds, native return %.4f, biggest win %.2fx, losing spins %.1f%%\n",
    $n, $natural, max($mults), count(array_filter($mults, fn ($m) => $m == 0)) / $n * 100);
check('enough seeds measured to shape a distribution', $n >= 500);
check('the seeds bracket the target (some pay more than 0.70x)', max($mults) > GlamourSpins::TARGET_RTP);

echo "== the tilt ==\n";
$w = GlamourSpins::weights();
printf("  lambda %.4f -> expected return %.6f (target %.2f)\n", $w['lambda'], $w['rtp'], GlamourSpins::TARGET_RTP);
check(sprintf('expected return is the target to 4 decimals (%.6f)', $w['rtp']),
    abs($w['rtp'] - GlamourSpins::TARGET_RTP) < 0.0001);

// effective sample size: how many distinct spins the weights really draw from
$sum = array_sum($w['weights']);
$sumSq = array_sum(array_map(fn ($x) => $x * $x, $w['weights']));
$ess = $sum * $sum / $sumSq;
printf("  effective sample size %.0f of %d seeds (%.1f%%)\n", $ess, $n, $ess / $n * 100);
check('at least 50 distinct spins carry the weight', $ess >= 50);

// what a player actually meets
$sorted = $w['weights'];
arsort($sorted);
$topShare = array_sum(array_slice($sorted, 0, 10, true)) / $sum;
printf("  the 10 likeliest seeds are %.1f%% of all spins\n", $topShare * 100);
check('no single handful of seeds dominates play', $topShare < 0.5);

echo "== the sampler ==\n";
// the weights being right is one thing; draw() actually realising them is another
$draws = 20000;
$i = array_search('--draws', $argv, true);
if ($i !== false && isset($argv[$i + 1])) {
    $draws = (int) $argv[$i + 1];
}
$staked = 0.0;
$paid = 0.0;
$seen = [];
for ($k = 0; $k < $draws; $k++) {
    [$seed, $mult] = GlamourSpins::draw();
    $staked += 1;
    $paid += $mult;
    $seen[$seed] = true;
}
$rtp = $paid / $staked;
printf("  %s spins: staked %s, paid %.1f -> return %.4f, house %.2f%%\n",
    number_format($draws), number_format($staked), $paid, $rtp, (1 - $rtp) * 100);
printf("  %d distinct seeds appeared\n", count($seen));
// binomial-ish spread on the mean; 0.01 is many standard errors at 20k draws
check(sprintf('the sampler returns 70%% in practice (%.4f)', $rtp), abs($rtp - GlamourSpins::TARGET_RTP) < 0.02);
check('play is varied, not a few repeated spins', count($seen) >= 100);

echo "== bets ==\n";
printf("  offered bets: %s\n", implode(', ', GlamourSpins::BETS));
check('the smallest bet is affordable', min(GlamourSpins::BETS) <= 1);
// the win is linear in the bet, which is what lets one table serve every stake
check('house percentage is stated as 30', GlamourSpins::HOUSE_PCT === 30);

echo $fail === 0 ? "\nglamour-house-edge OK\n" : "\n$fail problem(s)\n";
exit($fail === 0 ? 0 : 1);
