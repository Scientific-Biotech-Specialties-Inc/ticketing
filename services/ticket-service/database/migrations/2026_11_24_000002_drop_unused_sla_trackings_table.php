<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Database cleanup, phase 3 (dead tables).
 *
 * sla_trackings was created by 2026_05_18_000011 but no code reads or writes it: SLA timing and
 * pause time live on tickets (response_due_at, resolution_due_at, sla_paused_total_seconds, ...)
 * and per-assignment timing lives in ticket_assignment_periods. down() recreates the empty table
 * with its original schema; it does not restore rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('sla_trackings');
    }

    public function down(): void
    {
        if (Schema::hasTable('sla_trackings')) {
            return;
        }

        Schema::create('sla_trackings', function (Blueprint $table) {
            $table->bigIncrements('sla_log_ID');
            $table->foreignId('assignment_ID')->nullable()->constrained('ticket_assignments', 'assignment_ID')->nullOnDelete();
            $table->foreignId('sla_ID')->nullable()->constrained('slas', 'sla_ID')->nullOnDelete();
            $table->string('stage');
            $table->dateTime('expected_time')->nullable();
            $table->dateTime('actual_time')->nullable();
            $table->string('status')->nullable();
            $table->timestamps();
        });
    }
};
