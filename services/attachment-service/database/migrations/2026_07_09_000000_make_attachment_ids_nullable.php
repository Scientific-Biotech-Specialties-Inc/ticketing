<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::getConnection()->getDriverName() === 'sqlite') {
            return;
        }

        Schema::table('ticket_attachments', function (Blueprint $table) {
            $table->foreignId('ticket_id')->nullable()->change();
        });

        Schema::table('proof_of_completion', function (Blueprint $table) {
            $table->foreignId('assignment_ID')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('ticket_attachments', function (Blueprint $table) {
            $table->foreignId('ticket_id')->nullable(false)->change();
        });

        Schema::table('proof_of_completion', function (Blueprint $table) {
            $table->foreignId('assignment_ID')->nullable(false)->change();
        });
    }
};
