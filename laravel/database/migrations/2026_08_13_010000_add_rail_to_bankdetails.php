<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        // ponytail: one table, typed rows; legacy id=1 stays rail=both so deposit keeps working
        Schema::table('bankdetails', function (Blueprint $table) {
            $table->string('rail', 16)->default('both')->after('id');
        });
        DB::table('bankdetails')->whereNull('rail')->orWhere('rail', '')->update(['rail' => 'both']);
    }

    public function down()
    {
        Schema::table('bankdetails', function (Blueprint $table) {
            $table->dropColumn('rail');
        });
    }
};
