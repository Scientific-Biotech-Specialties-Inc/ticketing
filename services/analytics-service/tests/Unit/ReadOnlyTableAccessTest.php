<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\Support\ReadOnlyTableScanner;

/**
 * Analytics-service code never writes to a table it does not own. Read only access to
 * ticket-service and employee-service tables is enforced here, not by database grants.
 */
class ReadOnlyTableAccessTest extends TestCase
{
    public function test_analytics_code_never_writes_a_non_owned_table(): void
    {
        $base = dirname(__DIR__, 2);
        $directories = [
            $base . '/app',
            // The shared reporting package runs inside analytics too.
            $base . '/packages/ticketing-reporting/src',
            $base . '/../../packages/ticketing-reporting/src',
        ];

        $violations = (new ReadOnlyTableScanner())->scanDirectories($directories);

        $this->assertSame([], $violations, "analytics-service writes tables it does not own:\n" . implode("\n", $violations));
    }

    public function test_query_builder_writes_are_caught(): void
    {
        $scanner = new ReadOnlyTableScanner();

        $this->assertNotEmpty($scanner->scanSource('<?php DB::table(\'tickets\')->where(\'id\', 1)->update([\'x\' => 1]);'));
        $this->assertNotEmpty($scanner->scanSource('<?php DB::table("tickets as t")->insert([]);'));
        $this->assertNotEmpty($scanner->scanSource('<?php DB::table(\'employees\')->updateOrInsert([], []);'));
        $this->assertNotEmpty($scanner->scanSource('<?php DB::table(\'branches\')->whereIn(\'id\', [1, 2])->delete();'));
        $this->assertNotEmpty($scanner->scanSource('<?php DB::table(\'ticket_assignment_periods\')->increment(\'n\');'));
    }

    public function test_reads_and_owned_table_writes_are_allowed(): void
    {
        $scanner = new ReadOnlyTableScanner();

        $this->assertSame([], $scanner->scanSource('<?php $rows = DB::table(\'tickets as t\')->where(\'t.x\', 1)->get(); DB::table(\'branch_ticket_forecasts\')->insert($rows);'));
        $this->assertSame([], $scanner->scanSource('<?php DB::table(\'forecast_job_runs\')->where(\'id\', 1)->update([\'status\' => \'done\']);'));
        $this->assertSame([], $scanner->scanSource('<?php // DB::table(\'tickets\')->update([]);'));
    }

    public function test_raw_statements_on_non_owned_tables_are_caught(): void
    {
        $scanner = new ReadOnlyTableScanner();

        $this->assertNotEmpty($scanner->scanSource('<?php DB::statement(\'UPDATE tickets SET x = 1\');'));
        $this->assertNotEmpty($scanner->scanSource('<?php DB::unprepared("DELETE FROM `employees`");'));
        $this->assertSame([], $scanner->scanSource('<?php DB::statement(\'DELETE FROM forecast_job_runs WHERE id = 1\');'));
    }

    public function test_writable_models_on_non_owned_tables_are_caught(): void
    {
        $scanner = new ReadOnlyTableScanner();

        $writable = '<?php class Ticket extends Model { protected $table = \'tickets\'; }';
        $inferred = '<?php class Employee extends Model { }';
        $readOnly = '<?php class Ticket extends Model { protected $table = \'tickets\';
            protected static function booted() {
                static::saving(function () { throw new \LogicException(\'read only\'); });
                static::deleting(function () { throw new \LogicException(\'read only\'); });
            } }';
        $owned = '<?php class ForecastJobRun extends Model { protected $table = \'forecast_job_runs\'; }';

        $this->assertNotEmpty($scanner->scanSource($writable));
        $this->assertNotEmpty($scanner->scanSource($inferred));
        $this->assertSame([], $scanner->scanSource($readOnly));
        $this->assertSame([], $scanner->scanSource($owned));
    }
}
