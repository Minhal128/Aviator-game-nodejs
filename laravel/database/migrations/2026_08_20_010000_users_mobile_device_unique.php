<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** One mobile + one device_key per account (anti bonus/referral multi-account). */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('users')->where('mobile', '')->update(['mobile' => null]);

        // break existing mobile duplicates so UNIQUE can land
        $dupMobiles = DB::table('users')
            ->select('mobile')
            ->whereNotNull('mobile')
            ->groupBy('mobile')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('mobile');
        foreach ($dupMobiles as $mobile) {
            $ids = DB::table('users')->where('mobile', $mobile)->orderBy('id')->pluck('id');
            $keep = true;
            foreach ($ids as $id) {
                if ($keep) {
                    $keep = false;
                    continue;
                }
                DB::table('users')->where('id', $id)->update(['mobile' => $mobile . '-dup' . $id]);
            }
        }

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'device_key')) {
                $table->string('device_key', 80)->nullable()->after('mobile');
            }
        });

        try {
            Schema::table('users', function (Blueprint $table) {
                $table->unique('mobile', 'users_mobile_unique');
            });
        } catch (\Throwable $e) {
            // already present
        }
        try {
            Schema::table('users', function (Blueprint $table) {
                $table->unique('device_key', 'users_device_key_unique');
            });
        } catch (\Throwable $e) {
            // already present
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            try {
                $table->dropUnique('users_mobile_unique');
            } catch (\Throwable $e) {
            }
            try {
                $table->dropUnique('users_device_key_unique');
            } catch (\Throwable $e) {
            }
            if (Schema::hasColumn('users', 'device_key')) {
                $table->dropColumn('device_key');
            }
        });
    }
};
