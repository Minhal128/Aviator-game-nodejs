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

// Bump this on every edit. If the number you see is not the number you uploaded,
// nothing below matters - the upload did not land, and that is the bug to chase.
echo "TL-CLEAR v4\n\n";

foreach (['view:clear', 'cache:clear', 'config:clear', 'route:clear'] as $cmd) {
    Illuminate\Support\Facades\Artisan::call($cmd);
    echo str_pad($cmd, 14) . trim(Illuminate\Support\Facades\Artisan::output()) . "\n";
}

if (function_exists('opcache_reset')) {
    echo str_pad('opcache', 14) . (opcache_reset() ? 'reset' : 'not reset') . "\n";
}

// The question every "I uploaded it and nothing changed" comes down to: is PHP
// even reading the file you uploaded? With opcache.validate_timestamps=0 it never
// re-checks mtime, so a fresh upload is ignored until the cache is dropped.
echo "\nis your upload live?\n";
$index = __DIR__ . '/index.php';
$hasPatch = is_file($index) && str_contains((string) file_get_contents($index), 'ifsc_code_title');
echo '  index.php on disk    ' . ($hasPatch ? 'has the UTR patch' : 'OLD - upload it again')
    . '  ' . (is_file($index) ? date('Y-m-d H:i', (int) filemtime($index)) : '') . "\n";

if (function_exists('opcache_get_configuration')) {
    $cfg = opcache_get_configuration()['directives'] ?? [];
    $vt = !empty($cfg['opcache.validate_timestamps']);
    echo '  validate_timestamps  ' . ($vt ? 'on (uploads are picked up)' : 'OFF - uploads are IGNORED until reset') . "\n";
    echo '  revalidate_freq      ' . (int) ($cfg['opcache.revalidate_freq'] ?? 0) . "s\n";
}
// drop these two by name as well, in case a global reset was refused
foreach ([$index, __FILE__] as $f) {
    if (function_exists('opcache_invalidate') && is_file($f)) {
        opcache_invalidate($f, true);
    }
}
// what opcache is holding for index.php right now, against what is on disk
if (function_exists('opcache_get_status')) {
    $st = @opcache_get_status(true);
    $key = realpath($index) ?: $index;
    $held = $st['scripts'][$key]['timestamp'] ?? null;
    // a 0 timestamp means opcache is off or is not tracking mtime - not "from 1970"
    if ($held !== null && (int) $held > 0) {
        echo '  cached copy is from   ' . date('Y-m-d H:i', (int) $held)
            . ((int) $held < (int) filemtime($index) ? '  <-- STALE, older than your upload' : '  (matches disk)') . "\n";
    } else {
        echo "  cached copy           none held - next request reads the file fresh\n";
    }
}

// Which file is actually on this server. A stale label after a clear means the
// upload never landed, not that the cache held on - and those look identical
// from the browser, which is the whole reason this block is here.
//
// Count BOTH words rather than stopping at the first hit: a half-uploaded file
// carries the new label somewhere and the old one on the row you are looking at,
// and "found UTR, therefore fine" is exactly how that hides.
// ifsc_code is the FIELD NAME and is meant to stay - only text a player reads
// counts, so ignore any IFSC that is followed by _code / code.
echo "\nfiles on disk (visible IFSC text left = how many labels are still old)\n";
$root = __DIR__ . '/';
foreach ([
    'laravel/resources/views/deposite.blade.php' => 'deposit form',
    'laravel/resources/views/withdraw.blade.php' => 'withdraw form',
    'laravel/resources/views/profile.blade.php' => 'profile page',
    'user/deposit.js' => 'deposit fields + labels',
    'user/withdraw.js' => 'withdraw fields',
] as $file => $what) {
    $path = $root . $file;
    if (!is_file($path)) {
        echo '  ' . str_pad(basename($file), 20) . "MISSING\n";
        continue;
    }
    $src = (string) file_get_contents($path);
    // >IFSC</span> is the SITE's own bank IFSC in the deposit instructions - the
    // player needs it to transfer money in, so it is not a leftover
    $src = str_replace('>IFSC</span>', '', $src);
    $left = preg_match_all('/IFSC(?![_a-z])/i', $src);
    echo '  ' . str_pad(basename($file), 20)
        . str_pad($left ? "OLD ($left)" : 'ok', 10)
        . date('Y-m-d H:i', (int) filemtime($path)) . '  '
        . str_pad(number_format(filesize($path)) . ' B', 10) . $what . "\n";
}

// The label the browser paints comes from this one line; print it verbatim so
// there is nothing left to infer.
$dep = $root . 'laravel/resources/views/deposite.blade.php';
if (is_file($dep) && preg_match('/id="ifsc_code_title">([^<]*)</', (string) file_get_contents($dep), $m)) {
    echo "\ndeposit label on disk: \"" . trim($m[1]) . "\"\n";
}
// ...unless deposit.js overwrites it after load, which the old build did
$js = $root . 'user/deposit.js';
if (is_file($js)) {
    $over = preg_match('/#ifsc_code_title"\)\.text\(\s*"([^"]*)"/', (string) file_get_contents($js), $m2);
    echo 'deposit.js overrides it: ' . ($over ? '"' . $m2[1] . '"  <-- THIS is what you see' : 'no') . "\n";
    echo "if disk says UTR and the page still says IFSC, the browser is holding an old\n"
        . "copy of /user/deposit.js - hard reload with Ctrl+Shift+R.\n";
}

// The one question the checks above cannot answer: what does LARAVEL end up
// running? A blade is compiled to plain PHP under storage/framework/views, and
// this host has been caught serving a stale compiled copy after view:clear (see
// the note in index.php). So resolve the view the way the app does, force a
// recompile, and read the compiled file back.
echo "\nwhat laravel actually runs\n";
try {
    $finder = Illuminate\Support\Facades\View::getFinder();
    $blade = app('blade.compiler');
    foreach (['deposite', 'withdraw', 'profile'] as $view) {
        $src = $finder->find($view);
        $blade->compile($src);                       // rebuild it here and now
        $out = $blade->getCompiledPath($src);
        $says = '-';
        if (is_file($out)) {
            $c = str_replace('>IFSC</span>', '', (string) file_get_contents($out));
            $says = preg_match('/IFSC(?![_a-z])/i', $c) ? 'STALE - still IFSC' : 'UTR';
        }
        echo '  ' . str_pad($view, 12) . str_pad($says, 22)
            . (is_file($out) ? date('Y-m-d H:i', (int) filemtime($out)) : 'not compiled') . "\n";
    }
    echo "\nif a row above says STALE the compiled copy is the problem, not your upload:\n"
        . "  delete everything inside laravel/storage/framework/views/ from File Manager,\n"
        . "  then load this page again.\n";
} catch (Throwable $e) {
    echo '  could not compile: ' . $e->getMessage() . "\n";
}

echo "\ndone\n";
