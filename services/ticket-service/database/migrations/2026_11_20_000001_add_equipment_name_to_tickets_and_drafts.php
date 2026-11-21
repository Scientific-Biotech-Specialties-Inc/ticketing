<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff (internal) tickets name their equipment or software as free text instead of picking a
 * customer machine. Customer tickets keep using machine_ID.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['tickets', 'ticket_drafts'] as $table) {
            if (Schema::hasTable($table) && !Schema::hasColumn($table, 'equipment_name')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->string('equipment_name', 150)->nullable()->after('machine_ID');
                });
            }
        }
    }

    public function down(): void
    {
        foreach (['tickets', 'ticket_drafts'] as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'equipment_name')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->dropColumn('equipment_name');
                });
            }
        }
    }
};
