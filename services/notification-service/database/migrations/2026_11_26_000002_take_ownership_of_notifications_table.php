<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * notification-service takes ownership of the shared `notifications` table.
 *
 * The table's history lives in ticket-service migrations (2026_05_28_000030, 2026_06_08_000003,
 * 2026_06_11_000001, 2026_11_24_000001). From now on schema changes go here.
 *
 * - Table missing (fresh database, or this service migrated before ticket-service): create it in
 *   its current final shape. The ticket-service migrations above skip whatever already exists.
 * - Table present: drop the foreign key to `tickets`. It tied this service's table to
 *   ticket-service's schema and forced ticket-service to migrate first. Its only effect was
 *   cascading deletes when a ticket row is hard deleted, which only the seeders do, and they
 *   already delete notifications first. The index backing the key stays, so lookups by
 *   ticket_id are still indexed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('notifications')) {
            $this->createTable();
            return;
        }

        $this->dropTicketForeignKeys();
    }

    /**
     * Ownership is not handed back on rollback: dropping the table would delete every user's
     * notifications, and re-adding the foreign key could fail on rows whose ticket is gone.
     */
    public function down(): void
    {
    }

    private function createTable(): void
    {
        $typeExpression = DB::getDriverName() === 'mysql'
            ? "json_unquote(json_extract(`data`, '$.type'))"
            : "json_extract(\"data\", '$.type')";

        Schema::create('notifications', function (Blueprint $table) use ($typeExpression) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('recipient_id');
            $table->string('recipient_type'); // 'client' or 'employee'
            $table->string('title');
            $table->text('message');
            $table->json('data')->nullable();
            $table->string('type', 64)->nullable()->storedAs($typeExpression);
            $table->unsignedBigInteger('ticket_id')->nullable();
            $table->boolean('is_read')->default(false);
            $table->timestamps();

            $table->index('ticket_id', 'idx_notifications_ticket_id');
            $table->index(['recipient_id', 'recipient_type', 'is_read'], 'idx_notifications_recipient_unread');
            $table->index(['recipient_id', 'recipient_type', 'created_at'], 'idx_notifications_recipient_created');
            $table->index(['type', 'created_at'], 'idx_notifications_type_created');
            $table->index(['is_read', 'created_at'], 'idx_notifications_read_created');
        });
    }

    private function dropTicketForeignKeys(): void
    {
        // The shared database is MySQL; SQLite (tests) cannot drop a foreign key in place.
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        foreach (Schema::getForeignKeys('notifications') as $foreignKey) {
            if (strcasecmp((string) ($foreignKey['foreign_table'] ?? ''), 'tickets') !== 0) {
                continue;
            }

            Schema::table('notifications', function (Blueprint $table) use ($foreignKey) {
                $table->dropForeign($foreignKey['name']);
            });
        }
    }
};
