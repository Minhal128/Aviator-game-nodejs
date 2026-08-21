<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Bonus is playable but not withdrawable until wager_left is cleared by game bets. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('wallets', function (Blueprint $table) {
            if (!Schema::hasColumn('wallets', 'bonus')) {
                $table->decimal('bonus', 14, 2)->default(0)->after('amount');
            }
            if (!Schema::hasColumn('wallets', 'wager_left')) {
                $table->decimal('wager_left', 14, 2)->default(0)->after('bonus');
            }
        });

        if (!DB::table('settings')->where('category', 'bonus_wager_mult')->exists()) {
            DB::table('settings')->insert([
                'category' => 'bonus_wager_mult',
                'value' => '1',
                'status' => '1',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('wallets', function (Blueprint $table) {
            if (Schema::hasColumn('wallets', 'wager_left')) {
                $table->dropColumn('wager_left');
            }
            if (Schema::hasColumn('wallets', 'bonus')) {
                $table->dropColumn('bonus');
            }
        });
        DB::table('settings')->where('category', 'bonus_wager_mult')->delete();
    }
};
