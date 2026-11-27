<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\Concerns\ComparesParityGolden;
use Tests\RefreshReportingDatabase;
use Tests\TestCase;
use Ticketing\Reporting\BranchEmployees;
use Ticketing\Reporting\BranchScope;
use Ticketing\Reporting\TechnicalDepartments;
use Ticketing\Auth\Dto\AuthenticatedUserDto;

/**
 * The shared parity fixture loads into analytics' test database on top of its own migrations, and the
 * shared reporting package reads it the same way ticket-service does.
 */
class ParityFixtureTest extends TestCase
{
    use RefreshReportingDatabase;
    use ComparesParityGolden;

    protected function setUp(): void
    {
        parent::setUp();
        $this->loadParityFixture();
    }

    public function test_the_parity_seed_loads_into_the_read_only_and_owned_tables(): void
    {
        $this->assertSame(12, DB::table('tickets')->count());
        $this->assertSame(10, DB::table('ticket_assignment_periods')->count());
        $this->assertSame(8, DB::table('employees')->count());
        $this->assertSame(6, DB::table('customer_feedback')->count());
        $this->assertSame(5, DB::table('branch_ticket_forecasts')->count());
        $this->assertSame(2, DB::table('forecast_job_runs')->count());
    }

    public function test_branch_scope_and_staff_resolve_from_the_shared_package(): void
    {
        $superAdmin = new AuthenticatedUserDto(['emp_id' => 100, 'role' => 'superadmin', 'branch' => 'Main Branch', 'branch_id' => 1]);
        $admin = new AuthenticatedUserDto(['emp_id' => 101, 'role' => 'admin', 'branch' => 'Main Branch', 'branch_id' => 1]);

        $this->assertSame('all', BranchScope::resolve($superAdmin, [])->slug);
        $this->assertSame('north', BranchScope::resolve($superAdmin, ['branch_id' => '2'])->slug);
        $this->assertSame('main', BranchScope::resolve($admin, [])->slug);

        $this->assertSame(['Service', 'IT'], TechnicalDepartments::list());

        $mainStaff = array_map(fn ($e) => (int) $e->emp_id, BranchEmployees::for(BranchScope::resolve($admin, [])));
        sort($mainStaff);
        $this->assertSame([110, 111], $mainStaff, 'Main Branch technical staff: active, Service or IT, not admin or CS');
    }

    public function test_an_admin_asking_for_another_branch_gets_403(): void
    {
        $admin = new AuthenticatedUserDto(['emp_id' => 101, 'role' => 'admin', 'branch' => 'Main Branch', 'branch_id' => 1]);

        try {
            BranchScope::resolve($admin, ['branch_id' => '2']);
            $this->fail('Expected a 403 for another branch.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
            $this->assertSame('Access denied: You are restricted to your assigned branch scope.', $e->getMessage());
        }
    }
}
