<?php

use App\Models\Gameresult;
use App\Models\Setting;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Wallet;
use App\Models\Userbit;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

function imageupload($file, $name, $path)
{
    $file_name = "";
    $file_type = "";
    $filePath = "";
    $size = "";

    if ($file) {
        $file_name = $file->getClientOriginalName();
        $file_type = $file->getClientOriginalExtension();
        $fileName = $name . "." . $file_type;
        Storage::disk('public')->put($path . $fileName, File::get($file));
        $filePath = "/" . 'storage/' . $path . $fileName;
    }
    return $file = [
        'fileName' => $file_name,
        'fileType' => $file_type,
        'filePath' => $filePath,
    ];
}
function datealgebra($date, $operator, $value, $format = "Y-m-d")
{
    if ($operator == "-") {
        $date = date_create($date);
        date_sub($date, date_interval_create_from_date_string($value));
        return date_format($date, $format);
    } elseif ($operator == "+") {
        $date = date_create($date);
        date_add($date, date_interval_create_from_date_string($value));
        return date_format($date, $format);
    }
}
function user($parameter,$id=null)
{
    if ($id == null) {
        return session()->get('userlogin')[$parameter];
    }else{
        $data = User::where('id', $id)->first();
        return $data->{$parameter};
    }
    // return session()->get('userlogin')[$parameter];
}
function userdetail($id, $parameter)
{
    // the return was commented out, so both admin history tables showed every
    // player as "Not found!" - the admin has to know whose request they approve
    $data = User::where('id', $id)->first();
    return $data ? $data->{$parameter} : null;
}
function admin($parameter)
{
    return session()->get('adminlogin')[$parameter];
}
function wallet($userid, $type = "string")
{
    $row = ensure_wallet($userid);
    $amt = (float) $row->amount;
    if ($type == "num") {
        return $amt;
    }
    return number_format($amt, 2);
}

/** Cash that may leave the site (total − still-locked bonus). */
function withdrawable($userid, $type = "num")
{
    $row = ensure_wallet($userid);
    $w = max(0.0, (float) $row->amount - (float) ($row->bonus ?? 0));
    return $type === "string" ? number_format($w, 2) : $w;
}

/** How many × the bonus must be staked in games before it unlocks. */
function bonus_wager_mult(): float
{
    $v = Setting::where('category', 'bonus_wager_mult')->value('value');
    $m = $v === null ? 1.0 : (float) $v;
    return $m < 0 ? 0.0 : $m;
}

/** One wallet row per user id — create empty if missing. */
function ensure_wallet($userid)
{
    $userid = (string) $userid;
    $row = Wallet::where('userid', $userid)->first();
    if ($row) {
        return $row;
    }
    $row = new Wallet;
    $row->userid = $userid;
    $row->amount = 0;
    if (Schema::hasColumn('wallets', 'bonus')) {
        $row->bonus = 0;
        $row->wager_left = 0;
    }
    $row->save();
    return $row;
}
function setting($parameter)
{
    $setting = Setting::where('category', $parameter)->first();
    return $setting->value;
}

/**
 * Share of what players stake that is payable back, set by the admin
 * (settings.win_percentage). Every game reads this one row: 100 = the whole pot
 * can be won and the house keeps nothing, 95 = house keeps 5% (Aviator pool =
 * 95% of round bets). Ships at 95.
 */
function win_pct(): float
{
    $v = Setting::where('category', 'win_percentage')->value('value');
    return $v === null ? 95.0 : max(0.0, min(100.0, (float) $v));
}

/** win_pct() as an RTP fraction, e.g. 70 -> 0.70. */
function win_rtp(): float
{
    return win_pct() / 100.0;
}

function currentid()
{
    $data = Gameresult::orderBy('id', 'desc')->first();
    if ($data) {
        return $data->id;
    } else {
        return 0;
    }
}
function dformat($date, $format)
{
    $strd = date_create($date);
    // if (date($format) == date_format($strd, $format)) {
    //     return "Today";
    // }
    return date_format($strd, $format);
}
function resultbyid($id)
{
    $data = Gameresult::where('id', $id)->first();
    if ($data && $data->result != 'pending' && $data->result != '') {
        return $data->result;
    }
    return 0;
}
function userbetdetail($id,$parameter)
{
    $data = Userbit::where('id', $id)->first();
    if ($data) {
        return $data->{$parameter};
    }
    return 0;
}
/**
 * Move money on the wallet.
 * $wager=true on game stake debits: counts toward clearing bonus lock.
 * Withdrawals/transfers must leave $wager false so cash-out does not unlock bonus.
 */
function addwallet($id, $amount, $symbol = "+", $wager = false)
{
    $wallet = ensure_wallet($id);
    $cur = (float) $wallet->amount;
    $amt = (float) $amount;
    $bonus = (float) ($wallet->bonus ?? 0);
    $wagerLeft = (float) ($wallet->wager_left ?? 0);

    if ($symbol == "+") {
        $new = $cur + $amt;
    } elseif ($symbol == "-") {
        $new = $cur - $amt;
        if ($wager && $wagerLeft > 0) {
            $wagerLeft = max(0.0, $wagerLeft - $amt);
            if ($wagerLeft <= 0.00001) {
                $bonus = 0.0;
                $wagerLeft = 0.0;
            }
        }
        // losses (or cash withdraw) cannot leave locked bonus above the balance
        $bonus = min($bonus, max(0.0, $new));
    } else {
        return $cur;
    }

    // ponytail: amount always; bonus cols only if migrated (avoids bricking bets on partial deploy)
    static $hasBonusCols = null;
    if ($hasBonusCols === null) {
        $hasBonusCols = Schema::hasColumn('wallets', 'bonus') && Schema::hasColumn('wallets', 'wager_left');
    }
    $payload = ['amount' => $new];
    if ($hasBonusCols) {
        $payload['bonus'] = $bonus;
        $payload['wager_left'] = $wagerLeft;
    }
    Wallet::where('userid', (string) $id)->update($payload);
    // ponytail: old return was wallet()+amount AFTER update → lied by +$amount to every caller
    return $new;
}

/** Credit promotional funds: playable immediately, withdrawable only after wagering. */
function credit_bonus($id, $amount)
{
    $amount = (float) $amount;
    if ($amount <= 0) {
        return (float) ensure_wallet($id)->amount;
    }
    $wallet = ensure_wallet($id);
    $new = (float) $wallet->amount + $amount;
    $payload = ['amount' => $new];
    if (Schema::hasColumn('wallets', 'bonus') && Schema::hasColumn('wallets', 'wager_left')) {
        $payload['bonus'] = (float) ($wallet->bonus ?? 0) + $amount;
        $payload['wager_left'] = (float) ($wallet->wager_left ?? 0) + $amount * bonus_wager_mult();
    }
    Wallet::where('userid', (string) $id)->update($payload);
    return $new;
}
function appvalidate($input)
{
    if ($input == '' || $input == null || $input == 0) {
        return 'Not found!';
    } else {
        return $input;
    }
}
function lastrecharge($id, $parameter)
{
    $data = Transaction::where('userid', $id)->where('type', 'credit')->where('category', 'recharge')->orderBy('id', 'desc')->first();
    if ($data) {
        return $data->{$parameter};
    }
    return false;
}
function status($code, $type)
{
    if ($type == 'recharge') {
        if ($code == 0) {
            return array('color' => 'warning', 'name' => 'Pending');
        }
        if ($code == 1) {
            return array('color' => 'success', 'name' => 'Approved');
        }
        if ($code == 2) {
            return array('color' => 'danger', 'name' => 'Cancel');
        }
    } elseif ($type == "user") {
        if ($code == 0) {
            return array('color' => 'danger', 'name' => 'Inactive');
        }
        if ($code == 1) {
            return array('color' => 'success', 'name' => 'Active');
        }
        if ($code == 2) {
            return array('color' => 'warning', 'name' => 'Pending');
        }
    }
}
// function bankdetail($userid,$parameter){
//     Bank_detail::where('userid',);
// }
function platform($id)
{
    if ($id == 2) {
        return 'phonepay';
    } elseif ($id == 3) {
        return 'upi';
    } elseif ($id == 1) {
        return 'gpay';
    } elseif ($id == 9) {
        return 'imps';
    } elseif ($id == 6) {
        return 'netbanking';
    } else {
        return 'other';
    }
}

function addtransaction($userid, $platform, $transactionno, $type, $amount, $category, $remark, $status)
{
    $trn = new Transaction;
    $trn->userid = $userid;
    $trn->platform = $platform;
    $trn->transactionno = $transactionno;
    $trn->type = $type;
    $trn->amount = $amount;
    $trn->category = $category;
    $trn->remark = $remark;
    $trn->status = $status;
    if ($trn->save()) {
        return true;
    }
    return false;
}
