<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks an SLA pause that system maintenance started (not an On Hold pause), so ending
 * maintenance resumes only the tickets it paused. See tickets:sync-maintenance-sla.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('tickets', 'sla_paused_by_maintenance')) {
            return;
        }

        Schema::table('tickets', function (Blueprint $table) {
            $table->boolean('sla_paused_by_maintenance')->default(false)->after('sla_paused_total_seconds');
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('tickets', 'sla_paused_by_maintenance')) {
            return;
        }

        Schema::table('tickets', function (Blueprint $table) {
            $table->dropColumn('sla_paused_by_maintenance');
        });
    }
};
