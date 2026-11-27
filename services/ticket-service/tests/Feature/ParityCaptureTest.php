<?php

namespace Tests\Feature;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\TestCase;

/**
 * Captures golden files from the old ticket-service reporting endpoints (spec 0050 AC-16).
 *
 * Gated: does nothing unless PARITY_CAPTURE=1. Run it on the commit BEFORE a slice deletes its
 * ticket-service endpoints, one slice at a time:
 *
 *   docker compose exec -e PARITY_CAPTURE=1 ticket-service php artisan test --filter=ParityCapture::test_capture_slice_1
 *
 * Each capture, inside a transaction that is rolled back afterwards:
 *   1. empties the tables the reports read, so only fixture rows count (ticketing_system_test holds rows
 *      left by other tests, and analytics_service_test will hold only the fixture);
 *   2. loads packages/ticketing-reporting/tests/fixtures/parity_seed.sql;
 *   3. freezes time at 2026-11-20 10:00:00 and flushes the cache;
 *   4. answers analytics' csat-stats from the seeded customer_feedback rows with the same rules
 *      analytics' FeedbackController::csatStats uses, so CSAT in the golden equals analytics' local query;
 *   5. calls each old endpoint as the SuperAdmin (All Branches) and as the Main Branch admin, and writes the
 *      JSON (or CSV bytes) to packages/ticketing-reporting/tests/golden/.
 * The analytics parity tests load the same seed, freeze the same time and compare against these files.
 */
class ParityCaptureTest extends TestCase
{
    use DatabaseTransactions;

    public const FROZEN_NOW = '2026-11-20 10:00:00';

    /** Seeded actors (parity_seed.sql). */
    public const ACTORS = [
        'superadmin' => 'parity.super@example.test',
        'admin' => 'parity.admin@example.test',
    ];

    /** Tables emptied before the seed loads: every table the moved reports read. */
    public const FIXTURE_TABLES = [
        'tickets',
        'ticket_statuses',
        'ticket_priorities',
        'ticket_assignments',
        'ticket_assignment_periods',
        'reassignment_requests',
        'employees',
        'branches',
        'machines',
        'problem_categories',
        'clients',
        'departments',
        'customer_feedback',
        'branch_ticket_forecasts',
        'branch_recurring_issue_trends',
        'forecast_job_runs',
    ];

    public const REPORT_TYPES = [
        'ticket_volume',
        'sla_compliance',
        'department_performance',
        'equipment_maintenance',
        'csat_satisfaction',
        'predictive_risk',
    ];

    private const PERIOD = 'preset=Last%2030%20Days';

    protected function setUp(): void
    {
        parent::setUp();

        if (getenv('PARITY_CAPTURE') !== '1') {
            $this->markTestSkipped('Golden capture runs only with PARITY_CAPTURE=1.');
        }

        $this->loadParityFixture();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /*
     * Slice 1 (predictive insights) was captured before slice 1 removed /admin-reports/predictive-insights:
     * golden/predictive-insights.{actor}.json (force_refresh on parity_seed.sql, the insufficient_data shape) and
     * golden/predictive-insights-stored.{actor}.json (fixtures/forecast_seed.sql loaded on top, horizon_days=7,
     * the success shape with trends). The capture methods went with the old endpoint.
     */

    /** Slice 2: employee and department performance, and the three Admin dashboard keys that move. */
    public function test_capture_slice_2(): void
    {
        foreach (array_keys(self::ACTORS) as $actor) {
            $this->writeJsonGolden("performance-employees.{$actor}", $this->as($actor)->getJson('/api/admin-reports/employees?' . self::PERIOD . '&force_refresh=true'));
            $this->writeJsonGolden("performance-departments.{$actor}", $this->as($actor)->getJson('/api/admin-reports/departments?' . self::PERIOD . '&sort_by=total_tickets&sort_dir=desc&force_refresh=true'));

            $dashboard = $this->as($actor)->getJson('/api/admin-dashboard?' . self::PERIOD . '&force_refresh=true');
            $dashboard->assertOk();
            $payload = $dashboard->json('data') ?? $dashboard->json();
            $this->writeGoldenFile("performance-dashboard.{$actor}.json", $this->encode([
                'employee_performance' => $payload['employee_performance'] ?? null,
                'departments' => $payload['departments'] ?? null,
                'workload' => $payload['workload'] ?? null,
            ]));
        }
    }

    /** Slice 3: every report type, plus the CSV export of each. */
    public function test_capture_slice_3(): void
    {
        foreach (array_keys(self::ACTORS) as $actor) {
            foreach (self::REPORT_TYPES as $type) {
                $this->writeJsonGolden("reports-{$type}.{$actor}", $this->as($actor)->getJson("/api/admin-reports?report_type={$type}&" . self::PERIOD . '&force_refresh=true'));

                $csv = $this->as($actor)->postJson('/api/admin-reports/export', [
                    'report_type' => $type,
                    'format' => 'csv',
                    'filters' => ['preset' => 'Last 30 Days'],
                ]);
                $csv->assertOk();
                $bytes = $csv->baseResponse instanceof \Symfony\Component\HttpFoundation\StreamedResponse
                    ? $csv->streamedContent()
                    : (string) $csv->getContent();
                $this->writeGoldenFile("reports-export-{$type}.{$actor}.csv", $bytes);
            }
        }
    }

    private function loadParityFixture(): void
    {
        $sql = "SET FOREIGN_KEY_CHECKS=0;\n";
        foreach (self::FIXTURE_TABLES as $table) {
            $sql .= "DELETE FROM `{$table}`;\n";
        }
        $sql .= file_get_contents($this->reportingTestsPath('fixtures/parity_seed.sql'));
        $sql .= "\nSET FOREIGN_KEY_CHECKS=1;";
        DB::unprepared($sql);

        Carbon::setTestNow(Carbon::parse(self::FROZEN_NOW));
        Cache::flush();

        Http::fake(['*/api/csat-stats*' => fn (HttpRequest $request) => Http::response($this->csatStats($request), 200)]);
    }

    /**
     * Same result analytics' FeedbackController::csatStats returns for these parameters (the fields
     * CsatSnapshotService reads), computed from the seeded customer_feedback rows.
     */
    private function csatStats(HttpRequest $request): array
    {
        parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $params);

        $query = DB::table('customer_feedback');
        if (!empty($params['date_from'])) {
            $query->where('created_at', '>=', Carbon::parse($params['date_from'])->startOfDay());
        }
        if (!empty($params['date_to'])) {
            $query->where('created_at', '<=', Carbon::parse($params['date_to'])->endOfDay());
        }
        $ids = array_filter(array_map('trim', explode(',', (string) ($params['ticket_ids'] ?? ''))));
        if ($ids !== []) {
            $query->whereIn('ticket_id', $ids);
        }

        $avg = (clone $query)->avg('overall_rating');
        $total = (clone $query)->count();
        $satisfied = (clone $query)->where('overall_rating', '>=', 4)->count();
        $ratings = $ids === [] ? [] : (clone $query)
            ->select('ticket_id', DB::raw('AVG(overall_rating) as rating'))
            ->groupBy('ticket_id')
            ->pluck('rating', 'ticket_id')
            ->map(fn ($rating) => round((float) $rating, 2))
            ->all();

        return ['status' => 'success', 'data' => [
            'average_score' => $avg !== null ? round((float) $avg, 2) : null,
            'total_reviews' => $total,
            'satisfaction_percentage' => $total > 0 ? round(($satisfied / $total) * 100, 1) : null,
            'ticket_ratings' => $ratings,
        ]];
    }

    private function as(string $actor): static
    {
        $employee = Employee::where('email', self::ACTORS[$actor])->firstOrFail();
        Cache::flush();

        return $this->actingAs($employee, 'api');
    }

    private function writeJsonGolden(string $name, TestResponse $response): void
    {
        $response->assertOk();
        $this->writeGoldenFile("{$name}.json", $this->encode($response->json()));
    }

    private function encode($data): string
    {
        return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION) . "\n";
    }

    private function writeGoldenFile(string $file, string $contents): void
    {
        $dir = $this->reportingTestsPath('golden');
        file_put_contents("{$dir}/{$file}", $contents);
        $this->addToAssertionCount(1);
    }

    private function reportingTestsPath(string $relative): string
    {
        foreach ([base_path('packages/ticketing-reporting/tests'), base_path('../../packages/ticketing-reporting/tests')] as $root) {
            if (is_dir($root)) {
                return $root . '/' . $relative;
            }
        }

        throw new RuntimeException('packages/ticketing-reporting/tests not found; is the package mounted?');
    }
}
