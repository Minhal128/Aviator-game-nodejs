<?php

namespace App\Services;

use App\Models\Gameresult;
use App\Models\User;
use App\Models\Userbit;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * House keeps 30%. Payout pool = 70% of round bets.
 * Crash when no active (non-cashed) bet can be paid at current multiplier:
 *   min(active.amount) * multiplier > remaining_pool
 *
 * When the pool cannot pay even the smallest bet at 1.00x (solo player, or one
 * bet >70% of the round), that rule can only ever crash at 1.00x — the round is
 * then flown in 'house' mode: random crash point with the same 30% edge,
 * banked over many rounds instead of guaranteed per round.
 */
class PoolCrashEngine
{
    public const HOUSE_PCT = 30.0;
    public const TICK_MS = 100;
    /** @deprecated linear step; liveMultiplier uses GROWTH_PER_MS */
    public const STEP = 0.01;
    /** e^(r·t): r=1e-4 → ~2.00x at 7s (Spribe-like). Old linear was 0.1x/s → flat and slow. */
    public const GROWTH_PER_MS = 0.0001;
    /** ponytail: hard ceiling on house-mode payout; raise if the client wants bigger tails */
    public const MAX_MULT = 100.0;

    private function key(int $gameId): string
    {
        return "pool_crash:{$gameId}";
    }

    public function get(int $gameId): ?array
    {
        $state = Cache::get($this->key($gameId));
        return is_array($state) ? $state : null;
    }

    public function put(int $gameId, array $state): void
    {
        Cache::put($this->key($gameId), $state, 600);
    }

    public function clear(int $gameId): void
    {
        Cache::forget($this->key($gameId));
    }

    /** Start flight for current round. */
    public function startFlight(int $gameId): array
    {
        $existing = $this->get($gameId);

        if ($existing && ($existing['phase'] ?? '') === 'flying') {
            $this->syncPoolFromBets($gameId, $existing);
            $this->put($gameId, $existing);
            return $existing;
        }
        if ($existing && ($existing['phase'] ?? '') === 'crashed') {
            return $existing;
        }

        $total = (float) Userbit::where('gameid', (string) $gameId)->sum('amount');
        $pool = round($total * (100.0 - self::HOUSE_PCT) / 100.0, 2);
        $minBet = $this->minActiveBet($gameId);

        $state = [
            'game_id' => $gameId,
            'phase' => 'flying',
            'mode' => ($minBet !== null && $minBet <= $pool) ? 'pool' : 'house',
            'total_bets' => $total,
            'pool' => $pool,
            'paid' => 0.0,
            'multiplier' => 1.0,
            'started_at' => microtime(true),
            'crash_at' => null,
        ];

        if ($state['mode'] === 'house') {
            $state['crash_at'] = self::houseCrashPoint();
        }

        $this->put($gameId, $state);
        return $state;
    }

    /**
     * Crash point for house-risk rounds. P(crash >= x) = 0.70 / x, so cashing out
     * at any target returns 70% long run — the same 30% edge, spread over rounds.
     * ~30% of these rounds bust at 1.00x, exactly like a real crash curve.
     */
    public static function houseCrashPoint(): float
    {
        $u = mt_rand(0, mt_getrandmax() - 1) / mt_getrandmax(); // [0,1)
        $c = (100.0 - self::HOUSE_PCT) / 100.0 / (1.0 - $u);
        return round(min(self::MAX_MULT, max(1.0, $c)), 2);
    }

    public function liveMultiplier(array $state): float
    {
        if (($state['phase'] ?? '') !== 'flying') {
            return round((float) ($state['multiplier'] ?? 1), 2);
        }
        $elapsedMs = max(0.0, (microtime(true) - (float) $state['started_at']) * 1000.0);
        $m = exp(self::GROWTH_PER_MS * $elapsedMs);
        return round(min(self::MAX_MULT, max(1.0, $m)), 2);
    }

    public function remainingPool(array $state): float
    {
        return round(max(0, (float) $state['pool'] - (float) $state['paid']), 2);
    }

    /** @return float|null min active bet amount */
    public function minActiveBet(int $gameId): ?float
    {
        // amount + 0: the column is text on legacy installs, where MIN() would
        // compare as text and pick '1000.00' over '670.00'
        $min = Userbit::where('gameid', (string) $gameId)->where('status', '0')->min(DB::raw('amount + 0'));
        return $min === null ? null : (float) $min;
    }

    public function shouldCrash(int $gameId, array $state, float $mult): bool
    {
        if (($state['phase'] ?? '') !== 'flying') {
            return true;
        }

        $minBet = $this->minActiveBet($gameId);
        if ($minBet === null && (float) ($state['total_bets'] ?? 0) > 0) {
            // everyone cashed out — end round
            return true;
        }

        if (($state['mode'] ?? '') === 'house') {
            return $mult >= (float) $state['crash_at'];
        }

        $need = round($minBet * $mult, 2);
        return $need > $this->remainingPool($state);
    }

    /**
     * Pool mode: any active bet whose cashout at $mult would exceed remaining
     * pool is forfeited (that bet flies away). Other bets keep flying.
     * e.g. 300+700 → pool 700: at >1.00x the 700 bet auto-loses; 300 can ride to ~2.33x.
     *
     * @return list<array{bet_id:int, section_no:int, userid:int, amount:float}>
     */
    private function forfeitUnaffordableBets(int $gameId, array &$state, float $mult): array
    {
        $forfeited = [];
        if (($state['mode'] ?? '') !== 'pool') {
            return $forfeited;
        }
        $remaining = $this->remainingPool($state);
        $actives = Userbit::where('gameid', (string) $gameId)->where('status', '0')->get();
        foreach ($actives as $bet) {
            $need = round((float) $bet->amount * $mult, 2);
            if ($need > $remaining) {
                Userbit::where('id', $bet->id)->update([
                    'status' => 1,
                    'cashout_multiplier' => '0.00',
                ]);
                $forfeited[] = [
                    'bet_id' => (int) $bet->id,
                    'section_no' => (int) $bet->section_no,
                    'userid' => (int) $bet->userid,
                    'amount' => (float) $bet->amount,
                ];
                Log::info('pool_crash: forfeit unaffordable bet', [
                    'gameId' => $gameId,
                    'betId' => $bet->id,
                    'amount' => $bet->amount,
                    'mult' => $mult,
                    'need' => $need,
                    'remaining' => $remaining,
                ]);
            }
        }
        return $forfeited;
    }

    /**
     * Advance / read state. May settle crash.
     * @return array{multiplier: float, phase: string, crashed: bool, remaining_pool: float, game_id: int, forfeited?: list}
     */
    public function tick(int $gameId): array
    {
        return Cache::lock("pool_crash_lock:{$gameId}", 5)->block(3, function () use ($gameId) {
            $state = $this->get($gameId);
            if (!$state) {
                return [
                    'multiplier' => 1.0,
                    'phase' => 'idle',
                    'crashed' => false,
                    'remaining_pool' => 0.0,
                    'game_id' => $gameId,
                    'forfeited' => [],
                ];
            }

            if ($state['phase'] === 'crashed') {
                return [
                    'multiplier' => round((float) $state['multiplier'], 2),
                    'phase' => 'crashed',
                    'crashed' => true,
                    'remaining_pool' => $this->remainingPool($state),
                    'game_id' => $gameId,
                    'forfeited' => [],
                ];
            }

            $this->syncPoolFromBets($gameId, $state);

            $mult = $this->liveMultiplier($state);
            $state['multiplier'] = $mult;

            // drop bets the pool can no longer pay, then re-check crash on survivors
            $forfeited = $this->forfeitUnaffordableBets($gameId, $state, $mult);

            if ($this->shouldCrash($gameId, $state, $mult)) {
                $this->settleCrash($gameId, $state, $mult);
                return [
                    'multiplier' => $mult,
                    'phase' => 'crashed',
                    'crashed' => true,
                    'remaining_pool' => $this->remainingPool($state),
                    'game_id' => $gameId,
                    'forfeited' => $forfeited,
                ];
            }

            $this->put($gameId, $state);
            return [
                'multiplier' => $mult,
                'phase' => 'flying',
                'crashed' => false,
                'remaining_pool' => $this->remainingPool($state),
                'game_id' => $gameId,
                'forfeited' => $forfeited,
            ];
        });
    }

    /** Keep pool in sync if more bets joined after flight start. */
    private function syncPoolFromBets(int $gameId, array &$state): void
    {
        $total = (float) Userbit::where('gameid', (string) $gameId)->sum('amount');
        if ($total <= 0) {
            return;
        }
        $state['total_bets'] = $total;
        $state['pool'] = round($total * (100.0 - self::HOUSE_PCT) / 100.0, 2);

        // Bets that landed after startFlight can make pool mode viable. Only before
        // the first payout — re-deciding mid-round would move an announced crash point.
        if ((float) $state['paid'] > 0) {
            return;
        }
        $minBet = $this->minActiveBet($gameId);
        if ($minBet !== null && $minBet <= $state['pool']) {
            $state['mode'] = 'pool';
            $state['crash_at'] = null;
        }
    }

    /**
     * Cash out using multiplier at click (capped by server clock).
     * @param float $clientMult multiplier shown when user clicked cashout
     */
    public function cashout(int $gameId, int $betId, int $userId, float $clientMult = 0): array
    {
        return Cache::lock("pool_crash_lock:{$gameId}", 5)->block(3, function () use ($gameId, $betId, $userId, $clientMult) {
            $state = $this->get($gameId);
            if (!$state || ($state['phase'] ?? '') !== 'flying') {
                return ['ok' => false, 'message' => 'Round not flying', 'crashed' => ($state['phase'] ?? '') === 'crashed'];
            }

            $this->syncPoolFromBets($gameId, $state);
            $this->put($gameId, $state);

            $bet = Userbit::where('id', $betId)
                ->where('userid', (string) $userId)
                ->where('gameid', (string) $gameId)
                ->first();
            if (!$bet || (string) $bet->status !== '0') {
                return ['ok' => false, 'message' => 'Bet not available', 'crashed' => false];
            }

            $serverMult = $this->liveMultiplier($state);
            // ponytail: pay at clicked mult if not ahead of server (UI lag safe)
            $mult = $serverMult;
            if ($clientMult >= 1.0 && $clientMult <= $serverMult + 0.05) {
                $mult = round(min($clientMult, $serverMult), 2);
            }

            $payout = round((float) $bet->amount * $mult, 2);
            $remaining = $this->remainingPool($state);

            // pool mode: unaffordable cashout = THIS bet loses, round continues for others
            if (($state['mode'] ?? '') === 'pool' && $payout > $remaining) {
                Log::info('pool_crash: cashout forfeit (cannot pay)', compact('gameId', 'betId', 'mult', 'payout', 'remaining'));
                Userbit::where('id', $betId)->update([
                    'status' => 1,
                    'cashout_multiplier' => '0.00',
                ]);

                $crashed = false;
                if ($this->shouldCrash($gameId, $state, $mult)) {
                    $this->settleCrash($gameId, $state, $mult);
                    $crashed = true;
                } else {
                    $this->put($gameId, $state);
                }

                return [
                    'ok' => false,
                    'message' => '',
                    'crashed' => $crashed,
                    'bet_lost' => true,
                    'multiplier' => $mult,
                    'silent' => true,
                ];
            }

            addwallet($userId, $payout);
            Userbit::where('id', $betId)->update([
                'status' => 1,
                'cashout_multiplier' => number_format($mult, 2, '.', ''),
            ]);

            $state['paid'] = round((float) $state['paid'] + $payout, 2);
            $state['multiplier'] = $mult;

            // after this payout, drop any remaining bets the leftover pool can't cover
            $this->forfeitUnaffordableBets($gameId, $state, $mult);

            $crashed = false;
            if ($this->shouldCrash($gameId, $state, $mult)) {
                $this->settleCrash($gameId, $state, $mult);
                $crashed = true;
            } else {
                $this->put($gameId, $state);
            }

            return [
                'ok' => true,
                'cash_out_amount' => $payout,
                'wallet_balance' => wallet($userId, 'num'),
                'multiplier' => $mult,
                'crashed' => $crashed,
                'remaining_pool' => $this->remainingPool($state),
            ];
        });
    }

    /**
     * Idempotent crash settlement. Admin gets total_bets - paid (house + leftover pool).
     * The multiplier is always the server's own clock — never a number from the browser.
     */
    public function ensureCrashed(int $gameId): void
    {
        Cache::lock("pool_crash_lock:{$gameId}", 5)->block(3, function () use ($gameId) {
            $state = $this->get($gameId);
            $gr = Gameresult::find($gameId);
            if (!$gr) {
                return;
            }
            if ($gr->result !== 'pending' && $gr->result !== '') {
                $this->ensureNextPending();
                return;
            }
            if ($state && ($state['phase'] ?? '') === 'crashed') {
                $this->ensureNextPending();
                return;
            }
            if (!$state) {
                $state = [
                    'game_id' => $gameId,
                    'phase' => 'flying',
                    'mode' => 'pool',
                    'total_bets' => (float) Userbit::where('gameid', $gameId)->sum('amount'),
                    'pool' => 0,
                    'paid' => 0,
                    'multiplier' => 1.0,
                    'started_at' => microtime(true),
                ];
                $state['pool'] = round($state['total_bets'] * (100.0 - self::HOUSE_PCT) / 100.0, 2);
            }
            $this->settleCrash($gameId, $state, $this->liveMultiplier($state));
        });
    }

    private function settleCrash(int $gameId, array &$state, float $mult): void
    {
        DB::transaction(function () use ($gameId, &$state, $mult) {
            $gr = Gameresult::where('id', $gameId)->lockForUpdate()->first();
            if (!$gr || ($gr->result !== 'pending' && $gr->result !== '')) {
                $state['phase'] = 'crashed';
                $state['multiplier'] = $mult;
                $this->put($gameId, $state);
                $this->ensureNextPending();
                return;
            }

            $gr->result = number_format($mult, 2, '.', '');
            $gr->save();

            Userbit::where('gameid', (string) $gameId)->where('status', '0')->update(['status' => 1]);

            // ponytail: admin = money not paid to winners (house cut + leftover pool).
            // Negative in house mode when a player beat the curve — debit, don't hide it.
            $delta = round((float) $state['total_bets'] - (float) $state['paid'], 2);
            if ($delta != 0.0) {
                $adminId = User::where('isadmin', '1')->value('id')
                    ?: User::where('email', 'admin@example.com')->value('id');
                if ($adminId) {
                    addwallet((int) $adminId, abs($delta), $delta > 0 ? '+' : '-');
                }
            }

            $state['phase'] = 'crashed';
            $state['multiplier'] = $mult;
            $this->put($gameId, $state);
            $this->ensureNextPending();
        });
    }

    private function ensureNextPending(): void
    {
        $latest = Gameresult::orderBy('id', 'desc')->first();
        if ($latest && $latest->result === 'pending') {
            return;
        }
        $result = new Gameresult;
        $result->result = 'pending';
        $result->save();
    }
}
