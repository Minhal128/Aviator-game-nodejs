<?php

use App\Http\Controllers\Admin;
use App\Http\Controllers\Authentication;
use App\Http\Controllers\Gamesetting;
use App\Http\Controllers\GlamourSpins;
use App\Http\Controllers\Pages;
use App\Http\Controllers\GoldEgypt;
use App\Http\Controllers\RoadGame;
use App\Http\Controllers\SlotApi;
use App\Http\Controllers\Userdetail;
use App\Http\Controllers\Adminapi;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
 */
/**
 * Uploaded files. In production /storagelink symlinks <root>/storage at the
 * public disk and server.php serves it straight off disk, so this route never
 * runs; without the symlink it is the only way an uploaded barcode resolves.
 * Deposit proofs are deliberately NOT here - they are bank screenshots, so they
 * live on the local disk and only /admin/proof/{id} can read them.
 */
Route::get('/storage/{path}', function (string $path) {
    // Flysystem throws on a path that climbs out of the disk root, which surfaces
    // as a 500; a request for a file outside the disk is simply not found
    abort_if(str_contains($path, '..'), 404);
    abort_unless(Storage::disk('public')->exists($path), 404);
    return response()->file(Storage::disk('public')->path($path));
})->where('path', '.*');

Route::get('/storagelink', function () {
	$target = '/home/u558340823/domains/thixpro.in/public_html/aviator/laravel/storage/app/public/';
   $shortcut = '/home/u558340823/domains/thixpro.in/public_html/aviator/storage/';
   symlink($target, $shortcut);
    dd('storage link successfully');
});
Route::get('/clear', function () {
    Artisan::call('cache:clear');
    Artisan::call('config:cache');
    Artisan::call('route:clear');
    Artisan::call('optimize');
    dd('Cache cleared successfully');
});
Route::get('/', function () {
    return view('welcome');
});
Route::get('/dashboard', function () {
    return view('welcome');
});
Route::get('/register', function () {
    return view('register');
});
// footer info pages (public)
Route::get('/{slug}', function (string $slug) {
    return view('page', ['slug' => $slug]);
})->where('slug', 'about|rules|contacts|affiliate|faq');
// Auth Login
Route::post('/auth/login', [Authentication::class, "login"]);
Route::post('/auth/register', [Authentication::class, "register"]);
Route::get('/is_login', [Userdetail::class, "is_login"]);
Route::get('/game-cron', [Gamesetting::class, "cronjob"]);
Route::post('/game/server/tick', [Gamesetting::class, "serverTick"]);
// Auth Admin Login
Route::post('/auth/admin/login', [Authentication::class, "adminlogin"]);

// Admin Login
Route::get('/admin', [Admin::class, "login"]);
Route::group(['prefix' => 'admin/', 'middleware' => ['isAdmin']], function () {
    Route::get('/dashboard', [Admin::class, "dashboard"]);
    Route::get('/user-list', [Admin::class, "userlist"]);
    Route::get('/change-password', [Admin::class, "chagepassword"]);
    Route::get('/user/edit/{id}', [Admin::class, "useredit"]);
    // the DB category is still 'recharge'; only what the operator reads changed
    Route::get('/deposits', [Admin::class, "rechargehistory"]);
    Route::get('/withdrawals', [Admin::class, "withdrawalhistory"]);
    Route::get('/bank-detail', [Admin::class, "bankdetail"]);
    Route::get('/referral', [Admin::class, "referral"]);
    // the screenshot the player uploaded with a deposit request
    Route::get('/proof/{id}', [Admin::class, "proof"]);
    
    Route::group(['prefix' => 'api/'], function () {
        Route::post('/changepassword', [Adminapi::class, "changepassword"]);
        Route::post('/edituser', [Adminapi::class, "edituser"]);
        Route::post('/recharge/{event}', [Adminapi::class, "rechargeapproval"]);
        Route::post('/withdraw/{event}', [Adminapi::class, "withdrawalapproval"]);
        Route::post('/user/delete', [Adminapi::class, "userdelete"]);
        Route::post('/bankdetail', [Adminapi::class, "editbankdetail"]);
        Route::post('/bankdetail/delete', [Adminapi::class, "deletebankdetail"]);
        Route::post('/limits', [Adminapi::class, "limits"]);
        Route::post('/referral', [Adminapi::class, "referral"]);
        Route::post('/win-percentage', [Adminapi::class, "winPercentage"]);
        Route::post('/updatewallet', [Adminapi::class, "updatewallet"]);
        Route::get('/live-round', [Adminapi::class, "liveRound"]);
        Route::get('/stats', [Adminapi::class, "stats"]);
    });

    Route::get('/logout', [Admin::class, "logout"]);
});

// Game art/js/audio: no session. File-session locks on shared hosting drop
// the login cookie when Ludo/Chicken Road boot ~20 files at once.
$gameAssetNoSession = [
    \Illuminate\Session\Middleware\StartSession::class,
    \Illuminate\View\Middleware\ShareErrorsFromSession::class,
    \App\Http\Middleware\VerifyCsrfToken::class,
];
Route::get('/chicken-road/{path}', function (string $path) {
    return app(Pages::class)->gameStatic('chicken-road', $path);
})->where('path', '.+')->withoutMiddleware($gameAssetNoSession);
Route::get('/ludo/{path}', function (string $path) {
    return app(Pages::class)->gameStatic('ludo', $path);
})->where('path', '.+')->withoutMiddleware($gameAssetNoSession);

Route::group(['middleware' => ['isUser']], function () {

    Route::get('/profile', [Userdetail::class, "profile"]);
    Route::get('/crash', [Pages::class, "aviator"]);
    Route::get('/chicken-road/{path?}', function (?string $path = null) {
        return app(Pages::class)->gameStatic('chicken-road', $path);
    })->where('path', '.*');
    Route::get('/ludo/{path?}', function (?string $path = null) {
        return app(Pages::class)->gameStatic('ludo', $path);
    })->where('path', '.*');
    Route::get('/gold-egypt/{path?}', function (?string $path = null) {
        return app(Pages::class)->gameStatic('gold-egypt', $path);
    })->where('path', '.*');
    Route::get('/slot-glamour/{path?}', function (?string $path = null) {
        return app(Pages::class)->gameStatic('slot-glamour', $path);
    })->where('path', '.*');
    Route::get('/deposit', [Pages::class, 'deposit']);
    Route::get('/amount-transfer', [Pages::class, "amount_transfer"]);
    Route::get('/withdraw', function () {
        return view('withdraw');
    });
    Route::get('/referal', function () {
        return view('refferal');
    });
    Route::get('/level-management', [Pages::class,'level_management']);

    Route::get('/deposit_withdrawals', [Userdetail::class, "deposit_withdrawal"]);
    Route::get('/logout', function () {
        if (session()->has('userlogin')) {
            session()->forget('userlogin');
        }
        return redirect('/');
    });
    //Api
    Route::get('/get_user_details', [Userdetail::class, "get_user_detail"]);
    // Api Lists App Createion

    //Data api
    Route::post('/user/withdrawal_list', [Userdetail::class, "withdrawal_list"]);
    Route::post('/game/existence', [Gamesetting::class, "game_existence"]);
    Route::post('/game/crash_plane', [Gamesetting::class, "crash_plane"]);
    Route::post('/game/new_game_generated', [Gamesetting::class, "new_game_generated"]);
    Route::post('/game/increamentor', [Gamesetting::class, "increamentor"]);
    Route::post('/game/tick', [Gamesetting::class, "tick"]);
    Route::post('/game/game_over', [Gamesetting::class, "game_over"]);
    Route::post('/game/add_bet', [Gamesetting::class, "betNow"]);
	Route::get('/cash_out', [Gamesetting::class, "cashout"]);
    Route::post('/game/currentlybet', [Gamesetting::class, "currentlybet"]);
    // Chicken Road on the real wallet - crash lane and multiplier decided server side
    Route::post('/game/road/bet', [RoadGame::class, 'bet']);
    Route::post('/game/road/step', [RoadGame::class, 'step']);
    Route::post('/game/road/cashout', [RoadGame::class, 'cashout']);
    // Gold of Egypt on the real wallet - reel stops drawn and settled server side
    Route::get('/game/gold/state', [GoldEgypt::class, 'state']);
    Route::post('/game/gold/spin', [GoldEgypt::class, 'spin']);
    Route::post('/game/gold/cashout', [GoldEgypt::class, 'cashout']);
    // Glamour Spins on the real wallet - the server settles first and only then
    // tells the client which measured spin to replay
    Route::get('/game/glamour/state', [GlamourSpins::class, 'state']);
    Route::post('/game/glamour/spin', [GlamourSpins::class, 'spin']);
    Route::post('/game/glamour/cashout', [GlamourSpins::class, 'cashout']);
    Route::post('/game/glamour/report', [GlamourSpins::class, 'report']);
    // Glamour Spins' own casino-API callback, repointed here by js/tl-c3-slot.js
    Route::any('/game/slot-api', [SlotApi::class, 'capture']);
    Route::post('/game/my_bets_history', [Gamesetting::class, "my_bets_history"]);
    Route::get('/payment_gateway_details', [Adminapi::class, "payment_gateway"]);
    Route::post('/insert/withdrawal', [Adminapi::class, "withdrawal_query"]);
    Route::post('/depositNow', [Adminapi::class, "depositNow"]);
    Route::post('/wallet_transfer', [Userdetail::class, "wallet_transfer"]);
});
