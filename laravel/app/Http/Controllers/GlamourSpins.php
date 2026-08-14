<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;

/**
 * Server side of Glamour Spins, so the game runs on the same wallet as Aviator
 * and the house keeps 30% of what is staked.
 *
 * This game had to be done the hard way. It is a Construct 3 export whose win
 * logic ships as compiled opcodes: there is no paytable to read and no protocol
 * to implement (its Send* functions only assign local variables - the balance
 * moved in the browser and nothing was ever sent). So the margin cannot come from
 * modelling the game. It comes from deciding which spin happens.
 *
 * That works because the client is deterministic. Seed the Math.random stream,
 * pin game time to 1/60s a tick, and a spin replays exactly - same grid, same
 * win, same number of draws. tools/glamour-measure.mjs plays a few thousand seeds
 * and records what each pays; the tilt below leans that measured distribution
 * until its mean is 0.70, and draw() picks from it.
 *
 * One correction worth keeping, because it invalidated a whole earlier attempt: a
 * seed's payout is NOT a property of the seed on its own. The outcome also
 * depends on the board the previous spin left, so a table measured back to back
 * only replayed if you replayed the entire sequence. Restarting the Game layout
 * before arming the seed fixes it - that rebuilds the sprite instances the
 * matching actually runs off, which restoring the board Array did not. So the
 * client bridge must do reset -> arm -> spin, in that order, and the table is
 * stamped "reset-per-spin" so a table measured any other way is refused here.
 *
 * Money is settled BEFORE the seed is handed over. The client cannot be told what
 * is coming and then choose its stake, because by the time it knows the seed the
 * bet is already taken and the win already paid.
 */
class GlamourSpins extends Controller
{
    /** Bet options the client offers (betlimits1..5 in its own globals). */
    public const BETS = [10, 50, 100, 300, 500];

    public const HOUSE_PCT = 30;
    public const TARGET_RTP = 0.70;

    private static ?array $table = null;

    /** @return array{seeds: array<int, array{0: int, 1: float}>, naturalRtp: float} */
    public static function table(): array
    {
        if (self::$table === null) {
            $path = base_path('../tools/glamour-seeds.json');
            if (!is_file($path)) {
                abort(503, 'Glamour Spins is not measured yet. Run: node tools/glamour-measure.mjs --seeds 1500');
            }
            $table = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
            // a table measured without the per-spin layout reset describes a
            // sequence, not a set of seeds, and would pay what nobody was shown
            if (($table['regime'] ?? null) !== 'reset-per-spin') {
                abort(503, 'glamour-seeds.json was measured in an old regime. Re-run tools/glamour-measure.mjs.');
            }
            self::$table = $table;
        }
        return self::$table;
    }

    /**
     * Weights that make the expected multiplier exactly TARGET_RTP.
     *
     * Exponential tilt: w_i proportional to exp(lambda * m_i). One knob, solved by
     * bisection, and it keeps the shape of the measured distribution instead of
     * inventing one - the same spins, just leaned toward or away from the wins by
     * however much the measured RTP is off.
     *
     * @return array{lambda: float, weights: array<int, float>, rtp: float, total: float}
     */
    public static function weights(?float $rtp = null): array
    {
        $target = $rtp ?? self::TARGET_RTP;
        // cached per target, because the admin can move it between spins
        static $cached = [];
        $ck = (string) round($target, 6);
        if (isset($cached[$ck])) {
            return $cached[$ck];
        }
        $mults = array_map(fn ($row) => (float) $row[1], self::table()['seeds']);
        $n = count($mults);
        if ($n < 100) {
            abort(503, "Only $n seeds measured; that is too few to shape a distribution.");
        }
        $max = max($mults);

        // mean multiplier under a given tilt
        $meanAt = function (float $lambda) use ($mults, $max) {
            $sw = 0.0;
            $sm = 0.0;
            foreach ($mults as $m) {
                // subtract max for numerical safety: exp() of a big positive blows up
                $w = exp($lambda * ($m - $max));
                $sw += $w;
                $sm += $w * $m;
            }
            return [$sm / $sw, $sw];
        };

        // the tilt is monotonic in lambda, so bisect
        $lo = -50.0;
        $hi = 50.0;
        if ($meanAt($lo)[0] > $target || $meanAt($hi)[0] < $target) {
            abort(503, 'The measured seeds cannot reach a 70% return; measure more of them.');
        }
        for ($i = 0; $i < 200; $i++) {
            $mid = ($lo + $hi) / 2;
            if ($meanAt($mid)[0] < $target) {
                $lo = $mid;
            } else {
                $hi = $mid;
            }
        }
        $lambda = ($lo + $hi) / 2;

        $weights = [];
        $total = 0.0;
        foreach ($mults as $m) {
            $w = exp($lambda * ($m - $max));
            $weights[] = $w;
            $total += $w;
        }
        [$measured] = $meanAt($lambda);
        return $cached[$ck] = ['lambda' => $lambda, 'weights' => $weights, 'rtp' => $measured, 'total' => $total];
    }

    /** Pick a seed by weight. @return array{0: int, 1: float} [seed, multiplier] */
    public static function draw(?float $rtp = null): array
    {
        $w = self::weights($rtp);
        $seeds = self::table()['seeds'];
        // random_int for the pick, so the outcome is not predictable from the clock
        $r = random_int(0, PHP_INT_MAX) / PHP_INT_MAX * $w['total'];
        $acc = 0.0;
        foreach ($w['weights'] as $i => $weight) {
            $acc += $weight;
            if ($r <= $acc) {
                return [(int) $seeds[$i][0], (float) $seeds[$i][1]];
            }
        }
        $last = end($seeds);
        return [(int) $last[0], (float) $last[1]];
    }

    public function state()
    {
        $userId = user('id');
        $w = self::weights(win_rtp());
        $held = round((float) session('glamour_held_win', 0), 2);
        $bal = (float) wallet($userId, 'num');
        return response()->json([
            'isSuccess' => true,
            'data' => [
                'balance' => $bal,
                'heldWin' => $held,
                'currency' => user('currency') ?: 'Rs',
                'bets' => self::BETS,
                'minBet' => (float) setting('min_bet_amount'),
                'maxBet' => (float) setting('max_bet_amount'),
                'seedsMeasured' => self::table()['count'] ?? count(self::table()['seeds']),
                'rtp' => round($w['rtp'], 4),
                'housePct' => round(100.0 - win_pct(), 2),
            ],
        ]);
    }

    /**
     * Take the bet, decide the spin, and only then hand over the seed.
     *
     * The order is the security. A client that knew the seed before staking could
     * replay it against its own copy of the game - it IS the simulator - and only
     * bet big on the good ones. Here the wallet has already moved by the time the
     * seed exists on the client, so knowing it is worth nothing.
     *
     * The win scales with the stake because the client's win is linear in the bet
     * (measured: seed 101 pays 1.35x at bets 0.5, 1, 2 and 5, to the same grid).
     * Wins are held until CASHOUT (not auto-credited).
     */
    public function spin(Request $r)
    {
        $userId = user('id');
        $bet = round((float) $r->input('bet', self::BETS[0]), 2);
        $minBet = (float) setting('min_bet_amount');
        $maxBet = (float) setting('max_bet_amount');
        if ($bet + 1e-6 < $minBet || $bet > $maxBet + 1e-6) {
            return $this->fail('Bet must be ₹' . $minBet . '–₹' . $maxBet . '.');
        }
        if ((float) wallet($userId, 'num') < $bet) {
            return $this->fail('Not enough balance for this spin.');
        }

        [$seed, $mult] = self::draw(win_rtp());
        $win = round($bet * $mult, 2);

        addwallet($userId, $bet, '-');
        $this->log($userId, $bet, 'debit', 'Glamour Spins bet');
        $held = round((float) session('glamour_held_win', 0) + $win, 2);
        session()->put('glamour_held_win', $held);

        $bal = (float) wallet($userId, 'num');
        return response()->json([
            'isSuccess' => true,
            'data' => [
                'seed' => $seed,
                'bet' => $bet,
                'multiplier' => $mult,
                'win' => $win,
                'heldWin' => $held,
                'balance' => $bal,
            ],
        ]);
    }

    /** Credit held spin wins into the site wallet. */
    public function cashout()
    {
        $userId = user('id');
        $held = round((float) session('glamour_held_win', 0), 2);
        if ($held <= 0) {
            return $this->fail('Nothing to cash out.');
        }
        addwallet($userId, $held, '+');
        $this->log($userId, $held, 'credit', 'Glamour Spins cashout');
        session()->put('glamour_held_win', 0);
        $bal = (float) wallet($userId, 'num');
        return response()->json([
            'isSuccess' => true,
            'data' => [
                'cashed' => $held,
                'heldWin' => 0,
                'balance' => $bal,
            ],
        ]);
    }

    /**
     * The client reporting what its screen actually showed. Nothing here can change
     * the money - it is already settled - but a mismatch means the browser played a
     * different spin than the one that was paid, which is the one failure this
     * design can have and the thing to watch in production.
     */
    public function report(Request $r)
    {
        $expected = (float) $r->input('multiplier', -1);
        $shown = (float) $r->input('shown', -1);
        if ($expected >= 0 && $shown >= 0 && abs($expected - $shown) > 0.0001) {
            \Illuminate\Support\Facades\Log::build(['driver' => 'single', 'path' => storage_path('logs/glamour-mismatch.log')])
                ->warning('glamour mismatch', [
                    'userid' => user('id'),
                    'seed' => $r->input('seed'),
                    'paid' => $expected,
                    'client' => $shown,
                ]);
        }
        return response()->json(['isSuccess' => true]);
    }

    private function fail(string $message)
    {
        return response()->json(['isSuccess' => false, 'message' => $message], 200);
    }

    /** Transaction has no $fillable, so assign like the rest of the app does. */
    private function log(int $userId, float $amount, string $type, string $remark): void
    {
        $t = new Transaction;
        $t->userid = $userId;
        $t->platform = 'slot-glamour';
        $t->type = $type;
        $t->amount = $amount;
        $t->category = 'game';
        $t->remark = $remark;
        $t->status = '1';
        $t->save();
    }
}
