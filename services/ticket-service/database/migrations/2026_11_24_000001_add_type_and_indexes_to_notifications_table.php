<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Database cleanup, phase 1 (notifications).
 *
 * - `type`: a stored generated column read from `data->type`. Every writer (ticket, employee,
 *   messaging, attachment and notification services) already puts the type inside `data`, so
 *   no insert has to change and the column can never disagree with the JSON.
 * - `idx_notifications_recipient_created`: serves the bell / notifications page query
 *   (recipient filter, newest first). The existing recipient_unread index only covers the
 *   unread count.
 * - `idx_notifications_read_created`: serves the retention purge (`notifications:purge`).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('notifications', 'type')) {
            Schema::table('notifications', function (Blueprint $table) {
                $table->string('type', 64)
                    ->nullable()
                    ->storedAs("json_unquote(json_extract(`data`, '$.type'))")
                    ->after('data');
            });
        }

        Schema::table('notifications', function (Blueprint $table) {
            if (!$this->hasIndex('idx_notifications_type_created')) {
                $table->index(['type', 'created_at'], 'idx_notifications_type_created');
            }
            if (!$this->hasIndex('idx_notifications_recipient_created')) {
                $table->index(['recipient_id', 'recipient_type', 'created_at'], 'idx_notifications_recipient_created');
            }
            if (!$this->hasIndex('idx_notifications_read_created')) {
                $table->index(['is_read', 'created_at'], 'idx_notifications_read_created');
            }
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            foreach (['idx_notifications_read_created', 'idx_notifications_recipient_created', 'idx_notifications_type_created'] as $index) {
                if ($this->hasIndex($index)) {
                    $table->dropIndex($index);
                }
            }
        });

        if (Schema::hasColumn('notifications', 'type')) {
            Schema::table('notifications', function (Blueprint $table) {
                $table->dropColumn('type');
            });
        }
    }

    private function hasIndex(string $name): bool
    {
        foreach (Schema::getIndexes('notifications') as $index) {
            if (($index['name'] ?? null) === $name) {
                return true;
            }
        }

        return false;
    }
};
