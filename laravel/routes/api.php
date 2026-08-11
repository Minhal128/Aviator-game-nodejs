<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Userdetail;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "api" middleware group. Enjoy building your API!
|
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
//Data api
Route::post('/user/withdrawal_list', [Userdetail::class,"withdrawal_list"]);

// ponytail: proxy Ludo Royale REST (ludo-api :8110) so /ludo client same-origin /api/v1 works
Route::any('/v1/{path?}', function (Request $request, ?string $path = null) {
    $target = 'http://127.0.0.1:8110/api/v1/' . ltrim((string) $path, '/');
    if ($qs = $request->getQueryString()) {
        $target .= '?' . $qs;
    }
    $headers = [];
    foreach (['Authorization', 'Content-Type', 'Accept', 'X-Device-Id'] as $h) {
        if ($request->headers->has($h)) {
            $headers[$h] = $request->header($h);
        }
    }
    try {
        $res = \Illuminate\Support\Facades\Http::withHeaders($headers)
            ->withBody($request->getContent(), $request->header('Content-Type') ?? 'application/json')
            ->send($request->method(), $target);
    } catch (\Throwable $e) {
        return response(['error' => 'ludo-api unreachable', 'message' => $e->getMessage()], 502);
    }
    return response($res->body(), $res->status())->withHeaders([
        'Content-Type' => $res->header('Content-Type') ?: 'application/json',
    ]);
})->where('path', '.*');
