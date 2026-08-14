<?php

namespace App\Http\Controllers;

use App\Models\Bankdetail;
use App\Models\Setting;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Facades\Storage;

class Admin extends Controller
{
    public function login()
    {
        // ponytail: blade cache on cPanel kept serving the old login; this file is outside laravel/
        $path = dirname(base_path()) . DIRECTORY_SEPARATOR . 'admin-login.html';
        abort_unless(is_file($path), 500);
        $html = file_get_contents($path);
        $html = str_replace('__CSRF__', csrf_field(), $html);
        $html = str_replace('__LOGIN_URL__', url('auth/admin/login'), $html);
        return response($html);
    }
    // ponytail: compiled blades on cPanel still emit /aviatoradmin/ (403). Rewrite at the response.
    private function page(string $view, array $data = [])
    {
        $html = view($view, $data)->render();
        $html = str_replace('/aviatoradmin/assets/', '/css/tl/', $html);
        $html = preg_replace('#https?://[^/]+/vendor/izitoast/css/iziToast\.min\.css#', '/css/iziToast.min.css', $html);
        $html = preg_replace('#https?://[^/]+/vendor/izitoast/js/iziToast\.min\.js#', '/js/iziToast.min.js', $html);
        $html = str_replace('/vendor/izitoast/css/iziToast.min.css', '/css/iziToast.min.css', $html);
        $html = str_replace('/vendor/izitoast/js/iziToast.min.js', '/js/iziToast.min.js', $html);
        return response($html);
    }

    public function dashboard()
    {
        $user = User::all();
        $recharge = Transaction::where('category', 'recharge')->get();
        $withdrawal = Transaction::where('category', 'withdraw')->get();
        return $this->page("admin.dashboard", [
            "user" => $user,
            "recharge" => $recharge,
            "withdrawal" => $withdrawal,
        ]);
    }
    public function userlist()
    {
        $userlist = User::where('isadmin', null)->orderBy('id','desc')->get();
        return $this->page("admin.userlist", compact("userlist"));
    }
    public function useredit($id)
    {
        $user = User::where('isadmin', null)->where('id', $id)->first();
        return $this->page("admin.useredit", compact("user"));
    }
    public function chagepassword()
    {
        return $this->page('admin.changepassword');
    }
    public function rechargehistory()
    {
        $history = Transaction::where('category', 'recharge')->where('type', 'credit')->orderBy('id','desc')->get();
        $title = 'Recharge Hitory';
        return $this->page('admin.rechargehistory', [
            'history' => $history,
            'title' => $title,
        ]);
    }
    public function withdrawalhistory()
    {
        $history = Transaction::where('category', 'withdraw')->where('type', 'debit')->join('bank_details', 'transactions.userid', '=', 'bank_details.userid')->select('transactions.*','bank_details.accountno','bank_details.ifsccode','bank_details.branchname','bank_details.upi_id','bank_details.mobile_no')->orderBy('transactions.id','desc')->get();
        $title = 'Withdrawal Hitory';
        return $this->page('admin.withdrawhistory', [
            'history' => $history,
            'title' => $title,
        ]);
    }
    public function bankdetail()
    {
        $rows = Bankdetail::orderBy('id')->get();
        return $this->page('admin.bankdetail', [
            'upis' => $rows->filter(fn ($r) => in_array($r->rail, ['upi', 'both'], true)),
            'banks' => $rows->filter(fn ($r) => in_array($r->rail, ['bank', 'both'], true)),
            'minDeposit' => setting('min_recharge'),
            'minWithdrawal' => setting('min_withdrawal'),
        ]);
    }

    /** Signup credit for referred player + reward for the referrer. */
    public function referral()
    {
        return $this->page('admin.referral', [
            'referralBonus' => Setting::where('category', 'referral_bonus')->value('value') ?? '100',
            'referrerBonus' => Setting::where('category', 'referrer_bonus')->value('value') ?? '100',
        ]);
    }
    /**
     * Streams the deposit screenshot. It lives on the local disk, off the web root,
     * so this admin-only route is the only way to see it.
     *
     * The type is taken from the extension the upload was accepted under, never
     * sniffed from the bytes: a file the player named .png but filled with markup
     * would otherwise be served back as HTML on the admin's own origin.
     */
    public function proof($id)
    {
        $trn = Transaction::where('id', $id)->where('category', 'recharge')->first();
        abort_unless($trn && $trn->proof && Storage::disk('local')->exists($trn->proof), 404);
        $types = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
        $ext = strtolower(pathinfo($trn->proof, PATHINFO_EXTENSION));
        abort_unless(isset($types[$ext]), 404);
        return response()->file(Storage::disk('local')->path($trn->proof), [
            'Content-Type' => $types[$ext],
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function logout()
    {
        if (session()->has('adminlogin')) {
            session()->forget('adminlogin');
        }
        return redirect('/admin');
    }
}
