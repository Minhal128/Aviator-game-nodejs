<?php
                    
//         define('DB_SERVER', 'localhost');
// define('DB_USERNAME', 'seekosoft_adbanaouser');
// define('DB_PASSWORD', 'seekosoft_adbanaouser@11');
// define('DB_NAME', 'seekosoft_adbanao');
// // Try connecting to the Database
// $conn = mysqli_connect(DB_SERVER, DB_USERNAME, DB_PASSWORD, DB_NAME);

// //Check the connection
// if($conn == false){
//     dir('Error: Cannot connect');
// }
// $sql3 = "SELECT value FROM emredperiod WHERE category=game_between_time_end and id='14'";
// $result3 =$conn->query($sql3);
// $row3 = mysqli_fetch_assoc($result3);
// @$period=$row3['value'];


namespace App\Http\Controllers;

use App\Models\Gameresult;
use App\Models\Setting;
use App\Models\Userbit;
use App\Services\PoolCrashEngine;
use Illuminate\Http\Request;
use Carbon\Carbon;

class Gamesetting extends Controller
{
    
    public function crash_plane()
    {
        return 1;
    }
    public function game_existence(Request $r)
    {
        $event = $r->event;
        if ($event == "check") {
            $new = Setting::where('category', 'game_status')->where('value', '0')->first();
            
            if ($new || (session()->has('gamegenerate') && session()->get('gamegenerate') == 1)) {
                return array('data'=>true);
            }else{
                return array('data'=>false);
            }
            return array('data'=>false);
        }
    }
    public function new_game_generated(Request $r)
    {
        $new = Setting::where('category', 'game_status')->update(['value' => '0']);
        $r->session()->put('gamegenerate','1');
        return response()->json(array("id" => currentid()));
    }
    
    /** Start authoritative flight (pool or random empty round). */
    public function increamentor(Request $r)
    {
        $gamestatusdata = Setting::where('category', 'game_status')->first();
        if (!$gamestatusdata) {
            return response()->json(['status' => false]);
        }

        $engine = app(PoolCrashEngine::class);
        $gameId = (int) currentid();
        $state = $engine->startFlight($gameId);

        return response()->json([
            'status' => true,
            'result' => 0, // never ship crash_at to the browser
            'mode' => $state['mode'],
            'pool' => $state['pool'],
            'total_bets' => $state['total_bets'],
            'game_id' => $gameId,
        ]);
    }

    /** Server clock + pool crash check. Clients poll this (or via socket proxy). */
    public function tick(Request $r)
    {
        $gameId = (int) ($r->game_id ?: currentid());
        $engine = app(PoolCrashEngine::class);
        $out = $engine->tick($gameId);
        return response()->json($out);
    }

    /** Internal tick for Node game-server (shared secret). */
    public function serverTick(Request $r)
    {
        $secret = env('GAME_SERVER_SECRET', 'change-me');
        if ($r->header('X-Game-Secret') !== $secret) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        return $this->tick($r);
    }

    public function game_over(Request $r)
    {
        $r->session()->forget('result');
        $gameId = (int) $r->game_id;
        if ($gameId > 0) {
            app(PoolCrashEngine::class)->ensureCrashed($gameId);
        }
        Setting::where('category', 'game_status')->update(['value' => '0']);
        $r->session()->put('gamegenerate', '0');
        return wallet(user('id'));
    }

    public function betNow(Request $r)
    {
        $status = false;
        $message = "Something went wrong!";
        $data = array();
        $returnbets = array();
        $bets = $r->all_bets;
        if (!is_array($bets) || count($bets) < 1) {
            return response()->json(["isSuccess" => false, "data" => [], "message" => "No bets"]);
        }

        $uid = user('id');
        $need = 0.0;
        $minBet = (float) setting('min_bet_amount');
        $maxBet = (float) setting('max_bet_amount');
        foreach ($bets as $b) {
            $amt = floatval($b['bet_amount']);
            if ($amt < $minBet || $amt > $maxBet) {
                return response()->json(["isSuccess" => false, "data" => [], "message" => "Bet must be " . $minBet . "-" . $maxBet]);
            }
            $need += $amt;
        }
        // ponytail: reject whole batch if wallet can't cover all (was deducting bet1 then failing bet2)
        if ($need > wallet($uid, 'num')) {
            return response()->json(["isSuccess" => false, "data" => [], "message" => "Insufficient fund!!"]);
        }

        foreach ($bets as $b) {
            $result = new Userbit;
            $result->userid = $uid;
            $result->amount = $b['bet_amount'];
            $result->type = $b['bet_type'];
            $result->gameid = currentid();
            $result->section_no = $b['section_no'];
            if ($result->save()) {
                $status = true;
                array_push($returnbets, ["bet_id" => $result->id]);
                addwallet($uid, floatval($b['bet_amount']), "-");
                $data = [
                    "wallet_balance" => wallet($uid),
                    "return_bets" => $returnbets,
                ];
                $message = "";
            }
        }
        $response = array("isSuccess" => $status, "data" => $data, "message" => $message);
        return response()->json($response);
    }
    public function currentlybet()
    {
        // ponytail: only real bets this round (was injecting 400–900 fake rows)
        $allbets = Userbit::where("gameid", currentid())->join('users','users.id','=','userbits.userid')->get();
        $currentGame = array("id"=>currentid());
        $currentGameBetCount = count($allbets);
        $response = array("currentGame" => $currentGame, "currentGameBet" => $allbets, "currentGameBetCount" => $currentGameBetCount);
        return response()->json($response);
    }
    public function my_bets_history(){
        $userid = user('id');
        $userbets = Userbit::where("userid", $userid)->where('status',1)->where('created_at', '>=', Carbon::today()->toDateString())->orderBy('id','desc')->get();
        return response()->json($userbets);
    }
	public function cashout(Request $r){
		$game_id = (int) $r->game_id;
		$bet_id = (int) $r->bet_id;
		$status = false;
        $message = "";
        $data = array();

        $engine = app(PoolCrashEngine::class);
        $out = $engine->cashout($game_id, $bet_id, (int) user('id'), floatval($r->win_multiplier));

        if (!empty($out['ok'])) {
            $status = true;
            $data = [
                'wallet_balance' => $out['wallet_balance'],
                'cash_out_amount' => $out['cash_out_amount'],
                'crashed' => !empty($out['crashed']),
                'multiplier' => $out['multiplier'] ?? null,
            ];
        } else {
            $message = $out['message'] ?? 'Cashout failed';
            $data = [
                'crashed' => !empty($out['crashed']),
                'multiplier' => $out['multiplier'] ?? null,
                'silent' => !empty($out['silent']),
                'bet_lost' => !empty($out['bet_lost']),
            ];
        }

		$response = array("isSuccess" => $status, "data" => $data, "message" => $message);
        return response()->json($response);
	}
	
	public function cronjob(){
	    //0 = Game end & statrting soon
	    //1 = Game start & and is in proccess
	    $gamestatusdata = Setting::where('category', 'game_status')->first();
	    $game_status = 0;
	    if($gamestatusdata){
	        $game_status = $gamestatusdata->value;
	    }
	    if($game_status == 1){
	    $last_start_time = Setting::where('category', 'game_start_time')->first()->value;
	    $last_till_time = Setting::where('category', 'game_between_time')->first()->value;
	    $bothdifference = datealgebra($last_start_time, '+', ($last_till_time/1000).' seconds', $format = "Y-m-d h:i:s");
	    if(strtotime(date('Y-m-d h:i:s')) >= strtotime($bothdifference)){
	        $gamestatusdata = Setting::where('category', 'game_status')->update([
	             "value"  => 0
	             ]);
	    }
	    }elseif($game_status == 0){
	         $gamestatusdata = Setting::where('category', 'game_status')->update(["value"  => 1]);
	         $gamestatusdata = Setting::where('category', 'game_start_time')->update(["value"  => date('Y-m-d h:i:s')]);
	         $gamestatusdata = Setting::where('category', 'game_between_time')->update(["value"  => 5000]);
	    }else{}
	}
}
