$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = 'C:\Users\Asus\Desktop\fix-all.php'

$ludoHtaccess = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'ludo\.htaccess')))

$php = @'
<?php
header('Content-Type: text/plain; charset=utf-8');
while (ob_get_level() > 0) { ob_end_flush(); }
@set_time_limit(300);
$base = __DIR__;

echo "=== 1. last errors in laravel.log ===\n";
$log = $base . '/laravel/storage/logs/laravel.log';
if (is_file($log) && ($fh = @fopen($log, 'rb'))) {
    $size = filesize($log);
    fseek($fh, max(0, $size - 60000));
    $tail = (string) fread($fh, 60000);
    fclose($fh);
    $seen = [];
    foreach (array_reverse(explode("\n", $tail)) as $line) {
        if (strpos($line, '.ERROR:') === false) { continue; }
        $msg = substr($line, 0, 300);
        $k = substr($msg, 30, 120);
        if (isset($seen[$k])) { continue; }
        $seen[$k] = 1;
        echo "  $msg\n";
        if (count($seen) >= 8) { break; }
    }
    if (!$seen) { echo "  no ERROR lines in the last 60KB\n"; }
    echo "  log size: $size bytes\n";
} else {
    echo "  no log file\n";
}

echo "\n=== 2. ludo 403 (real folder shadows the URL) ===\n";
$ludo = $base . '/ludo';
if (is_dir($ludo)) {
    $ok = @file_put_contents($ludo . '/.htaccess', base64_decode('LUDO_HTACCESS'));
    echo $ok === false ? "  FAIL writing ludo/.htaccess\n" : "  ludo/.htaccess written ($ok bytes)\n";
    $dist = $ludo . '/ludo-royale/client/dist';
    echo is_dir($dist)
        ? "  client build: " . count(glob($dist . '/*') ?: []) . " entries in dist\n"
        : "  client build MISSING: upload ludo/ludo-royale/client/dist\n";
} else {
    echo "  no ludo folder on the server\n";
}

echo "\n=== 3. game assets on disk (broken images) ===\n";
$checks = [
    'Chicken-Road/Main'                => 'assets/images/idle.png',
    'goldegypt/game'                   => 'png/Symbols/Wick.png',
    'slotglamor/game'                  => 'index.html',
];
foreach ($checks as $rootRel => $probe) {
    $dir = $base . '/' . $rootRel;
    if (!is_dir($dir)) { echo "  MISSING FOLDER $rootRel\n"; continue; }
    $sub = dirname($probe);
    $subDir = $dir . '/' . $sub;
    $n = is_dir($subDir) ? count(glob($subDir . '/*') ?: []) : -1;
    echo "  $rootRel: " . (is_file($dir . '/' . $probe) ? 'probe OK' : 'PROBE 404 -> ' . $probe)
        . ", $sub = " . ($n < 0 ? 'NO SUCH DIR' : "$n files") . "\n";
    /* case-sensitivity trap: same name, different case, on a Linux box */
    if ($n < 0 && is_dir($dir)) {
        foreach (glob($dir . '/*', GLOB_ONLYDIR) ?: [] as $d) {
            echo "      has dir: " . basename($d) . "\n";
        }
    }
}

echo "\n=== 4. migrations (deposit/withdraw 500) ===\n";
try {
    require $base . '/laravel/vendor/autoload.php';
    $app = require_once $base . '/laravel/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
    foreach (explode("\n", trim(Illuminate\Support\Facades\Artisan::output())) as $l) {
        if (trim($l) !== '') { echo '  ' . $l . "\n"; }
    }

    $cols = Illuminate\Support\Facades\Schema::getColumnListing('transactions');
    echo '  transactions.proof: ' . (in_array('proof', $cols, true) ? 'present' : 'STILL MISSING') . "\n";
    echo '  bankdetails.rail: ' . (Illuminate\Support\Facades\Schema::hasColumn('bankdetails', 'rail') ? 'present' : 'STILL MISSING') . "\n";
    echo '  bank_details table: ' . (Illuminate\Support\Facades\Schema::hasTable('bank_details') ? 'present' : 'STILL MISSING') . "\n";

    /* setting() reads ->value with no null guard, so a missing row 500s the page */
    $needed = ['min_recharge' => '100', 'min_withdrawal' => '2000'];
    foreach ($needed as $cat => $val) {
        $row = Illuminate\Support\Facades\DB::table('settings')->where('category', $cat)->first();
        if ($row) {
            echo "  setting $cat = {$row->value}\n";
        } else {
            Illuminate\Support\Facades\DB::table('settings')->insert([
                'category' => $cat, 'value' => $val, 'status' => '1',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            echo "  setting $cat inserted = $val\n";
        }
    }
} catch (Throwable $e) {
    echo '  BOOT/MIGRATE FAILED: ' . get_class($e) . ': ' . $e->getMessage() . "\n";
}

echo "\n=== 5. caches ===\n";
$cleared = 0;
foreach (['laravel/storage/framework/views', 'laravel/bootstrap/cache'] as $d) {
    foreach (glob($base . '/' . $d . '/*.php') ?: [] as $f) {
        if (@unlink($f)) { $cleared++; }
    }
}
echo "  cleared $cleared compiled files\n";
if (function_exists('opcache_reset')) { @opcache_reset(); }
echo "\ndone\n";
@unlink(__FILE__);
'@

$php = $php.Replace('LUDO_HTACCESS', $ludoHtaccess)
[IO.File]::WriteAllText($out, $php, (New-Object Text.UTF8Encoding($false)))
php -l $out
Write-Host "wrote $out"
