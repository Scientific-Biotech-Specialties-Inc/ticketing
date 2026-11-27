<?php

namespace Tests\Feature;

use App\Services\TicketNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Database cleanup, phase 1: ticket-service writes a type into every notification it inserts.
 * The table itself (schema, type column, read API and retention purge) belongs to
 * notification-service and is tested there.
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
}
