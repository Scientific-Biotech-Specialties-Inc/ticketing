<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * TS <-> SERMS reimbursement integration: the local copy of the SERMS claim filed for a ticket.
 * SERMS owns the claim; this row keeps what was submitted plus the latest status that SERMS
 * reported (by pull or webhook). One row per ticket: a resubmission after a terminal
 * rejection replaces it. submitted_by_emp_id has no FK on purpose (employees belong to employee-service).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('ticket_reimbursements')) {
            return;
        }

        Schema::create('ticket_reimbursements', function (Blueprint $table) {
            $table->bigIncrements('ticket_reimbursement_ID');
            $table->foreignId('ticket_ID')->unique()->constrained('tickets', 'ticket_ID')->cascadeOnDelete();
            $table->unsignedBigInteger('submitted_by_emp_id')->nullable()->index();
            $table->string('serms_reimbursement_id', 64)->nullable();
            $table->string('reference_no', 32)->nullable()->index();
            $table->string('status', 40)->default('submitted');
            $table->string('message', 500)->nullable();
            $table->decimal('amount', 12, 2)->nullable();
            $table->string('expense_category', 60)->nullable();
            $table->string('description', 255)->nullable();
            $table->date('expense_date')->nullable();
            $table->unsignedSmallInteger('receipt_count')->default(0);
            $table->text('rejection_comment')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('serms_updated_at')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ticket_reimbursements');
    }
};
