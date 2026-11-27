<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::disableForeignKeyConstraints();
        Schema::create('tickets', function (Blueprint $table) {
            $table->bigIncrements('ticket_ID');
            $table->foreignId('machine_ID')->constrained('machines', 'machine_ID')->cascadeOnDelete();
            $table->foreignId('problem_category_ID')->constrained('problem_categories', 'problem_category_ID');
            $table->foreignId('created_by')->constrained('clients', 'id');
            $table->foreignId('assigned_to')->nullable()->constrained('employees', 'emp_id')->nullOnDelete();
            $table->foreignId('ticket_type_ID')->constrained('ticket_types', 'ticket_type_ID');
            $table->foreignId('priority_ID')->nullable()->constrained('ticket_priorities', 'priority_ID');
            $table->foreignId('ticket_status_ID')->constrained('ticket_statuses', 'ticket_status_ID')->cascadeOnDelete();
            $table->foreignId('sla_ID')->nullable()->constrained('slas', 'sla_ID')->nullOnDelete();
            $table->string('title');
            $table->text('description')->nullable();
            $table->dateTime('resolved_at')->nullable();
            $table->dateTime('closed_at')->nullable();
            $table->timestamps();
        });
        Schema::enableForeignKeyConstraints();
    }

    public function down(): void
    {
        Schema::dropIfExists('tickets');
    }
};