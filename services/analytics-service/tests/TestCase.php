<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    /**
     * Runs after the app boots and before RefreshDatabase migrates, so a wrong database is never wiped.
     */
    protected function setUpTraits()
    {
        $this->assertIsolatedTestDatabase();

        return parent::setUpTraits();
    }

    /**
     * Spec 0050 AC-16: tests only ever run on an isolated database whose name ends in _test
     * (analytics_service_test, created by scripts/create-test-databases.sh), never on ticketing_system.
     */
    protected function assertIsolatedTestDatabase(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (!str_ends_with($database, '_test')) {
            throw new RuntimeException("Refusing to run tests: database '{$database}' does not end in _test. Run them on analytics_service_test.");
        }
    }

    /**
     * Absolute path of a file in the shared reporting package's tests folder. Inside the container the
     * package is mounted at packages/ticketing-reporting; on a host checkout it sits two levels up.
     */
    protected function reportingFixturePath(string $relative): string
    {
        foreach ([base_path('packages/ticketing-reporting/tests'), base_path('../../packages/ticketing-reporting/tests')] as $root) {
            if (is_dir($root)) {
                return $root . '/' . ltrim($relative, '/');
            }
        }

        throw new RuntimeException('packages/ticketing-reporting/tests not found; is the package mounted?');
    }

    /**
     * Run a fixture SQL file with foreign key checks off (the fixture holds only the tables analytics reads).
     */
    protected function loadReportingSql(string $relative): void
    {
        $sql = file_get_contents($this->reportingFixturePath($relative));

        DB::unprepared("SET FOREIGN_KEY_CHECKS=0;\n" . $sql . "\nSET FOREIGN_KEY_CHECKS=1;");
    }
}
