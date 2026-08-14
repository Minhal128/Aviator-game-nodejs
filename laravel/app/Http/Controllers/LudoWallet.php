<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;

/**
 * Server-to-server wallet for Ludo Royale (Node MatchService → Laravel).
 * 1 Ludo coin = ₹1. Auth is a shared key, not the browser session.
 */
class LudoWallet extends Controller
{
    public function handle(Request $r)
    {
        $key = (string) env('LUDO_WALLET_KEY', '');
        if ($key === '' || !hash_equals($key, (string) $r->header('X-TL-Ludo-Key', ''))) {
            return response()->json(['isSuccess' => false, 'message' => 'Unauthorized'], 401);
        }

        $action = (string) $r->input('action');
        if ($action === 'win_pct') {
            // Ludo scales its prize table by this, the way every other game does
            return response()->json(['isSuccess' => true, 'data' => ['pct' => win_pct()]]);
        }

        $userId = (int) $r->input('userId');
        if ($userId < 1) {
            return response()->json(['isSuccess' => false, 'message' => 'Bad userId']);
        }

        if ($action === 'balance') {
            return response()->json([
                'isSuccess' => true,
                'data' => ['balance' => (float) wallet($userId, 'num')],
            ]);
        }

        if ($action !== 'debit' && $action !== 'credit') {
            return response()->json(['isSuccess' => false, 'message' => 'Unknown action']);
        }

        $amount = round((float) $r->input('amount'), 2);
        $ref = substr((string) $r->input('ref', ''), 0, 190);
        if ($amount <= 0 || $ref === '') {
            return response()->json(['isSuccess' => false, 'message' => 'Bad amount/ref']);
        }

        // idempotent: same ref never moves money twice
        $dup = Transaction::where('userid', (string) $userId)
            ->where('category', 'ludo')
            ->where('remark', $ref)
            ->first();
        if ($dup) {
            return response()->json([
                'isSuccess' => true,
                'data' => ['balance' => (float) wallet($userId, 'num'), 'duplicate' => true],
            ]);
        }

        if ($action === 'debit') {
            if ((float) wallet($userId, 'num') < $amount) {
                return response()->json(['isSuccess' => false, 'message' => 'Insufficient balance']);
            }
            addwallet($userId, $amount, '-');
            $this->log($userId, $amount, 'debit', $ref);
        } else {
            addwallet($userId, $amount, '+');
            $this->log($userId, $amount, 'credit', $ref);
        }

        return response()->json([
            'isSuccess' => true,
            'data' => ['balance' => (float) wallet($userId, 'num')],
        ]);
    }

    private function log(int $userId, float $amount, string $type, string $ref): void
    {
        $t = new Transaction;
        $t->userid = (string) $userId;
        $t->platform = 'ludo';
        $t->type = $type;
        $t->amount = (string) $amount;
        $t->category = 'ludo';
        $t->remark = $ref;
        $t->status = '1';
        $t->save();
    }
}
