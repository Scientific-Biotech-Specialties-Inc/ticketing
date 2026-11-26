<?php

namespace Tests\Concerns;

use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;

/**
 * Parity checks for endpoints moved from ticket-service (spec 0050 AC-16).
 *
 * Use with Tests\RefreshReportingDatabase. Call loadParityFixture() in setUp, then compare each new
 * endpoint against the golden file ticket-service's ParityCaptureTest wrote from the old endpoint:
 *
 *   $this->assertMatchesJsonGolden('predictive-insights.superadmin', $response);
 *
 * Same seed, same frozen time (2026-11-20 10:00:00) and same actors as the capture.
 */
trait ComparesParityGolden
{
    protected function loadParityFixture(): void
    {
        $this->loadReportingSql('fixtures/parity_seed.sql');

        Carbon::setTestNow(Carbon::parse('2026-11-20 10:00:00'));
        Cache::flush();
    }

    protected function tearDownComparesParityGolden(): void
    {
        Carbon::setTestNow();
    }

    protected function assertMatchesJsonGolden(string $name, TestResponse $response): void
    {
        $response->assertOk();
        $golden = $this->goldenPath("{$name}.json");

        $this->assertFileExists($golden, "Golden {$name}.json is missing; capture it from ticket-service first (PARITY_CAPTURE=1).");
        $this->assertSame(
            json_decode((string) file_get_contents($golden), true),
            $response->json(),
            "Response differs from the ticket-service golden {$name}.json"
        );
    }

    protected function assertMatchesCsvGolden(string $name, string $csv): void
    {
        $golden = $this->goldenPath("{$name}.csv");

        $this->assertFileExists($golden, "Golden {$name}.csv is missing; capture it from ticket-service first (PARITY_CAPTURE=1).");
        $this->assertSame((string) file_get_contents($golden), $csv, "CSV differs byte for byte from the ticket-service golden {$name}.csv");
    }

    protected function goldenPath(string $file): string
    {
        return $this->reportingFixturePath("golden/{$file}");
    }
}
