<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('employees')) {
            Schema::table('refresh_tokens', function (Blueprint $table) {
                $table->foreign('employee_id')->references('emp_id')->on('employees')->onDelete('cascade');
            });
        }
    }

    public function down(): void
    {
        Schema::table('refresh_tokens', function (Blueprint $table) {
            $table->dropForeign(['employee_id']);
        });
    }
};