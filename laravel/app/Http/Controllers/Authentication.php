<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\Wallet;
use Hash;
use Illuminate\Http\Request;

class Authentication extends Controller
{
    public function login(Request $r)
    {
        $validated = $r->validate([
            'username' => 'required',
            'password' => 'required',
        ]);
        $data = "";
        $isSuccess = false;
        $message = "";
        $usernameexist = User::where('mobile', $r->username)->orWhere('email', $r->username)->first();
        if ($usernameexist) {
            if (Hash::check($r->password, $usernameexist->password)) {
                $r->session()->put('userlogin', $usernameexist);
                $message = "";
                $isSuccess = true;
            } else {
                $message = "Incorrect Password!";
            }
        } else {
            $message = "Username not found!";
        }
        $res = array("data" => $data, "isSuccess" => $isSuccess, "message" => $message);
        return response()->json($res);
    }

    public function register(Request $r)
    {
        $r->validate([
            'name' => 'required',
            'gender' => 'required',
            'email' => 'required|email',
            'password' => 'required',
            'mobile' => 'required',
            'device_key' => 'required|string|min:16|max:80',
        ]);

        $fail = function (string $message) {
            return response()->json(['data' => '', 'isSuccess' => false, 'message' => $message]);
        };

        $mobile = preg_replace('/\D+/', '', (string) $r->mobile);
        if (strlen($mobile) !== 10) {
            return $fail('Enter a valid 10-digit mobile number.');
        }

        // ponytail: browser UUID in localStorage+cookie — clearing both / private mode bypasses
        $deviceKey = trim((string) $r->device_key);
        if (!preg_match('/^[A-Za-z0-9_-]{16,80}$/', $deviceKey)) {
            return $fail('This device could not be verified. Refresh and try again.');
        }

        if (User::where('mobile', $mobile)->exists()) {
            return $fail('This mobile number is already registered.');
        }
        if (User::where('email', $r->email)->exists()) {
            return $fail('This email is already registered.');
        }
        if (User::where('device_key', $deviceKey)->exists()) {
            return $fail('An account was already created on this device.');
        }

        $promocode = '';
        $bonus = (float) setting('initial_bonus');
        $bonusCat = 'initial_bonus';
        $bonusRemark = 'Signup bonus';
        $bonusPlatform = 'Signup';

        if ($r->promocode != '') {
            if (!User::where('id', $r->promocode)->exists()) {
                return $fail('Invalid Promocode');
            }
            $promocode = $r->promocode;
            $bonus = (float) setting('referral_bonus');
            $bonusCat = 'referral_bonus';
            $bonusRemark = 'Referral signup bonus';
            $bonusPlatform = 'Referral';
        }

        $user = new User;
        $user->name = $r->name;
        $user->image = '/images/avtar/av-' . rand(1, 72) . '.png';
        $user->mobile = $mobile;
        $user->device_key = $deviceKey;
        $user->email = $r->email;
        $user->password = Hash::make($r->password);
        $user->currency = '₹';
        $user->gender = $r->gender;
        $user->country = 'IN';
        $user->status = '1';
        $user->promocode = $promocode;
        if (!$user->save()) {
            return $fail("Something wen't wrong!");
        }

        $wallet = new Wallet;
        $wallet->userid = $user->id;
        $wallet->amount = $bonus;
        if (\Illuminate\Support\Facades\Schema::hasColumn('wallets', 'bonus')) {
            $wallet->bonus = $bonus;
            $wallet->wager_left = $bonus * bonus_wager_mult();
        }
        if (!$wallet->save()) {
            return $fail("Something wen't wrong!");
        }
        if ($bonus > 0) {
            addtransaction($user->id, $bonusPlatform, date('ydmhsi'), 'credit', $bonus, $bonusCat, $bonusRemark, '1');
        }
        // ponytail: referrer_bonus waits for first approved deposit ≥ ₹300 (Adminapi::rechargeapproval)

        return response()->json([
            'data' => [
                'username' => $user->email,
                'password' => $r->password,
                'token' => csrf_token(),
            ],
            'isSuccess' => true,
            'message' => '',
        ]);
    }

    public function adminlogin(Request $r)
    {
        $validated = $r->validate([
            'username' => 'required',
            'password' => 'required',
        ]);
        $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Invalid Credential!");
        $usernameexist = User::where('mobile', $r->username)->orWhere('email', $r->username)->where('isadmin', '1')->first();
        if ($usernameexist) {
            if (Hash::check($r->password, $usernameexist->password)) {
                $r->session()->put('adminlogin', $usernameexist);
                $response = array('status' => 1, 'title' => "Success!!", 'message' => "Login Successfully!");
            } else {
                $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Incorrect Password!");
            }
        } else {
            $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Username not exists!");
        }
        return response()->json($response);
    }
}
