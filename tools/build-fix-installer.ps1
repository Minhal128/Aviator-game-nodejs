$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = 'C:\Users\Asus\Desktop\fix-game.php'

$files = @{
    'user/aviatorbyapp.js'                        = Join-Path $root 'user\aviatorbyapp.js'
    'user/aviatorold.js'                          = Join-Path $root 'user\aviatorold.js'
    'laravel/app/Services/PoolCrashEngine.php'    = Join-Path $root 'laravel\app\Services\PoolCrashEngine.php'
}
$markers = @{
    'user/aviatorbyapp.js'                     = 'startRoundWatchdog'
    'user/aviatorold.js'                       = 'read before the splice'
    'laravel/app/Services/PoolCrashEngine.php' = 'usePoolMode'
}

$php = @'
<?php
header('Content-Type: text/plain; charset=utf-8');
while (ob_get_level() > 0) { ob_end_flush(); }
$base = __DIR__;

$payload = PAYLOAD_HERE;

foreach ($payload as $rel => $spec) {
    $path = $base . '/' . $rel;
    $body = base64_decode($spec['b64']);
    if (!is_dir(dirname($path))) { echo "MISS dir for $rel\n"; continue; }
    if (@file_put_contents($path, $body) === false) { echo "FAIL write $rel\n"; continue; }
    $ok = strpos((string) @file_get_contents($path), $spec['marker']) !== false;
    echo ($ok ? 'OK   ' : 'BAD  ') . "$rel (" . strlen($body) . " bytes)\n";
}

/* bump APP_VERSION so browsers stop serving the old ?v= file */
$envPath = $base . '/laravel/.env';
$env = @file_get_contents($envPath);
if ($env !== false && preg_match('/^APP_VERSION=(\d+)\.(\d+)\.(\d+)/m', $env, $m)) {
    $next = $m[1] . '.' . $m[2] . '.' . ($m[3] + 1);
    $env = preg_replace('/^APP_VERSION=.*$/m', 'APP_VERSION=' . $next, $env, 1);
    echo @file_put_contents($envPath, $env) === false
        ? "FAIL APP_VERSION\n"
        : "APP_VERSION -> $next\n";
} else {
    echo "APP_VERSION not found in .env\n";
}

/* compiled views + config cache */
$cleared = 0;
foreach (['laravel/storage/framework/views', 'laravel/bootstrap/cache'] as $dir) {
    foreach (@glob($base . '/' . $dir . '/*.php') ?: [] as $f) {
        if (@unlink($f)) { $cleared++; }
    }
}
echo "cache files cleared: $cleared\n";

if (function_exists('opcache_reset')) { @opcache_reset(); }
echo "done - open /crash and press Ctrl+F5\n";
@unlink(__FILE__);
'@

$entries = foreach ($rel in $files.Keys) {
    $bytes = [IO.File]::ReadAllBytes($files[$rel])
    $b64 = [Convert]::ToBase64String($bytes)
    $mark = $markers[$rel]
    if (-not ([Text.Encoding]::UTF8.GetString($bytes)).Contains($mark)) {
        throw "marker '$mark' missing in $rel"
    }
    "    '$rel' => ['marker' => '$mark', 'b64' => '$b64'],"
}
$payload = "[`n" + ($entries -join "`n") + "`n]"
[IO.File]::WriteAllText($out, $php.Replace('PAYLOAD_HERE', $payload), (New-Object Text.UTF8Encoding($false)))

php -l $out
Write-Host "wrote $out ($((Get-Item $out).Length) bytes)"
