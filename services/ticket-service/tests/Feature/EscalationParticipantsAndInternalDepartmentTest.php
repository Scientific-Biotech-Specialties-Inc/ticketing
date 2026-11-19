<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\CategoryTrack;
use App\Services\EscalationParticipants;
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
}
