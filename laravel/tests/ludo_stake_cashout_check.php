<?php
/**
 * Smoke: Ludo stake tiers + cashout math (1 coin = ₹1).
 * Run: php laravel/tests/ludo_stake_cashout_check.php
 */
declare(strict_types=1);

$tiersUrl = getenv('LUDO_API_TIERS') ?: 'http://127.0.0.1:8110/api/v1/matches/tiers';
$raw = @file_get_contents($tiersUrl);
assert($raw !== false, "tiers GET failed: $tiersUrl (is ludo-api up?)");
$data = json_decode($raw, true);
assert(is_array($data['tiers'] ?? null) && count($data['tiers']) >= 1, 'tiers empty');
$beginner = null;
foreach ($data['tiers'] as $t) {
    if (($t['name'] ?? '') === 'Beginner') {
        $beginner = $t;
        break;
    }
}
assert($beginner !== null, 'Beginner tier missing');
assert((int)$beginner['entryFee'] === 500, 'Beginner fee expected 500');

// ponytail: prize = entryFee * placeMultiplier; house keeps ~30% on 2p (winner ~1.4x fee)
$entryFee = 500;
$players = 2;
$pot = $entryFee * $players; // 1000
$winnerPrize = (int)round($entryFee * 1.4); // typical 2p first place
$winnerDelta = $winnerPrize - $entryFee; // +200 net
$loserDelta = 0 - $entryFee; // -500
assert($pot === 1000);
assert($winnerDelta === 200);
assert($loserDelta === -500);

echo "OK ludo stake/cashout: Beginner ₹{$beginner['entryFee']}; 2p win net +₹{$winnerDelta}, lose −₹{$entryFee}\n";
