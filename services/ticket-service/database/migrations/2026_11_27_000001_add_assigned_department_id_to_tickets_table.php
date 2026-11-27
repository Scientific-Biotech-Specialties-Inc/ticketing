<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0051 (AC-4): the department a ticket was routed to. Set when CS routes to a department,
 * kept after the manager delegates, cleared on return to CS or a CS reroute to members.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('tickets', 'assigned_department_id')) {
            return;
        }

        // departments belongs to employee-service. On a database where it does not exist yet
        // (a fresh ticket-service test database), the column and index still land without the FK.
        $withForeignKey = Schema::hasTable('departments');

        Schema::table('tickets', function (Blueprint $table) use ($withForeignKey) {
            $table->unsignedBigInteger('assigned_department_id')->nullable()->after('assigned_to');
            $table->index('assigned_department_id', 'tickets_assigned_department_id_index');
            if ($withForeignKey) {
                $table->foreign('assigned_department_id', 'tickets_assigned_department_id_foreign')
                    ->references('id')
                    ->on('departments')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('tickets', 'assigned_department_id')) {
            return;
        }

        $hasForeignKey = DB::table('information_schema.TABLE_CONSTRAINTS')
            ->where('TABLE_SCHEMA', DB::getDatabaseName())
            ->where('TABLE_NAME', 'tickets')
            ->where('CONSTRAINT_NAME', 'tickets_assigned_department_id_foreign')
            ->where('CONSTRAINT_TYPE', 'FOREIGN KEY')
            ->exists();

        Schema::table('tickets', function (Blueprint $table) use ($hasForeignKey) {
            if ($hasForeignKey) {
                $table->dropForeign('tickets_assigned_department_id_foreign');
            }
            $table->dropIndex('tickets_assigned_department_id_index');
            $table->dropColumn('assigned_department_id');
        });
    }
};
