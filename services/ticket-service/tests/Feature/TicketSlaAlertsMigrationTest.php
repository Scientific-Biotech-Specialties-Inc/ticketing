<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Spec 0049, release 1 migration: copy (AC-1), cascade delete (AC-7), rollback (AC-8).
 * DDL commits implicitly on MySQL, so this test cleans up the rows it creates instead of using a transaction.
 */
class TicketSlaAlertsMigrationTest extends TestCase
{
    private array $ticketIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (!Schema::hasColumn('tickets', 'sla_breach_notified_at')) {
            $this->markTestSkipped('Release 2 of spec 0049 is applied: the old tickets alert columns are gone.');
        }
    }

    protected function tearDown(): void
    {
        if (Schema::hasTable('ticket_sla_alerts')) {
            DB::table('ticket_sla_alerts')->whereIn('ticket_id', $this->ticketIds)->delete();
        }
        DB::table('tickets')->whereIn('ticket_ID', $this->ticketIds)->delete();
        parent::tearDown();
    }

    private function migration()
    {
        return require database_path('migrations/2026_11_24_000004_create_ticket_sla_alerts_table.php');
    }

    private function ticket(array $alerts): int
    {
        $id = DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'TKT-MIG-' . random_int(100000, 999999),
            'ticket_type_ID' => 1,
            'created_by' => 401,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'description' => 'spec 0049',
            'title' => 'migration scenario',
            'created_at' => now(),
            'updated_at' => now(),
        ], $alerts));
        return $this->ticketIds[] = $id;
    }

    public function test_up_copies_only_tickets_with_alert_values_and_is_rerunnable(): void
    {
        $this->assertTrue(Schema::hasTable('ticket_sla_alerts'));
        DB::table('ticket_sla_alerts')->delete();

        $none = $this->ticket([]);
        $risk = $this->ticket(['sla_risk_notified_at' => '2026-01-01 10:00:00']);
        $all = $this->ticket([
            'sla_risk_notified_at' => '2026-01-01 10:00:00',
            'sla_breach_notified_at' => '2026-01-02 11:00:00',
            'last_sla_breach_alert_at' => '2026-01-03 12:00:00',
        ]);

        $migration = $this->migration();
        $migration->up();
        $migration->up();

        $rows = DB::table('ticket_sla_alerts')->whereIn('ticket_id', $this->ticketIds)->get()->keyBy('ticket_id');
        $this->assertCount(2, $rows);
        $this->assertFalse($rows->has($none));
        $this->assertSame('2026-01-01 10:00:00', $rows[$risk]->sla_risk_notified_at);
        $this->assertNull($rows[$risk]->sla_breach_notified_at);
        $this->assertSame('2026-01-02 11:00:00', $rows[$all]->sla_breach_notified_at);
        $this->assertSame('2026-01-03 12:00:00', $rows[$all]->last_sla_breach_alert_at);
    }

    public function test_deleting_a_ticket_deletes_its_alert_row(): void
    {
        $id = $this->ticket([]);
        DB::table('ticket_sla_alerts')->insert(['ticket_id' => $id, 'sla_risk_notified_at' => now()]);

        DB::table('tickets')->where('ticket_ID', $id)->delete();

        $this->assertNull(DB::table('ticket_sla_alerts')->where('ticket_id', $id)->first());
    }

    public function test_down_copies_current_values_back_then_drops_the_table(): void
    {
        $id = $this->ticket(['sla_risk_notified_at' => '2026-01-01 10:00:00']);
        DB::table('ticket_sla_alerts')->insert([
            'ticket_id' => $id,
            'sla_risk_notified_at' => '2026-02-01 10:00:00',
            'sla_breach_notified_at' => '2026-02-02 11:00:00',
            'last_sla_breach_alert_at' => '2026-02-03 12:00:00',
        ]);

        $migration = $this->migration();
        $migration->down();

        try {
            $this->assertFalse(Schema::hasTable('ticket_sla_alerts'));
            $ticket = DB::table('tickets')->where('ticket_ID', $id)->first();
            $this->assertSame('2026-02-01 10:00:00', $ticket->sla_risk_notified_at);
            $this->assertSame('2026-02-02 11:00:00', $ticket->sla_breach_notified_at);
            $this->assertSame('2026-02-03 12:00:00', $ticket->last_sla_breach_alert_at);
        } finally {
            $migration->up();
        }
        $this->assertTrue(Schema::hasTable('ticket_sla_alerts'));
    }

    public function test_down_keeps_the_old_value_when_the_row_holds_null(): void
    {
        $id = $this->ticket([
            'sla_breach_notified_at' => '2026-01-05 08:00:00',
            'last_sla_breach_alert_at' => '2026-01-05 08:00:00',
        ]);
        DB::table('ticket_sla_alerts')->insert([
            'ticket_id' => $id,
            'sla_breach_notified_at' => null,
            'last_sla_breach_alert_at' => '2026-02-07 09:00:00',
        ]);

        $migration = $this->migration();
        $migration->down();

        try {
            $ticket = DB::table('tickets')->where('ticket_ID', $id)->first();
            $this->assertSame('2026-01-05 08:00:00', $ticket->sla_breach_notified_at, 'a null in the row keeps the tickets value');
            $this->assertSame('2026-02-07 09:00:00', $ticket->last_sla_breach_alert_at, 'a set row value wins');
            $this->assertNull($ticket->sla_risk_notified_at);
        } finally {
            $migration->up();
        }
        $this->assertTrue(Schema::hasTable('ticket_sla_alerts'));
    }
}
