<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;

/**
 * Chicken Road on the real wallet, with the crash lane decided here.
 *
 * The client used to roll its own PRNG and its own balance, so the 30% margin
 * in Chicken-Road/Main/js/math.js was decoration - a player could edit the JS
 * and never crash. Now the server picks the crash step when the bet is placed
 * and reveals it one lane at a time, and the multiplier is recomputed here, so
 * the house keeps 30% no matter what the client says.
 *
 * MODES and the multiplier formula MUST stay identical to
 * Chicken-Road/Main/js/math.js - tools/house-edge-check.mjs checks the JS side,
 * tools/road-house-edge.php checks this side.
 */
class RoadGame extends Controller
{
    private const HOUSE_PCT = 30.0;
    private const RTP = (100.0 - self::HOUSE_PCT) / 100.0;

    /** baseSurvival/decay/maxSteps per difficulty, mirroring GAME_MODES in math.js */
    public const MODES = [
        'easy' => ['baseSurvival' => 0.70, 'maxSteps' => 40, 'decay' => 0.005],
        'medium' => ['baseSurvival' => 0.70, 'maxSteps' => 30, 'decay' => 0.010],
        'hard' => ['baseSurvival' => 0.70, 'maxSteps' => 20, 'decay' => 0.018],
        'hardcore' => ['baseSurvival' => 0.70, 'maxSteps' => 15, 'decay' => 0.025],
    ];

    /**
     * survivalAt() in math.js / checkIsCrashLane() in app.js.
     *
     * baseSurvival IS the rtp in every shipped mode, and that is not a
     * coincidence: multiplier() pays rtp / reach, so a road that survives more
     * often than the rtp can only sell multipliers under 1.00x. The admin's
     * percentage therefore moves the road's danger, not just the ladder - drop it
     * to 30% and the chicken dies early instead of being sold a losing cash-out.
     */
    public static function survival(array $mode, int $step, ?float $rtp = null): float
    {
        return max(0.05, ($rtp ?? $mode['baseSurvival']) - $step * $mode['decay']);
    }

    /**
     * calculateMultiplierForIndex() in math.js, including its 2-decimal cut.
     * $rtp defaults to the built-in 70% so the offline checkers in tools/ can call
     * this without a database; the controller passes the admin's win_rtp() instead.
     */
    public static function multiplier(array $mode, int $step, ?float $rtp = null): float
    {
        if ($step <= 0) {
            return 1.0;
        }
        $compounded = 1.0;
        for ($i = 1; $i <= $step; $i++) {
            $compounded *= self::survival($mode, $i, $rtp);
        }
        // volatility is 0 in every mode, so there is no bonus term to mirror
        return round(max(1.01, ($rtp ?? self::RTP) / $compounded), 2);
    }

    /** First step the player does not survive, or maxSteps+1 if the road is cleared. */
    public static function drawCrashStep(array $mode, ?float $rtp = null): int
    {
        for ($step = 1; $step <= $mode['maxSteps']; $step++) {
            if (mt_rand() / mt_getrandmax() > self::survival($mode, $step, $rtp)) {
                return $step;
            }
        }
        return $mode['maxSteps'] + 1;
    }

    private function mode(Request $r): ?array
    {
        return self::MODES[(string) $r->mode] ?? null;
    }

    private function log(int $userId, float $amount, string $type, string $remark): void
    {
        // the model has no $fillable, so assign like the rest of the app does
        $t = new Transaction;
        $t->userid = (string) $userId;
        $t->platform = 'web';
        $t->type = $type;
        $t->amount = (string) $amount;
        $t->category = 'chicken-road';
        $t->remark = $remark;
        $t->status = '1';
        $t->save();
    }

    public function bet(Request $r)
    {
        $mode = $this->mode($r);
        if (!$mode) {
            return response()->json(['isSuccess' => false, 'message' => 'Unknown difficulty']);
        }
        $bet = round((float) $r->bet, 2);
        $minBet = (float) setting('min_bet_amount');
        $maxBet = (float) setting('max_bet_amount');
        if ($bet < $minBet || $bet > $maxBet) {
            return response()->json(['isSuccess' => false, 'message' => 'Bet must be ' . $minBet . '-' . $maxBet]);
        }
        $userId = (int) user('id');
        if (wallet($userId, 'num') < $bet) {
            return response()->json(['isSuccess' => false, 'message' => 'Insufficient balance']);
        }
        if (session()->has('road_round')) {
            // a reload mid-round leaves the stake spent; drop the orphan and let them bet again
            session()->forget('road_round');
        }

        addwallet($userId, $bet, '-');
        $this->log($userId, $bet, 'debit', 'bet ' . (string) $r->mode);
        // ponytail: one round per session, so no table. Add one if you need round history.
        session()->put('road_round', [
            'bet' => $bet,
            'mode' => (string) $r->mode,
            'step' => 0,
            'crash_step' => self::drawCrashStep($mode, win_rtp()),
            // frozen at bet time: an admin change mid-round must not repay an open round
            'rtp' => win_rtp(),
        ]);

        return response()->json(['isSuccess' => true, 'data' => ['balance' => (float) wallet($userId, 'num')]]);
    }

    public function step(Request $r)
    {
        $round = session('road_round');
        if (!$round) {
            return response()->json(['isSuccess' => false, 'message' => 'No open round']);
        }
        $mode = self::MODES[$round['mode']];
        $round['step']++;
        $crashed = $round['step'] >= $round['crash_step'];

        if ($crashed) {
            session()->forget('road_round');
            $this->log((int) user('id'), 0, 'credit', 'crash at step ' . $round['step']);
        } else {
            session()->put('road_round', $round);
        }

        return response()->json(['isSuccess' => true, 'data' => [
            'step' => $round['step'],
            'crashed' => $crashed,
            'multiplier' => $crashed ? null : self::multiplier($mode, $round['step'], $round['rtp'] ?? null),
            'balance' => (float) wallet((int) user('id'), 'num'),
        ]]);
    }

    public function cashout(Request $r)
    {
        $round = session('road_round');
        if (!$round || $round['step'] < 1) {
            return response()->json(['isSuccess' => false, 'message' => 'Nothing to cash out']);
        }
        $userId = (int) user('id');
        $mult = self::multiplier(self::MODES[$round['mode']], $round['step'], $round['rtp'] ?? null);
        $payout = round($round['bet'] * $mult, 2);

        session()->forget('road_round');   // before crediting, so a double-click cannot pay twice
        addwallet($userId, $payout);
        $this->log($userId, $payout, 'credit', 'cashout ' . $mult . 'x at step ' . $round['step']);

        return response()->json(['isSuccess' => true, 'data' => [
            'multiplier' => $mult,
            'payout' => $payout,
            'balance' => (float) wallet($userId, 'num'),
        ]]);
    }
}
