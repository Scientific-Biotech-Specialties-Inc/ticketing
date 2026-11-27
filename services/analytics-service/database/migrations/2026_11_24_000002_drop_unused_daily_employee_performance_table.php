<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Database cleanup, phase 3 (dead tables).
 *
 * daily_employee_performance was created by 2026_11_01_000001 for a daily rollup that was never
 * built: no service reads or writes it (its only model, ticket-service DailyEmployeePerformance,
 * was never used and is removed). down() recreates the empty table with its original schema;
 * it does not restore rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('daily_employee_performance');
    }

    public function down(): void
    {
        if (Schema::hasTable('daily_employee_performance')) {
            return;
        }

        Schema::create('daily_employee_performance', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->foreignId('branch_id')->constrained('branches', 'id')->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained('employees', 'emp_id')->cascadeOnDelete();
            $table->date('date');
            $table->unsignedInteger('tickets_assigned')->default(0);
            $table->unsignedInteger('tickets_resolved')->default(0);
            $table->unsignedBigInteger('total_resolution_seconds')->default(0);
            $table->unsignedInteger('sla_met_count')->default(0);
            $table->unsignedInteger('sla_breached_count')->default(0);
            $table->unsignedInteger('reassignments_approved')->default(0);
            $table->decimal('csat_sum', 8, 2)->default(0.00);
            $table->unsignedInteger('csat_count')->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'date'], 'unique_emp_daily_date');
            $table->index(['branch_id', 'date']);
        });
    }
};
