<?php
/**
 * Renders the lobby in both auth states and asserts the pieces the redesign
 * depends on. Run: php tools/ui-smoke.php
 */
require __DIR__ . '/../laravel/vendor/autoload.php';
$app = require __DIR__ . '/../laravel/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$fail = 0;
function check(string $what, bool $ok): void
{
    global $fail;
    printf("  [%s] %s\n", $ok ? 'ok' : 'FAIL', $what);
    if (!$ok) {
        $fail++;
    }
}

$games = ['/crash', '/chicken-road/', '/ludo/', '/gold-egypt/', '/slot-glamour/'];

echo "== lobby, logged out ==\n";
session()->forget('userlogin');
$html = view('welcome')->render();
check('5 game cards', substr_count($html, 'class="tl-card"') === 5);
check('every card gated behind login', substr_count($html, 'LOGIN TO PLAY') === 5);
check('no play links leak to guests', !str_contains($html, 'PLAY NOW'));
check('no demo links leak to guests', !str_contains($html, 'PLAY DEMO'));
check('login + register modals present', str_contains($html, 'id="login-modal"') && str_contains($html, 'id="register-modal"'));

echo "== lobby, logged in ==\n";
$user = App\Models\User::orderBy('id')->first();
if (!$user) {
    echo "  [FAIL] no user in the database to render the logged-in lobby\n";
    $fail++;
} else {
    session()->put('userlogin', $user);
    $html = view('welcome')->render();
    check('5 game cards', substr_count($html, 'class="tl-card"') === 5);
    foreach ($games as $href) {
        // all five settle against the wallet now, so all five get the real button
        $cls = 'tl-btn tl-btn-primary tl-btn-block';
        check("playable: $href", str_contains($html, 'href="' . $href . '" class="' . $cls . '"'));
    }
    check('no demo badges left', substr_count($html, 'tl-tag-demo') === 0);
    check('5 real-money games', substr_count($html, '>PLAY NOW</a>') === 5);
    check('balance shown', str_contains($html, 'tl-balance'));
    session()->forget('userlogin');
}

echo "== hero slider ==\n";
session()->forget('userlogin');
$html = view('welcome')->render();
check('5 banners in the carousel', substr_count($html, 'class="owl-lazy" data-src="images/slider') === 5);
foreach (glob(__DIR__ . '/../images/slider*.jpg') as $banner) {
    check('banner exists: ' . basename($banner), is_file($banner));
}
foreach (glob(__DIR__ . '/../images/tile-*.jpg') as $tile) {
    check('card tile exists: ' . basename($tile), is_file($tile));
}
check('5 card tiles used', substr_count($html, 'images/tile-') === 5);
check('carousel picked up by js/main.js', str_contains($html, 'owl-carousel tl-slider'));
check('edge strips present', str_contains($html, 'tl-slide-prev') && str_contains($html, 'tl-slide-next'));

echo "== info pages ==\n";
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$slugs = ['about' => 'About us', 'rules' => 'The rules', 'contacts' => 'Contacts', 'affiliate' => 'Affiliate program', 'faq' => 'FAQ'];
foreach ($slugs as $slug => $title) {
    $res = $kernel->handle(Illuminate\Http\Request::create('/' . $slug));
    check("/$slug renders", $res->getStatusCode() === 200 && str_contains($res->getContent(), '<h1>' . $title . '</h1>'));
}
check('unknown slug still 404s', $kernel->handle(Illuminate\Http\Request::create('/nope'))->getStatusCode() === 404);
check('game routes not shadowed', $kernel->handle(Illuminate\Http\Request::create('/crash'))->getStatusCode() === 302);

echo "== chrome ==\n";
check('tl-ui.css exists', is_file(__DIR__ . '/../css/tl-ui.css'));
foreach (['usergame', 'usergame2'] as $layout) {
    $src = file_get_contents(__DIR__ . "/../laravel/resources/views/Layout/$layout.blade.php");
    check("$layout links tl-ui.css after style.css", strpos($src, 'css/tl-ui.css') > strpos($src, 'css/style.css'));
}
$footer = view('include.footer')->render();
$live = preg_replace('/<!--.*?-->/s', '', $footer); // the file keeps old icons commented out
check('4 payment icons left', substr_count($live, 'footer-icon mastercard') === 4);
check('webmoney icon removed', !str_contains($live, 'C0DAEC')); // webmoney's wordmark fill
check('copyright strip removed', !str_contains($footer, 'All rights reserved') && !str_contains($footer, 'footer-bottom'));
foreach (array_keys($slugs) as $slug) {
    check("footer links /$slug", str_contains($footer, 'href="/' . $slug . '"'));
}
foreach (['crash', 'chicken-road/', 'ludo/', 'gold-egypt/', 'slot-glamour/'] as $game) {
    check("footer links /$game", str_contains($footer, 'href="/' . $game . '"'));
}
$css = file_get_contents(__DIR__ . '/../css/tl-ui.css');
// the youtube glyph is the one two-path svg: its play arrow is painted in the
// button colour to read as a cut-out, so the two have to keep matching
check('youtube cut-out selector still matches the svg', str_contains($css, 'path[fill="#04386e"]') && str_contains($live, 'fill="#04386e"'));

echo "== account menu ==
";
// the menu only renders for a signed-in player, so borrow the newest account
session()->put('userlogin', App\Models\User::where('isadmin', null)->orderBy('id', 'desc')->first());
$header = view('include.header')->render();
preg_match_all('/<a href="([^"]+)" class="tl-mi/', $header, $m);
check('13 menu items', count($m[1]) === 13);
foreach ($m[1] as $href) {
    $code = $kernel->handle(Illuminate\Http\Request::create($href))->getStatusCode();
    // logged out, so a real route answers 200 or redirects; 404 means a typo
    check("menu item $href resolves ($code)", $code !== 404);
}
check('menu sections labelled', substr_count($header, 'tl-menu-sec') === 3);
check('sign out marked apart', str_contains($header, 'tl-mi tl-mi-danger'));

echo "== glamour spins (on the wallet) ==
";
// This game has no paytable to read, so the margin comes from the server picking
// which measured spin happens. Three things make that honest and none of them are
// obvious from the code they live in, so they get checked here.
$c3 = file_get_contents(__DIR__ . '/../js/tl-c3-slot.js');
$routes = file_get_contents(__DIR__ . '/../laravel/routes/web.php');
$ctl = file_get_contents(__DIR__ . '/../laravel/app/Http/Controllers/GlamourSpins.php');
check('the wallet routes are registered', str_contains($routes, 'game/glamour/spin'));
check('the third-party endpoint is still overridden', str_contains($c3, "g.apiUrl = new URL('/game/slot-api'"));

// the seed must not reach the browser until the bet has been taken, or a player
// can replay it against their own copy of the game and only stake on the good ones
$spinBody = substr($ctl, strpos($ctl, 'public function spin('));
$spinBody = substr($spinBody, 0, strpos($spinBody, "
    }"));
check('the server settles before it returns the seed',
    strpos($spinBody, "addwallet") < strpos($spinBody, "'seed' => "));

// all three of these are load-bearing for a seed meaning the same spin twice
check('the bridge resets the layout before every spin', str_contains($c3, "goToLayout('Game')"));
check('the bridge restores the globals too', str_contains($c3, 'function restore()') && str_contains($c3, 'TL.snap'));
check('the bridge pins the timestep', str_contains($c3, 'STEP = 1000 / 60'));
check('the bridge arms the stream from the server seed', str_contains($c3, 'arm(res.data.seed)'));

// a table measured any other way describes a sequence, not a set of seeds
$seedsFile = __DIR__ . '/glamour-seeds.json';
check('a measured seed table exists', is_file($seedsFile));
if (is_file($seedsFile)) {
    $seeds = json_decode(file_get_contents($seedsFile), true);
    check('the table was measured in the reset-per-spin regime', ($seeds['regime'] ?? null) === 'reset-per-spin');
    check('enough seeds to shape a distribution (' . count($seeds['seeds']) . ')', count($seeds['seeds']) >= 500);
}
check('the controller refuses a table from any other regime', str_contains($ctl, "'reset-per-spin'"));

$pages = file_get_contents(__DIR__ . '/../laravel/app/Http/Controllers/Pages.php');
// a cached main.js brings the worker back and the bridge silently detaches
check('rewritten main.js is served no-store', str_contains($pages, "'Cache-Control', 'no-store, must-revalidate'"));

echo "== admin chrome ==
";
// mdi-cash-plus and mdi-cash-minus are not in this icon build and rendered as
// nothing at all, twice. Every glyph the admin asks for has to exist.
$icons = file_get_contents(__DIR__ . '/../aviatoradmin/assets/vendors/mdi/css/materialdesignicons.min.css');
$adminviews = array_merge(glob(__DIR__ . '/../laravel/resources/views/admin/*.blade.php'),
                          glob(__DIR__ . '/../laravel/resources/views/include/admin/*.blade.php'));
$missing = [];
foreach ($adminviews as $v) {
    preg_match_all('/mdi-([a-z0-9-]+)/', file_get_contents($v), $mm);
    foreach (array_unique($mm[1]) as $name) {
        if (in_array($name, ['icon'], true)) continue;   // mdi-icon is a wrapper class
        if (!str_contains($icons, 'mdi-' . $name . ':')) $missing[] = basename($v) . ': mdi-' . $name;
    }
}
check('every admin mdi icon exists' . ($missing ? ' (' . implode(', ', $missing) . ')' : ''), $missing === []);
$theme = file_get_contents(__DIR__ . '/../aviatoradmin/assets/css/turbo-theme.css');
// one palette across both surfaces, or they stop looking like one product
foreach (['#e50539' => 'crimson', '#ffb020' => 'amber', '#14c46a' => 'green'] as $hex => $name) {
    check("admin shares the site $name ($hex)", str_contains($theme, $hex) && str_contains($css, $hex));
}

// .header-top is fixed and 60px tall, the lobby has to clear it
check('lobby clears the fixed header', str_contains($css, 'padding: 84px 16px 56px'));
// login / forgot / reset / register all open at one size
check('auth modals share a height', str_contains($css, 'min-height: min(630px, 88vh)'));

echo $fail === 0 ? "\nui_smoke OK\n" : "\n$fail problem(s)\n";
exit($fail === 0 ? 0 : 1);
