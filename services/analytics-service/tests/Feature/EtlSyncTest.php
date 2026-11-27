<?php

namespace Tests\Feature;

use App\Models\ForecastJobRun;
use App\Services\ReportCacheService;
use Tests\Concerns\ComparesParityGolden;
use Tests\RefreshReportingDatabase;
use Tests\TestCase;
use Ticketing\Auth\Dto\AuthenticatedUserDto;

/**
 * POST /etl/sync: the branch rules, messages and response shape of ticket-service's
 * old etl/trigger, with a 7 day horizon, clearing only analytics' report caches.
 */
class EtlSyncTest extends TestCase
{
    use RefreshReportingDatabase;
    use ComparesParityGolden;

    protected function setUp(): void
    {
        parent::setUp();
        $this->loadParityFixture();
    }

    private function staff(string $role, int $branchId = 1): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['emp_id' => 7000, 'role' => $role, 'branch' => 'Main Branch', 'branch_id' => $branchId]);
    }

    /** Branch ids of the job runs a sync logged (the seed's own runs are ids 1 and 2). */
    private function syncedBranches(): array
    {
        $ids = ForecastJobRun::where('id', '>', 2)->pluck('branch_id')->map(fn ($id) => (int) $id)->sort()->values()->all();

        return $ids;
    }

    public function test_superadmin_recalculates_every_branch_for_full_sync_empty_or_all(): void
    {
        foreach ([['full_sync' => true, 'branch_id' => 2], [], ['branch_id' => 'all']] as $payload) {
            ForecastJobRun::where('id', '>', 2)->delete();

            $response = $this->actingAs($this->parityActor('superadmin'))
                ->postJson('/api/etl/sync', $payload)
                ->assertOk()
                ->assertJson(['status' => 'success', 'message' => 'ETL synchronization completed successfully.']);

            $this->assertSame(['status', 'message', 'records_processed', 'duration_ms', 'timestamp'], array_keys($response->json()));
            $this->assertSame([1, 2], $this->syncedBranches(), 'payload ' . json_encode($payload));
        }
    }

    public function test_superadmin_naming_one_branch_recalculates_only_that_branch(): void
    {
        $this->actingAs($this->parityActor('superadmin'))->postJson('/api/etl/sync', ['branch_id' => 2])->assertOk();

        $this->assertSame([2], $this->syncedBranches());
    }

    public function test_admin_recalculates_only_their_own_branch(): void
    {
        foreach ([[], ['branch_id' => 1], ['branch_id' => 'current'], ['branch_id' => 'assigned'], ['full_sync' => true]] as $payload) {
            ForecastJobRun::where('id', '>', 2)->delete();

            $this->actingAs($this->parityActor('admin'))->postJson('/api/etl/sync', $payload)->assertOk();

            $this->assertSame([1], $this->syncedBranches(), 'payload ' . json_encode($payload));
        }
    }

    public function test_records_processed_sums_the_branch_results_with_a_seven_day_horizon(): void
    {
        $response = $this->actingAs($this->parityActor('superadmin'))->postJson('/api/etl/sync', ['full_sync' => true])->assertOk();

        $this->assertSame((int) ForecastJobRun::where('id', '>', 2)->where('status', 'success')->sum('records_processed'), $response->json('records_processed'));
        $this->assertSame(7, \App\Models\BranchTicketForecast::where('branch_id', 2)->where('forecast_date', '>=', '2026-11-20')->count());
    }

    public function test_access_rules_and_messages_match_the_old_trigger(): void
    {
        $this->postJson('/api/etl/sync')->assertStatus(401);

        $this->actingAs($this->parityActor('admin'))
            ->postJson('/api/etl/sync', ['branch_id' => 2])
            ->assertStatus(403)
            ->assertExactJson(['message' => 'Access denied: You are restricted to your assigned branch scope.']);

        foreach (['employee', 'manager', 'branch admin', 'itadmin', 'customer'] as $role) {
            $this->actingAs($this->staff($role))
                ->postJson('/api/etl/sync')
                ->assertStatus(403)
                ->assertExactJson(['message' => 'Access denied: Admin or SuperAdmin role required.']);
        }

        $this->assertSame([], $this->syncedBranches(), 'a refused sync calculates nothing');
    }

    public function test_sync_clears_the_analytics_report_caches(): void
    {
        $this->mock(ReportCacheService::class)->shouldReceive('clearReportCaches')->once();

        $this->actingAs($this->parityActor('admin'))->postJson('/api/etl/sync')->assertOk();
    }
}
