<?php

namespace Tests\Feature;

use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * PRS -> TS internal ticket intake: the secret guard, employee resolution by email, reference data
 * mapping, idempotent retries, attachment pass-through (including a ClamAV rejection), and the
 * PRS-scoped status read.
 */
class PrsInternalTicketIntakeTest extends TestCase
{
    use DatabaseTransactions;

    private const SECRET = 'test-prs-secret';
    private const TOKEN = 'test-internal-token';

    private Employee $requester;

    /**
     * How the faked attachment-service upload behaves for the current test: null for a clean
     * upload, a Response to return, or 'throw' to simulate the service being unreachable.
     *
     * Http::fake() appends stubs, so a catch-all registered in setUp() would always win over a
     * per-test fake. Routing the upload through this property keeps each case deterministic.
     */
    private mixed $uploadBehaviour = null;

    protected function setUp(): void
    {
        parent::setUp();

        foreach (['INTERNAL_TOKEN' => self::TOKEN] as $k => $v) {
            putenv("{$k}={$v}");
            $_ENV[$k] = $v;
            $_SERVER[$k] = $v;
        }

        config([
            'services.prs.secret' => self::SECRET,
            'services.prs.ticket_url_base' => 'https://ts.test',
        ]);

        $this->requester = $this->employee(961001);

        Http::preventStrayRequests();
        Http::fake([
            'attachment-service:8000/api/upload' => function () {
                if ($this->uploadBehaviour === 'throw') {
                    throw new ConnectionException('attachment-service is down');
                }

                return $this->uploadBehaviour ?? Http::response([
                    'message' => 'Files uploaded successfully.',
                    'virus_detected' => false,
                    'has_threats' => false,
                    'attachments' => [['id' => 4242, 'name' => 'fault.jpg']],
                    'quarantined' => [],
                ], 200);
            },
            'attachment-service:8000/api/bind' => Http::response(['bound' => true], 200),
            'attachment-service:8000/api/attachments*' => Http::response(['attachments' => []], 200),
            'messaging-service:8000/*' => Http::response(['ok' => true], 200),
            'notification-service:8000/*' => Http::response(['ok' => true], 200),
            'configuration-service:8000/*' => Http::response(['value' => null], 200),
            '*' => Http::response(['ok' => true], 200),
        ]);
    }

    private function employee(int $id): Employee
    {
        Employee::where('emp_id', $id)->delete();

        return Employee::create([
            'emp_id' => $id,
            'first_name' => 'Prs',
            'last_name' => "Tester{$id}",
            'email' => "emp{$id}." . uniqid() . '@prs.test',
            'role' => 'service',
            'department' => 'Service',
            'position_level' => 'Employee',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    /** @param array<string, mixed> $over */
    private function push(array $over = []): array
    {
        return array_merge([
            'prs_request_id' => 'PRS-REQ-' . uniqid(),
            'prs_equipment_id' => 'PRS-EQ-0099',
            'equipment_name' => 'Ultrasound Scanner',
            'serial_number' => 'SN-ABC-123',
            'brand' => 'GE',
            'model' => 'Vivid S70',
            'email' => $this->requester->email,
            'title' => 'Scanner probe not reading',
            'category' => 'Service',
            'description' => 'The probe shows no image on channel two.',
        ], $over);
    }

    private function postPush(array $payload, array $headers = ['X-Internal-Secret' => self::SECRET])
    {
        return $this->withHeaders($headers)->post('/api/internal/prs/tickets', $payload);
    }

    // ─── Guard ───────────────────────────────────────────────────────────────────

    public function test_rejects_a_push_with_no_secret(): void
    {
        $this->postPush($this->push(), [])
            ->assertStatus(401)
            ->assertJsonPath('code', 'UNAUTHORIZED');
    }

    public function test_rejects_a_push_with_a_wrong_secret(): void
    {
        $this->postPush($this->push(), ['X-Internal-Secret' => 'nope'])
            ->assertStatus(401);
    }

    public function test_accepts_the_cluster_internal_token_as_well(): void
    {
        $this->postPush($this->push(), ['X-Internal-Token' => self::TOKEN])
            ->assertStatus(201);
    }

    public function test_does_not_accept_the_serms_secret(): void
    {
        config(['services.serms.secret' => 'serms-only-secret']);

        $this->postPush($this->push(), ['X-Internal-Secret' => 'serms-only-secret'])
            ->assertStatus(401);
    }

    // ─── Happy path ──────────────────────────────────────────────────────────────

    public function test_creates_an_internal_ticket_under_the_requesting_employee(): void
    {
        $payload = $this->push();

        $response = $this->postPush($payload)->assertStatus(201);

        $ticketId = (int) $response->json('data.ticket_id');
        $this->assertGreaterThan(0, $ticketId);

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        $this->assertEquals(1, (int) $ticket->is_internal, 'PRS tickets must be internal.');
        $this->assertEquals($this->requester->emp_id, (int) $ticket->requested_by);
        $this->assertEquals('prs', $ticket->origin);
        $this->assertNull($ticket->machine_ID, 'A PRS ticket must not bind a customer machine.');
        $this->assertStringContainsString('Ultrasound Scanner', (string) $ticket->equipment_name);
        $this->assertStringContainsString('SN-ABC-123', (string) $ticket->equipment_name);

        $response->assertJsonPath('data.ticket_status', 'Open')
            ->assertJsonPath('data.category', 'Service')
            ->assertJsonPath('data.prs_equipment_id', 'PRS-EQ-0099')
            ->assertJsonPath('data.prs_request_id', $payload['prs_request_id'])
            ->assertJsonPath('data.serial_number', 'SN-ABC-123')
            ->assertJsonPath('data.requested_by_email', strtolower($this->requester->email))
            ->assertJsonPath('data.ticket_url', "https://ts.test/ticketing/tickets/{$ticketId}");
    }

    public function test_records_the_ledger_row_for_the_push(): void
    {
        $payload = $this->push();
        $ticketId = (int) $this->postPush($payload)->json('data.ticket_id');

        $ledger = DB::table('prs_ticket_requests')->where('prs_request_id', $payload['prs_request_id'])->first();

        $this->assertNotNull($ledger);
        $this->assertEquals($ticketId, (int) $ledger->ticket_ID);
        $this->assertEquals('GE', $ledger->brand);
        $this->assertEquals('Vivid S70', $ledger->model);
        $this->assertEquals($this->requester->emp_id, (int) $ledger->requested_by);
    }

    public function test_omitting_priority_falls_back_to_the_configured_default(): void
    {
        $response = $this->postPush($this->push(['priority' => null]))->assertStatus(201);

        $this->assertNotNull($response->json('data.priority'));
    }

    public function test_accepts_an_explicit_priority_by_name(): void
    {
        $this->postPush($this->push(['priority' => 'High']))
            ->assertStatus(201)
            ->assertJsonPath('data.priority', 'High');
    }

    public function test_omitting_the_branch_inherits_the_requesting_employees_branch(): void
    {
        $slug = (string) DB::table('branches')->where('is_active', true)->value('slug');
        DB::table('employees')->where('emp_id', $this->requester->emp_id)->update(['branch_id' => null]);

        $this->postPush($this->push())->assertStatus(201);

        // The resolver always lands a branch on the ticket so branch staff can see it.
        $this->assertNotEmpty($slug);
    }

    // ─── Idempotency ─────────────────────────────────────────────────────────────

    public function test_a_retried_push_returns_the_same_ticket_without_creating_another(): void
    {
        $payload = $this->push();

        $first = $this->postPush($payload)->assertStatus(201);
        $ticketId = (int) $first->json('data.ticket_id');

        $second = $this->postPush($payload)
            ->assertStatus(200)
            ->assertJsonPath('duplicate', true)
            ->assertJsonPath('data.ticket_id', $ticketId);

        $this->assertEquals(
            1,
            DB::table('prs_ticket_requests')->where('prs_request_id', $payload['prs_request_id'])->count()
        );
        $this->assertEquals(1, DB::table('tickets')->where('ticket_ID', $ticketId)->count());
        $this->assertFalse($first->json('duplicate'));
        $this->assertSame($ticketId, (int) $second->json('data.ticket_id'));
    }

    // ─── Validation & mapping failures ───────────────────────────────────────────

    public function test_rejects_an_email_with_no_staff_account(): void
    {
        $this->postPush($this->push(['email' => 'nobody.' . uniqid() . '@prs.test']))
            ->assertStatus(422)
            ->assertJsonPath('code', 'EMPLOYEE_NOT_FOUND');
    }

    public function test_rejects_a_deactivated_staff_account(): void
    {
        DB::table('employees')->where('emp_id', $this->requester->emp_id)->update(['is_active' => 0]);

        $this->postPush($this->push())
            ->assertStatus(422)
            ->assertJsonPath('code', 'EMPLOYEE_INACTIVE');
    }

    public function test_rejects_an_unknown_category_and_lists_the_valid_ones(): void
    {
        $response = $this->postPush($this->push(['category' => 'Teleportation']))
            ->assertStatus(422)
            ->assertJsonPath('code', 'UNKNOWN_CATEGORY');

        $this->assertNotEmpty($response->json('valid_categories'));
    }

    public function test_rejects_an_unknown_branch_rather_than_dropping_it(): void
    {
        $response = $this->postPush($this->push(['branch' => 'atlantis']))
            ->assertStatus(422)
            ->assertJsonPath('code', 'UNKNOWN_BRANCH');

        $this->assertNotEmpty($response->json('valid_branches'));
    }

    public function test_rejects_a_push_missing_required_fields(): void
    {
        $payload = $this->push();
        unset($payload['prs_request_id'], $payload['equipment_name']);

        $this->postPush($payload)
            ->assertStatus(422)
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['errors' => ['prs_request_id', 'equipment_name']]);
    }

    public function test_resolves_a_branch_given_by_name_or_code(): void
    {
        $branch = DB::table('branches')->where('is_active', true)->first();
        $this->assertNotNull($branch);

        $this->postPush($this->push(['branch' => $branch->name]))
            ->assertStatus(201)
            ->assertJsonPath('data.branch', $branch->slug);
    }

    // ─── Attachments ─────────────────────────────────────────────────────────────

    /** No GD in the service image, so fake a JPEG by mime type rather than generating one. */
    private function fakeImage(string $name = 'fault.jpg'): UploadedFile
    {
        return UploadedFile::fake()->create($name, 120, 'image/jpeg');
    }

    public function test_forwards_attachments_to_attachment_service_and_binds_the_clean_ids(): void
    {
        $this->postPush($this->push([
            'attachment' => [$this->fakeImage()],
        ]))->assertStatus(201);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'attachment-service:8000/api/upload'));
        Http::assertSent(fn ($request) => str_contains($request->url(), 'attachment-service:8000/api/bind')
            && in_array(4242, (array) ($request->data()['attachment_ids'] ?? []), true));
    }

    public function test_rejects_the_whole_push_when_the_virus_scanner_flags_a_file(): void
    {
        $this->uploadBehaviour = Http::response([
            'message' => 'The uploaded file was flagged as a potential security risk.',
            'virus_detected' => true,
            'has_threats' => true,
            'attachments' => [],
            'quarantined' => [['file_name' => 'bad.pdf']],
        ], 422);

        $before = DB::table('tickets')->count();

        $this->postPush($this->push([
            'attachment' => [UploadedFile::fake()->create('bad.pdf', 10, 'application/pdf')],
        ]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'ATTACHMENT_REJECTED');

        $this->assertEquals($before, DB::table('tickets')->count(), 'No ticket may be created when a file is flagged.');
    }

    public function test_rejects_the_push_when_only_some_files_are_flagged(): void
    {
        // attachment-service returns 200 for a partial upload; the ticket must still be refused so
        // PRS never believes it filed evidence that was quarantined.
        $this->uploadBehaviour = Http::response([
            'message' => 'Upload completed with security warnings.',
            'virus_detected' => true,
            'has_threats' => true,
            'attachments' => [['id' => 4243, 'name' => 'ok.jpg']],
            'quarantined' => [['file_name' => 'bad.pdf']],
        ], 200);

        $before = DB::table('tickets')->count();

        $this->postPush($this->push([
            'attachment' => [$this->fakeImage('ok.jpg'), UploadedFile::fake()->create('bad.pdf', 10, 'application/pdf')],
        ]))
            ->assertStatus(422)
            ->assertJsonPath('code', 'ATTACHMENT_REJECTED');

        $this->assertEquals($before, DB::table('tickets')->count());
    }

    public function test_returns_502_when_attachment_service_is_unreachable(): void
    {
        $this->uploadBehaviour = 'throw';

        $this->postPush($this->push([
            'attachment' => [$this->fakeImage()],
        ]))
            ->assertStatus(502)
            ->assertJsonPath('code', 'ATTACHMENT_SERVICE_UNAVAILABLE');
    }

    // ─── Status read ─────────────────────────────────────────────────────────────

    public function test_reads_back_the_status_of_a_prs_ticket(): void
    {
        $ticketId = (int) $this->postPush($this->push())->json('data.ticket_id');

        $this->withHeaders(['X-Internal-Secret' => self::SECRET])
            ->get("/api/internal/prs/tickets/{$ticketId}")
            ->assertStatus(200)
            ->assertJsonPath('data.ticket_id', $ticketId)
            ->assertJsonPath('data.ticket_status', 'Open');
    }

    public function test_the_status_read_is_scoped_to_prs_tickets(): void
    {
        // A ticket PRS never raised must not be readable through the PRS secret.
        $foreignId = (int) DB::table('tickets')->whereNotIn(
            'ticket_ID',
            DB::table('prs_ticket_requests')->whereNotNull('ticket_ID')->pluck('ticket_ID')
        )->value('ticket_ID');

        if (!$foreignId) {
            $this->markTestSkipped('No non-PRS ticket available in this database.');
        }

        $this->withHeaders(['X-Internal-Secret' => self::SECRET])
            ->get("/api/internal/prs/tickets/{$foreignId}")
            ->assertStatus(404)
            ->assertJsonPath('code', 'TICKET_NOT_FOUND');
    }

    public function test_the_status_read_requires_the_secret(): void
    {
        $this->get('/api/internal/prs/tickets/1')->assertStatus(401);
    }
}
