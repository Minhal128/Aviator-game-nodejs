<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Userdetail;
use App\Http\Controllers\LudoWallet;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
Route::post('/user/withdrawal_list', [Userdetail::class, "withdrawal_list"]);

// Ludo Node → Laravel wallet (shared key). Not browser-facing.
Route::post('/ludo/wallet', [LudoWallet::class, 'handle']);

// Ludo Royale REST. cPanel PHP cannot reach 127.0.0.1:8110 (Node is on AWS :80).
Route::any('/v1/{path?}', function (Request $request, ?string $path = null) {
    $base = rtrim((string) env('LUDO_API_URL', 'http://127.0.0.1:8110'), '/');
    if (app()->environment('production') && (str_contains($base, '127.0.0.1') || str_contains($base, 'localhost'))) {
        $base = 'http://13.232.99.7';
    }
    $target = $base . '/api/v1/' . ltrim((string) $path, '/');
    if ($qs = $request->getQueryString()) {
        $target .= '?' . $qs;
    }
    $headers = [];
    foreach (['Authorization', 'Content-Type', 'Accept', 'X-Device-Id', 'X-TL-User-Id', 'X-TL-Wallet-Balance'] as $h) {
        if ($request->headers->has($h)) {
            $headers[$h] = $request->header($h);
        }
    }
    // bind the logged-in Turbo Legends user to the Ludo guest (deviceId tl{id})
    if (session()->has('userlogin')) {
        $uid = (int) session('userlogin')['id'];
        $headers['X-TL-User-Id'] = (string) $uid;
        // stamp balance so Node need not call back into artisan serve (deadlock)
        $headers['X-TL-Wallet-Balance'] = (string) wallet($uid, 'num');
    }
    try {
        // expect=false: Guzzle's 100-continue hangs (or 417s) against Node/Express
        $res = \Illuminate\Support\Facades\Http::withHeaders($headers)
            ->withOptions(['expect' => false])
            ->timeout(15)
            ->withBody($request->getContent(), $request->header('Content-Type') ?? 'application/json')
            ->send($request->method(), $target);
    } catch (\Throwable $e) {
        return response(['error' => 'ludo-api unreachable', 'message' => $e->getMessage()], 502);
    }
    return response($res->body(), $res->status())->withHeaders([
        'Content-Type' => $res->header('Content-Type') ?: 'application/json',
    ]);
})->where('path', '.*')->middleware(['web', \App\Http\Middleware\KeepLoginCookie::class]);
