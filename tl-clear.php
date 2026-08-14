<?php
// Cache clearer for cPanel: upload next to index.php in public_html and open
// /tl-clear.php?k=<key below>. Public URL, so it stays behind a key.
// ponytail: no UI, no logging - it prints what it ran and that is the whole job.

$key = 'tl7c41d9';

if (!hash_equals($key, (string) ($_GET['k'] ?? ''))) {
    http_response_code(404);
    exit;
}

require __DIR__ . '/laravel/vendor/autoload.php';
$app = require __DIR__ . '/laravel/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

header('Content-Type: text/plain; charset=utf-8');

foreach (['view:clear', 'cache:clear', 'config:clear', 'route:clear'] as $cmd) {
    Illuminate\Support\Facades\Artisan::call($cmd);
    echo str_pad($cmd, 14) . trim(Illuminate\Support\Facades\Artisan::output()) . "\n";
}

if (function_exists('opcache_reset')) {
    echo str_pad('opcache', 14) . (opcache_reset() ? 'reset' : 'not reset') . "\n";
}

echo "\ndone\n";
