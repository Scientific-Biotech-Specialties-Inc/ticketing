<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Spec 0047: remember which of the customer's items a chat is about, so later turns
     * (and the ticket handoff) do not ask for it again. The id belongs to ticket-service,
     * so it is a plain column, not a foreign key.
     */
    public function up(): void
    {
        if (!Schema::hasColumn('ai_conversations', 'asset_machine_id')) {
            Schema::table('ai_conversations', function (Blueprint $table) {
                $table->unsignedBigInteger('asset_machine_id')->nullable()->after('escalation_data');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('ai_conversations', 'asset_machine_id')) {
            Schema::table('ai_conversations', function (Blueprint $table) {
                $table->dropColumn('asset_machine_id');
            });
        }
    }
};
