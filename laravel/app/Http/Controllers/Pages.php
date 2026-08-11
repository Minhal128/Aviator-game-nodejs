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
                $html = preg_replace('/<head>/i', '<head><base href="/' . $game . '/">', $html, 1);
            }
            return response($html, 200)->header('Content-Type', 'text/html; charset=UTF-8');
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
