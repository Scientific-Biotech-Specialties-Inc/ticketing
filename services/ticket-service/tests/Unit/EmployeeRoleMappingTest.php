<?php

namespace Tests\Unit;

use App\Services\EmployeeDirectorySyncService;
use PHPUnit\Framework\TestCase;

/**
 * EmployeeDirectorySyncService::mapRole translates an auth-module role name and department into the
 * ticket-service position_level / role / technical_role triple.
 *
 * The rule it encodes: Service and IT are the only departments that work tickets. Everyone else
 * (Sales & Marketing, Finance, HR, Operations, RA/QA, Executive, Admin support) raises internal
 * tickets and never handles one, so they must not carry the service role. They keep their standing
 * — a supervisor stays a Supervisor, a manager stays a Manager — which is what lets a superadmin
 * still assign them a ticket deliberately, while they stay out of the normal assignable pool.
 *
 * The regression these pin down: every non-handling department used to fall through to role
 * 'service', and upsertEmployee() rewrites `role` on every sync, so it could not be corrected by
 * hand.
 */
class EmployeeRoleMappingTest extends TestCase
{
    /** @return array<string, array{0: string, 1: string, 2: string, 3: string}> */
    public static function roleCases(): array
    {
        return [
            // ─── Departments that do NOT work tickets: internal requesters ───────────
            'sales employee' => ['Employee', 'Sales & Marketing', 'employee', 'Employee'],
            'sales supervisor' => ['Supervisor', 'Sales & Marketing', 'employee', 'Supervisor'],
            'sales manager' => ['Manager', 'Sales & Marketing', 'employee', 'Manager'],
            'finance employee' => ['Employee', 'Finance', 'employee', 'Employee'],
            'finance manager' => ['Manager', 'Finance', 'employee', 'Manager'],
            'operations supervisor' => ['Supervisor', 'Operations', 'employee', 'Supervisor'],
            'hr employee' => ['Employee', 'HR', 'employee', 'Employee'],
            'ra/qa employee' => ['Employee', 'RA/QA', 'employee', 'Employee'],
            'executive employee' => ['Employee', 'Executive', 'employee', 'Employee'],
            'unknown department' => ['Employee', '', 'employee', 'Employee'],

            // ─── Service: works tickets, unchanged ───────────────────────────────────
            'service employee' => ['Employee', 'Service', 'service', 'Engineer'],
            'service engineer' => ['Engineer', 'Service', 'service', 'Engineer'],
            'service supervisor' => ['Supervisor', 'Service', 'service', 'Engineer'],
            'service manager' => ['Manager', 'Service', 'service', 'Manager'],

            // ─── IT: works tickets, unchanged ────────────────────────────────────────
            'it employee' => ['Employee', 'IT', 'service', 'Employee'],
            'it engineer' => ['Engineer', 'IT', 'service', 'Engineer'],
            'it supervisor' => ['Supervisor', 'IT', 'service', 'Engineer'],
            'it manager' => ['Manager', 'IT', 'service', 'Manager'],

            // ─── Customer Service, unchanged ─────────────────────────────────────────
            'customer service employee' => ['Employee', 'Customer Service', 'customer service', 'Employee'],
            'customer service manager' => ['Manager', 'Customer Service', 'customer service', 'Manager'],

            // ─── Admin wins over everything ──────────────────────────────────────────
            'admin' => ['Admin', 'Sales & Marketing', 'admin', 'Admin'],
            'it admin' => ['IT Admin', 'IT', 'admin', 'Admin'],
        ];
    }

    /** @dataProvider roleCases */
    public function test_maps_an_auth_account_to_a_role_and_level(
        string $roleName,
        string $dept,
        string $expectedRole,
        string $expectedLevel
    ): void {
        $mapped = EmployeeDirectorySyncService::mapRole($roleName, $dept);

        $this->assertSame($expectedRole, $mapped['role'], "role for {$roleName} in {$dept}");
        $this->assertSame($expectedLevel, $mapped['position_level'], "position_level for {$roleName} in {$dept}");
    }

    public function test_no_non_handling_department_is_labelled_service_staff(): void
    {
        $departments = ['Sales & Marketing', 'Finance', 'HR', 'Operations', 'RA/QA', 'Executive', 'Admin'];

        foreach ($departments as $dept) {
            foreach (['Employee', 'Manager', 'Supervisor', 'Engineer'] as $roleName) {
                $role = EmployeeDirectorySyncService::mapRole($roleName, $dept)['role'];

                $this->assertNotSame(
                    'service',
                    $role,
                    "{$roleName} in {$dept} must not carry the service role; they never handle tickets."
                );
            }
        }
    }

    public function test_service_and_it_keep_the_service_role_at_every_level(): void
    {
        foreach (['Service', 'IT'] as $dept) {
            foreach (['Employee', 'Manager', 'Supervisor', 'Engineer'] as $roleName) {
                $role = EmployeeDirectorySyncService::mapRole($roleName, $dept)['role'];

                $this->assertSame('service', $role, "{$roleName} in {$dept} must stay service staff.");
            }
        }
    }

    public function test_a_sales_supervisor_is_a_supervisor_not_an_engineer(): void
    {
        $mapped = EmployeeDirectorySyncService::mapRole('Supervisor', 'Sales & Marketing');

        $this->assertSame('employee', $mapped['role']);
        $this->assertSame('Supervisor', $mapped['position_level']);
        $this->assertSame('Sales & Marketing Supervisor', $mapped['technical_role']);
    }

    public function test_standing_is_preserved_so_a_superadmin_can_still_assign_deliberately(): void
    {
        // Non-handling staff stay out of the assignable pool because that filters on department,
        // but their level must still read correctly for a deliberate superadmin assignment.
        $this->assertSame('Manager', EmployeeDirectorySyncService::mapRole('Manager', 'Sales & Marketing')['position_level']);
        $this->assertSame('Supervisor', EmployeeDirectorySyncService::mapRole('Supervisor', 'Operations')['position_level']);
        $this->assertSame('Employee', EmployeeDirectorySyncService::mapRole('Employee', 'Finance')['position_level']);
    }

    public function test_every_mapped_role_is_one_the_spa_employee_gates_accept(): void
    {
        // PrivateRoute / GuestRoute / AuthContext / Loginpage / MessagingPage gate on
        // role === 'employee' || role.includes('service') || role.includes('engineer').
        $gate = fn (string $role): bool => $role === 'employee'
            || str_contains($role, 'service')
            || str_contains($role, 'engineer')
            || $role === 'admin';

        $departments = ['Sales & Marketing', 'Finance', 'HR', 'Operations', 'RA/QA', 'Service', 'IT', 'Customer Service'];

        foreach ($departments as $dept) {
            foreach (['Employee', 'Manager', 'Supervisor', 'Engineer', 'Admin'] as $roleName) {
                $role = EmployeeDirectorySyncService::mapRole($roleName, $dept)['role'];

                $this->assertTrue($gate($role), "{$roleName} in {$dept} mapped to '{$role}', which no employee gate accepts.");
            }
        }
    }
}
