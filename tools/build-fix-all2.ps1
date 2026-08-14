$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = 'C:\Users\Asus\Desktop\fix-all2.php'
$zip = 'C:\Users\Asus\Desktop\chicken-assets.zip'

# the two migrations that must land before migrate --force can pass
$mig = @{
    'laravel/database/migrations/2026_08_13_000000_add_proof_to_transactions.php' = 'hasColumn'
    'laravel/database/migrations/2026_08_13_010000_add_rail_to_bankdetails.php'   = 'hasColumn'
}
$migEntries = foreach ($rel in $mig.Keys) {
    $p = Join-Path $root ($rel -replace '/', '\')
    $bytes = [IO.File]::ReadAllBytes($p)
    if (-not ([Text.Encoding]::UTF8.GetString($bytes)).Contains($mig[$rel])) { throw "guard missing in $rel" }
    "    '$rel' => '" + [Convert]::ToBase64String($bytes) + "',"
}

# expected file manifest per game bundle, so the server can report its own deploy gaps
$roots = [ordered]@{
    'Chicken-Road/Main'              = 'Chicken-Road\Main'
    'goldegypt/game'                 = 'goldegypt\game'
    'slotglamor/game'                = 'slotglamor\game'
    'ludo/ludo-royale/client/dist'   = 'ludo\ludo-royale\client\dist'
}
$manEntries = foreach ($urlRoot in $roots.Keys) {
    $abs = Join-Path $root $roots[$urlRoot]
    $prefix = (Resolve-Path $abs).Path + '\'
    $lines = Get-ChildItem -File -Recurse $abs | ForEach-Object {
        $rel = $_.FullName.Substring($prefix.Length).Replace('\', '/')
        "        '$rel' => $($_.Length),"
    }
    "    '$urlRoot' => [`n" + ($lines -join "`n") + "`n    ],"
}

$php = @'
<?php
header('Content-Type: text/plain; charset=utf-8');
while (ob_get_level() > 0) { ob_end_flush(); }
@set_time_limit(600);
$base = __DIR__;

echo "=== 1. migration files ===\n";
$migrations = [
MIGRATIONS_HERE
];
foreach ($migrations as $rel => $b64) {
    $path = $base . '/' . $rel;
    echo (@file_put_contents($path, base64_decode($b64)) === false ? 'FAIL ' : 'OK   ') . "$rel\n";
}

echo "\n=== 2. migrate ===\n";
try {
    require $base . '/laravel/vendor/autoload.php';
    $app = require_once $base . '/laravel/bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
    foreach (explode("\n", trim(Illuminate\Support\Facades\Artisan::output())) as $l) {
        if (trim($l) !== '') { echo '  ' . trim($l) . "\n"; }
    }
    $S = 'Illuminate\Support\Facades\Schema';
    echo '  transactions.proof: ' . ($S::hasColumn('transactions', 'proof') ? 'present' : 'STILL MISSING') . "\n";
    echo '  bankdetails.rail:   ' . ($S::hasColumn('bankdetails', 'rail') ? 'present' : 'STILL MISSING') . "\n";
    echo '  bank_details table: ' . ($S::hasTable('bank_details') ? 'present' : 'STILL MISSING') . "\n";
} catch (Throwable $e) {
    echo '  FAILED: ' . get_class($e) . ': ' . $e->getMessage() . "\n";
}

echo "\n=== 3. aviator cache dirs (the increamentor 500) ===\n";
$dataDir = $base . '/laravel/storage/framework/cache/data';
$parked = 0; $stuck = 0; $checked = 0;
$probe = function (string $d): bool {
    $f = $d . '/.tlprobe';
    if (@file_put_contents($f, 'x') === false) { return false; }
    @unlink($f);
    return true;
};
foreach (@scandir($dataDir) ?: [] as $a) {
    if ($a === '.' || $a === '..' || strpos($a, '-blk-') !== false) { continue; }
    $lvl1 = $dataDir . '/' . $a;
    if (!is_dir($lvl1)) { continue; }
    foreach (@scandir($lvl1) ?: [] as $b) {
        if ($b === '.' || $b === '..' || strpos($b, '-blk-') !== false) { continue; }
        $lvl2 = $lvl1 . '/' . $b;
        if (!is_dir($lvl2)) { continue; }
        $checked++;
        if ($probe($lvl2)) { continue; }
        @chmod($lvl2, 0755);
        if ($probe($lvl2)) { continue; }
        if (@rename($lvl2, $lvl2 . '-blk-' . date('YmdHis'))) { $parked++; } else { $stuck++; }
    }
}
echo "  shard dirs: $checked checked, $parked moved aside, $stuck unfixable\n";

echo "\n=== 4. chicken assets ===\n";
$zip = $base . '/chicken-assets.zip';
if (!is_file($zip)) {
    echo "  chicken-assets.zip not uploaded next to this script\n";
} elseif (!class_exists('ZipArchive')) {
    echo "  no ZipArchive here - in cPanel File Manager right-click chicken-assets.zip > Extract\n";
} else {
    $za = new ZipArchive;
    if ($za->open($zip) === true) {
        $n = $za->numFiles;
        $done = $za->extractTo($base . '/Chicken-Road/Main/');
        $za->close();
        if ($done) {
            echo "  extracted $n entries into Chicken-Road/Main/\n";
            @unlink($zip); // only once it is safely unpacked
        } else {
            echo "  EXTRACT FAILED - use cPanel File Manager: right-click the zip > Extract\n";
        }
    } else {
        echo "  cannot open zip\n";
    }
}

echo "\n=== 5. deploy gaps (missing / truncated game files) ===\n";
$manifest = [
MANIFEST_HERE
];
foreach ($manifest as $rootRel => $files) {
    $missing = 0; $bad = 0; $shown = 0;
    foreach ($files as $rel => $size) {
        $p = $base . '/' . $rootRel . '/' . $rel;
        $have = @filesize($p);
        if ($have === false) {
            $missing++;
            if ($shown < 12) { echo "  MISSING $rootRel/$rel\n"; $shown++; }
        } elseif ($have !== $size) {
            $bad++;
            if ($shown < 12) { echo "  SIZE    $rootRel/$rel ($have vs $size)\n"; $shown++; }
        }
    }
    echo '  ' . $rootRel . ': ' . count($files) . " expected, $missing missing, $bad wrong size\n";
}

echo "\n=== 6. caches ===\n";
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

$php = $php.Replace('MIGRATIONS_HERE', ($migEntries -join "`n")).Replace('MANIFEST_HERE', ($manEntries -join "`n"))
[IO.File]::WriteAllText($out, $php, (New-Object Text.UTF8Encoding($false)))
php -l $out

Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $root 'Chicken-Road\Main\assets') -DestinationPath $zip
Write-Host ("wrote {0} ({1:N0} KB) and {2} ({3:N1} MB)" -f $out, ((Get-Item $out).Length / 1KB), $zip, ((Get-Item $zip).Length / 1MB))
