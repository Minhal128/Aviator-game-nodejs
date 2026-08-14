<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** One wallet row per user — dedupe then unique index. */
return new class extends Migration
{
    public function up(): void
    {
        // keep the highest id per userid, drop the rest
        $dups = DB::table('wallets')
            ->select('userid', DB::raw('MAX(id) as keep_id'), DB::raw('COUNT(*) as c'))
            ->groupBy('userid')
            ->having('c', '>', 1)
            ->get();
        foreach ($dups as $d) {
            DB::table('wallets')
                ->where('userid', $d->userid)
                ->where('id', '!=', $d->keep_id)
                ->delete();
        }

        Schema::table('wallets', function (Blueprint $table) {
            $table->unique('userid', 'wallets_userid_unique');
        });
    }

    public function down(): void
    {
        Schema::table('wallets', function (Blueprint $table) {
            $table->dropUnique('wallets_userid_unique');
        });
    }
};
