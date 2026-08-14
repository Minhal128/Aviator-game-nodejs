<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Default referral signup credit is ₹100 (settings.initial_bonus). */
return new class extends Migration
{
    public function up(): void
    {
        $n = DB::table('settings')->where('category', 'initial_bonus')->update(['value' => '100']);
        if ($n === 0) {
            DB::table('settings')->insert([
                'category' => 'initial_bonus',
                'value' => '100',
                'status' => '1',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('settings')->where('category', 'initial_bonus')->update(['value' => '50']);
    }
};
