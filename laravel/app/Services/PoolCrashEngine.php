<?php

namespace App\Services;

use App\Models\Gameresult;
use App\Models\User;
use App\Models\Userbit;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * House keeps 30%. Payout pool = 70% of round bets.
 * Crash when no active (non-cashed) bet can be paid at current multiplier:
 *   min(active.amount) * multiplier > remaining_pool
 */
class PoolCrashEngine
{
    public const HOUSE_PCT = 30.0;
    public const TICK_MS = 100;
    public const STEP = 0.01;

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

        $state = [
            'game_id' => $gameId,
            'phase' => 'flying',
            'mode' => $total > 0 ? 'pool' : 'random',
            'total_bets' => $total,
            'pool' => $pool,
            'paid' => 0.0,
            'multiplier' => 1.0,
            'started_at' => microtime(true),
            'crash_at' => null,
        ];

        if ($state['mode'] === 'random') {
            $state['crash_at'] = (float) rand(8, 11);
        }

        $this->put($gameId, $state);
        return $state;
    }

    public function liveMultiplier(array $state): float
    {
        if (($state['phase'] ?? '') !== 'flying') {
            return round((float) ($state['multiplier'] ?? 1), 2);
        }
        $elapsedMs = (int) ((microtime(true) - (float) $state['started_at']) * 1000);
        $steps = intdiv(max(0, $elapsedMs), self::TICK_MS);
        return round(1.0 + $steps * self::STEP, 2);
    }

    public function remainingPool(array $state): float
    {
        return round(max(0, (float) $state['pool'] - (float) $state['paid']), 2);
    }

    /** @return float|null min active bet amount */
    public function minActiveBet(int $gameId): ?float
    {
        $min = Userbit::where('gameid', (string) $gameId)->where('status', '0')->min('amount');
        return $min === null ? null : (float) $min;
    }

    public function shouldCrash(int $gameId, array $state, float $mult): bool
    {
        if (($state['phase'] ?? '') !== 'flying') {
            return true;
        }

        if (($state['mode'] ?? '') === 'random') {
            return $mult >= (float) $state['crash_at'];
        }

        $minBet = $this->minActiveBet($gameId);
        if ($minBet === null) {
            // everyone cashed out — end round
            return true;
        }

        $need = round($minBet * $mult, 2);
        return $need > $this->remainingPool($state);
    }

    /**
     * Advance / read state. May settle crash.
     * @return array{multiplier: float, phase: string, crashed: bool, remaining_pool: float, game_id: int}
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
                ];
            }

            if ($state['phase'] === 'crashed') {
                return [
                    'multiplier' => round((float) $state['multiplier'], 2),
                    'phase' => 'crashed',
                    'crashed' => true,
                    'remaining_pool' => $this->remainingPool($state),
                    'game_id' => $gameId,
                ];
            }

            $this->syncPoolFromBets($gameId, $state);

            $mult = $this->liveMultiplier($state);
            $state['multiplier'] = $mult;

            if ($this->shouldCrash($gameId, $state, $mult)) {
                $this->settleCrash($gameId, $state, $mult);
                return [
                    'multiplier' => $mult,
                    'phase' => 'crashed',
                    'crashed' => true,
                    'remaining_pool' => $this->remainingPool($state),
                    'game_id' => $gameId,
                ];
            }

            $this->put($gameId, $state);
            return [
                'multiplier' => $mult,
                'phase' => 'flying',
                'crashed' => false,
                'remaining_pool' => $this->remainingPool($state),
                'game_id' => $gameId,
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
        $state['mode'] = 'pool';
        $state['total_bets'] = $total;
        $state['pool'] = round($total * (100.0 - self::HOUSE_PCT) / 100.0, 2);
        $state['crash_at'] = null;
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

            if ($payout > $remaining) {
                // this bet can't be paid — fly away, no error toast needed
                $this->settleCrash($gameId, $state, $mult);
                return [
                    'ok' => false,
                    'message' => '',
                    'crashed' => true,
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

    /** Idempotent crash settlement. Admin gets total_bets - paid (house + leftover pool). */
    public function ensureCrashed(int $gameId, float $fallbackMult): void
    {
        Cache::lock("pool_crash_lock:{$gameId}", 5)->block(3, function () use ($gameId, $fallbackMult) {
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
                    'multiplier' => $fallbackMult,
                    'started_at' => microtime(true),
                ];
                $state['pool'] = round($state['total_bets'] * (100.0 - self::HOUSE_PCT) / 100.0, 2);
            }
            $mult = $fallbackMult > 0 ? $fallbackMult : $this->liveMultiplier($state);
            $this->settleCrash($gameId, $state, $mult);
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

            // ponytail: admin = money not paid to winners (house cut + leftover pool)
            $adminCredit = round(max(0, (float) $state['total_bets'] - (float) $state['paid']), 2);
            if ($adminCredit > 0) {
                $adminId = User::where('isadmin', '1')->value('id')
                    ?: User::where('email', 'admin@example.com')->value('id');
                if ($adminId) {
                    addwallet((int) $adminId, $adminCredit);
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
