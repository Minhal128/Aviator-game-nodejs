<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Gameresult;
use App\Models\Userbit;
use App\Models\User;
use App\Models\Bank_detail;
use Carbon\Carbon;

class Pages extends Controller
{
    public function aviator() {
        $allresults = Gameresult::where('created_at', '>=', Carbon::today()->toDateString())->orderBy('id','desc')->get();
        $mybets = Userbit::where('userid',user('id'))->where('created_at', '>=', Carbon::today()->toDateString())->orderBy('id','desc')->get();
        // return $allresults;
        return view('crash',compact("allresults","mybets"));
    }

    public function deposit() {
        $bank = Bank_detail::where('userid',user('id'))->first();
        if (!$bank) {
            $bank = array();
        }
        return view('deposite',compact('bank'));
    }

    public function amount_transfer()
    {
        settle_open_holds(user('id'));
        $specificdata = null;
        $title = 'Amount Transfer';
        return view('amount_transfer', [
            'title' => $title,
        ]);
    }

    public function level_management() {
        $mypromocode = user('id');
        $level1users = User::where('promocode',$mypromocode)->get();
        $users = count($level1users);
        $level1 = $level1users;
        $level2 = array();
        $level3 = array();
        foreach ($level1users as $key2) {
            $level2users = User::where('promocode',$key2->id)->get();
            $users += count($level2users);
            if (count($level2users) > 0) {
                array_push($level2,$level2users);
            }
            foreach ($level2users as $key3) {
                $level3users = User::where('promocode',$key3->id)->get();
                $users += count($level3users);
                array_push($level3,$level3users);
            }
        }
        return view('level_management',compact('users','level1','level2','level3'));
    }

    /** Serve the bundled game builds under /chicken-road|/ludo|/gold-egypt|/slot-glamour. */
    public function gameStatic(string $game, ?string $path = null)
    {
        $games = dirname(base_path()) . DIRECTORY_SEPARATOR;
        $roots = [
            'chicken-road' => $games . 'Chicken-Road' . DIRECTORY_SEPARATOR . 'Main',
            'ludo' => $games . 'ludo' . DIRECTORY_SEPARATOR . 'ludo-royale' . DIRECTORY_SEPARATOR . 'client' . DIRECTORY_SEPARATOR . 'dist',
            'gold-egypt' => $games . 'goldegypt' . DIRECTORY_SEPARATOR . 'game',
            'slot-glamour' => $games . 'slotglamor' . DIRECTORY_SEPARATOR . 'game',
        ];
        if (!isset($roots[$game])) {
            abort(404);
        }
        $root = realpath($roots[$game]);
        if ($root === false || !is_dir($root)) {
            abort(503, match ($game) {
                'ludo' => 'Ludo client not built. From ludo/ludo-royale: npm i && npm run build --workspace @ludo/client',
                'slot-glamour' => 'Slot build missing. Extract slotglamor/html5.zip into slotglamor/game',
                default => 'Game files missing',
            });
        }
        $rel = ($path === null || $path === '') ? 'index.html' : str_replace(['..', '\\'], '', $path);
        $file = realpath($root . DIRECTORY_SEPARATOR . $rel);
        if ($file === false || !is_file($file) || !str_starts_with($file, $root)) {
            abort(404);
        }
        // Gold of Egypt is 47MB of art in ~120 files. Routed through the front
        // controller that is 120 PHP boots per load, each waiting on the same session
        // file lock, and shared hosting drops the overflow - Phaser then draws its green
        // missing-texture box for whatever did not arrive. The bundle already sits inside
        // public_html, so point the base at it and let Apache serve the art directly;
        // index.html still comes through here for auth and the wallet injection.
        // Glamour same path: scripts/main.js is patched on disk (useWorker:false).
        $staticBase = [
            'gold-egypt' => '/goldegypt/game/',
            'slot-glamour' => '/slotglamor/game/',
            // same trick as Egypt: art/js/audio must not touch the session file
            'chicken-road' => '/Chicken-Road/Main/',
            'ludo' => '/ludo/ludo-royale/client/dist/',
        ];
        $baseHref = $staticBase[$game] ?? '/' . $game . '/';

        // ponytail: base href so /game (no slash) still loads relative assets
        if ($rel === 'index.html') {
            if (!request()->hasSession() || !session()->has('userlogin')) {
                return redirect('/');
            }
            $html = file_get_contents($file);
            if ($html !== false && !str_contains($html, '<base ')) {
                $viewport = str_contains($html, 'name="viewport"')
                    ? ''
                    : '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">';
                $boot = '<style>#tl-gboot{position:fixed;inset:0;z-index:99998;background:#070b14;display:flex;align-items:center;justify-content:center;transition:opacity .25s}#tl-gboot.is-done{opacity:0;pointer-events:none}.tl-gboot-spin{width:36px;height:36px;border:3px solid rgba(255,255,255,.15);border-top-color:#e50539;border-radius:50%;animation:tl-gboot .7s linear infinite}@keyframes tl-gboot{to{transform:rotate(360deg)}}</style>'
                    . '<div id="tl-gboot" aria-busy="true" aria-label="Loading"><div class="tl-gboot-spin"></div></div>'
                    . '<script>(function(){var b=document.getElementById("tl-gboot");function hide(){if(!b||b.classList.contains("is-done"))return;b.classList.add("is-done");setTimeout(function(){if(b&&b.parentNode)b.parentNode.removeChild(b)},250)}window.addEventListener("load",hide);setTimeout(hide,8000)})();</script>';
                $head = '<head><base href="' . $baseHref . '">'
                    . $viewport
                    . $boot
                    . '<script>window.TL_WALLET=' . json_encode([
                        'token' => csrf_token(),
                        'balance' => (float) wallet(user('id'), 'num'),
                        'currency' => user('currency') ?: '₹',
                        'userId' => (int) user('id'),
                        'minBet' => (float) setting('min_bet_amount'),
                        'maxBet' => (float) setting('max_bet_amount'),
                        // share of stake that is payable; the ladder a game draws must match what it pays
                        'winPct' => win_pct(),
                    ]) . ';</script>'
                    . '<script src="/js/tl-back.js"></script>';
                if ($game === 'ludo') {
                    $head .= '<script src="/js/tl-ludo.js"></script>';
                }
                if (request()->boolean('mute')) {
                    // must land before the engine builds its audio graph
                    $head .= '<script src="/js/tl-mute.js"></script>';
                }
                $html = preg_replace('/<head>/i', $head, $html, 1);
                if ($game === 'gold-egypt' || $game === 'slot-glamour') {
                    $slotClass = $game === 'gold-egypt' ? 'tl-slot tl-slot-egypt' : 'tl-slot tl-slot-glamour';
                    $slotLabel = $game === 'gold-egypt' ? 'Gold of Egypt' : 'Glamour Spins';
                    $html = preg_replace(
                        '/<body([^>]*)>/i',
                        '<body$1 class="' . $slotClass . '">',
                        $html,
                        1
                    );
                    $html = str_replace(
                        '</body>',
                        '<link rel="stylesheet" href="/css/tl-slots.css?v=20260823-hud">'
                        . '<div class="tl-slot-brand" aria-hidden="true">Turbo · ' . $slotLabel . '</div>'
                        . ($game === 'gold-egypt'
                            ? '<script src="/js/tl-gold-egypt.js?v=20260823-nomaxbar"></script>'
                            : '<script type="module" src="/js/tl-c3-slot.js?v=20260823-fit"></script>')
                        . '</body>',
                        $html
                    );
                }
            }
            return response($html, 200)->header('Content-Type', 'text/html; charset=UTF-8');
        }
        // Belt: if something still hits /slot-glamour/scripts/main.js (old base),
        // force useWorker:false. On-disk file is already patched for Apache.
        if ($game === 'slot-glamour' && $rel === 'scripts/main.js') {
            $raw = (string) file_get_contents($file);
            $js = str_replace(
                'const e=true;window["c3_runtimeInterface"]',
                'const e=false;window["c3_runtimeInterface"]',
                $raw
            );
            return response($js, 200)
                ->header('Content-Type', 'application/javascript; charset=UTF-8')
                ->header('Cache-Control', 'no-store, must-revalidate');
        }
        // Windows mime_content_type often returns text/plain for .css → browser ignores stylesheet
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $mimes = [
            'css' => 'text/css; charset=UTF-8',
            'js' => 'application/javascript; charset=UTF-8',
            'mjs' => 'application/javascript; charset=UTF-8',
            'json' => 'application/json',
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'svg' => 'image/svg+xml',
            'ico' => 'image/x-icon',
            'mp3' => 'audio/mpeg',
            'wav' => 'audio/wav',
            'ogg' => 'audio/ogg',
            'm4a' => 'audio/mp4',
            'webm' => 'video/webm',
            'mp4' => 'video/mp4',
            'otf' => 'font/otf',
            'ttf' => 'font/ttf',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'xml' => 'application/xml',
            'pdf' => 'application/pdf',
            'webmanifest' => 'application/manifest+json',
            'html' => 'text/html; charset=UTF-8',
        ];
        $headers = isset($mimes[$ext]) ? ['Content-Type' => $mimes[$ext]] : [];
        return response()->file($file, $headers);
    }
}
