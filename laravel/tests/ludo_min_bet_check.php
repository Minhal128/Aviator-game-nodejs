<?php
$seed = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/server/src/db/seed.ts');
assert(str_contains($seed, "name: 'Beginner', entryFeeCoins: 5"), 'Beginner is not ₹5');
assert(str_contains($seed, "name: 'Bronze', entryFeeCoins: 10"), 'Bronze is not ₹10');
assert(str_contains($seed, "where(eq(lrRoomTiers.name, 'Beginner'))"), 'live Beginner rows are not updated');
assert(str_contains($seed, "where(eq(lrRoomTiers.name, 'Bronze'))"), 'live Bronze rows are not updated');
$home = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/game/scenes/HomeScene.ts');
assert(str_contains($home, 'tierAttempts'), 'Play Online retries empty stake fetch');
$api = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/meta/api.ts');
assert(str_contains($api, "cache: 'no-store'"), 'tiers GET must not use a cached 502');
echo "ludo_min_bet_check OK\n";
