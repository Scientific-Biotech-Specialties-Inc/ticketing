<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0051 (AC-1, AC-2): superadmin switch for which departments CS may route tickets to.
 * Service and IT start on, every other department starts off.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('departments', 'accepts_tickets')) {
            Schema::table('departments', function (Blueprint $table) {
                $table->boolean('accepts_tickets')->default(false)->after('is_active');
            });
        }

        DB::table('departments')
            ->whereRaw('LOWER(TRIM(name)) IN (?, ?)', ['service', 'it'])
            ->update(['accepts_tickets' => true]);
    }

    public function down(): void
    {
        if (Schema::hasColumn('departments', 'accepts_tickets')) {
            Schema::table('departments', function (Blueprint $table) {
                $table->dropColumn('accepts_tickets');
            });
        }
    }
};
