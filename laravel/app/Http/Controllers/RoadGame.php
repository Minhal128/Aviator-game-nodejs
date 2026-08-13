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
    private const MIN_BET = 1;
    private const MAX_BET = 50;

    /** baseSurvival/decay/maxSteps per difficulty, mirroring GAME_MODES in math.js */
    public const MODES = [
        'easy' => ['baseSurvival' => 0.70, 'maxSteps' => 40, 'decay' => 0.005],
        'medium' => ['baseSurvival' => 0.70, 'maxSteps' => 30, 'decay' => 0.010],
        'hard' => ['baseSurvival' => 0.70, 'maxSteps' => 20, 'decay' => 0.018],
        'hardcore' => ['baseSurvival' => 0.70, 'maxSteps' => 15, 'decay' => 0.025],
    ];

    /** survivalAt() in math.js / checkIsCrashLane() in app.js */
    public static function survival(array $mode, int $step): float
    {
        return max(0.05, $mode['baseSurvival'] - $step * $mode['decay']);
    }

    /** calculateMultiplierForIndex() in math.js, including its 2-decimal cut. */
    public static function multiplier(array $mode, int $step): float
    {
        if ($step <= 0) {
            return 1.0;
        }
        $compounded = 1.0;
        for ($i = 1; $i <= $step; $i++) {
            $compounded *= self::survival($mode, $i);
        }
        // volatility is 0 in every mode, so there is no bonus term to mirror
        return round(max(1.01, self::RTP / $compounded), 2);
    }

    /** First step the player does not survive, or maxSteps+1 if the road is cleared. */
    public static function drawCrashStep(array $mode): int
    {
        for ($step = 1; $step <= $mode['maxSteps']; $step++) {
            if (mt_rand() / mt_getrandmax() > self::survival($mode, $step)) {
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
        if ($bet < self::MIN_BET || $bet > self::MAX_BET) {
            return response()->json(['isSuccess' => false, 'message' => 'Bet must be ' . self::MIN_BET . '-' . self::MAX_BET]);
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
            'crash_step' => self::drawCrashStep($mode),
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
            'multiplier' => $crashed ? null : self::multiplier($mode, $round['step']),
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
        $mult = self::multiplier(self::MODES[$round['mode']], $round['step']);
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
