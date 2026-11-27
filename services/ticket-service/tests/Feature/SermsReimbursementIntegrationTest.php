<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * TS <-> SERMS reimbursement integration: submit and pull (TS -> SERMS), ticket list and
 * status webhook (SERMS -> TS), and the internal guard accepting X-Internal-Secret.
 */
class SermsReimbursementIntegrationTest extends TestCase
{
    use DatabaseTransactions;

    private const TOKEN = 'test-internal-token';
    private const SECRET = 'test-serms-secret';
    private const SERMS = 'https://serms.test';

    private Client $owner;
    private Employee $assignee;
    private int $ticketId;
    private string $ticketNumber;

    protected function setUp(): void
    {
        parent::setUp();
        foreach (['INTERNAL_TOKEN' => self::TOKEN, 'INTERNAL_SERVICE_SECRET' => self::SECRET] as $k => $v) {
            putenv("{$k}={$v}");
            $_ENV[$k] = $v;
            $_SERVER[$k] = $v;
        }
        config(['services.serms.url' => self::SERMS, 'services.serms.prefix' => '/api', 'services.serms.secret' => self::SECRET, 'services.serms.timeout' => 5]);

        $uid = uniqid();
        $this->owner = Client::create(['client_name' => "SERMS Owner {$uid}", 'email' => "owner.{$uid}@serms.test", 'contact_number' => '1', 'address' => 'x']);
        $this->assignee = $this->employee(951001, 'service', 'Service');
        $this->ticketNumber = 'SRM-' . $uid;
        $this->ticketId = $this->ticket([
            'ticket_number' => $this->ticketNumber,
            'assigned_to' => $this->assignee->emp_id,
            'ticket_status_ID' => $this->statusId('Resolved'),
        ]);
    }

    private function statusId(string $name): int
    {
        return (int) DB::table('ticket_statuses')->where('status_name', $name)->value('ticket_status_ID');
    }

    private function ticket(array $over = []): int
    {
        return (int) DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'SRM-' . uniqid(),
            'title' => 'SERMS reimbursement ticket',
            'description' => 'SERMS reimbursement ticket',
            'problem_category_ID' => (int) DB::table('problem_categories')->value('problem_category_ID'),
            'created_by' => $this->owner->id,
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => (int) (DB::table('ticket_priorities')->value('priority_ID') ?? 1),
            'ticket_status_ID' => 1,
            'is_internal' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $over));
    }

    private function employee(int $id, string $role, string $department): Employee
    {
        Employee::where('emp_id', $id)->delete();

        return Employee::create([
            'emp_id' => $id,
            'first_name' => 'Serms',
            'last_name' => "Tester{$id}",
            'email' => "emp{$id}." . uniqid() . '@serms.test',
            'role' => $role,
            'department' => $department,
            'position_level' => 'Employee',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    private function claim(array $over = []): array
    {
        return array_merge([
            'amount' => '750.50',
            'expense_category' => 'Transportation',
            'description' => 'Grab fare to client site for analyzer repair',
            'expense_date' => now()->subDay()->format('Y-m-d'),
            'receipts' => [UploadedFile::fake()->create('receipt.pdf', 100, 'application/pdf')],
        ], $over);
    }

    private function fakeSermsSubmit(int $status = 201, array $body = []): void
    {
        Http::fake([
            self::SERMS . '/api/internal/ts/reimbursements' => Http::response(array_merge([
                'reimbursement_id' => 42,
                'reference_no' => 'RMB-2026-00042',
                'status' => 'pending',
                'message' => 'TS reimbursement request received and queued for OCR processing.',
                'data' => [],
            ], $body), $status),
            '*' => Http::response([], 404),
        ]);
    }

    // ─── Submit (TS -> SERMS) ────────────────────────────────────────────────

    public function test_assignee_submits_a_claim_forwarded_to_serms_with_receipts(): void
    {
        $this->fakeSermsSubmit();
        $this->actingAs($this->assignee, 'api');

        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])
            ->assertStatus(201)
            ->assertJsonPath('data.reference_no', 'RMB-2026-00042')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.amount', 750.5)
            ->assertJsonPath('data.receipt_count', 1);

        Http::assertSent(function (HttpRequest $req) {
            if ($req->url() !== self::SERMS . '/api/internal/ts/reimbursements') {
                return false;
            }
            $fields = collect($req->data())->mapWithKeys(fn ($part) => [$part['name'] => $part['contents']]);

            return $req->hasHeader('X-Internal-Secret', self::SECRET)
                && $req->isMultipart()
                && (string) $fields['ticket_id'] === (string) $this->ticketId
                && $fields['ticket_number'] === $this->ticketNumber
                && $fields['employee_email'] === $this->assignee->email
                && $fields['employee_name'] === 'Serms Tester951001'
                && $fields['employee_id'] === (string) $this->assignee->emp_id
                && $fields['amount'] === '750.50'
                && $fields['expense_category'] === 'Transportation'
                && $fields->has('receipts[]');
        });

        $this->assertDatabaseHas('ticket_reimbursements', [
            'ticket_ID' => $this->ticketId,
            'reference_no' => 'RMB-2026-00042',
            'submitted_by_emp_id' => $this->assignee->emp_id,
        ]);
    }

    public function test_second_submit_is_refused_while_a_claim_is_active(): void
    {
        $this->fakeSermsSubmit();
        $this->actingAs($this->assignee, 'api');
        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])->assertStatus(201);

        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])
            ->assertStatus(409)
            ->assertJsonPath('data.reference_no', 'RMB-2026-00042');
        Http::assertSentCount(1);
    }

    public function test_a_terminally_rejected_claim_can_be_refiled(): void
    {
        $this->fakeSermsSubmit();
        $this->actingAs($this->assignee, 'api');
        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])->assertStatus(201);
        DB::table('ticket_reimbursements')->where('ticket_ID', $this->ticketId)->update(['status' => 'rejected']);

        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(['amount' => '100']), ['Accept' => 'application/json'])
            ->assertStatus(201)
            ->assertJsonPath('data.amount', 100);
        $this->assertSame(1, DB::table('ticket_reimbursements')->where('ticket_ID', $this->ticketId)->count());
    }

    public function test_only_the_assignee_or_a_delegate_may_submit(): void
    {
        $this->fakeSermsSubmit();
        $admin = $this->employee(951002, 'superadmin', 'IT');
        $this->actingAs($admin, 'api');
        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])->assertStatus(403);

        $delegate = $this->employee(951003, 'service', 'Service');
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $this->ticketId,
            'employee_ID' => $delegate->emp_id,
            'assignment_status' => 'assigned',
            'assigned_by' => $delegate->emp_id,
            'assigned_at' => now(),
        ]);
        $this->actingAs($delegate, 'api');
        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])->assertStatus(201);
    }

    public function test_ticket_must_be_resolved_or_closed(): void
    {
        $this->fakeSermsSubmit();
        DB::table('tickets')->where('ticket_ID', $this->ticketId)->update(['ticket_status_ID' => $this->statusId('In Progress')]);
        $this->actingAs($this->assignee, 'api');

        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])->assertStatus(422);
        Http::assertNothingSent();
    }

    public function test_validation_rejects_missing_receipts_and_long_description(): void
    {
        $this->fakeSermsSubmit();
        $this->actingAs($this->assignee, 'api');

        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim([
            'receipts' => [],
            'description' => str_repeat('a', 256),
            'expense_category' => 'Fuel',
        ]), ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['receipts', 'description', 'expense_category']);
        Http::assertNothingSent();
    }

    public function test_serms_422_is_passed_through_and_unreachable_serms_is_502(): void
    {
        $this->actingAs($this->assignee, 'api');

        Http::fake([self::SERMS . '/*' => Http::sequence()
            ->push(['message' => 'Duplicate receipt.', 'errors' => ['receipts' => ['Duplicate receipt.']]], 422)
            ->push(['message' => 'Unauthenticated.'], 401)]);
        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Duplicate receipt.');

        $this->post("/api/tickets/{$this->ticketId}/reimbursement", $this->claim(), ['Accept' => 'application/json'])->assertStatus(502);

        $this->assertDatabaseMissing('ticket_reimbursements', ['ticket_ID' => $this->ticketId]);
    }

    // ─── Show + pull (TS -> SERMS) ───────────────────────────────────────────

    public function test_show_pulls_a_stale_status_from_serms(): void
    {
        DB::table('ticket_reimbursements')->insert([
            'ticket_ID' => $this->ticketId,
            'submitted_by_emp_id' => $this->assignee->emp_id,
            'reference_no' => 'RMB-2026-00042',
            'status' => 'pending',
            'amount' => 750.5,
            'receipt_count' => 1,
            'last_synced_at' => now()->subMinutes(5),
            'submitted_at' => now()->subMinutes(5),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Http::fake([self::SERMS . "/api/internal/ts/reimbursements/by-ticket/{$this->ticketId}" => Http::response([
            'reimbursement_id' => 42,
            'reference_no' => 'RMB-2026-00042',
            'status' => 'Approved',
            'message' => 'Approved by finance.',
            'ticket_id' => $this->ticketId,
            'amount' => 700.0,
            'rejection_comment' => null,
            'approved_at' => now()->toIso8601String(),
            'updated_at' => now()->toIso8601String(),
            'history' => [],
        ], 200)]);

        $this->actingAs($this->assignee, 'api');
        $this->getJson("/api/tickets/{$this->ticketId}/reimbursement")
            ->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.amount', 700)
            ->assertJsonPath('eligible', true)
            ->assertJsonPath('can_submit', false);

        // Fresh now: a second view does not call SERMS again.
        $this->getJson("/api/tickets/{$this->ticketId}/reimbursement")->assertOk();
        Http::assertSentCount(1);
    }

    public function test_show_without_a_claim_reports_eligibility_and_a_customer_is_refused(): void
    {
        Http::fake();
        $this->actingAs($this->assignee, 'api');
        $this->getJson("/api/tickets/{$this->ticketId}/reimbursement")
            ->assertOk()
            ->assertJsonPath('data', null)
            ->assertJsonPath('can_submit', true);

        $this->actingAs($this->owner, 'api');
        $this->getJson("/api/tickets/{$this->ticketId}/reimbursement")->assertStatus(403);
    }

    // ─── SERMS -> TS ─────────────────────────────────────────────────────────

    public function test_internal_tickets_list_accepts_token_or_secret(): void
    {
        $this->getJson('/api/internal/tickets?search=' . $this->ticketNumber, ['X-Internal-Token' => self::TOKEN])
            ->assertOk()
            ->assertJsonPath('data.0.ticket_id', $this->ticketId)
            ->assertJsonPath('data.0.ticket_number', $this->ticketNumber)
            ->assertJsonPath('data.0.status', 'Resolved')
            ->assertJsonPath('data.0.assignee_email', $this->assignee->email)
            ->assertJsonStructure(['data' => [['ticket_id', 'ticket_number', 'title', 'status', 'priority', 'assignee_name', 'assignee_email', 'department', 'created_at', 'updated_at']]]);

        $this->getJson('/api/internal/tickets?status=resolved&search=' . $this->ticketNumber, ['X-Internal-Secret' => self::SECRET])
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->getJson('/api/internal/tickets', ['X-Internal-Secret' => 'wrong'])->assertStatus(403);
        $this->getJson('/api/internal/tickets')->assertStatus(403);
    }

    public function test_status_webhook_updates_the_local_claim(): void
    {
        $headers = ['X-Internal-Token' => self::TOKEN, 'X-Internal-Secret' => self::SECRET];

        $this->postJson('/api/internal/reimbursements/status', [
            'ticket_id' => $this->ticketId,
            'ticket_number' => $this->ticketNumber,
            'reimbursement_id' => 42,
            'reference_no' => 'RMB-2026-00042',
            'status' => 'revise',
            'message' => 'Receipt is blurry.',
            'rejection_comment' => 'Please upload a clearer receipt.',
            'updated_at' => now()->toIso8601String(),
        ], $headers)
            ->assertOk()
            ->assertJsonPath('data.status', 'revise')
            ->assertJsonPath('data.rejection_comment', 'Please upload a clearer receipt.');

        $this->postJson('/api/internal/reimbursements/status', [
            'ticket_id' => $this->ticketId,
            'ticket_number' => 'TKT-WRONG',
            'status' => 'approved',
        ], $headers)->assertStatus(422);

        $this->postJson('/api/internal/reimbursements/status', ['ticket_id' => $this->ticketId, 'status' => 'approved'], ['X-Internal-Token' => 'wrong'])
            ->assertStatus(403);
    }
}
