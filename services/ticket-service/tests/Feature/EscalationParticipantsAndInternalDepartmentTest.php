<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\CategoryTrack;
use App\Services\EscalationParticipants;
use App\Services\ManagerDashboardService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Escalation managers may join the ticket conversation (looked up by messaging-service), and an
 * internal ticket's department follows its category instead of an employee's choice.
 */
class EscalationParticipantsAndInternalDepartmentTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $manager;
    protected int $ticketId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();
        // No configured track rules in tests: keyword rules decide.
        Cache::put('config:category_track_rules', [], 60);

        DB::table('tickets')->where('ticket_number', 'TCK-ESCJOIN-001')->delete();
        DB::table('employees')->whereIn('email', ['mgr.escjoin@example.com'])->delete();

        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 5], ['status_name' => 'Escalated', 'created_at' => now(), 'updated_at' => now()]);

        DB::table('clients')->updateOrInsert(['id' => 9501], [
            'client_name' => 'Esc Customer', 'email' => 'cust.escjoin@example.com', 'contact_number' => '5559501',
            'address' => '9501 Road', 'status' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->manager = Employee::create([
            'emp_id' => 89501, 'first_name' => 'Mona', 'last_name' => 'Reyes', 'email' => 'mgr.escjoin@example.com',
            'role' => 'Service Manager', 'department' => 'Service', 'position_level' => 'Manager',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);

        $this->ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-ESCJOIN-001', 'title' => 'Escalated ticket', 'description' => 'Test', 'created_by' => 9501,
            'ticket_type_ID' => 1, 'ticket_status_ID' => 5, 'priority_ID' => 1,
            'created_at' => now()->subHour(), 'updated_at' => now(),
        ]);
    }

    public function test_recorded_escalation_managers_are_returned_to_internal_callers(): void
    {
        $participants = app(EscalationParticipants::class);
        $this->assertSame([], $participants->managerIds($this->ticketId));

        $participants->record($this->ticketId, [$this->manager->emp_id], $this->manager->emp_id, 'employee', 'Needs a manager');
        $this->assertSame([(int) $this->manager->emp_id], $participants->managerIds($this->ticketId));

        // A second escalation to the same manager does not duplicate them.
        $participants->record($this->ticketId, [$this->manager->emp_id], $this->manager->emp_id, 'employee', 'Again');
        $this->assertSame([(int) $this->manager->emp_id], $participants->managerIds($this->ticketId));

        $token = 'test-internal-token';
        putenv("INTERNAL_TOKEN={$token}");
        $_ENV['INTERNAL_TOKEN'] = $token;
        $_SERVER['INTERNAL_TOKEN'] = $token;

        $this->getJson("/api/internal/tickets/{$this->ticketId}/escalation-managers", ['X-Internal-Token' => $token])
            ->assertOk()
            ->assertJson(['manager_ids' => [(int) $this->manager->emp_id]]);

        $this->getJson("/api/internal/tickets/{$this->ticketId}/escalation-managers", ['X-Internal-Token' => 'wrong'])
            ->assertForbidden();
    }

    public function test_escalation_entry_reads_plainly_in_the_staff_timeline(): void
    {
        app(EscalationParticipants::class)->record($this->ticketId, [$this->manager->emp_id], $this->manager->emp_id, 'employee', 'Needs a manager');

        $entry = collect(
            $this->actingAs($this->manager, 'api')->getJson("/api/tickets/{$this->ticketId}/timeline")->assertOk()->json('data')
        )->firstWhere('event_type', EscalationParticipants::EVENT);

        $this->assertSame('Escalated to Mona Reyes: Needs a manager', $entry['description']);
    }

    public function test_category_decides_the_internal_department_from_its_name_only(): void
    {
        $track = app(CategoryTrack::class);
        $this->assertSame('it', $track->forName('Network Outage'));
        $this->assertSame('it', $track->forName('Software'));
        $this->assertSame('service', $track->forName('Biomedical Equipment'));
        $this->assertSame('others', $track->forName('General Inquiry'));

        $itId = DB::table('problem_categories')->insertGetId(['category_name' => 'Network Outage ESCJOIN', 'created_at' => now(), 'updated_at' => now()]);
        $serviceId = DB::table('problem_categories')->insertGetId(['category_name' => 'Machine Repair ESCJOIN', 'created_at' => now(), 'updated_at' => now()]);

        $this->assertSame(CategoryTrack::IT_DEPARTMENT_ID, $track->departmentIdFor($itId));
        $this->assertSame(CategoryTrack::SERVICE_DEPARTMENT_ID, $track->departmentIdFor($serviceId));
    }

    public function test_internal_ticket_ignores_a_client_sent_department(): void
    {
        $serviceId = DB::table('problem_categories')->insertGetId(['category_name' => 'Machine Repair ESCJOIN', 'created_at' => now(), 'updated_at' => now()]);

        // A Service category needs equipment even if the client claims the IT department.
        $this->actingAs($this->manager, 'api')
            ->postJson('/api/tickets/internal', [
                'title' => 'Broken Analyzer Needs Repair',
                'description' => 'The analyzer stopped working this morning.',
                'problem_category_ID' => $serviceId,
                'department_id' => CategoryTrack::IT_DEPARTMENT_ID,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['machine_ID']);
    }

    /**
     * A ticket escalated to a manager shows in their queue and can be reassigned, even when the
     * ticket belongs to another branch (escalation picks managers by department, not branch).
     */
    public function test_escalated_ticket_outside_the_manager_branch_is_in_their_queue_and_reassignable(): void
    {
        DB::table('branches')->updateOrInsert(['id' => 951], ['slug' => 'branch-951', 'name' => 'Branch 951', 'code' => 'B951', 'region' => 'East', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('branches')->updateOrInsert(['id' => 952], ['slug' => 'branch-952', 'name' => 'Branch 952', 'code' => 'B952', 'region' => 'East', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('employees')->where('emp_id', $this->manager->emp_id)->update(['branch_id' => 951]);
        DB::table('tickets')->where('ticket_ID', $this->ticketId)->update(['branch_id' => '952']);

        DB::table('employees')->whereIn('emp_id', [89502, 89503])->delete();
        $engineer = Employee::create([
            'emp_id' => 89502, 'first_name' => 'Eddie', 'last_name' => 'Cruz', 'email' => 'eng.escjoin@example.com',
            'role' => 'Engineer', 'department' => 'Service', 'is_active' => 1, 'branch_id' => 952, 'password_hash' => bcrypt('password'),
        ]);
        $itManager = Employee::create([
            'emp_id' => 89503, 'first_name' => 'Ivan', 'last_name' => 'Tech', 'email' => 'itmgr.escjoin@example.com',
            'role' => 'IT Manager', 'department' => 'IT', 'position_level' => 'Manager', 'is_active' => 1, 'branch_id' => 951, 'password_hash' => bcrypt('password'),
        ]);
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $this->ticketId, 'employee_ID' => $engineer->emp_id, 'assigned_by' => $this->manager->emp_id,
            'assignment_status' => 'accepted', 'assigned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $queue = fn ($emp) => collect(
            app(ManagerDashboardService::class)->ticketsForManager(DB::table('employees')->where('emp_id', $emp->emp_id)->first())['tickets']
        )->firstWhere('ticket_ID', $this->ticketId);

        // No escalation record needed: Escalated + an assignee in the manager's department is enough.
        $row = $queue($this->manager);
        $this->assertNotNull($row, 'The escalated ticket from another branch must be in the Service manager queue.');
        $this->assertTrue($row['can_reassign']);
        $this->assertTrue($row['escalated_to_me']);

        // Not escalated to the IT manager (no IT assignee, not named in an escalation record).
        $this->assertNull($queue($itManager));

        // Once an escalation names the IT manager explicitly, it shows for them too.
        app(EscalationParticipants::class)->record($this->ticketId, [$itManager->emp_id], $this->manager->emp_id, 'employee', 'Needs IT');
        $this->assertTrue($queue($itManager)['escalated_to_me']);
    }
}
