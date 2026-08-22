<?php
/**
 * Uncashed game holds become withdrawable cash. Withdraw form uses paise.
 * Run: php laravel/tests/withdraw_holds_check.php
 */
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$helper = file_get_contents(__DIR__ . '/../app/Helper.php');
$api = file_get_contents(__DIR__ . '/../app/Http/Controllers/Adminapi.php');
$routes = file_get_contents(__DIR__ . '/../routes/web.php');
assert(str_contains($helper, 'PoolCrashEngine'), 'aviator open bets settled');
assert(str_contains($helper, "where('status', '0')"), 'open userbits');
assert(str_contains($routes, 'settle_open_holds(user(\'id\'))'), 'withdraw page settles holds');
assert(str_contains($api, 'settle_open_holds(user(\'id\'))'), 'withdraw submit settles holds');
assert(str_contains($api, 'withdrawable($userid'), 'approve uses withdrawable not raw wallet');

$uid = '900003';
ensure_wallet($uid);
$before = (float) wallet($uid, 'num');
user_hold_put($uid, ['gold_held_win' => 10.25, 'glamour_held_win' => 5.00]);
$got = settle_open_holds($uid);
assert(abs($got - 15.25) < 0.001, "credited $got");
assert(abs((float) wallet($uid, 'num') - ($before + 15.25)) < 0.001, 'wallet got holds');
$h = user_hold($uid);
assert((float) ($h['gold_held_win'] ?? 0) === 0.0, 'gold hold cleared');
assert((float) ($h['glamour_held_win'] ?? 0) === 0.0, 'glamour hold cleared');

user_hold_put($uid, ['road_round' => ['bet' => 50, 'mode' => 'easy', 'step' => 1, 'crash_step' => 10, 'rtp' => 0.95]]);
$mult = \App\Http\Controllers\RoadGame::multiplier(\App\Http\Controllers\RoadGame::MODES['easy'], 1, 0.95);
$payout = round(50 * $mult, 2);
$before = (float) wallet($uid, 'num');
$got = settle_open_holds($uid);
assert(abs($got - $payout) < 0.001, "road settle $got vs $payout");
assert(abs((float) wallet($uid, 'num') - ($before + $payout)) < 0.001, 'road payout in wallet');

\App\Models\Wallet::where('userid', $uid)->delete();
echo "OK withdraw settles gold/glamour/chicken holds as cash\n";
