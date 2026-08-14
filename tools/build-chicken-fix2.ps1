$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = 'C:\Users\Asus\Desktop\fix-chicken2.php'
$prefix = (Resolve-Path (Join-Path $root 'Chicken-Road\Main')).Path + '\'
$manifest = Get-ChildItem -File -Recurse (Join-Path $root 'Chicken-Road\Main\assets') | ForEach-Object {
    "    '" + $_.FullName.Substring($prefix.Length).Replace('\', '/') + "' => $($_.Length),"
}

$php = @'
<?php
header('Content-Type: text/plain; charset=utf-8');
while (ob_get_level() > 0) { ob_end_flush(); }
@set_time_limit(600);
$main = __DIR__ . '/Chicken-Road/Main';

function writable_dir(string $d): bool
{
    $f = $d . '/.tlprobe';
    if (@file_put_contents($f, 'x') === false) { return false; }
    @unlink($f);
    return true;
}

/**
 * extractTo() failed as a whole, so the target dirs are the suspect: the half-finished
 * upload left an 'assets' folder PHP cannot write into. Parent is writable (the junk
 * files landed there), so a rename plus a fresh mkdir gets us a usable tree.
 */
echo "=== dirs ===\n";
echo '  Main writable: ' . (writable_dir($main) ? 'yes' : 'NO') . "\n";
foreach (['assets', 'assets/images', 'assets/audio'] as $rel) {
    $d = $main . '/' . $rel;
    if (is_dir($d) && !writable_dir($d)) {
        @chmod($d, 0755);
        if (!writable_dir($d)) {
            $parked = $d . '-blk-' . date('YmdHis');
            echo @rename($d, $parked) ? "  $rel was blocked, moved aside\n" : "  $rel BLOCKED and cannot be renamed\n";
        }
    }
    if (!is_dir($d) && !@mkdir($d, 0755, true)) {
        echo "  cannot create $rel\n";
    }
    echo "  $rel: " . (is_dir($d) ? (writable_dir($d) ? 'writable' : 'NOT WRITABLE') : 'MISSING') . "\n";
}

echo "\n=== extract ===\n";
$zip = __DIR__ . '/chicken-assets.zip';
if (!is_file($zip)) {
    echo "  chicken-assets.zip is not here - upload it next to this script\n";
} elseif (!class_exists('ZipArchive')) {
    echo "  no ZipArchive on this server\n";
} else {
    $za = new ZipArchive;
    if ($za->open($zip) !== true) {
        echo "  cannot open zip\n";
    } else {
        /* one file at a time: extractTo() is all-or-nothing and hides which entry failed */
        $ok = 0; $fail = 0;
        for ($i = 0; $i < $za->numFiles; $i++) {
            $name = $za->getNameIndex($i);
            if ($name === false || substr($name, -1) === '/') { continue; }
            $dest = $main . '/' . $name;
            if (!is_dir(dirname($dest))) { @mkdir(dirname($dest), 0755, true); }
            $in = $za->getStream($name);
            if (!$in) { $fail++; echo "  no stream: $name\n"; continue; }
            $bytes = @file_put_contents($dest, $in);
            fclose($in);
            if ($bytes === false) {
                $fail++;
                if ($fail <= 3) { echo "  write failed: $name\n"; }
            } else {
                $ok++;
            }
        }
        $za->close();
        echo "  written: $ok, failed: $fail\n";
        if ($fail === 0) { @unlink($zip); }
    }
}

echo "\n=== audit ===\n";
$expected = [
MANIFEST_HERE
];
$missing = 0; $bad = 0;
foreach ($expected as $rel => $size) {
    $have = @filesize($main . '/' . $rel);
    if ($have === false) { $missing++; echo "  MISSING $rel\n"; }
    elseif ($have !== $size) { $bad++; echo "  SIZE    $rel ($have vs $size)\n"; }
}
echo '  ' . count($expected) . " expected, $missing missing, $bad wrong size\n";
echo $missing === 0 && $bad === 0 ? "\ndone - open /chicken-road and Ctrl+F5\n" : "\ndone with gaps\n";
@unlink(__FILE__);
'@

[IO.File]::WriteAllText($out, $php.Replace('MANIFEST_HERE', ($manifest -join "`n")), (New-Object Text.UTF8Encoding($false)))
php -l $out
Write-Host "wrote $out ($($manifest.Count) files in manifest)"
