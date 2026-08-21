<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** House margin 30% → 5%: player pool (win_percentage) becomes 95. */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('settings')->where('category', 'win_percentage')->exists()) {
            DB::table('settings')->where('category', 'win_percentage')->update(['value' => '95']);
        } else {
            DB::table('settings')->insert([
                'category' => 'win_percentage',
                'value' => '95',
                'status' => '1',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::table('settings')->where('category', 'win_percentage')->update(['value' => '30']);
    }
};
