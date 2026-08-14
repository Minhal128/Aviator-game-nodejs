$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = 'C:\Users\Asus\Desktop\fix-egypt.php'

$src = Join-Path $root 'laravel\app\Http\Controllers\Pages.php'
$bytes = [IO.File]::ReadAllBytes($src)
if (-not ([Text.Encoding]::UTF8.GetString($bytes)).Contains("'gold-egypt' => '/goldegypt/game/'")) { throw 'static base map missing' }
$b64 = [Convert]::ToBase64String($bytes)

$php = @'
<?php
header('Content-Type: text/plain; charset=utf-8');
while (ob_get_level() > 0) { ob_end_flush(); }
@set_time_limit(300);
$base = __DIR__;
$host = $_SERVER['HTTP_HOST'] ?? 'turbolegends.com';
$probeUrl = 'https://' . $host . '/goldegypt/game/png/Symbols/Wick.png';

/** @return array{0:int,1:string} status, content-type */
function head(string $url): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RANGE => '0-99',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        curl_exec($ch);
        $s = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $t = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);
        return [$s, $t];
    }
    $body = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 15, 'ignore_errors' => true]]));
    $code = 0; $type = '';
    foreach ($http_response_header ?? [] as $h) {
        if (preg_match('#^HTTP/\S+ (\d{3})#', $h, $m)) { $code = (int) $m[1]; }
        if (stripos($h, 'content-type:') === 0) { $type = trim(substr($h, 13)); }
    }
    return [$code, $body === false ? $type : $type];
}

echo "=== can Apache serve the art directly? ===\n";
[$status, $type] = head($probeUrl);
echo "  $probeUrl -> $status $type\n";

if ($status !== 200 && $status !== 206) {
    echo "\n  NOT reachable, so the base href is left alone (nothing changed).\n";
    echo "  Send me this output.\n";
    @unlink(__FILE__);
    return;
}
if (stripos($type, 'image') === false) {
    echo "\n  reachable but served as '$type', not an image - leaving the base href alone.\n";
    @unlink(__FILE__);
    return;
}

echo "\n=== burst test (20 at once, the way Phaser loads) ===\n";
if (function_exists('curl_multi_init')) {
    $mh = curl_multi_init();
    $hs = [];
    for ($i = 0; $i < 20; $i++) {
        $ch = curl_init($probeUrl . '?b=' . $i);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_SSL_VERIFYPEER => false]);
        curl_multi_add_handle($mh, $ch);
        $hs[] = $ch;
    }
    do { curl_multi_exec($mh, $running); curl_multi_select($mh, 0.1); } while ($running > 0);
    $codes = [];
    foreach ($hs as $ch) {
        $c = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $codes[$c] = ($codes[$c] ?? 0) + 1;
        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }
    curl_multi_close($mh);
    foreach ($codes as $c => $n) { echo "  status $c: $n\n"; }
} else {
    echo "  curl_multi not available, skipped\n";
}

echo "\n=== patch ===\n";
$target = $base . '/laravel/app/Http/Controllers/Pages.php';
$body = base64_decode('PAGES_B64');
echo @file_put_contents($target, $body) === false
    ? "  FAIL writing Pages.php\n"
    : '  Pages.php written (' . strlen($body) . " bytes)\n";
echo '  base map present: ' . (strpos((string) @file_get_contents($target), "'gold-egypt' => '/goldegypt/game/'") !== false ? "yes\n" : "NO\n");

$cleared = 0;
foreach (['laravel/storage/framework/views', 'laravel/bootstrap/cache'] as $d) {
    foreach (glob($base . '/' . $d . '/*.php') ?: [] as $f) {
        if (@unlink($f)) { $cleared++; }
    }
}
echo "  cleared $cleared compiled files\n";
if (function_exists('opcache_reset')) { @opcache_reset(); }
echo "\ndone - open /gold-egypt and Ctrl+F5\n";
@unlink(__FILE__);
'@

[IO.File]::WriteAllText($out, $php.Replace('PAGES_B64', $b64), (New-Object Text.UTF8Encoding($false)))
php -l $out
Write-Host "wrote $out"
