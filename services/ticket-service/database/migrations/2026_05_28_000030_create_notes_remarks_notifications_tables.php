<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('internal_notes', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('ticket_id');
            $table->unsignedBigInteger('employee_id');
            $table->text('note');
            $table->timestamps();

            $table->foreign('ticket_id')->references('ticket_ID')->on('tickets')->cascadeOnDelete();
            $table->foreign('employee_id')->references('emp_id')->on('employees')->cascadeOnDelete();
        });

        Schema::create('ticket_remarks', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('ticket_id');
            $table->unsignedBigInteger('employee_id');
            $table->text('remark');
            $table->timestamps();

            $table->foreign('ticket_id')->references('ticket_ID')->on('tickets')->cascadeOnDelete();
            $table->foreign('employee_id')->references('emp_id')->on('employees')->cascadeOnDelete();
        });

        // notifications is owned by notification-service now (its 2026_11_26_000002 migration).
        // On a fresh shared database that service may have created the table already.
        if (!Schema::hasTable('notifications')) {
            Schema::create('notifications', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedBigInteger('recipient_id');
                $table->string('recipient_type'); // 'client' or 'employee'
                $table->string('title');
                $table->text('message');
                $table->unsignedBigInteger('ticket_id')->nullable();
                $table->boolean('is_read')->default(false);
                $table->timestamps();

                $table->foreign('ticket_id')->references('ticket_ID')->on('tickets')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        // notifications is left alone: notification-service owns it.
        Schema::dropIfExists('ticket_remarks');
        Schema::dropIfExists('internal_notes');
    }
};
