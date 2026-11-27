<?php

namespace Tests\Feature;

use App\Jobs\NotifyPrsTicketStatusChanged;
use App\Services\PrsCallbackClient;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * TS -> PRS status callback: the payload, the PRS-origin scoping, and the queued job's retry and
 * permanent-failure behaviour.
 */
class PrsStatusCallbackTest extends TestCase
{
    use DatabaseTransactions;

    private const SECRET = 'prs-callback-secret';
    private const BASE = 'https://prs.test';
    private const PATH = '/api/internal/ts/tickets/status';

    private int $prsTicketId;
    private string $requestId;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.prs.callback_url' => self::BASE,
            'services.prs.callback_path' => self::PATH,
            'services.prs.callback_secret' => self::SECRET,
            'services.prs.callback_timeout' => 5,
        ]);

        $this->prsTicketId = (int) DB::table('tickets')->value('ticket_ID');
        $this->assertGreaterThan(0, $this->prsTicketId, 'The test database needs at least one ticket.');

        $this->requestId = 'PRS-REQ-' . uniqid();
        DB::table('prs_ticket_requests')->insert([
            'prs_request_id' => $this->requestId,
            'prs_equipment_id' => 'PRS-EQ-7001',
            'equipment_name' => 'Ultrasound Scanner',
            'serial_number' => 'SN-CB-1',
            'requester_email' => 'cb@prs.test',
            'ticket_ID' => $this->prsTicketId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function client(): PrsCallbackClient
    {
        return app(PrsCallbackClient::class);
    }

    // ─── Configuration gating ────────────────────────────────────────────────────

    public function test_is_not_configured_without_a_url(): void
    {
        config(['services.prs.callback_url' => '']);

        $this->assertFalse($this->client()->isConfigured());
        $this->assertNull($this->client()->notifyStatusChange($this->prsTicketId));
    }

    public function test_is_not_configured_without_a_secret(): void
    {
        config(['services.prs.callback_secret' => '']);

        $this->assertFalse($this->client()->isConfigured());
    }

    public function test_is_configured_with_both(): void
    {
        $this->assertTrue($this->client()->isConfigured());
    }

    // ─── Payload & scoping ───────────────────────────────────────────────────────

    public function test_the_payload_carries_the_prs_identifiers_and_ticket_state(): void
    {
        $payload = $this->client()->payloadFor($this->prsTicketId);

        $this->assertNotNull($payload);
        $this->assertSame($this->prsTicketId, $payload['ticket_id']);
        $this->assertSame($this->requestId, $payload['prs_request_id']);
        $this->assertSame('PRS-EQ-7001', $payload['prs_equipment_id']);
        $this->assertArrayHasKey('ticket_status', $payload);
        $this->assertArrayHasKey('resolved_at', $payload);
        $this->assertArrayHasKey('closed_at', $payload);
        $this->assertArrayHasKey('sla_due_at', $payload);
    }

    public function test_a_ticket_prs_never_raised_produces_no_payload(): void
    {
        $foreignId = (int) DB::table('tickets')
            ->whereNotIn('ticket_ID', DB::table('prs_ticket_requests')->whereNotNull('ticket_ID')->pluck('ticket_ID'))
            ->value('ticket_ID');

        if (!$foreignId) {
            $this->markTestSkipped('No non-PRS ticket available.');
        }

        $this->assertNull($this->client()->payloadFor($foreignId));
        $this->assertNull($this->client()->notifyStatusChange($foreignId));
    }

    // ─── Delivery ────────────────────────────────────────────────────────────────

    public function test_posts_the_payload_to_the_configured_url_with_the_prs_secret(): void
    {
        Http::preventStrayRequests();
        Http::fake([self::BASE . self::PATH => Http::response(['received' => true], 200)]);

        $result = $this->client()->notifyStatusChange($this->prsTicketId);

        $this->assertTrue($result['ok']);
        $this->assertSame(200, $result['status']);

        Http::assertSent(function ($request) {
            return $request->url() === self::BASE . self::PATH
                && $request->hasHeader('X-Internal-Secret', self::SECRET)
                && $request->method() === 'POST'
                && ($request->data()['prs_request_id'] ?? null) === $this->requestId;
        });
    }

    public function test_reports_status_zero_when_prs_is_unreachable(): void
    {
        Http::fake([self::BASE . '*' => fn () => throw new ConnectionException('tunnel down')]);

        $result = $this->client()->notifyStatusChange($this->prsTicketId);

        $this->assertFalse($result['ok']);
        $this->assertSame(0, $result['status']);
    }

    public function test_reports_the_upstream_status_when_prs_rejects_it(): void
    {
        Http::fake([self::BASE . '*' => Http::response(['message' => 'bad payload'], 422)]);

        $result = $this->client()->notifyStatusChange($this->prsTicketId);

        $this->assertFalse($result['ok']);
        $this->assertSame(422, $result['status']);
    }

    // ─── Queued job behaviour ────────────────────────────────────────────────────

    public function test_the_job_succeeds_quietly_when_prs_accepts(): void
    {
        Http::fake([self::BASE . '*' => Http::response(['received' => true], 200)]);

        (new NotifyPrsTicketStatusChanged($this->prsTicketId))->handle($this->client());

        Http::assertSentCount(1);
    }

    public function test_the_job_ends_without_a_call_for_a_non_prs_ticket(): void
    {
        Http::preventStrayRequests();
        config(['services.prs.callback_url' => '']);

        (new NotifyPrsTicketStatusChanged($this->prsTicketId))->handle($this->client());

        Http::assertNothingSent();
    }

    public function test_the_job_throws_so_the_queue_retries_when_prs_is_unreachable(): void
    {
        Http::fake([self::BASE . '*' => fn () => throw new ConnectionException('tunnel down')]);

        $this->expectException(\RuntimeException::class);

        (new NotifyPrsTicketStatusChanged($this->prsTicketId))->handle($this->client());
    }

    public function test_the_job_throws_so_the_queue_retries_on_a_server_error(): void
    {
        Http::fake([self::BASE . '*' => Http::response(['message' => 'boom'], 500)]);

        $this->expectException(\RuntimeException::class);

        (new NotifyPrsTicketStatusChanged($this->prsTicketId))->handle($this->client());
    }

    public function test_the_job_retries_on_429_rather_than_failing_permanently(): void
    {
        Http::fake([self::BASE . '*' => Http::response(['message' => 'slow down'], 429)]);

        $this->expectException(\RuntimeException::class);

        (new NotifyPrsTicketStatusChanged($this->prsTicketId))->handle($this->client());
    }

    public function test_the_job_declares_a_retry_schedule(): void
    {
        $job = new NotifyPrsTicketStatusChanged($this->prsTicketId);

        $this->assertSame(4, $job->tries);
        $this->assertSame([30, 120, 600], $job->backoff);
    }
}
