<?php
/**
 * A referral link pasted with a trailing slash (/register/?refer=123) made every
 * bare-relative asset resolve under /register/, so the page rendered naked.
 * Run: php laravel/tests/relative_asset_paths_check.php
 */
$bad = [];
$dir = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(__DIR__ . '/../resources/views'));
foreach ($dir as $file) {
    if ($file->getExtension() !== 'php') {
        continue;
    }
    $lines = file($file->getPathname());
    foreach ($lines as $n => $line) {
        if (preg_match('/(?:href|src)="(?:css|js|images|user|vendor|dist|unpkg\.com)\//', $line)
            || preg_match("/url: '(?!\/|https?:)[a-z_]/", $line)) {
            $bad[] = $file->getFilename() . ':' . ($n + 1) . ' ' . trim($line);
        }
    }
}

assert($bad === [], "relative asset/ajax paths break on trailing-slash URLs:\n" . implode("\n", $bad));
echo $bad ? "FAIL\n" . implode("\n", $bad) . "\n" : "OK: no bare-relative asset or ajax paths in views\n";
exit($bad ? 1 : 0);
