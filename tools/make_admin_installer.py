from pathlib import Path
import base64

root = Path(__file__).resolve().parents[1]
payloads = {
    "admin-login.html": root / "admin-login.html",
    "laravel/app/Http/Controllers/Admin.php": root / "laravel/app/Http/Controllers/Admin.php",
    "laravel/app/Http/Controllers/Adminapi.php": root / "laravel/app/Http/Controllers/Adminapi.php",
    "js/appcustomize.js": root / "js/appcustomize.js",
}

parts = ["    '%s' => '%s'," % (rel, base64.b64encode(src.read_bytes()).decode("ascii")) for rel, src in payloads.items()]

php = """<?php
header('Content-Type: text/plain; charset=utf-8');
$base = __DIR__;
$ok = 0;
$fail = 0;
$files = [
%s
];
foreach ($files as $rel => $b64) {
    $path = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) {
        echo "FAIL mkdir $rel\\n";
        $fail++;
        continue;
    }
    $data = base64_decode($b64);
    if (@file_put_contents($path, $data) === false) {
        echo "FAIL write $rel\\n";
        $fail++;
        continue;
    }
    @chmod($path, 0644);
    echo "OK $rel (" . strlen($data) . ")\\n";
    $ok++;
}
$views = $base . '/laravel/storage/framework/views';
$cleared = 0;
foreach ([$views, $base . '/_views_tmp'] as $dir) {
    if (!is_dir($dir)) continue;
    foreach (glob($dir . '/*.php') ?: [] as $f) {
        if (@unlink($f)) $cleared++;
    }
}
echo "cache cleared: $cleared\\n";
echo "done ok=$ok fail=$fail\\n";
@unlink(__FILE__);
""" % "\n".join(parts)

out = Path.home() / "Desktop" / "install-admin-ui.php"
out.write_text(php, encoding="utf-8")
print(out, out.stat().st_size)
