<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A deposit request is now a claim the admin has to see evidence for: the path,
 * on the local (non-web-reachable) disk, of the screenshot the player uploaded.
 * Nullable because every row written before this existed has none.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->string('proof')->nullable()->after('remark');
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropColumn('proof');
        });
    }
};
