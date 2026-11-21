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

        // The reconnect above leaves the rollback transaction on the old connection, so rows these
        // tests write are committed to ticketing_system_test. Clear this file's own fixtures first.
        $this->assertSame('ticketing_system_test', DB::connection('mysql')->getDatabaseName());
        $ticketIds = DB::table('tickets')->where('ticket_number', 'like', 'TCK-ESCJOIN-%')->pluck('ticket_ID');
        DB::table('ticket_audit_logs')->whereIn('ticket_ID', $ticketIds)->delete();
        DB::table('ticket_assignments')->whereIn('ticket_ID', $ticketIds)->delete();
        DB::table('tickets')->whereIn('ticket_ID', $ticketIds)->delete();
        $empIds = DB::table('employees')->where('email', 'like', '%.escjoin@example.com')->pluck('emp_id');
        DB::table('ticket_assignments')->whereIn('employee_ID', $empIds)->delete();
        DB::table('employees')->whereIn('emp_id', $empIds)->delete();
        DB::table('problem_categories')->where('category_name', 'like', '%ESCJOIN')->delete();
        DB::table('branches')->whereBetween('id', [951, 965])->delete();

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
            ->assertJsonValidationErrors(['equipment_name']);
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

    // EscalationParticipants::ticketIdsForManager
    // Fixtures for the cases below. Ids 89510 and up are reserved for this file.

    protected function employee(int $id, string $department, ?int $branchId = null, ?string $level = null): Employee
    {
        // $id only makes the email unique: emp_id is not fillable, so the database assigns the real id.
        return Employee::create([
            'emp_id' => $id, 'first_name' => 'Emp', 'last_name' => (string) $id, 'email' => "emp{$id}.escjoin@example.com",
            'role' => $level === 'Manager' ? "{$department} Manager" : 'Engineer', 'department' => $department,
            'position_level' => $level, 'is_active' => 1, 'branch_id' => $branchId, 'password_hash' => bcrypt('password'),
        ]);
    }

    protected function ticket(int $statusId, ?string $branchId = null): int
    {
        return DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-ESCJOIN-' . uniqid(), 'title' => 'Fixture ticket', 'description' => 'Test',
            'created_by' => 9501, 'ticket_type_ID' => 1, 'ticket_status_ID' => $statusId, 'priority_ID' => 1,
            'branch_id' => $branchId, 'created_at' => now()->subHour(), 'updated_at' => now(),
        ]);
    }

    protected function assign(int $ticketId, int $empId, bool $completed = false): void
    {
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $ticketId, 'employee_ID' => $empId, 'assigned_by' => $this->manager->emp_id,
            'assignment_status' => $completed ? 'completed' : 'accepted', 'assigned_at' => now(),
            'completed_at' => $completed ? now() : null, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function statuses(): void
    {
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 2], ['status_name' => 'In Progress', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 4], ['status_name' => 'Closed', 'created_at' => now(), 'updated_at' => now()]);
    }

    public function test_ticket_ids_for_manager_is_empty_for_a_missing_manager_id(): void
    {
        $this->assertSame([], app(EscalationParticipants::class)->ticketIdsForManager(0, 'Service'));
        $this->assertSame([], app(EscalationParticipants::class)->ticketIdsForManager(-5, 'Service'));
    }

    public function test_an_escalated_ticket_with_an_active_assignee_in_the_department_counts_whatever_the_casing(): void
    {
        $engineer = $this->employee(89510, 'Service');
        $this->assign($this->ticketId, $engineer->emp_id);

        $ids = app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, '  SERVICE ');

        $this->assertContains($this->ticketId, $ids);
    }

    public function test_a_finished_assignment_does_not_make_the_ticket_escalated_to_the_department(): void
    {
        $engineer = $this->employee(89511, 'Service');
        $this->assign($this->ticketId, $engineer->emp_id, completed: true);

        $ids = app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, 'Service');

        $this->assertNotContains($this->ticketId, $ids);
    }

    public function test_a_ticket_that_is_not_escalated_does_not_count_by_department(): void
    {
        $this->statuses();
        $inProgress = $this->ticket(2);
        $this->assign($inProgress, $this->employee(89512, 'Service')->emp_id);

        $ids = app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, 'Service');

        $this->assertNotContains($inProgress, $ids);
    }

    public function test_an_assignee_from_another_department_does_not_count(): void
    {
        $this->assign($this->ticketId, $this->employee(89513, 'IT')->emp_id);

        $ids = app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, 'Service');

        $this->assertNotContains($this->ticketId, $ids);
    }

    public function test_a_recorded_escalation_counts_even_without_an_assignee_or_department(): void
    {
        app(EscalationParticipants::class)->record($this->ticketId, [$this->manager->emp_id], $this->manager->emp_id, 'employee', 'Needs a manager');

        $this->assertContains($this->ticketId, app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, null));
        $this->assertContains($this->ticketId, app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, ''));
    }

    public function test_a_recorded_escalation_matches_the_exact_manager_id_only(): void
    {
        // A recorded id must not match a lookup for a number that contains it or that it contains.
        $id = (int) $this->manager->emp_id;
        app(EscalationParticipants::class)->record($this->ticketId, [$id], $id, 'employee', null);

        $this->assertNotContains($this->ticketId, app(EscalationParticipants::class)->ticketIdsForManager($id * 10 + 1, null));
        if ($id >= 10) {
            $this->assertNotContains($this->ticketId, app(EscalationParticipants::class)->ticketIdsForManager(intdiv($id, 10), null));
        }
    }

    public function test_a_ticket_matching_both_rules_is_listed_once(): void
    {
        $this->assign($this->ticketId, $this->employee(89514, 'Service')->emp_id);
        app(EscalationParticipants::class)->record($this->ticketId, [$this->manager->emp_id], $this->manager->emp_id, 'employee', null);

        $ids = app(EscalationParticipants::class)->ticketIdsForManager($this->manager->emp_id, 'Service');

        $this->assertSame(1, count(array_keys($ids, $this->ticketId, true)));
    }

    // ManagerDashboardService::ticketsForManager: the fix must not widen the queue

    protected function queueRow(Employee $manager, int $ticketId): ?array
    {
        $row = DB::table('employees')->where('emp_id', $manager->emp_id)->first();

        return collect(app(ManagerDashboardService::class)->ticketsForManager($row)['tickets'])->firstWhere('ticket_ID', $ticketId);
    }

    protected function managerInBranch(int $branchId): Employee
    {
        DB::table('branches')->updateOrInsert(['id' => $branchId], ['slug' => "branch-{$branchId}", 'name' => "Branch {$branchId}", 'code' => "B{$branchId}", 'region' => 'East', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('employees')->where('emp_id', $this->manager->emp_id)->update(['branch_id' => $branchId]);

        return $this->manager;
    }

    public function test_a_closed_ticket_stays_out_of_the_queue_even_when_it_was_escalated_to_the_manager(): void
    {
        $this->statuses();
        $manager = $this->managerInBranch(961);
        $closed = $this->ticket(4, '962');
        $this->assign($closed, $this->employee(89515, 'Service', 962)->emp_id);
        app(EscalationParticipants::class)->record($closed, [$manager->emp_id], $manager->emp_id, 'employee', null);

        $this->assertNull($this->queueRow($manager, $closed));
    }

    public function test_a_normal_ticket_from_another_branch_is_still_outside_the_queue(): void
    {
        $this->statuses();
        $manager = $this->managerInBranch(963);
        $otherBranch = $this->ticket(2, '964');
        $this->assign($otherBranch, $this->employee(89516, 'Service', 964)->emp_id);

        $this->assertNull($this->queueRow($manager, $otherBranch));
    }

    public function test_a_normal_ticket_in_the_manager_branch_is_listed_but_not_marked_escalated(): void
    {
        $this->statuses();
        $manager = $this->managerInBranch(965);
        $ownBranch = $this->ticket(2, '965');
        $this->assign($ownBranch, $this->employee(89517, 'Service', 965)->emp_id);

        $row = $this->queueRow($manager, $ownBranch);

        $this->assertNotNull($row);
        $this->assertFalse($row['escalated_to_me']);
        $this->assertFalse($row['can_join_conversation']);
        $this->assertFalse($row['can_reassign'], 'Not escalated and not breached, so managers cannot reassign it.');
    }

    // ManagerDashboardService::forManager: same department scope as the ticket list

    public function test_dashboard_counts_a_breach_whose_department_assignee_is_only_in_ticket_assignments(): void
    {
        $this->statuses();
        $manager = $this->managerInBranch(955);
        $breached = $this->ticket(2, '955');
        // assigned_to points at an IT engineer; the Service engineer is only in ticket_assignments.
        $itEngineer = $this->employee(89518, 'IT', 955);
        $serviceEngineer = $this->employee(89519, 'Service', 955);
        DB::table('tickets')->where('ticket_ID', $breached)->update([
            'assigned_to' => $itEngineer->emp_id,
            'resolution_due_at' => now()->subHours(2),
            'sla_status' => 'Breached',
        ]);
        $this->assign($breached, $itEngineer->emp_id);
        $this->assign($breached, $serviceEngineer->emp_id);

        $row = DB::table('employees')->where('emp_id', $manager->emp_id)->first();
        $dashboard = app(ManagerDashboardService::class)->forManager($row, true);

        $this->assertSame(1, $dashboard['summary']['breached']);
        $this->assertSame($breached, $dashboard['breached_queue'][0]['ticket_ID']);
        // The Service manager sees their own engineer as the assignee, not the IT one.
        $this->assertSame((int) $serviceEngineer->emp_id, $dashboard['breached_queue'][0]['assignee_id']);
        $this->assertSame('Service', $dashboard['breached_queue'][0]['department']);
    }

    // TicketService::showTicket escalated_to

    public function test_ticket_details_name_the_managers_it_was_escalated_to(): void
    {
        app(EscalationParticipants::class)->record($this->ticketId, [$this->manager->emp_id], 1, 'system', 'SLA breached');

        $this->actingAs($this->manager, 'api')
            ->getJson("/api/tickets/{$this->ticketId}")
            ->assertOk()
            ->assertJsonPath('escalated_to', [[
                'id' => (int) $this->manager->emp_id, 'name' => 'Mona Reyes', 'department' => 'Service', 'automatic' => true,
            ]]);
    }

    // Internal tickets: staff type the equipment / software name

    public function test_internal_ticket_stores_the_typed_equipment_name(): void
    {
        \Illuminate\Support\Facades\Http::fake();
        // Ticket creation fails closed without a limit policy; give it one, as the config service would.
        Cache::put('ticket:config:limits', ['isUnlimited' => true, 'limit' => 100], 60);
        DB::table('ticket_types')->updateOrInsert(['type_name' => 'Internal'], ['created_at' => now(), 'updated_at' => now()]);
        $serviceId = DB::table('problem_categories')->insertGetId(['category_name' => 'Machine Repair ESCJOIN', 'created_at' => now(), 'updated_at' => now()]);

        $response = $this->actingAs($this->manager, 'api')
            ->postJson('/api/tickets/internal', [
                'title' => 'Office Printer Jams Constantly',
                'description' => 'The second floor printer jams on every print job.',
                'problem_category_ID' => $serviceId,
                'equipment_name' => '  HP LaserJet 2nd Floor  ',
            ])
            ->assertCreated();

        $ticketId = (int) ($response->json('ticket.ticket_ID') ?: DB::table('tickets')->where('requested_by', $this->manager->emp_id)->max('ticket_ID'));
        try {
            $this->assertSame('HP LaserJet 2nd Floor', DB::table('tickets')->where('ticket_ID', $ticketId)->value('equipment_name'));
            $this->assertNull(DB::table('tickets')->where('ticket_ID', $ticketId)->value('machine_ID'));
        } finally {
            // Generated ticket numbers are not TCK-ESCJOIN-*, so remove this row here.
            DB::table('ticket_audit_logs')->where('ticket_ID', $ticketId)->delete();
            DB::table('tickets')->where('ticket_ID', $ticketId)->delete();
        }
    }

    public function test_internal_ticket_rejects_markup_in_the_equipment_name(): void
    {
        $serviceId = DB::table('problem_categories')->insertGetId(['category_name' => 'Machine Repair ESCJOIN', 'created_at' => now(), 'updated_at' => now()]);

        $this->actingAs($this->manager, 'api')
            ->postJson('/api/tickets/internal', [
                'title' => 'Office Printer Jams Constantly',
                'description' => 'The second floor printer jams on every print job.',
                'problem_category_ID' => $serviceId,
                'equipment_name' => '<script>alert(1)</script>',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['equipment_name']);
    }
}
