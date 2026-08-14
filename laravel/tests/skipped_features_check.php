<?php
/**
 * Static check: tick exposes forfeited[]; client wires applyTickForfeits; second-row always shown; coin burst exists.
 * Run: php laravel/tests/skipped_features_check.php
 */
$root = dirname(__DIR__, 2);
$engine = file_get_contents($root . '/laravel/app/Services/PoolCrashEngine.php');
$old = file_get_contents($root . '/user/aviatorold.js');
$byapp = file_get_contents($root . '/user/aviatorbyapp.js');
$css = file_get_contents($root . '/css/style.css');
$blade = file_get_contents($root . '/laravel/resources/views/crash.blade.php');

assert(strpos($engine, "'forfeited' => \$forfeited") !== false, 'tick must return forfeited');
assert(strpos($engine, "return \$forfeited;") !== false, 'forfeitUnaffordableBets must return list');
assert(strpos($old, 'function applyTickForfeits') !== false, 'applyTickForfeits missing');
assert(strpos($old, 'function hideSectionAfterForfeit') !== false, 'hideSectionAfterForfeit missing');
assert(strpos($old, 'function cashoutCoinBurst') !== false, 'cashoutCoinBurst missing');
assert(strpos($byapp, 'applyTickForfeits(tick)') !== false, 'poll/socket must call applyTickForfeits');
assert(preg_match('/\.controls \.second-row\s*\{[^}]*display:\s*flex/s', $css), 'second-row must be always visible');
assert(strpos($blade, 'coin-burst-fly') !== false, 'coin burst CSS missing');

echo "skipped_features_check OK\n";
echo "  forfeit-in-tick + live hide + auto row + coin burst wired\n";
