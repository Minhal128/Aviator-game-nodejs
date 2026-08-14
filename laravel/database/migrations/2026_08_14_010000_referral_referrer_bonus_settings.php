<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Separate referral_bonus (new user) + referrer_bonus (inviter). Both default ₹100. */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['referral_bonus' => '100', 'referrer_bonus' => '100'] as $cat => $val) {
            if (!DB::table('settings')->where('category', $cat)->exists()) {
                DB::table('settings')->insert([
                    'category' => $cat,
                    'value' => $val,
                    'status' => '1',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            } else {
                DB::table('settings')->where('category', $cat)->update(['value' => $val]);
            }
        }
        // organic signup bonus stays on initial_bonus; undo prior misuse as referral amount
        DB::table('settings')->where('category', 'initial_bonus')->update(['value' => '50']);
    }

    public function down(): void
    {
        DB::table('settings')->whereIn('category', ['referral_bonus', 'referrer_bonus'])->delete();
    }
};
