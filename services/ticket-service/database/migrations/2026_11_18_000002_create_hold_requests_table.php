<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0048: an employee asks CS to put a ticket On Hold; CS approves or rejects.
 * At most one pending row per ticket, enforced by HoldRequestService with a ticket row lock
 * (MySQL has no partial unique index). requested_by_emp_id has no FK on purpose: employees
 * belong to employee-service.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('hold_requests')) {
            return;
        }

        Schema::create('hold_requests', function (Blueprint $table) {
            $table->bigIncrements('hold_request_ID');
            $table->foreignId('ticket_ID')->constrained('tickets', 'ticket_ID')->cascadeOnDelete();
            $table->unsignedBigInteger('requested_by_emp_id')->index();
            $table->string('remarks', 250);
            $table->string('status', 20)->default('pending');
            $table->unsignedBigInteger('reviewed_by_id')->nullable();
            $table->text('review_note')->nullable();
            $table->timestamp('requested_at');
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['ticket_ID', 'status'], 'hold_requests_ticket_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hold_requests');
    }
};
