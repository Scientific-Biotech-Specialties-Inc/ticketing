<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Support\TechnicalDepartments;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The admin dashboard departments follow the superadmin managed `departments` table, and branch admins
 * can open the dashboard while staying locked to their own branch.
 */
class DynamicAdminDepartmentsTest extends TestCase
{
    use DatabaseTransactions;

    private const BRANCH_ID = 903;
    private const OTHER_BRANCH_ID = 904;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        Cache::flush();
        config(['ticketing.technical_departments' => null]);
        TechnicalDepartments::flush();

        foreach ([self::BRANCH_ID => 'dyn-dept-903', self::OTHER_BRANCH_ID => 'dyn-dept-904'] as $id => $slug) {
            DB::table('branches')->updateOrInsert(
                ['id' => $id],
                [
                    'slug' => $slug,
                    'name' => 'Dynamic Dept Branch ' . $id,
                    'code' => 'DD' . $id,
                    'region' => 'Region Test',
                    'is_active' => 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            );
        }

        DB::table('employees')->whereIn('email', ['bea.branchadmin@example.com', 'finn.field@example.com'])->delete();

        // Start every test from a known department set: everything inactive, then the rows each test needs.
        DB::table('departments')->update(['is_active' => false]);
    }

    private function activateDepartment(string $name, string $code): void
    {
        $existing = DB::table('departments')->whereRaw('LOWER(name) = ?', [strtolower($name)])->first();
        if ($existing) {
            DB::table('departments')->where('id', $existing->id)->update(['is_active' => true, 'updated_at' => now()]);
        } else {
            DB::table('departments')->insert([
                'name' => $name,
                'code' => $code,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        TechnicalDepartments::flush();
    }

    private function branchAdmin(string $role = 'branch admin'): Employee
    {
        return Employee::create([
            'first_name' => 'Bea',
            'last_name' => 'Branch',
            'email' => 'bea.branchadmin@example.com',
            'role' => $role,
            'department' => 'Operations',
            'branch_id' => self::BRANCH_ID,
            'branch' => 'dyn-dept-903',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    public function test_list_uses_active_departments_from_the_table(): void
    {
        $this->activateDepartment('Service', 'SVC');
        $this->activateDepartment('Field Support', 'FSUP');

        $list = TechnicalDepartments::list();

        $this->assertContains('Service', $list);
        $this->assertContains('Field Support', $list);
        $this->assertNotContains('IT', $list, 'An inactive department must not be listed.');
    }

    public function test_explicit_config_override_wins_over_the_table(): void
    {
        $this->activateDepartment('Field Support', 'FSUP');
        config(['ticketing.technical_departments' => ['Service', 'IT']]);
        TechnicalDepartments::flush();

        $this->assertSame(['Service', 'IT'], TechnicalDepartments::list());
    }

    public function test_falls_back_to_service_and_it_when_no_department_is_active(): void
    {
        $this->assertSame(['Service', 'IT'], TechnicalDepartments::list());
    }

    public function test_department_report_lists_superadmin_departments_for_a_branch_admin(): void
    {
        $this->activateDepartment('Service', 'SVC');
        $this->activateDepartment('Field Support', 'FSUP');

        Employee::create([
            'first_name' => 'Finn',
            'last_name' => 'Field',
            'email' => 'finn.field@example.com',
            'role' => 'technical',
            'department' => 'Field Support',
            'branch_id' => self::BRANCH_ID,
            'branch' => 'dyn-dept-903',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        $response = $this->actingAs($this->branchAdmin(), 'api')
            ->getJson('/api/admin-reports/departments?preset=Last 7 Days&force_refresh=true')
            ->assertOk();

        $names = collect($response->json('departments'))->pluck('department')->all();
        $this->assertContains('Service', $names);
        $this->assertContains('Field Support', $names);
        $this->assertNotContains('IT', $names);

        $fieldSupport = collect($response->json('departments'))->firstWhere('department', 'Field Support');
        $this->assertSame(1, $fieldSupport['staff_count']);
    }

    public function test_branch_admin_role_variants_can_open_the_dashboard(): void
    {
        foreach (['branch admin', 'branchadmin', 'branch_admin'] as $role) {
            DB::table('employees')->where('email', 'bea.branchadmin@example.com')->delete();
            $admin = $this->branchAdmin($role);

            $this->actingAs($admin, 'api')
                ->getJson('/api/admin/dashboard?preset=Last 7 Days')
                ->assertOk();
        }
    }

    public function test_superadmin_without_a_branch_param_sees_all_branches_even_with_a_branch_on_their_row(): void
    {
        DB::table('employees')->where('email', 'sia.super@example.com')->delete();
        $superAdmin = Employee::create([
            'first_name' => 'Sia',
            'last_name' => 'Super',
            'email' => 'sia.super@example.com',
            'role' => 'superadmin',
            'department' => 'IT',
            'branch_id' => self::OTHER_BRANCH_ID,
            'branch' => 'dyn-dept-904',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        foreach (['/api/admin-reports/employees', '/api/admin-reports/departments', '/api/admin/dashboard'] as $path) {
            $this->actingAs($superAdmin, 'api')
                ->getJson($path . '?preset=Last 7 Days&force_refresh=true')
                ->assertOk()
                ->assertJsonPath('branch.id', 'all');
        }

        $this->actingAs($superAdmin, 'api')
            ->getJson('/api/admin-reports/employees?preset=Last 7 Days&branch_id=' . self::BRANCH_ID)
            ->assertOk()
            ->assertJsonPath('branch.id', self::BRANCH_ID);
    }

    public function test_branch_admin_stays_locked_to_their_branch(): void
    {
        $this->actingAs($this->branchAdmin(), 'api')
            ->getJson('/api/admin-reports/departments?branch_id=' . self::OTHER_BRANCH_ID)
            ->assertForbidden();
    }
}
