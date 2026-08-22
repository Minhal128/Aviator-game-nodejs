<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// tl-inject-start
// ponytail: cPanel keeps serving old compiled blades, so the header edits never land;
// patch the markup on the way out until the host stops caching views
ob_start(static function ($html) {
    $html = preg_replace('/<title>.*?<\/title>/s', '<title>turbolegends</title>', $html, 1) ?? $html;
    // Same reason as the title: the blade already says UTR, the stale compiled copy
    // still says IFSC. Scoped to the two label elements by id/for, so the SITE's own
    // bank IFSC in the deposit instructions (a real IFSC the player needs) is untouched.
    $html = preg_replace('/(id="ifsc_code_title"[^>]*>)\s*IFSC[^<]*/i', '$1UTR Code / Number', $html) ?? $html;
    $html = preg_replace('/(<label[^>]*for="ifsc_code"[^>]*>)\s*IFSC[^<]*/i', '$1UTR Code / Number', $html) ?? $html;
    // ponytail: old Pages.php left base on /slot-glamour/ (PHP→508); force Apache path
    $html = str_replace('base href="/slot-glamour/"', 'base href="/slotglamor/game/"', $html);
    if (strpos($html, 'Download Game') === false) {
        $html = preg_replace(
            '/(?=<button class="register-btn)/',
            '<a href="https://turbolegends-downloads.s3.ap-south-1.amazonaws.com/turbo-legends.apk" class="login-btn rounded-pill d-flex align-items-center me-2" style="white-space:nowrap" aria-label="Download Game"><span class="material-symbols-outlined d-md-none">download</span><span class="d-none d-md-inline">Download Game</span></a>',
            $html,
            1
        ) ?? $html;
    }
    return $html;
});
// tl-inject-end

/*
|--------------------------------------------------------------------------
| Check If The Application Is Under Maintenance
|--------------------------------------------------------------------------
|
| If the application is in maintenance / demo mode via the "down" command
| we will load this file so that any pre-rendered content can be shown
| instead of starting the framework, which could cause an exception.
|
*/

if (file_exists($maintenance = __DIR__.'/laravel/storage/framework/maintenance.php')) {
    require $maintenance;
}

/*
|--------------------------------------------------------------------------
| Register The Auto Loader
|--------------------------------------------------------------------------
|
| Composer provides a convenient, automatically generated class loader for
| this application. We just need to utilize it! We'll simply require it
| into the script here so we don't need to manually load our classes.
|
*/

require __DIR__.'/laravel/vendor/autoload.php';

/*
|--------------------------------------------------------------------------
| Run The Application
|--------------------------------------------------------------------------
|
| Once we have the application, we can handle the incoming request using
| the application's HTTP kernel. Then, we will send the response back
| to this client's browser, allowing them to enjoy our application.
|
*/

$app = require_once __DIR__.'/laravel/bootstrap/app.php';

$kernel = $app->make(Kernel::class);

$response = $kernel->handle(
    $request = Request::capture()
)->send();

$kernel->terminate($request, $response);
