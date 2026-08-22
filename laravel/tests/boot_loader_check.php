<?php
/**
 * Boot loader must cover lobby/screens; no-js must stay off (owl FOUC).
 * Run: php laravel/tests/boot_loader_check.php
 */
$root = __DIR__ . '/../resources/views';
$boot = file_get_contents($root . '/include/tl-boot.blade.php');
assert(str_contains($boot, 'id="tl-boot"'), 'boot markup');
assert(str_contains($boot, 'tl-boot-spin'), 'boot spinner');
assert(str_contains($boot, "addEventListener('DOMContentLoaded'"), 'hides on DOMContentLoaded');
assert(str_contains($boot, 'setTimeout(hide, 4000)'), 'boot timeout so CDNs cannot freeze mobile');
assert(!str_contains($boot, "addEventListener('click'"), 'click overlay froze games on mobile');

foreach (['Layout/usergame.blade.php', 'Layout/usergame2.blade.php'] as $f) {
    $html = file_get_contents("$root/$f");
    assert(str_contains($html, "include('include.tl-boot')") || str_contains($html, 'include("include.tl-boot")'), "$f includes boot");
    assert(!preg_match('/<html[^>]*class="[^"]*no-js/', $html), "$f must not use no-js");
}

$crash = file_get_contents("$root/crash.blade.php");
assert(!preg_match('/<html[^>]*class="[^"]*no-js/', $crash), 'crash must not use no-js');
assert(str_contains($crash, 'load-txt'), 'crash keeps its own loader');

$welcome = file_get_contents("$root/welcome.blade.php");
assert(str_contains($welcome, 'owl-lazy'), 'lobby slider');
assert(str_contains($welcome, 'data:image/gif;base64'), 'lazy placeholder src');
assert(str_contains($welcome, "asset('images/tile-aviator.jpg')"), 'absolute tile paths');

echo "OK: boot loader wired, no-js FOUC fixed\n";
