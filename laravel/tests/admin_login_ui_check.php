<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$root = dirname(base_path());
$login = file_get_contents(base_path('resources/views/admin/login.blade.php'));
assert(!str_contains($login, '/aviatoradmin/'), 'login does not load blocked assets');
assert(!str_contains($login, 'vendor/izitoast'), 'login does not use 403 izitoast path');
assert(str_contains($login, 'place-items: center'), 'login has centered card css');
assert(str_contains($login, '/css/iziToast.min.css'), 'login izitoast css under /css');

$head = file_get_contents(base_path('resources/views/include/admin/head.blade.php'));
$foot = file_get_contents(base_path('resources/views/include/admin/foot.blade.php'));
assert(str_contains($head, '/css/tl/css/turbo-theme.css'), 'admin css via /css/tl');
assert(!str_contains($head, '/aviatoradmin/assets/'), 'head dropped blocked path');
assert(str_contains($foot, '/css/tl/js/misc.js'), 'admin js via /css/tl');
assert(str_contains($foot, '/js/iziToast.min.js'), 'foot izitoast under /js');

assert(is_file($root . '/css/tl/css/turbo-theme.css'), 'copied turbo-theme');
assert(is_file($root . '/css/iziToast.min.css'), 'copied izitoast css');
assert(is_file($root . '/js/iziToast.min.js'), 'copied izitoast js');
assert(str_contains(file_get_contents($root . '/js/appcustomize.js'), 'typeof iziToast'), 'toast guard');

$admin = file_get_contents(base_path('app/Http/Controllers/Admin.php'));
assert(str_contains($admin, "str_replace('/aviatoradmin/assets/', '/css/tl/'"), 'dashboard rewrites blocked css');
$html = str_replace('/aviatoradmin/assets/', '/css/tl/', '<link href="/aviatoradmin/assets/css/style.css">');
assert($html === '<link href="/css/tl/css/style.css">', 'rewrite maps style.css');

echo "admin_login_ui_check OK\n";
