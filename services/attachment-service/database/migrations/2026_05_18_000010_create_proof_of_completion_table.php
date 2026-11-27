<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ticket-service owns this table and may have created it already.
        if (Schema::hasTable('proof_of_completion')) {
            return;
        }

        Schema::create('proof_of_completion', function (Blueprint $table) {
            $table->bigIncrements('proof_ID');
            $table->foreignId('assignment_ID')->nullable();
            if (Schema::hasTable('ticket_assignments')) {
                $table->foreign('assignment_ID')->references('assignment_ID')->on('ticket_assignments')->cascadeOnDelete();
            }
            $table->string('file_name');
            $table->string('file_path');
            $table->string('file_type')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->dateTime('uploaded_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('proof_of_completion');
    }
};