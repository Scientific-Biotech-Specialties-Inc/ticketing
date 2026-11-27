<?php

namespace Tests\Feature;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * notification-service owns the notifications table: its schema (created by this service's
 * migration on a fresh database) and the retention purge, both moved from ticket-service.
 */
class NotificationsTableTest extends TestCase
{
    use RefreshDatabase;

    public function test_migration_creates_the_table_in_its_final_shape(): void
    {
        // `type` is a generated column, which SQLite's column listing hides; it is covered by
        // test_type_column_is_generated_from_data_type.
        $this->assertTrue(Schema::hasColumns('notifications', [
            'id', 'recipient_id', 'recipient_type', 'title', 'message', 'data', 'ticket_id', 'is_read', 'created_at', 'updated_at',
        ]));

        $indexes = array_column(Schema::getIndexes('notifications'), 'name');
        foreach ([
            'idx_notifications_ticket_id',
            'idx_notifications_recipient_unread',
            'idx_notifications_recipient_created',
            'idx_notifications_type_created',
            'idx_notifications_read_created',
        ] as $index) {
            $this->assertContains($index, $indexes);
        }

        $this->assertSame([], Schema::getForeignKeys('notifications'), 'No foreign key into ticket-service tables');
    }

    public function test_type_column_is_generated_from_data_type(): void
    {
        $typed = $this->insertNotification(['data' => json_encode(['type' => 'hold_request', 'ticketId' => 5])]);
        $untyped = $this->insertNotification(['data' => null]);

        $this->assertSame('hold_request', DB::table('notifications')->where('id', $typed)->value('type'));
        $this->assertNull(DB::table('notifications')->where('id', $untyped)->value('type'));
    }

    public function test_purge_deletes_only_read_notifications_past_retention(): void
    {
        $oldRead = $this->insertNotification(['is_read' => true, 'created_at' => now()->subDays(120)]);
        $oldUnread = $this->insertNotification(['is_read' => false, 'created_at' => now()->subDays(120)]);
        $recentRead = $this->insertNotification(['is_read' => true, 'created_at' => now()->subDays(10)]);

        $this->artisan('notifications:purge', ['--days' => 90])->assertSuccessful();

        $this->assertDatabaseMissing('notifications', ['id' => $oldRead]);
        $this->assertDatabaseHas('notifications', ['id' => $oldUnread]);
        $this->assertDatabaseHas('notifications', ['id' => $recentRead]);
    }

    public function test_purge_uses_the_configured_retention(): void
    {
        config(['notifications.retention_days' => 30]);
        $read40DaysAgo = $this->insertNotification(['is_read' => true, 'created_at' => now()->subDays(40)]);

        $this->artisan('notifications:purge')->assertSuccessful();

        $this->assertDatabaseMissing('notifications', ['id' => $read40DaysAgo]);
    }

    public function test_purge_dry_run_deletes_nothing(): void
    {
        $oldRead = $this->insertNotification(['is_read' => true, 'created_at' => now()->subDays(120)]);

        $this->artisan('notifications:purge', ['--days' => 90, '--dry-run' => true])->assertSuccessful();

        $this->assertDatabaseHas('notifications', ['id' => $oldRead]);
    }

    public function test_purge_refuses_a_retention_below_the_floor(): void
    {
        $oldRead = $this->insertNotification(['is_read' => true, 'created_at' => now()->subDays(30)]);

        $this->artisan('notifications:purge', ['--days' => 1])->assertFailed();

        $this->assertDatabaseHas('notifications', ['id' => $oldRead]);
    }

    public function test_purge_is_scheduled_daily(): void
    {
        $events = collect(app(Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'notifications:purge'));

        $this->assertCount(1, $events);
        $this->assertSame('0 3 * * *', $events->first()->expression);
    }

    private function insertNotification(array $overrides = []): int
    {
        return DB::table('notifications')->insertGetId(array_merge([
            'recipient_id' => 990001,
            'recipient_type' => 'employee',
            'title' => 'Fixture',
            'message' => 'Fixture notification',
            'data' => json_encode(['type' => 'fixture']),
            'ticket_id' => null,
            'is_read' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }
}
