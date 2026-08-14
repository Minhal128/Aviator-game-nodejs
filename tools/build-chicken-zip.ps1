$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'Chicken-Road\Main\assets'
$zipPath = 'C:\Users\Asus\Desktop\chicken-assets.zip'
$out = 'C:\Users\Asus\Desktop\fix-chicken.php'

# Compress-Archive on PowerShell 5.1 writes 'assets\audio\bgm.mp3' as the entry name.
# Linux unzips that as one file with backslashes in its name, so build entries by hand.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Remove-Item $zipPath -ErrorAction SilentlyContinue
$stream = [IO.File]::Open($zipPath, 'Create')
$archive = New-Object IO.Compression.ZipArchive($stream, 'Create')
$prefix = (Resolve-Path (Join-Path $root 'Chicken-Road\Main')).Path + '\'
$manifest = foreach ($f in Get-ChildItem -File -Recurse $src) {
    $rel = $f.FullName.Substring($prefix.Length).Replace('\', '/')
    $entry = $archive.CreateEntry($rel, [IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $fs = [IO.File]::OpenRead($f.FullName)
    $fs.CopyTo($es)
    $fs.Dispose(); $es.Dispose()
    "    '$rel' => $($f.Length),"
}
$archive.Dispose(); $stream.Dispose()

# prove the entry names are POSIX before shipping
$check = [IO.Compression.ZipFile]::OpenRead($zipPath)
$bad = @($check.Entries | Where-Object { $_.FullName -like '*\*' }).Count
$n = $check.Entries.Count
$check.Dispose()
if ($bad -gt 0) { throw "$bad entries still use backslashes" }

$php = @'
<?php
header('Content-Type: text/plain; charset=utf-8');
while (ob_get_level() > 0) { ob_end_flush(); }
@set_time_limit(300);
$main = __DIR__ . '/Chicken-Road/Main';

/* the previous zip unpacked as files literally named "assets\audio\bgm.mp3" */
$junk = 0;
foreach (@scandir($main) ?: [] as $e) {
    if (strpos($e, '\\') !== false && is_file($main . '/' . $e) && @unlink($main . '/' . $e)) { $junk++; }
}
echo "junk files removed: $junk\n";

$zip = __DIR__ . '/chicken-assets.zip';
if (!is_file($zip)) {
    echo "chicken-assets.zip not next to this script\n";
} elseif (!class_exists('ZipArchive')) {
    echo "no ZipArchive - use cPanel File Manager: right-click the zip > Extract into Chicken-Road/Main\n";
} else {
    $za = new ZipArchive;
    if ($za->open($zip) === true) {
        $n = $za->numFiles;
        $done = $za->extractTo($main . '/');
        $za->close();
        echo $done ? "extracted $n entries\n" : "EXTRACT FAILED - extract it in cPanel File Manager instead\n";
        if ($done) { @unlink($zip); }
    } else {
        echo "cannot open zip\n";
    }
}

$expected = [
MANIFEST_HERE
];
$missing = 0; $bad = 0;
foreach ($expected as $rel => $size) {
    $have = @filesize($main . '/' . $rel);
    if ($have === false) { $missing++; echo "  MISSING $rel\n"; }
    elseif ($have !== $size) { $bad++; echo "  SIZE    $rel ($have vs $size)\n"; }
}
echo count($expected) . " expected, $missing missing, $bad wrong size\n";
echo $missing === 0 && $bad === 0 ? "done - open /chicken-road and Ctrl+F5\n" : "done with gaps\n";
@unlink(__FILE__);
'@

[IO.File]::WriteAllText($out, $php.Replace('MANIFEST_HERE', ($manifest -join "`n")), (New-Object Text.UTF8Encoding($false)))
php -l $out
Write-Host ("zip: $n entries, 0 backslash names, {0:N1} MB" -f ((Get-Item $zipPath).Length / 1MB))
