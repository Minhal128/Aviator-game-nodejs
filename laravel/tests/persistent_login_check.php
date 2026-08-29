<?php

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Middleware\userlogin;
use App\Models\User;
use App\Support\PersistentLogin;
use Illuminate\Http\Request;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;

$user = User::whereNull('isadmin')->first();
assert($user, 'a player account is required');

$sourceRequest = Request::create('/auth/login', 'POST');
$rememberCookie = PersistentLogin::cookieFor($user, $sourceRequest);
assert($rememberCookie->isHttpOnly(), 'persistent login cookie must be HTTP-only');
assert($rememberCookie->getPath() === '/', 'persistent login cookie is shared by every game path');

$request = Request::create('/ludo', 'GET', [], [
    $rememberCookie->getName() => $rememberCookie->getValue(),
]);
$session = new Store('persistent-login-test', new ArraySessionHandler(120));
$session->start();
$request->setLaravelSession($session);

$response = (new userlogin())->handle($request, fn () => response('restored'));
assert($response->getContent() === 'restored', 'valid remember cookie reaches the game');
assert((int) $session->get('userlogin')->id === (int) $user->id, 'player session is restored');

$badRequest = Request::create('/gold-egypt', 'GET', [], [
    $rememberCookie->getName() => $user->id . '|' . str_repeat('0', 64),
]);
$badSession = new Store('persistent-login-test-bad', new ArraySessionHandler(120));
$badSession->start();
$badRequest->setLaravelSession($badSession);

$badResponse = (new userlogin())->handle($badRequest, fn () => response('should not pass'));
assert($badResponse->getStatusCode() === 302, 'invalid remember cookie returns to login');
$redirectPath = parse_url($badResponse->headers->get('Location'), PHP_URL_PATH);
assert($redirectPath === null || $redirectPath === '/', 'invalid remember cookie targets login');
assert(!$badSession->has('userlogin'), 'invalid remember cookie cannot restore a player');

$routes = file_get_contents(base_path('routes/web.php'));
assert(str_contains($routes, 'PersistentLogin::forgetCookie()'), 'logout clears persistent login');
assert(!str_contains(file_get_contents(base_path('resources/views/Layout/usergame.blade.php')), 'rememberme'), 'login is always remembered');
assert(!str_contains(file_get_contents(base_path('resources/views/Layout/usergame2.blade.php')), 'rememberme'), 'secondary login is always remembered');

echo "persistent_login_check OK\n";
