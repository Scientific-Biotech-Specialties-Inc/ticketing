<?php

namespace Tests\Feature;

use App\Services\MaintenanceSlaPauseService;
use App\Services\SLAService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * While the system is Under Maintenance every open ticket's SLA clock is paused, and when it is
 * Operational again only those tickets resume, with due dates pushed out by the paused time.
 */
class MaintenanceSlaPauseTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** Current fake system status; null makes configuration-service answer 503. */
    private ?string $status = 'Operational';

    protected function setUp(): void
    {
        parent::setUp();
        // One stub reading $this->status, since later Http::fake() calls never override earlier stubs.
        Http::fake(function ($request) {
            if (str_contains($request->url(), '/api/ticket-configurations/system-status')) {
                return $this->status === null
                    ? Http::response('down', 503)
                    : Http::response(['status' => $this->status], 200);
            }

            return Http::response(['status' => 'success'], 200);
        });
    }

    private function fakeStatus(?string $status): void
    {
        $this->status = $status;
    }

    private function ticket(string $statusName, array $extra = []): int
    {
        $statusId = (int) DB::table('ticket_statuses')->whereRaw('LOWER(status_name) = ?', [strtolower($statusName)])->value('ticket_status_ID');

        return (int) DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'MAINT-' . uniqid(),
            'title' => 'Maintenance pause',
            'description' => 'Maintenance pause',
            'problem_category_ID' => (int) DB::table('problem_categories')->value('problem_category_ID'),
            'created_by' => (int) (DB::table('clients')->value('id') ?? 1),
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => (int) DB::table('ticket_priorities')->value('priority_ID'),
            'ticket_status_ID' => $statusId,
            'is_internal' => 0,
            'sla_status' => 'On Track',
            'created_at' => now(),
            'updated_at' => now(),
            'response_due_at' => now()->addHour(),
            'resolution_due_at' => now()->addHours(4),
        ], $extra));
    }

    public function test_open_ticket_is_paused_then_resumed_with_due_dates_extended(): void
    {
        Carbon::setTestNow('2026-11-27 08:00:00');
        $id = $this->ticket('Open');

        $this->fakeStatus('Under Maintenance');
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();

        $row = DB::table('tickets')->where('ticket_ID', $id)->first();
        $this->assertNotNull($row->sla_paused_at);
        $this->assertSame('Paused', $row->sla_status);
        $this->assertTrue((bool) $row->sla_paused_by_maintenance);
        $this->assertTrue(app(SLAService::class)->computeTicketSlaMetrics($row)['is_paused']);

        Carbon::setTestNow('2026-11-27 10:00:00');
        $this->fakeStatus('Operational');
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();

        $row = DB::table('tickets')->where('ticket_ID', $id)->first();
        $this->assertNull($row->sla_paused_at);
        $this->assertFalse((bool) $row->sla_paused_by_maintenance);
        $this->assertSame(7200, (int) $row->sla_paused_total_seconds);
        $this->assertSame('2026-11-27 14:00:00', (string) $row->resolution_due_at);
        $this->assertSame('2026-11-27 11:00:00', (string) $row->response_due_at);
    }

    public function test_on_hold_ticket_keeps_its_own_pause(): void
    {
        $heldAt = now()->subHour()->startOfSecond();
        $id = $this->ticket('On Hold', ['sla_paused_at' => $heldAt, 'sla_status' => 'Paused']);

        $this->fakeStatus('Under Maintenance');
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();
        $this->assertFalse((bool) DB::table('tickets')->where('ticket_ID', $id)->value('sla_paused_by_maintenance'));

        $this->fakeStatus('Operational');
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();

        $row = DB::table('tickets')->where('ticket_ID', $id)->first();
        $this->assertSame($heldAt->toDateTimeString(), (string) $row->sla_paused_at);
        $this->assertSame('Paused', $row->sla_status);
    }

    public function test_closed_ticket_is_not_paused(): void
    {
        $id = $this->ticket('Closed', ['closed_at' => now(), 'resolved_at' => now()]);

        $this->fakeStatus('Under Maintenance');
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();

        $this->assertNull(DB::table('tickets')->where('ticket_ID', $id)->value('sla_paused_at'));
    }

    public function test_unreadable_status_changes_nothing(): void
    {
        Carbon::setTestNow('2026-11-27 08:00:00');
        $id = $this->ticket('Open');
        $this->fakeStatus('Under Maintenance');
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();

        $this->fakeStatus(null);
        $this->artisan('tickets:sync-maintenance-sla')->assertSuccessful();

        $this->assertNotNull(DB::table('tickets')->where('ticket_ID', $id)->value('sla_paused_at'));
    }

    public function test_sla_alerts_are_skipped_during_maintenance(): void
    {
        $this->fakeStatus('Under Maintenance');

        $this->artisan('tickets:check-sla-alerts')
            ->expectsOutput('System is Under Maintenance; SLA alerts are paused.')
            ->assertSuccessful();
    }

    public function test_status_helper_matches_only_maintenance(): void
    {
        $service = app(MaintenanceSlaPauseService::class);
        $this->assertTrue($service->isUnderMaintenance('Under Maintenance'));
        $this->assertFalse($service->isUnderMaintenance('Operational'));
        $this->assertFalse($service->isUnderMaintenance(null));
    }
}
