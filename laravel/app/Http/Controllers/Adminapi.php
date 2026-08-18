<?php

namespace App\Http\Controllers;

use App\Models\Bankdetail;
use App\Models\Bank_detail;
use App\Models\Gameresult;
use App\Models\Setting;
use App\Models\Transaction;
use App\Models\User;
use App\Models\Userbit;
use App\Models\Wallet;
use App\Services\PoolCrashEngine;
use Hash;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Database\Schema\Blueprint;

class Adminapi extends Controller
{
    public const MAX_DEPOSIT = 100000;

    public function changepassword(Request $r)
    {
        $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Invalid Credential!");
        $validated = $r->validate([
            'userid' => 'required',
            'newpassword' => 'required',
            'renewpassword' => 'required',
        ]);
        if ($r->newpassword == $r->renewpassword) {
            User::where('id', $r->userid)->where('isadmin', '1')->update([
                "password" => Hash::make($r->newpassword),
            ]);
            $response = array('status' => 1, 'title' => "Success!!", 'message' => "Password successfully updated!");
        } else {
            $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Password not match!");
        }
        return response()->json($response);
    }
    public function edituser(Request $r)
    {
        $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Invalid Credential!");
        $validated = $r->validate([
            'userid' => 'required',
            'newpassword' => 'required',
            'renewpassword' => 'required',
        ]);
        if ($r->newpassword == $r->renewpassword) {
            User::where('id', $r->userid)->where('isadmin', '1')->update([
                "password" => Hash::make($r->newpassword),
            ]);
            $response = array('status' => 1, 'title' => "Success!!", 'message' => "Password successfully updated!");
        } else {
            $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Password not match!");
        }
        return response()->json($response);
    }
    /**
     * Credits a deposit request after the admin has looked at the screenshot.
     *
     * Amount and owner come from the stored row, not the posted form, and the row
     * is claimed with a where(status 0) before any money moves - approving twice
     * used to credit twice.
     * ponytail: the claim is a single conditional UPDATE, which is enough for one
     * operator; wrap the claim and the credit in a transaction if it ever grows to
     * several admins clicking at once.
     */
    public function rechargeapproval($event, Request $r)
    {
        $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Invalid Action!");
        $id = $r->id;
        $pending = Transaction::where('id', $id)->where('category', 'recharge')->where('status', '0')->first();
        if (!$pending) {
            return response()->json(array('status' => 0, 'title' => "Already handled", 'message' => "That request is no longer pending."));
        }
        $userid = $pending->userid;
        $amount = (float) $pending->amount;
        if ($event == 'success') {
            $firstrecharge = Transaction::where('id', $userid)->where('category', 'recharge')->where('status','0')->get();
            if (count($firstrecharge) == 0) {
                $level1 = User::where('id', user('promocode', $userid))->first();
                if ($level1) {
                    $level1amount = ($amount / 100 ) * setting('level1commission');
                    // return $level1amount;
                    addwallet($level1->id, $level1amount);
                    addtransaction($level1->id, 'Level', date("ydmhsi"), 'credit', $level1amount, 'Level_bonus', 'Success', '1');

                    $level2 = User::where('id', $level1->promocode)->first();
                    if ($level2) {
                        $level2amount = ($amount / setting('level2commission')) * 100;
                        addwallet($level2->id, $level2amount);
                        addtransaction($level2->id, 'Level', date("ydmhsi"), 'credit', $level2amount, 'Level_bonus', 'Success', '1');

                        $level3 = User::where('id', $level2->promocode)->first();
                        if ($level3) {
                            $level3amount = ($amount / setting('level3commission')) * 100;
                            addwallet($level3->id, $level3amount);
                            addtransaction($level3->id, 'Level', date("ydmhsi"), 'credit', $level3amount, 'Level_bonus', 'Success', '1');
                        }
                    }
                }
            }
            if (!Transaction::where('id', $id)->where('status', '0')->update(["remark" => 'Success', "status" => '1'])) {
                return response()->json(array('status' => 0, 'title' => "Already handled", 'message' => "That request is no longer pending."));
            }
            addwallet($userid, $amount);
            $response = array('status' => 1, 'title' => "Success!!", 'message' => "Deposit approved, " . $amount . " credited.");

        } elseif ($event == 'cancel') {
            Transaction::where('id', $id)->where('status', '0')->update([
                "remark" => 'Cancle payment due to some issue',
                "status" => '2',
            ]);
            $response = array('status' => 1, 'title' => "Success!!", 'message' => "Deposit request rejected, nothing credited.");
        }
        return response()->json($response);
    }
    /**
     * Approving a withdrawal is what debits the wallet - the admin has just paid
     * the player by hand, so the money leaves here and not when they asked.
     *
     * That means the balance has to be re-checked: between asking and approving the
     * player can spend it in a game. If it is short, the admin is told to cancel
     * rather than being allowed to push the wallet negative.
     *
     * Cancel does NOT refund, because nothing was ever taken.
     */
    public function withdrawalapproval($event, Request $r)
    {
        $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Invalid Action!");
        $id = $r->id;
        $pending = Transaction::where('id', $id)->where('category', 'withdraw')->where('status', '0')->first();
        if (!$pending) {
            return response()->json(array('status' => 0, 'title' => "Already handled", 'message' => "That request is no longer pending."));
        }
        $userid = $pending->userid;
        $amount = (float) $pending->amount;
        if ($event == 'success') {
            if ((float) wallet($userid, 'num') < $amount) {
                return response()->json(array('status' => 0, 'title' => "Not enough balance",
                    'message' => "This player now holds " . wallet($userid) . " and asked for " . $amount . ". Cancel the request instead."));
            }
            if (!Transaction::where('id', $id)->where('status', '0')->update([
                "transactionno" => 'doltedaviator' . date("dmyhis"),
                "remark" => 'Success',
                "status" => '1',
            ])) {
                return response()->json(array('status' => 0, 'title' => "Already handled", 'message' => "That request is no longer pending."));
            }
            addwallet($userid, $amount, '-');
            $response = array('status' => 1, 'title' => "Success!!", 'message' => "Paid out, " . $amount . " taken from the wallet.");
        } elseif ($event == 'cancel') {
            Transaction::where('id', $id)->where('status', '0')->update([
                "remark" => 'Cancle payment due to some issue',
                "status" => '2',
            ]);
            $response = array('status' => 1, 'title' => "Success!!", 'message' => "Request rejected, the balance was never touched.");
        }
        return response()->json($response);
    }
    public function userdelete(Request $r)
    {
        $response = array('status' => 0, 'title' => "Oops!!", 'message' => "Invalid Action!");
        $id = $r->id;
        User::where('id', $id)->delete();
        Wallet::where('userid', $id)->delete();
        Transaction::where('userid', $id)->delete();
        $response = array('status' => 1, 'title' => "Success!!", 'message' => "User successfully Deleted!");
        return response()->json($response);
    }
    public function payment_gateway(Request $r)
    {
        if ((string) $r->id !== '3') {
            return response()->json([
                'isSuccess' => false,
                'data' => [],
                'list' => [],
                'message' => 'Only UPI deposits are accepted.',
            ], 403);
        }
        $rows = Bankdetail::orderBy('id')->get()->filter(function ($row) {
            return in_array($row->rail, ['upi', 'both'], true) && trim((string) $row->upi_id) !== '';
        })->values();

        $map = function ($detail) {
            return [
                'id' => (int) $detail->id,
                'user_name' => $detail->account_holder_name,
                'mobile_no' => $detail->mobile_no,
                'upi_id' => $detail->upi_id,
                'account_number' => $detail->account_no,
                'ifsc_code' => $detail->ifsc_code,
                'bank_name' => $detail->bank_name,
                'barcode' => $detail->barcode,
            ];
        };
        $list = $rows->map($map)->all();
        $data = $list[0] ?? [];
        return response()->json([
            'isSuccess' => count($list) > 0,
            'data' => $data,
            'list' => $list,
            'message' => count($list) > 0 ? '' : 'No payment details configured.',
        ]);
    }

    public function editbankdetail(Request $r)
    {
        $this->ensureBankRail();
        $rail = $r->rail === 'bank' ? 'bank' : 'upi';
        if ($rail === 'bank') {
            return response()->json(['status' => 0, 'title' => 'Disabled', 'message' => 'Net Banking deposits are disabled. Use UPI only.'], 403);
        }
        $id = (int) $r->id;
        $exist = $id > 0 ? Bankdetail::where('id', $id)->first() : null;

        if ($rail === 'upi') {
            if (trim((string) $r->upi_id) === '') {
                return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'UPI ID is required.']);
            }
            $barcode = $exist ? (string) $exist->barcode : '';
            $file = $r->file('barcode');
            if ($file) {
                // PHP drops anything over upload_max_filesize before this runs and hands
                // over an invalid file, so quote the host's real ceiling, not 10 MB - the
                // old message sent admins hunting for a limit that was never the problem
                if (!$file->isValid()) {
                    return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'The QR image did not arrive in one piece. This server accepts uploads up to ' . ini_get('upload_max_filesize') . '; try a smaller picture.']);
                }
                if (!in_array(strtolower($file->getClientOriginalExtension()), ['jpg', 'jpeg', 'png', 'webp'], true)
                    || $file->getSize() > 10 * 1024 * 1024) {
                    return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'QR code must be a JPG, PNG or WebP image under 10 MB.']);
                }
                $name = bin2hex(random_bytes(8)) . '.' . strtolower($file->getClientOriginalExtension());
                if (!Storage::disk('public')->putFileAs('admin/bankdetail', $file, $name)) {
                    return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Could not save the QR code. Check storage permissions.']);
                }
                $barcode = '/storage/admin/bankdetail/' . $name;
            }
            $fields = [
                'rail' => $exist && $exist->rail === 'both' ? 'both' : 'upi',
                'account_holder_name' => (string) $r->holdername,
                'mobile_no' => (string) $r->mobile_no,
                'upi_id' => (string) $r->upi_id,
                'barcode' => $barcode,
            ];
            if (!$exist) {
                $fields += ['account_no' => '', 'ifsc_code' => '', 'bank_name' => ''];
            }
        } else {
            if (trim((string) $r->account_no) === '' || trim((string) $r->bank_name) === '') {
                return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Bank name and account number are required.']);
            }
            $fields = [
                'rail' => $exist && $exist->rail === 'both' ? 'both' : 'bank',
                'account_holder_name' => (string) $r->holdername,
                'account_no' => (string) $r->account_no,
                'ifsc_code' => (string) $r->ifsccode,
                'bank_name' => (string) $r->bank_name,
            ];
            if (!$exist) {
                $fields += ['mobile_no' => '', 'upi_id' => '', 'barcode' => ''];
            }
        }

        if ($exist) {
            $exist->update($fields);
        } else {
            Bankdetail::create($fields);
        }
        return response()->json(['status' => 1, 'title' => 'Success!!', 'message' => 'Payment details saved. Players see these on the deposit page.']);
    }

    public function deletebankdetail(Request $r)
    {
        $this->ensureBankRail();
        $id = (int) $r->id;
        $side = $r->rail === 'bank' ? 'bank' : 'upi';
        $row = Bankdetail::where('id', $id)->first();
        if (!$row) {
            return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Already gone.']);
        }
        // ponytail: legacy rail=both is one row for both sides — only strip the side being removed
        if ($row->rail === 'both') {
            if ($side === 'upi') {
                $row->update(['rail' => 'bank', 'upi_id' => '', 'mobile_no' => '', 'barcode' => '']);
            } else {
                $row->update(['rail' => 'upi', 'account_no' => '', 'ifsc_code' => '', 'bank_name' => '']);
            }
            return response()->json(['status' => 1, 'title' => 'Success!!', 'message' => 'Removed.']);
        }
        $row->delete();
        return response()->json(['status' => 1, 'title' => 'Success!!', 'message' => 'Removed.']);
    }
    /**
     * The two settings the cashier actually enforces. Amount setup used to list all
     * fourteen rows including the game timers and commission levels; these are the
     * only ones the deposit/withdraw pages read.
     */
    public function limits(Request $r)
    {
        foreach (['min_recharge' => $r->min_recharge, 'min_withdrawal' => $r->min_withdrawal] as $key => $value) {
            if ($value === null || !is_numeric($value) || (float) $value < 1) {
                return response()->json(array('status' => 0, 'title' => "Oops!!", 'message' => "Both limits have to be a number of at least 1."));
            }
            Setting::where('category', $key)->update(['value' => (string) (int) $value]);
        }
        return response()->json(array('status' => 1, 'title' => "Success!!", 'message' => "Limits updated."));
    }

    /** Wallet credits for referred signup + referrer reward. */
    public function referral(Request $r)
    {
        foreach (['referral_bonus' => $r->referral_bonus, 'referrer_bonus' => $r->referrer_bonus] as $key => $value) {
            if ($value === null || !is_numeric($value) || (float) $value < 0) {
                return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Both bonuses must be a number of at least 0.']);
            }
            $row = Setting::where('category', $key)->first();
            if ($row) {
                $row->value = (string) (int) $value;
                $row->save();
            } else {
                $row = new Setting;
                $row->category = $key;
                $row->value = (string) (int) $value;
                $row->status = '1';
                $row->save();
            }
        }
        return response()->json(['status' => 1, 'title' => 'Success!!', 'message' => 'Referral bonuses updated.']);
    }

    /**
     * Share of a round's total stake that is payable. 100 = the whole pot can be
     * won, house keeps nothing; 30 = only 30% of the pot is ever paid out.
     */
    public function winPercentage(Request $r)
    {
        $value = $r->win_percentage;
        if ($value === null || !is_numeric($value) || (float) $value < 0 || (float) $value > 100) {
            return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Win percentage must be a number between 0 and 100.']);
        }
        $row = Setting::where('category', 'win_percentage')->first() ?: new Setting;
        $row->category = 'win_percentage';
        $row->value = (string) (float) $value;
        $row->status = '1';
        $row->save();
        return response()->json(['status' => 1, 'title' => 'Success!!', 'message' => 'Win percentage set to ' . (float) $value . '%.']);
    }

    /** Admin credits INR into a player's shared wallet (all 5 games read this row). */
    public function updatewallet(Request $r)
    {
        $userid = (int) $r->userid;
        $amount = (float) $r->amount;
        if ($userid < 1 || $amount <= 0) {
            return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Pick a player and an amount greater than 0.']);
        }
        if (!User::where('id', $userid)->where('isadmin', null)->exists()) {
            return response()->json(['status' => 0, 'title' => 'Oops!!', 'message' => 'Player not found.']);
        }
        if (!Wallet::where('userid', $userid)->exists()) {
            $w = new Wallet;
            $w->userid = $userid;
            $w->amount = 0;
            $w->save();
        }
        addwallet($userid, $amount, '+');
        addtransaction($userid, 'Admin', date('ydmhsi'), 'credit', $amount, 'admin_credit', 'Admin topped up', '1');
        $bal = wallet($userid, 'num');
        return response()->json([
            'status' => 1,
            'title' => 'Success!!',
            'message' => 'Added ₹' . number_format($amount, 2) . '. New balance ₹' . number_format($bal, 2) . '.',
        ]);
    }

    /**
     * A deposit request. Nothing reaches the wallet here - the player is claiming
     * they transferred money, and the screenshot is the claim's evidence. An admin
     * credits it from /admin/deposits after looking at it.
     */
    public function depositNow(Request $r)
    {
        if ((string) $r->payment_gateway_type !== '3') {
            return redirect('/deposit?msg=upi');
        }
        $amount = (float) $r->amount;
        if ($amount < (float) setting('min_recharge')) {
            return redirect('/deposit?msg=min');
        }
        if ($amount > self::MAX_DEPOSIT) {
            return redirect('/deposit?msg=max');
        }
        // the screenshot is the whole point of the request, so it is required
        $file = $r->file('proof');
        if (!$file || !$file->isValid() || !in_array(strtolower($file->getClientOriginalExtension()), ['jpg', 'jpeg', 'png', 'webp'], true)) {
            return redirect('/deposit?msg=proof');
        }
        if ($file->getSize() > 5 * 1024 * 1024) {
            return redirect('/deposit?msg=big');
        }

        $trn = new Transaction;
        $trn->userid = user('id');
        $trn->platform = platform($r->payment_gateway_type);
        $trn->transactionno = (string) $r->trn;
        $trn->type = 'credit';
        $trn->amount = $amount;
        $trn->category = 'recharge';
        $trn->remark = 'Processing';
        $trn->status = '0';
        if (!$trn->save()) {
            return redirect('/deposit?msg=error');
        }
        // 'local' not 'public': a bank screenshot must not sit on a guessable URL
        $name = $trn->id . '-' . bin2hex(random_bytes(6)) . '.' . strtolower($file->getClientOriginalExtension());
        Storage::disk('local')->putFileAs('deposit-proof', $file, $name);
        $trn->proof = 'deposit-proof/' . $name;
        $trn->save();

        return redirect('/deposit?msg=Success');
    }
    /**
     * A withdrawal request. The money stays in the wallet until an admin approves
     * it and pays out by hand; withdrawalapproval() is what debits it.
     *
     * The old version debited here, but only when the balance was strictly GREATER
     * than the amount - so asking for the exact balance created a request that was
     * never funded, and approving it paid out money the player still had.
     */
    public function withdrawal_query(Request $r)
    {
        $amount = (float) $r->amount;
        if ($amount < (float) setting('min_withdrawal')) {
            return redirect('/withdraw?msg=min');
        }
        if ($amount > (float) wallet(user('id'), 'num')) {
            return redirect('/withdraw?msg=balance');
        }

        $trn = new Transaction;
        $trn->userid = user('id');
        $trn->platform = platform($r->payment_gateway_type);
        $trn->transactionno = '';
        $trn->type = 'debit';
        $trn->amount = $amount;
        $trn->category = 'withdraw';
        $trn->remark = 'Processing';
        $trn->status = '0';
        if ($trn->save()) {
            $existbank = Bank_detail::where('userid', user('id'))->orderBy('id', 'desc')->first();
            if ($existbank) {
                Bank_detail::where('userid', user('id'))->update([
                    "bankname" => $r->bank_name,
                    "accountno" => $r->account_no,
                    "ifsccode" => $r->ifsc_code,
                    "upi_id" => $r->upi_id,
                    "mobile_no" => $r->mobile,
                ]);
                return redirect('/withdraw?msg=Success');
            } else {
                $bank = new Bank_detail;
                $bank->userid = user('id');
                $bank->bankname = $r->bank_name;
                $bank->accountno = $r->account_no;
                $bank->ifsccode = $r->ifsc_code;
                $bank->upi_id = $r->upi_id;
                $bank->mobile_no = $r->mobile;
                if ($bank->save()) {
                    return redirect('/withdraw?msg=Success');
                }
                return redirect('/withdraw?msg=error');
            }
        }
    }

    /**
     * Real aggregates for the dashboard charts. Every number is a query - there is
     * no seeded or example data anywhere in here.
     *
     * Cashier money lives in transactions under category recharge/withdraw. Game
     * money is split: Aviator writes to userbits, and the other four write
     * transactions under their own category (slots use 'game' with the platform
     * naming them, chicken-road uses its own). So "play" is every transaction that
     * is not cashier, plus userbits.
     */
    public function stats(Request $r)
    {
        $days = max(2, min(60, (int) $r->input('days', 14)));
        $from = date('Y-m-d', strtotime('-' . ($days - 1) . ' days'));

        $labels = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $labels[] = date('Y-m-d', strtotime('-' . $i . ' days'));
        }
        $blank = array_fill_keys($labels, 0.0);

        /** sum a transactions query into a day => total map */
        $byDay = function ($query) use ($blank) {
            $out = $blank;
            foreach ($query as $row) {
                if (isset($out[$row->d])) {
                    $out[$row->d] = round((float) $row->s, 2);
                }
            }
            return $out;
        };
        $trn = fn(array $where, string $type) => Transaction::selectRaw('DATE(created_at) as d, SUM(amount) as s')
            ->where('type', $type)
            ->whereIn('category', $where)
            ->where('status', '1')
            ->where('created_at', '>=', $from . ' 00:00:00')
            ->groupBy('d')->get();

        $deposits = $byDay($trn(['recharge'], 'credit'));
        $withdrawals = $byDay($trn(['withdraw'], 'debit'));

        // play: transactions that are not cashier, either direction
        $play = fn(string $type) => Transaction::selectRaw('DATE(created_at) as d, SUM(amount) as s')
            ->where('type', $type)
            ->whereNotIn('category', ['recharge', 'withdraw'])
            ->where('created_at', '>=', $from . ' 00:00:00')
            ->groupBy('d')->get();
        $staked = $byDay($play('debit'));
        $paid = $byDay($play('credit'));

        // Aviator: the bet is the stake, amount x cashout_multiplier is the payout
        foreach (Userbit::selectRaw('DATE(created_at) as d, SUM(amount) as s, SUM(amount * cashout_multiplier) as p')
            ->where('created_at', '>=', $from . ' 00:00:00')->groupBy('d')->get() as $row) {
            if (isset($staked[$row->d])) {
                $staked[$row->d] = round($staked[$row->d] + (float) $row->s, 2);
                $paid[$row->d] = round($paid[$row->d] + (float) $row->p, 2);
            }
        }

        $stakedTotal = array_sum($staked);
        return response()->json([
            'labels' => array_map(fn($d) => date('d M', strtotime($d)), $labels),
            'deposits' => array_values($deposits),
            'withdrawals' => array_values($withdrawals),
            'staked' => array_values($staked),
            'paid' => array_values($paid),
            'totals' => [
                'deposits' => round(array_sum($deposits), 2),
                'withdrawals' => round(array_sum($withdrawals), 2),
                'staked' => round($stakedTotal, 2),
                'paid' => round(array_sum($paid), 2),
                // what the house actually kept over the window, not the target
                'house_pct' => $stakedTotal > 0 ? round((1 - array_sum($paid) / $stakedTotal) * 100, 2) : null,
                'players' => User::where('isadmin', null)->count(),
                'pending_deposits' => Transaction::where('category', 'recharge')->where('status', '0')->count(),
                'pending_withdrawals' => Transaction::where('category', 'withdraw')->where('status', '0')->count(),
            ],
        ]);
    }

    /** Live round snapshot for admin dashboard (poll / socket). */
    public function liveRound()
    {
        $gameId = (int) currentid();
        $engine = app(PoolCrashEngine::class);
        $state = $engine->get($gameId);

        $tick = [
            'game_id' => $gameId,
            'phase' => 'idle',
            'multiplier' => 1.0,
            'crashed' => false,
            'remaining_pool' => 0,
            'total_bets' => 0,
            'pool' => 0,
            'paid' => 0,
            'mode' => null,
            'house_pct' => round(100.0 - win_pct(), 2),
        ];

        if ($state) {
            if (($state['phase'] ?? '') === 'flying') {
                $out = $engine->tick($gameId);
                $state = $engine->get($gameId) ?: $state;
                $tick['multiplier'] = $out['multiplier'];
                $tick['phase'] = $out['phase'];
                $tick['crashed'] = !empty($out['crashed']);
                $tick['remaining_pool'] = $out['remaining_pool'];
            } else {
                $tick['multiplier'] = round((float) ($state['multiplier'] ?? 1), 2);
                $tick['phase'] = $state['phase'] ?? 'idle';
                $tick['crashed'] = ($state['phase'] ?? '') === 'crashed';
                $tick['remaining_pool'] = $engine->remainingPool($state);
            }
            $tick['total_bets'] = (float) ($state['total_bets'] ?? 0);
            $tick['pool'] = (float) ($state['pool'] ?? 0);
            $tick['paid'] = (float) ($state['paid'] ?? 0);
            $tick['mode'] = $state['mode'] ?? null;
        }

        $betsQuery = function (int $gid) use ($tick) {
            return Userbit::where('userbits.gameid', $gid)
                ->leftJoin('users', 'users.id', '=', 'userbits.userid')
                ->orderBy('userbits.id', 'desc')
                ->get([
                    'userbits.id',
                    'userbits.userid',
                    'userbits.amount',
                    'userbits.status',
                    'userbits.cashout_multiplier',
                    'users.name',
                    'users.mobile',
                ])
                ->map(function ($b) use ($tick) {
                    $mult = ((string) $b->status === '0')
                        ? (float) $tick['multiplier']
                        : (float) $b->cashout_multiplier;
                    $potential = round((float) $b->amount * max($mult, 0), 2);
                    return [
                        'id' => $b->id,
                        'userid' => $b->userid,
                        'name' => $b->name ?: ('User ' . $b->userid),
                        'mobile' => $b->mobile,
                        'amount' => (float) $b->amount,
                        'status' => (string) $b->status === '0' ? 'flying' : 'cashed',
                        'cashout_multiplier' => $b->cashout_multiplier,
                        'potential' => $potential,
                    ];
                });
        };

        $bets = $betsQuery($gameId);
        $betsGameId = $gameId;
        // between rounds the current id has no bets yet — show the last settled round
        if ($bets->isEmpty()) {
            $prevId = (int) Gameresult::where('id', '<', $gameId)->orderByDesc('id')->value('id');
            if ($prevId > 0) {
                $bets = $betsQuery($prevId);
                $betsGameId = $prevId;
            }
        }

        $adminId = \App\Models\User::where('isadmin', '1')->value('id')
            ?: \App\Models\User::where('email', 'admin@example.com')->value('id');
        $adminWallet = $adminId ? wallet($adminId, 'num') : 0;

        return response()->json([
            'tick' => $tick,
            'bets' => $bets,
            'bets_game_id' => $betsGameId,
            'bets_is_prev' => $betsGameId !== $gameId,
            'admin_wallet' => $adminWallet,
            'pending_recharge' => Transaction::where('category', 'recharge')->where('status', '0')->count(),
            'pending_withdraw' => Transaction::where('category', 'withdraw')->where('status', '0')->count(),
        ]);
    }

    // ponytail: cPanel never ran the rail migration; INSERT then 500s. Add the column once.
    private function ensureBankRail(): void
    {
        if (Schema::hasColumn('bankdetails', 'rail')) {
            return;
        }
        Schema::table('bankdetails', function (Blueprint $table) {
            $table->string('rail', 16)->default('both');
        });
    }
}
