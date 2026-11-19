<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use App\Services\ManagerReassignmentNotice;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Department manager reassignments: internal timeline entry, CS notice until acknowledged,
 * hidden from customers.
 */
class ManagerReassignmentNoticeTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $cs;
    protected Employee $engineer;
    protected Employee $manager;
    protected Client $customer;
    protected int $ticketId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        $emails = ['cs.mgrre@example.com', 'eng.mgrre@example.com', 'mgr.mgrre@example.com'];
        DB::table('ticket_audit_logs')->whereIn('ticket_ID', function ($q) {
            $q->select('ticket_ID')->from('tickets')->where('ticket_number', 'TCK-MGRRE-001');
        })->delete();
        DB::table('tickets')->where('ticket_number', 'TCK-MGRRE-001')->delete();
        DB::table('employees')->whereIn('email', $emails)->delete();

        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Network', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 2], ['status_name' => 'In Progress', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('clients')->updateOrInsert(['id' => 9401], [
            'client_name' => 'Mia Customer', 'email' => 'mia.mgrre@example.com', 'contact_number' => '5559401',
            'address' => '9401 Road', 'status' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->customer = Client::find(9401);

        $make = fn (int $id, string $first, string $email, string $role, string $dept, ?string $level = null) => Employee::create([
            'emp_id' => $id, 'first_name' => $first, 'last_name' => 'Test', 'email' => $email, 'role' => $role,
            'department' => $dept, 'position_level' => $level, 'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);
        $this->cs = $make(89401, 'Carla', 'cs.mgrre@example.com', 'Customer Service', 'Customer Service');
        $this->engineer = $make(89402, 'Eddie', 'eng.mgrre@example.com', 'Engineer', 'Service');
        $this->manager = $make(89403, 'Mona', 'mgr.mgrre@example.com', 'Service Manager', 'Service', 'Manager');

        $this->ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-MGRRE-001', 'title' => 'Manager reassignment ticket', 'description' => 'Test',
            'created_by' => 9401, 'assigned_to' => $this->engineer->emp_id, 'problem_category_ID' => 1,
            'ticket_type_ID' => 1, 'ticket_status_ID' => 2, 'priority_ID' => 1,
            'created_at' => now()->subHour(), 'updated_at' => now(),
        ]);
    }

    /** The row employee-service writes when a manager reassigns. */
    protected function recordManagerReassignment(): void
    {
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $this->ticketId,
            'action_type' => 'manager_reassigned',
            'event_type' => 'manager_reassigned',
            'action_by_ID' => $this->manager->emp_id,
            'actor_type' => 'employee',
            'actor_role' => 'service_manager',
            'before_state' => json_encode(['assignees' => ['Old Engineer']]),
            'after_state' => json_encode(['assignees' => ['Eddie Test']]),
            'details' => json_encode([
                'manager_id' => $this->manager->emp_id,
                'manager_name' => 'Mona Test',
                'department' => 'Service',
                'added' => [['id' => $this->engineer->emp_id, 'name' => 'Eddie Test']],
                'removed' => [['id' => 1, 'name' => 'Old Engineer']],
            ]),
            'is_system' => 0,
            'is_internal' => 1,
            'created_at' => now(),
        ]);
    }

    public function test_timeline_describes_manager_reassignment_for_staff(): void
    {
        $this->recordManagerReassignment();

        $response = $this->actingAs($this->cs, 'api')
            ->getJson("/api/tickets/{$this->ticketId}/timeline")
            ->assertOk();

        $entry = collect($response->json('data'))->firstWhere('event_type', 'manager_reassigned');
        $this->assertNotNull($entry);
        $this->assertSame(
            'Service Manager Mona Test reassigned the ticket. Added: Eddie Test. Removed: Old Engineer',
            $entry['description']
        );
        $this->assertSame('Mona Test', $entry['actor']['name']);
    }

    public function test_customer_timeline_hides_manager_reassignment(): void
    {
        $this->recordManagerReassignment();

        $response = $this->actingAs($this->customer, 'api')
            ->getJson("/api/tickets/{$this->ticketId}/timeline")
            ->assertOk();

        $this->assertNull(collect($response->json('data'))->firstWhere('event_type', 'manager_reassigned'));
    }

    public function test_notice_is_pending_until_cs_acknowledges(): void
    {
        $notice = app(ManagerReassignmentNotice::class);
        $this->assertNull($notice->pendingForTicket($this->ticketId));

        $this->recordManagerReassignment();
        $pending = $notice->pendingForTicket($this->ticketId);
        $this->assertSame('Mona Test', $pending['manager_name']);
        $this->assertSame('Service', $pending['department']);
        $this->assertSame('Eddie Test', $pending['added'][0]['name']);

        // The SQL rule used for the tab and its count agrees with the PHP rule.
        $sqlPending = fn () => DB::table('tickets as t')->where('t.ticket_ID', $this->ticketId)
            ->whereRaw(ManagerReassignmentNotice::pendingSql('t'))->exists();
        $this->assertTrue($sqlPending());

        $this->actingAs($this->cs, 'api')
            ->postJson("/api/tickets/{$this->ticketId}/manager-reassignment/acknowledge")
            ->assertOk()
            ->assertJson(['acknowledged' => true]);

        $this->assertNull($notice->pendingForTicket($this->ticketId));
        $this->assertFalse($sqlPending());

        // A second acknowledgement (another CS user) is a harmless no-op.
        $this->actingAs($this->cs, 'api')
            ->postJson("/api/tickets/{$this->ticketId}/manager-reassignment/acknowledge")
            ->assertOk()
            ->assertJson(['acknowledged' => false]);

        // A new manager reassignment raises the notice again.
        $this->recordManagerReassignment();
        $this->assertNotNull($notice->pendingForTicket($this->ticketId));
        $this->assertTrue($sqlPending());
    }

    public function test_only_cs_or_admin_can_acknowledge(): void
    {
        $this->recordManagerReassignment();

        $this->actingAs($this->engineer, 'api')
            ->postJson("/api/tickets/{$this->ticketId}/manager-reassignment/acknowledge")
            ->assertForbidden();

        $this->assertNotNull(app(ManagerReassignmentNotice::class)->pendingForTicket($this->ticketId));
    }
}
