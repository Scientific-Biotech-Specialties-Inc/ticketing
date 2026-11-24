<?php

namespace Tests\Feature;

use App\Services\TicketNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Database cleanup, phase 1: notifications type column, typed inserts and the retention purge.
 */
class NotificationTableCleanupTest extends TestCase
{
    use DatabaseTransactions;

    private const RECIPIENT_ID = 990001;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('notifications')->where('recipient_id', self::RECIPIENT_ID)->delete();
        if (Schema::hasTable('notification_channels')) {
            DB::table('notification_channels')->whereIn('alert_key', ['new_ticket', 'status_update'])->update(['channel' => 'both']);
        }
    }

    public function test_type_column_is_generated_from_data_type(): void
    {
        $typed = $this->insertNotification(['data' => json_encode(['type' => 'hold_request', 'ticketId' => 5])]);
        $untyped = $this->insertNotification(['data' => null]);

        $this->assertSame('hold_request', DB::table('notifications')->where('id', $typed)->value('type'));
        $this->assertNull(DB::table('notifications')->where('id', $untyped)->value('type'));
    }

    public function test_notify_recipient_falls_back_to_alert_key_when_data_has_no_type(): void
    {
        $service = app(TicketNotificationService::class);

        $service->notifyRecipient(self::RECIPIENT_ID, 'employee', 'New Ticket Created', 'A ticket was created.', null, null, 'new_ticket');
        $service->notifyRecipient(self::RECIPIENT_ID, 'employee', 'Ticket Updated', 'Status changed.', null, ['ticketId' => 7], 'status_update');

        $rows = DB::table('notifications')->where('recipient_id', self::RECIPIENT_ID)->orderBy('id')->get();

        $this->assertCount(2, $rows);
        $this->assertSame('new_ticket', $rows[0]->type);
        $this->assertSame('status_update', $rows[1]->type);
        $this->assertSame(7, json_decode($rows[1]->data, true)['ticketId'], 'Existing payload keys are kept');
    }

    public function test_notify_recipient_keeps_the_callers_specific_type(): void
    {
        app(TicketNotificationService::class)->notifyRecipient(
            self::RECIPIENT_ID, 'employee', 'Ticket Assigned', 'Assigned to you.', null, ['type' => 'ticket_assigned'], 'escalation_delegation'
        );

        $this->assertSame('ticket_assigned', DB::table('notifications')->where('recipient_id', self::RECIPIENT_ID)->value('type'));
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
        $events = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'notifications:purge'));

        $this->assertCount(1, $events);
        $this->assertSame('0 3 * * *', $events->first()->expression);
    }

    private function insertNotification(array $overrides = []): int
    {
        return DB::table('notifications')->insertGetId(array_merge([
            'recipient_id' => self::RECIPIENT_ID,
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
