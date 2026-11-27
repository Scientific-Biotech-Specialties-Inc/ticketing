<?php

namespace Tests\Feature;

use App\Models\BranchTicketForecast;
use App\Models\ForecastJobRun;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\ComparesParityGolden;
use Tests\RefreshReportingDatabase;
use Tests\TestCase;
use Ticketing\Auth\Dto\AuthenticatedUserDto;

/**
 * Predictive insights behavior and access (spec 0050 slice 1: AC-1, AC-1a, AC-3, AC-12).
 * The forecast behavior tests moved here from ticket-service's AdminReportsTest with the code.
 */
class PredictiveInsightsTest extends TestCase
{
    use RefreshReportingDatabase;
    use ComparesParityGolden;

    protected function setUp(): void
    {
        parent::setUp();
        $this->loadParityFixture();
    }

    private function staff(string $role, int $branchId = 1, string $branch = 'Main Branch'): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['emp_id' => 7000, 'role' => $role, 'branch' => $branch, 'branch_id' => $branchId]);
    }

    /** Spec 0029: 15 distinct days of Main Branch tickets, enough to cross the 14 day threshold. */
    private function seedHistory(string $prefix): void
    {
        $now = Carbon::now();
        for ($i = 1; $i <= 15; $i++) {
            DB::table('tickets')->insert([
                'ticket_number' => "{$prefix}-{$i}",
                'title' => "Historical Ticket Day {$i}",
                'description' => 'Test history',
                'problem_category_ID' => 1,
                'machine_ID' => null,
                'created_by' => 1,
                'assigned_to' => 110,
                'branch_id' => '1',
                'ticket_type_ID' => 1,
                'ticket_status_ID' => 3,
                'priority_ID' => 1,
                'created_at' => $now->copy()->subDays($i)->setHour(10),
                'resolved_at' => $now->copy()->subDays($i)->setHour(12),
                'updated_at' => $now,
            ]);
        }
    }

    /** AC-13, AC-15 (spec 0029): insufficient_data when below 14 days of history. */
    public function test_insufficient_data_when_below_14_days_of_history(): void
    {
        $response = $this->actingAs($this->parityActor('admin'))
            ->getJson('/api/insights/predictive?force_refresh=true')
            ->assertOk()
            ->assertJson([
                'status' => 'insufficient_data',
                'historical_basis' => ['minimum_days_required' => 14],
            ]);

        $this->assertEmpty($response->json('volume_forecast'));
        $this->assertStringContainsString('Insufficient historical data', $response->json('message'));
    }

    /** AC-14, AC-16, AC-17, AC-18 (spec 0029): the command calculates forecasts and logs job health. */
    public function test_forecast_command_calculates_rows_and_logs_the_job_run(): void
    {
        $this->seedHistory('TCK-HIST');

        $this->artisan('tickets:calculate-forecasts', ['--horizon' => 7])->assertExitCode(0);

        $this->assertGreaterThanOrEqual(7, BranchTicketForecast::where('branch_id', 1)->where('calculation_status', 'success')->count());

        $jobRun = ForecastJobRun::where('branch_id', 1)->latest('id')->first();
        $this->assertNotNull($jobRun);
        $this->assertSame('tickets:calculate-forecasts', $jobRun->job_name, 'job_name history stays continuous (AC-2)');
        $this->assertSame('success', $jobRun->status);
        $this->assertGreaterThanOrEqual(15, $jobRun->records_processed);

        $response = $this->actingAs($this->parityActor('admin'))
            ->getJson('/api/insights/predictive')
            ->assertOk()
            ->assertJson(['status' => 'success', 'historical_basis' => ['minimum_days_required' => 14]]);

        $this->assertCount(7, $response->json('volume_forecast'));
    }

    /** Spec 0029 AC-10: a 30 day request tops the 7 stored days up instead of returning a short window. */
    public function test_thirty_day_horizon_is_topped_up_after_a_seven_day_run(): void
    {
        $this->seedHistory('TCK-H30');
        $this->artisan('tickets:calculate-forecasts', ['--horizon' => 7])->assertExitCode(0);

        $response = $this->actingAs($this->parityActor('admin'))
            ->getJson('/api/insights/predictive?horizon_days=30')
            ->assertOk()
            ->assertJsonPath('status', 'success');

        $this->assertCount(30, $response->json('volume_forecast'));
    }

    /** Spec 0050 AC-1a: with fewer than horizon_days future rows stored, analytics tops up (ticket-service never does). */
    public function test_three_stored_rows_are_topped_up_to_the_horizon(): void
    {
        $this->loadReportingSql('fixtures/forecast_seed.sql');
        BranchTicketForecast::where('branch_id', 1)->where('forecast_date', '>', '2026-11-22')->delete();
        $runsBefore = ForecastJobRun::count();

        $response = $this->actingAs($this->parityActor('admin'))
            ->getJson('/api/insights/predictive?horizon_days=7')
            ->assertOk();

        $this->assertSame($runsBefore + 1, ForecastJobRun::count(), 'one recalculation for Main Branch');
        // Seven days of history only, so the recalculation stores insufficient_data rows for the whole horizon.
        $this->assertSame(7, BranchTicketForecast::where('branch_id', 1)->where('forecast_date', '>=', '2026-11-20')->count());
        $this->assertSame('insufficient_data', $response->json('status'));
    }

    /** Spec 0029 AC-12: All Branches reports insufficient data when no branch has enough, else the real basis. */
    public function test_all_branches_forecast_reports_true_status_and_basis(): void
    {
        DB::table('branch_ticket_forecasts')->delete();
        $seed = function (int $branchId, string $status, int $days, int $volume) {
            for ($d = 0; $d < 7; $d++) {
                BranchTicketForecast::updateOrCreate(
                    ['branch_id' => $branchId, 'forecast_date' => Carbon::today()->addDays($d)->toDateString()],
                    ['predicted_volume' => $volume, 'lower_bound' => 0, 'upper_bound' => $volume,
                     'historical_days_used' => $days, 'calculation_status' => $status, 'calculated_at' => now()]
                );
            }
        };
        $seed(1, 'insufficient_data', 4, 0);
        $seed(2, 'insufficient_data', 3, 0);

        $insufficient = $this->actingAs($this->parityActor('superadmin'))
            ->getJson('/api/insights/predictive?branch_id=all&horizon_days=7')
            ->assertOk()
            ->assertJsonPath('status', 'insufficient_data')
            ->assertJsonPath('historical_basis.days_used', 4);
        $this->assertSame([], $insufficient->json('volume_forecast'));

        Cache::flush();
        $seed(2, 'success', 20, 5);

        $this->actingAs($this->parityActor('superadmin'))
            ->getJson('/api/insights/predictive?branch_id=all&horizon_days=7')
            ->assertOk()
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('historical_basis.days_used', 20)
            ->assertJsonCount(7, 'volume_forecast');
    }

    /** AC-12: same roles, branch rule and 403 messages as ticket-service's AdminReportController. */
    public function test_access_rules_match_the_old_endpoint(): void
    {
        $this->loadReportingSql('fixtures/forecast_seed.sql');

        $this->getJson('/api/insights/predictive')->assertStatus(401);

        foreach (['employee', 'manager', 'customer service', 'customer'] as $role) {
            $this->actingAs($this->staff($role))
                ->getJson('/api/insights/predictive')
                ->assertStatus(403)
                ->assertExactJson(['status' => 'error', 'message' => 'Access denied: Admin role required to view operational reports.']);
        }

        foreach (['branch_id=2', 'branch_id=all', 'branch=north', 'branch=all'] as $query) {
            $this->actingAs($this->parityActor('admin'))
                ->getJson("/api/insights/predictive?{$query}")
                ->assertStatus(403)
                ->assertExactJson(['status' => 'error', 'message' => 'Access denied: Cross-branch reporting access is prohibited.']);
        }

        $this->actingAs($this->parityActor('admin'))->getJson('/api/insights/predictive?branch_id=1')->assertOk();
        $this->actingAs($this->staff('branch admin'))->getJson('/api/insights/predictive')->assertOk();
        $this->actingAs($this->parityActor('superadmin'))
            ->getJson('/api/insights/predictive?branch_id=2')
            ->assertOk()
            ->assertJsonPath('branch.slug', 'north');
    }

    public function test_responses_are_not_cached_by_the_browser(): void
    {
        $this->loadReportingSql('fixtures/forecast_seed.sql');

        $response = $this->actingAs($this->parityActor('admin'))->getJson('/api/insights/predictive')->assertOk();
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
    }
}
