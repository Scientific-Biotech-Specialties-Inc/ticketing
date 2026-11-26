<?php

namespace Ticketing\Reporting\Tests\Unit;

use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;
use Ticketing\Reporting\ForecastReader;

/**
 * ForecastReader shapes the predictive insights payload from stored rows, read only (spec 0050 AC-1a).
 *
 * Runs in the host service's test suite (ticket-service's Reporting suite), on its isolated _test database,
 * inside a transaction. The forecast tables are emptied first, since the All Branches view sums every branch.
 */
class ForecastReaderTest extends TestCase
{
    use DatabaseTransactions;

    private const A = 9801;
    private const B = 9802;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow(Carbon::parse('2026-11-20 10:00:00'));
        DB::table('branch_ticket_forecasts')->delete();
        DB::table('branch_recurring_issue_trends')->delete();

        foreach ([self::A => 'reader-a', self::B => 'reader-b'] as $id => $slug) {
            DB::table('branches')->updateOrInsert(['id' => $id], [
                'slug' => $slug, 'name' => "Reader {$id}", 'code' => strtoupper($slug), 'region' => 'Test',
                'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function branch(int $id): object
    {
        return DB::table('branches')->where('id', $id)->first();
    }

    private function allBranches(): object
    {
        return (object) ['id' => 'all', 'slug' => 'all', 'name' => 'All Branches'];
    }

    private function forecast(int $branchId, string $date, int $volume, string $status = 'success', int $days = 30): void
    {
        DB::table('branch_ticket_forecasts')->insert([
            'branch_id' => $branchId, 'forecast_date' => $date, 'predicted_volume' => $volume,
            'lower_bound' => max(0, $volume - 2), 'upper_bound' => $volume + 2, 'historical_days_used' => $days,
            'calculation_status' => $status, 'calculated_at' => '2026-11-20 02:00:00',
            'created_at' => '2026-11-20 02:00:00', 'updated_at' => '2026-11-20 02:00:00',
        ]);
    }

    private function trend(int $id, int $branchId, string $type, int $itemId, string $name, int $recent, string $baseline, string $change): void
    {
        DB::table('branch_recurring_issue_trends')->insert([
            'id' => $id, 'branch_id' => $branchId, 'issue_type' => $type, 'item_id' => $itemId, 'item_name' => $name,
            'recent_frequency' => $recent, 'baseline_frequency' => $baseline, 'change_percentage' => $change,
            'trend_signal' => 'stable', 'calculated_at' => '2026-11-20 02:00:00',
            'created_at' => '2026-11-20 02:00:00', 'updated_at' => '2026-11-20 02:00:00',
        ]);
    }

    public function test_single_branch_payload_matches_the_eloquent_shape(): void
    {
        $this->forecast(self::A, '2026-11-19', 99); // past, ignored
        $this->forecast(self::A, '2026-11-21', 6);
        $this->forecast(self::A, '2026-11-20', 12);
        $this->forecast(self::B, '2026-11-20', 50); // other branch, ignored
        $this->trend(98001, self::A, 'category', 1, 'Hardware Failure', 9, '4.67', '20.00');
        $this->trend(98002, self::A, 'category', 2, 'Software Error', 3, '3.27', '20.00'); // tie: id order
        $this->trend(98003, self::A, 'machine', 7, 'Ultrasound X1', 5, '2.00', '150.00');

        $payload = ForecastReader::insights($this->branch(self::A), 7);

        $this->assertSame('success', $payload['status']);
        $this->assertSame(['id' => self::A, 'name' => 'Reader 9801', 'slug' => 'reader-a'], $payload['branch']);
        $this->assertSame(30, $payload['historical_basis']['days_used']);
        $this->assertSame('7-day Weighted Moving Average with Day-of-Week Seasonality', $payload['historical_basis']['model']);
        $this->assertSame([
            ['date' => '2026-11-20', 'day_of_week' => 'Fri', 'predicted_volume' => 12, 'lower_bound' => 10, 'upper_bound' => 14],
            ['date' => '2026-11-21', 'day_of_week' => 'Sat', 'predicted_volume' => 6, 'lower_bound' => 4, 'upper_bound' => 8],
        ], $payload['volume_forecast']);

        $this->assertSame([98001, 98002], array_column($payload['recurring_issues']['categories'], 'id'));
        $this->assertSame([
            'id' => 98003,
            'branch_id' => self::A,
            'issue_type' => 'machine',
            'item_id' => 7,
            'item_name' => 'Ultrasound X1',
            'recent_frequency' => 5,
            'baseline_frequency' => 2.0,
            'change_percentage' => 150.0,
            'trend_signal' => 'stable',
            'calculated_at' => '2026-11-20T02:00:00.000000Z',
            'created_at' => '2026-11-20T02:00:00.000000Z',
            'updated_at' => '2026-11-20T02:00:00.000000Z',
        ], $payload['recurring_issues']['machines'][0]);
    }

    public function test_all_branches_payload_sums_days_and_averages_trends(): void
    {
        $this->forecast(self::A, '2026-11-20', 12, 'success', 30);
        $this->forecast(self::B, '2026-11-20', 5, 'insufficient_data', 9);
        $this->forecast(self::A, '2026-11-21', 6, 'success', 30);
        $this->trend(98011, self::A, 'category', 1, 'Hardware Failure', 9, '4.67', '92.72');
        $this->trend(98012, self::B, 'category', 1, 'Hardware Failure', 2, '2.80', '-28.57');

        $payload = ForecastReader::insights($this->allBranches(), 7);

        $this->assertSame('success', $payload['status']);
        $this->assertSame(['id' => 'all', 'name' => 'All Branches', 'slug' => 'all'], $payload['branch']);
        $this->assertSame(30, $payload['historical_basis']['days_used'], 'days used by a branch with a real forecast');
        $this->assertSame([17, 6], array_column($payload['volume_forecast'], 'predicted_volume'));
        $this->assertSame([[
            'issue_type' => 'category',
            'item_id' => 1,
            'item_name' => 'Hardware Failure',
            'change_percentage' => 32.075,
            'recent_frequency' => 11,
            'baseline_frequency' => 7.47,
        ]], $payload['recurring_issues']['categories']);
        $this->assertSame([], $payload['recurring_issues']['machines']);
    }

    public function test_insufficient_data_for_one_branch_and_for_all_branches(): void
    {
        $this->forecast(self::A, '2026-11-20', 0, 'insufficient_data', 6);
        $this->forecast(self::B, '2026-11-20', 0, 'insufficient_data', 4);

        $single = ForecastReader::insights($this->branch(self::A), 7);
        $this->assertSame('insufficient_data', $single['status']);
        $this->assertSame(['days_used' => 6, 'minimum_days_required' => 14], $single['historical_basis']);
        $this->assertSame('Insufficient historical data for reliable projection. Minimum 14 days required.', $single['message']);
        $this->assertSame([], $single['volume_forecast']);
        $this->assertSame(['categories' => [], 'machines' => []], $single['recurring_issues']);

        $all = ForecastReader::insights($this->allBranches(), 7);
        $this->assertSame('insufficient_data', $all['status']);
        $this->assertSame(6, $all['historical_basis']['days_used']);
        $this->assertStringContainsString('in any branch', $all['message']);
    }

    public function test_future_row_count_is_capped_at_the_horizon_and_reads_never_write(): void
    {
        foreach (['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'] as $date) {
            $this->forecast(self::A, $date, 3);
        }
        $this->forecast(self::B, '2026-11-25', 3);
        $before = DB::table('branch_ticket_forecasts')->count();
        $runsBefore = DB::table('forecast_job_runs')->count();

        $this->assertSame(3, ForecastReader::futureRowCount($this->branch(self::A), 7));
        $this->assertSame(2, ForecastReader::futureRowCount($this->branch(self::A), 2));
        $this->assertSame(4, ForecastReader::futureRowCount($this->allBranches(), 7), 'distinct future dates');
        $this->assertCount(3, ForecastReader::insights($this->branch(self::A), 7)['volume_forecast'], 'no top up');
        $this->assertSame($before, DB::table('branch_ticket_forecasts')->count());
        $this->assertSame($runsBefore, DB::table('forecast_job_runs')->count());
    }

    public function test_horizon_is_clamped_to_one_through_thirty(): void
    {
        $this->assertSame(7, ForecastReader::clampHorizon(null));
        $this->assertSame(1, ForecastReader::clampHorizon(0));
        $this->assertSame(30, ForecastReader::clampHorizon('90'));
        $this->assertSame(12, ForecastReader::clampHorizon('12'));
    }
}
