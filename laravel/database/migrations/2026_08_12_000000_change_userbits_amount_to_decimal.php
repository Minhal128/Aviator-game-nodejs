<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * amount was varchar, so MIN()/ORDER BY compared it as text ('1000.00' < '670.00')
 * and the crash engine picked the wrong smallest bet.
 */
return new class extends Migration
{
    public function up()
    {
        DB::statement('ALTER TABLE userbits MODIFY amount DECIMAL(15,2) NOT NULL DEFAULT 0');
    }

    public function down()
    {
        DB::statement('ALTER TABLE userbits MODIFY amount VARCHAR(255) NOT NULL');
    }
};
