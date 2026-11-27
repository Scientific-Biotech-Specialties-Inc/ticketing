<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Spec 0049, release 2 migration: backfill, then drop (AC-9), and its rollback.
 * DDL commits implicitly on MySQL, so this test cleans up the rows it creates instead of using a transaction,
 * and always leaves the test database in the release 1 shape (old columns present).
 */
class TicketSlaAlertsDropColumnsMigrationTest extends TestCase
{
    private const DROPPED = ['sla_risk_notified_at', 'sla_breach_notified_at', 'last_sla_breach_alert_at', 'first_cs_response_at'];

    private array $ticketIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        // Start from the release 1 shape even if the test database was migrated past release 2.
        if (!Schema::hasColumn('tickets', 'sla_breach_notified_at')) {
            $this->migration()->down();
        }
    }

    protected function tearDown(): void
    {
        if (!Schema::hasColumn('tickets', 'sla_breach_notified_at')) {
            $this->migration()->down();
        }
        DB::table('ticket_sla_alerts')->whereIn('ticket_id', $this->ticketIds)->delete();
        DB::table('tickets')->whereIn('ticket_ID', $this->ticketIds)->delete();
        parent::tearDown();
    }

    private function migration()
    {
        return require database_path('migrations/2026_11_26_000001_drop_sla_alert_and_first_cs_columns_from_tickets.php');
    }

    private function ticket(array $columns): int
    {
        $id = DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'TKT-MIG2-' . random_int(100000, 999999),
            'ticket_type_ID' => 1,
            'created_by' => 401,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'description' => 'spec 0049 release 2',
            'title' => 'drop migration scenario',
            'created_at' => now(),
            'updated_at' => now(),
        ], $columns));
        return $this->ticketIds[] = $id;
    }

    public function test_up_backfills_old_values_then_drops_the_columns_and_down_restores_them(): void
    {
        // Old values only on tickets, no row (for example a ticket an old container alerted, then closed).
        $orphan = $this->ticket([
            'sla_risk_notified_at' => '2026-03-01 08:00:00',
            'sla_breach_notified_at' => '2026-03-02 09:00:00',
            'last_sla_breach_alert_at' => '2026-03-03 10:00:00',
            'first_cs_response_at' => '2026-03-01 07:00:00',
        ]);
        // A row with a null column that the old column fills, and a set column that must win.
        $partial = $this->ticket([
            'sla_breach_notified_at' => '2026-04-01 08:00:00',
            'last_sla_breach_alert_at' => '2026-04-01 08:00:00',
        ]);
        DB::table('ticket_sla_alerts')->insert([
            'ticket_id' => $partial,
            'sla_breach_notified_at' => null,
            'last_sla_breach_alert_at' => '2026-04-09 12:00:00',
        ]);
        // No alert values anywhere: no row should appear.
        $untouched = $this->ticket([]);

        $migration = $this->migration();
        $migration->up();

        foreach (self::DROPPED as $column) {
            $this->assertFalse(Schema::hasColumn('tickets', $column), "{$column} is dropped");
        }

        $rows = DB::table('ticket_sla_alerts')->whereIn('ticket_id', $this->ticketIds)->get()->keyBy('ticket_id');
        $this->assertSame('2026-03-01 08:00:00', $rows[$orphan]->sla_risk_notified_at);
        $this->assertSame('2026-03-02 09:00:00', $rows[$orphan]->sla_breach_notified_at);
        $this->assertSame('2026-03-03 10:00:00', $rows[$orphan]->last_sla_breach_alert_at);
        $this->assertSame('2026-04-01 08:00:00', $rows[$partial]->sla_breach_notified_at, 'null column filled from tickets');
        $this->assertSame('2026-04-09 12:00:00', $rows[$partial]->last_sla_breach_alert_at, 'set row value wins');
        $this->assertNull($rows[$partial]->sla_risk_notified_at);
        $this->assertFalse($rows->has($untouched));

        $migration->down();

        foreach (self::DROPPED as $column) {
            $this->assertTrue(Schema::hasColumn('tickets', $column), "{$column} is back");
        }
        $tickets = DB::table('tickets')->whereIn('ticket_ID', $this->ticketIds)->get()->keyBy('ticket_ID');
        $this->assertSame('2026-03-02 09:00:00', $tickets[$orphan]->sla_breach_notified_at);
        $this->assertSame('2026-03-03 10:00:00', $tickets[$orphan]->last_sla_breach_alert_at);
        $this->assertSame('2026-04-09 12:00:00', $tickets[$partial]->last_sla_breach_alert_at, 'copied back from the row');
        $this->assertNull($tickets[$orphan]->first_cs_response_at, 'first_cs_response_at comes back empty');
    }

    public function test_up_is_safe_to_run_twice(): void
    {
        $id = $this->ticket(['sla_risk_notified_at' => '2026-05-01 08:00:00']);

        $migration = $this->migration();
        $migration->up();
        $migration->up();

        $this->assertSame(1, DB::table('ticket_sla_alerts')->where('ticket_id', $id)->count());
        $this->assertSame('2026-05-01 08:00:00', DB::table('ticket_sla_alerts')->where('ticket_id', $id)->value('sla_risk_notified_at'));
    }
}
