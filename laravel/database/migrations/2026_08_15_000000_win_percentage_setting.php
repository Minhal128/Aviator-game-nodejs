<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Admin-set payout share of what players stake. 30 = players get 30% back, house keeps 70%. */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('settings')->where('category', 'win_percentage')->exists()) {
            DB::table('settings')->where('category', 'win_percentage')->update(['value' => '30']);
            return;
        }
        DB::table('settings')->insert([
            'category' => 'win_percentage',
            'value' => '30',
            'status' => '1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('settings')->where('category', 'win_percentage')->delete();
    }
};
