<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Skipped when notification-service (the table's owner) already created the column.
        if (Schema::hasColumn('notifications', 'data')) {
            return;
        }

        Schema::table('notifications', function (Blueprint $table) {
            $table->json('data')->nullable()->after('message');
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropColumn('data');
        });
    }
};
