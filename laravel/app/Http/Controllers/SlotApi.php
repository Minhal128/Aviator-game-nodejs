<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Glamour Spins talks to a casino backend: its C3 global apiUrl ships pointing at
 * https://1700700.net/betclipapi/match3/callback.asp, and it drives the round
 * through globals (request, roundid, accountid, gamesessionid, betAmount,
 * resultAmount, situacao_aposta, ACCOUNTTRANSACTIONID, divisor).
 *
 * js/tl-c3-slot.js repoints apiUrl here, which does two things at once: no player
 * data leaves this box, and the server gets to decide the balance and the result -
 * the same arrangement Aviator has, where the house margin is enforced server side.
 *
 * ponytail: capture build. The game's event sheet is compiled to opcodes, so
 * instead of reverse engineering the protocol we let the game tell us what it
 * asks for. Every hit is appended to storage/logs/slot-api.log; the real
 * bet/settle handling (70/30 pool) goes in once the log shows the call sequence.
 */
class SlotApi extends Controller
{
    public function capture(Request $r)
    {
        $hit = [
            'at' => now()->toDateTimeString(),
            'method' => $r->method(),
            'userid' => user('id'),
            'query' => $r->query(),
            'body' => $r->except(['_token']),
            'raw' => substr((string) $r->getContent(), 0, 2000),
        ];
        Log::build(['driver' => 'single', 'path' => storage_path('logs/slot-api.log')])
            ->info('slot-api', $hit);

        // enough of a reply for the game to keep going while we learn the shape
        return response()->json([
            'status' => 'OK',
            'balance' => (float) wallet(user('id'), 'num'),
            'currency' => user('currency') ?: 'INR',
        ]);
    }
}
