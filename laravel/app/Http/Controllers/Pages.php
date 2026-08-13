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
        // ponytail: base href so /game (no slash) still loads relative assets
        if ($rel === 'index.html') {
            $html = file_get_contents($file);
            if ($html !== false && !str_contains($html, '<base ')) {
                // the wallet block lets a game post to /game/road/* with the session's CSRF token
                $head = '<head><base href="/' . $game . '/">'
                    . '<script>window.TL_WALLET=' . json_encode([
                        'token' => csrf_token(),
                        'balance' => (float) wallet(user('id'), 'num'),
                        'currency' => user('currency') ?: 'Rs',
                        'userId' => (int) user('id'),
                    ]) . ';</script>';
                if (request()->boolean('mute')) {
                    // must land before the engine builds its audio graph
                    $head .= '<script src="/js/tl-mute.js"></script>';
                }
                $html = preg_replace('/<head>/i', $head, $html, 1);
                if ($game === 'gold-egypt') {
                    // after slotGame.js, so window.spinReels exists to be wrapped
                    $html = str_replace('</body>', '<script src="/js/tl-gold-egypt.js"></script></body>', $html);
                }
                if ($game === 'slot-glamour') {
                    // after main.js so runOnStartup() exists; both are modules, so order holds
                    $html = str_replace('</body>', '<script type="module" src="/js/tl-c3-slot.js"></script></body>', $html);
                }
            }
            return response($html, 200)->header('Content-Type', 'text/html; charset=UTF-8');
        }
        // Glamour Spins ships with useWorker:true, which hides the C3 runtime (and its
        // global variables: balance, betAmount, bonusbalance) inside a Web Worker where
        // the page cannot reach it. The flag is the vendor's own switch, so flip it at
        // serve time instead of editing the bundle - survives re-extracting html5.zip.
        if ($game === 'slot-glamour' && $rel === 'scripts/main.js') {
            $js = str_replace(
                'const e=true;window["c3_runtimeInterface"]',
                'const e=false;window["c3_runtimeInterface"]',
                (string) file_get_contents($file)
            );
            // a cached copy of the original brings the worker back and the wallet
            // bridge silently stops working, so this one file is never cacheable
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
