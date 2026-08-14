<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;

/**
 * Server side of Gold of Egypt, so the game runs on the same wallet as Aviator
 * and the house margin is decided here rather than trusted to the browser.
 *
 * How it stays honest:
 *  - the server draws the five reel stops, uniformly over each strip, exactly
 *    the distribution the client's own getRandomOrderPosition() used;
 *  - it settles from its own paytable read, then hands the stops back and the
 *    client animates onto them through the config's existing reels_simulate
 *    hook, so what the player sees is what was already paid;
 *  - tools/gold-egypt-model.json is generated from the game's own config by
 *    `node tools/gold-egypt-rtp.mjs --json`, so the two never drift;
 *  - free spins are counted here, otherwise a client could claim them forever.
 *
 * The margin itself is proved elsewhere: gold-egypt-rtp.mjs enumerates all
 * 460,800 stop combinations and reports RTP 0.6999 (house 30.01%) at lineBet 1,
 * jackpot included. This controller only has to draw uniformly and pay the
 * paytable, which is what tools/gold-egypt-server.php checks.
 */
class GoldEgypt extends Controller
{
    /** 1 coin = 1 paisa, so the 243-coin minimum spin costs Rs 2.43 instead of Rs 243. */
    public const COINS_PER_UNIT = 100;

    /** All 243 lines, always. Fewer lines shrinks the bet but not the scatter or
     *  jackpot pays, which would hand back far more than 70% - at one line the
     *  jackpot alone is worth about 26% of turnover. */
    public const LINES = 243;

    private static ?array $model = null;
    private static ?array $payTable = null;

    private static function model(): array
    {
        if (self::$model === null) {
            $path = base_path('../tools/gold-egypt-model.json');
            self::$model = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        }
        return self::$model;
    }

    /**
     * createFullPaytable() + PayLine.getWildLines(): every payline followed by its
     * wild variants, in that order, because the vendor's findWin takes the FIRST
     * match rather than the best one and we pay the game that ships.
     *
     * @return array<int, array{line: array<int, int>, pay: int}> symbol ids, -1 = any
     */
    private static function payTable(): array
    {
        if (self::$payTable !== null) {
            return self::$payTable;
        }
        $m = self::model();
        $id = [];
        foreach ($m['symbols'] as $i => $s) {
            $id[$s['name']] = $i;
        }
        $substitutable = [];
        foreach ($m['symbols'] as $s) {
            if ($s['useWildSubstitute']) {
                $substitutable[$s['name']] = true;
            }
        }

        $out = [];
        foreach ($m['payLines'] as $pl) {
            $base = array_map(fn ($n) => $n === 'any' ? -1 : $id[$n], $pl['line']);
            $out[] = ['line' => $base, 'pay' => $pl['pay']];
            if (!$m['useWild']) {
                continue;
            }
            $positions = [];
            $counter = 0;
            foreach ($pl['line'] as $i => $n) {
                if ($n === 'any' || $n === $m['wild']) {
                    continue;
                }
                if ($counter === 0 && !$m['useWildInFirstPosition']) {   // first symbol is never wild
                    $counter++;
                    continue;
                }
                if (isset($substitutable[$n])) {
                    $positions[] = $i;
                }
                $counter++;
            }
            for ($mask = 1; $mask < (1 << count($positions)); $mask++) {
                $line = $base;
                foreach ($positions as $b => $pos) {
                    if ($mask & (1 << $b)) {
                        $line[$pos] = $id[$m['wild']];
                    }
                }
                $out[] = ['line' => $line, 'pay' => $pl['pay']];
            }
        }
        return self::$payTable = $out;
    }

    /** Uniform stop per reel, the same draw the client used to make. */
    public static function drawStops(): array
    {
        $stops = [];
        foreach (self::model()['reels'] as $r) {
            $stops[] = random_int(0, count($r['symbolImages']) - 1);
        }
        return $stops;
    }

    /**
     * Coins won for one set of reel stops, before the lineBet multiplier.
     *
     * @return array{line: int, scatter: int, jackpot: int, freeSpins: int}
     */
    public static function evaluate(array $stops): array
    {
        $m = self::model();
        $id = [];
        foreach ($m['symbols'] as $i => $s) {
            $id[$s['name']] = $i;
        }

        // window = symbols[(stop + row) % len], the client's getWindowsSymbols
        $window = [];
        foreach ($m['reels'] as $ri => $r) {
            $strip = $r['symbolImages'];
            $len = count($strip);
            for ($row = 0; $row < $r['windowsCount']; $row++) {
                $window[$ri][$row] = $id[$strip[($stops[$ri] + $row) % $len]];
            }
        }

        // one bucket per opening symbol: a line whose first reel matches nothing
        // can be dropped without looking at the other four
        $buckets = [];
        foreach (self::payTable() as $entry) {
            $buckets[$entry['line'][0]][] = $entry;
        }

        $rows = array_map(fn ($r) => $r['windowsCount'], $m['reels']);
        $reelCount = count($rows);
        // divisor per reel: ComboCounter is an odometer with the last reel as the
        // fastest digit, so line k takes row (k / div) % rows for each reel - the
        // same order the client builds
        $div = [];
        $d = 1;
        for ($ri = $reelCount - 1; $ri >= 0; $ri--) {
            $div[$ri] = $d;
            $d *= $rows[$ri];
        }

        $line = 0;
        for ($k = 0; $k < self::LINES; $k++) {
            $symbols = [];
            for ($ri = 0; $ri < $reelCount; $ri++) {
                $symbols[$ri] = $window[$ri][intdiv($k, $div[$ri]) % $rows[$ri]];
            }
            foreach ($buckets[$symbols[0]] ?? [] as $entry) {
                $hit = true;
                for ($i = 1; $i < $reelCount; $i++) {
                    $want = $entry['line'][$i];
                    if ($want !== -1 && $want !== $symbols[$i]) {
                        $hit = false;
                        break;
                    }
                }
                if ($hit) {
                    $line += $entry['pay'];
                    break;                      // first match wins, not best
                }
            }
        }

        $scatterCount = 0;
        $jackpotCount = 0;
        foreach ($window as $reel) {
            foreach ($reel as $sym) {
                if ($sym === $id[$m['scatter']]) {
                    $scatterCount++;
                } elseif ($sym === $id[$m['jackpot']['symbolName']]) {
                    $jackpotCount++;
                }
            }
        }

        $scatter = 0;
        $freeSpins = 0;
        foreach ($m['scatterPayTable'] as $rule) {
            if ($scatterCount === $rule['scattersCount']) {   // WinController uses ==, not >=
                $scatter += $rule['pay'];
                $freeSpins += $rule['freeSpins'];
            }
        }

        // flat pot, not multiplied by lineBet, and frozen so the RTP has one value
        $jackpot = $jackpotCount === $m['jackpot']['symbolsCount'] ? $m['jackpot']['defaultAmount'] : 0;

        return ['line' => $line, 'scatter' => $scatter, 'jackpot' => $jackpot, 'freeSpins' => $freeSpins];
    }

    public function spin(Request $r)
    {
        $m = self::model();
        $userId = user('id');
        $lineBet = (int) $r->input('lineBet', 1);
        $lines = (int) $r->input('lines', self::LINES);

        if ($lines !== self::LINES) {
            return $this->fail('All ' . self::LINES . ' lines have to be in play.');
        }

        // free spins are the server's count, so the client cannot mint them
        $freeLeft = (int) session('gold_free_left', 0);
        $free = $freeLeft > 0;

        // Exact ₹ stake from client (no 243×lineBet quantize). lineBet = paytable mult.
        $minStake = 100.0;
        $bal = (float) wallet($userId, 'num');
        if ($r->filled('betAmount')) {
            $betAmount = round((float) $r->input('betAmount'), 2);
        } else {
            $betAmount = round(($lines * max(1, $lineBet)) / self::COINS_PER_UNIT, 2);
        }
        if ($lineBet < 1) {
            $lineBet = max(1, (int) round($betAmount * self::COINS_PER_UNIT / self::LINES));
        }
        $betCoins = $free ? 0 : (int) round($betAmount * self::COINS_PER_UNIT);
        if (!$free) {
            if ($betAmount + 1e-6 < $minStake) {
                return $this->fail('Minimum bet is ₹100.');
            }
            if ($bal < $betAmount) {
                return $this->fail('Not enough balance for this spin.');
            }
            addwallet($userId, $betAmount, '-');
            $this->log($userId, $betAmount, 'debit', 'Gold of Egypt bet');
        } else {
            session()->put('gold_free_left', $freeLeft - 1);
        }

        $stops = self::drawStops();
        $win = self::evaluate($stops);

        // win = (lineWin + scatterWin) * lineBet + flat jackpot
        $winCoins = ($win['line'] + $win['scatter']) * ($m['useLineBetMultiplier'] ? $lineBet : 1) + $win['jackpot'];
        $winAmount = $winCoins / self::COINS_PER_UNIT;
        // Hold wins until CASHOUT — do not credit wallet here.
        $held = round((float) session('gold_held_win', 0) + $winAmount, 2);
        session()->put('gold_held_win', $held);
        if ($win['freeSpins'] > 0) {
            session()->put('gold_free_left', (int) session('gold_free_left', 0) + $win['freeSpins']);
        }

        $bal = (float) wallet($userId, 'num');
        return response()->json([
            'isSuccess' => true,
            'data' => [
                'stops' => $stops,
                'free' => $free,
                'betCoins' => $betCoins,
                'winCoins' => $winCoins,
                'heldWin' => $held,
                'heldCoins' => (int) round($held * self::COINS_PER_UNIT),
                'win' => $win,
                'freeLeft' => (int) session('gold_free_left', 0),
                'balance' => $bal,
                'coins' => (int) round($bal * self::COINS_PER_UNIT),
            ],
        ]);
    }

    /** Move held spin wins into the site wallet. */
    public function cashout()
    {
        $userId = user('id');
        $held = round((float) session('gold_held_win', 0), 2);
        if ($held <= 0) {
            return $this->fail('Nothing to cash out.');
        }
        addwallet($userId, $held, '+');
        $this->log($userId, $held, 'credit', 'Gold of Egypt cashout');
        session()->put('gold_held_win', 0);
        $bal = (float) wallet($userId, 'num');
        return response()->json([
            'isSuccess' => true,
            'data' => [
                'cashed' => $held,
                'heldWin' => 0,
                'heldCoins' => 0,
                'balance' => $bal,
                'coins' => (int) round($bal * self::COINS_PER_UNIT),
            ],
        ]);
    }

    /** Opening balance, so the reels never start from the demo credit. */
    public function state()
    {
        $userId = user('id');
        $held = round((float) session('gold_held_win', 0), 2);
        $bal = (float) wallet($userId, 'num');
        return response()->json([
            'isSuccess' => true,
            'data' => [
                'balance' => $bal,
                'coins' => (int) round($bal * self::COINS_PER_UNIT),
                'heldWin' => $held,
                'heldCoins' => (int) round($held * self::COINS_PER_UNIT),
                'coinsPerUnit' => self::COINS_PER_UNIT,
                'lines' => self::LINES,
                'lineBetMax' => max(1, (int) ceil($bal * self::COINS_PER_UNIT / self::LINES)),
                'jackpotPot' => self::model()['jackpot']['defaultAmount'],
                'freeLeft' => (int) session('gold_free_left', 0),
                'losingStops' => self::aLosingCombination(),
            ],
        ]);
    }

    /**
     * A stop combination that pays nothing. When a spin is refused the reels still
     * have to land somewhere or the client's state machine waits forever, and
     * landing them at random would show a win that was never paid.
     */
    public static function aLosingCombination(): array
    {
        for ($i = 0; $i < 200; $i++) {          // about a third of combinations lose
            $stops = self::drawStops();
            $win = self::evaluate($stops);
            if ($win['line'] === 0 && $win['scatter'] === 0 && $win['jackpot'] === 0) {
                return $stops;
            }
        }
        return array_fill(0, count(self::model()['reels']), 0);   // never seen; better than a fake win
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
        $t->platform = 'gold-egypt';
        $t->type = $type;
        $t->amount = $amount;
        $t->category = 'game';
        $t->remark = $remark;
        $t->status = '1';
        $t->save();
    }
}
