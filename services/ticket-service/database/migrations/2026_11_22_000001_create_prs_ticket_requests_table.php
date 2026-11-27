<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PRS -> TS handoff ledger.
 *
 * One row per ticket request PRS pushes to us. It exists for two reasons:
 *   1. Idempotency. prs_request_id is unique, so a retried push (tunnel dropped, timeout) resolves
 *      to the ticket already created instead of creating a second one.
 *   2. PRS equipment metadata that has no home on `tickets`. Internal tickets name their equipment
 *      as free text (tickets.equipment_name) and never reference a customer machine, so the serial
 *      number, brand and model PRS sends are kept here and echoed back on reads.
 *
 * ticket_ID is nullable and non-cascading: a deleted ticket must not take the audit trail of what
 * PRS asked for with it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('prs_ticket_requests')) {
            return;
        }

        Schema::create('prs_ticket_requests', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('prs_request_id', 100)->unique();
            $table->string('prs_equipment_id', 100)->index();
            $table->string('equipment_name', 150);
            $table->string('serial_number', 150)->nullable()->index();
            $table->string('brand', 150)->nullable();
            $table->string('model', 150)->nullable();
            $table->string('requester_email');
            $table->unsignedBigInteger('requested_by')->nullable();
            $table->unsignedBigInteger('ticket_ID')->nullable()->index();
            $table->timestamps();

            $table->foreign('ticket_ID')->references('ticket_ID')->on('tickets')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prs_ticket_requests');
    }
};
