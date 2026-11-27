<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->index(['created_by', 'created_at'], 'idx_tickets_created_by_created_at');
            $table->index(['assigned_to', 'created_at'], 'idx_tickets_assigned_to_created_at');
            $table->index('created_at', 'idx_tickets_created_at');
        });

        // Skipped when notification-service (the table's owner) already created the index.
        if (!$this->hasNotificationIndex('idx_notifications_recipient_unread')) {
            Schema::table('notifications', function (Blueprint $table) {
                $table->index(['recipient_id', 'recipient_type', 'is_read'], 'idx_notifications_recipient_unread');
            });
        }
    }

    private function hasNotificationIndex(string $name): bool
    {
        foreach (Schema::getIndexes('notifications') as $index) {
            if (($index['name'] ?? null) === $name) {
                return true;
            }
        }

        return false;
    }

    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->dropIndex('idx_tickets_created_by_created_at');
            $table->dropIndex('idx_tickets_assigned_to_created_at');
            $table->dropIndex('idx_tickets_created_at');
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex('idx_notifications_recipient_unread');
        });
    }
};
