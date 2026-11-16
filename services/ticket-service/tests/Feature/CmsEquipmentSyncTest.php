<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Services\Cms\CmsEquipmentSyncService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 3.1: TS pulls customers' equipment from the CMS (source of truth), read only.
 */
class CmsEquipmentSyncTest extends TestCase
{
    use DatabaseTransactions;

    private const BASE = 'https://cms.test/api/contract/integrations/v1/ts';
    private const KEY = 'test-cms-key';

    private string $uid;
    private Client $client;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.cms_ts.base_url' => self::BASE,
            'services.cms_ts.key' => self::KEY,
            'services.internal.secret' => 'test-internal',
            'services.customer.url' => 'http://customer-service.test',
        ]);
        Cache::forget(CmsEquipmentSyncService::STATUS_KEY);
        Cache::forget(CmsEquipmentSyncService::CURSOR_KEY);

        $this->uid = uniqid();
        $this->client = Client::create([
            'client_name' => "CMS Customer {$this->uid}",
            'email' => "cms.{$this->uid}@example.test",
            'contact_number' => '',
            'address' => '',
        ]);

        // Mirrors the real data: the CMS says "Main Office", TS renamed it "SBSI Makati Branch".
        if (!DB::table('branches')->where('slug', 'sbsi-makati-branch')->exists()) {
            DB::table('branches')->insert([
                'slug' => 'sbsi-makati-branch', 'name' => 'SBSI Makati Branch', 'code' => 'MKT',
                'region' => 'NCR', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    private function row(array $over = [], array $equipment = [], array $customer = []): array
    {
        $eqUid = $over['equipment_uid'] ?? "EQP-{$this->uid}";

        return array_merge([
            'equipment_uid' => $eqUid,
            'customer_uid' => "BP-{$this->uid}",
            'contract_code' => "CTR-{$this->uid}",
            'approval_status' => 'Approved',
            'lifecycle_status' => 'active',
            'end_date' => now()->addYear()->toDateString(),
            'sbsi_branch' => 'Main Office',
            'updated_at' => '2026-11-15T12:00:00+00:00',
            'equipment' => array_merge([
                'equipment_uid' => $eqUid,
                'equipment_name' => 'Sysmex XN-1000 Analyzer',
                'brand' => 'Sysmex',
                'model' => 'XN-1000',
                'serial_number' => "SN-{$this->uid}",
                'item_code' => 'ITM-0041',
            ], $equipment),
            'customer' => array_merge([
                'customer_uid' => "BP-{$this->uid}",
                'customer_name' => $this->client->client_name,
                'customer_email' => $this->client->email,
                'contact_number' => null,
                'address' => null,
            ], $customer),
        ], $over);
    }

    private function fakeCms(array $rows, int $status = 200): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([
            'cms.test/*' => Http::response(['data' => $rows, 'meta' => ['current_page' => 1, 'last_page' => 1]], $status),
            'customer-service.test/*' => Http::response(['id' => $this->client->id, 'status' => 'exists'], 200),
            '*' => Http::response(['status' => 'success'], 200),
        ]);
    }

    private function machine(): ?object
    {
        return DB::table('machines')->where('serial_number', "SN-{$this->uid}")->first();
    }

    public function test_sync_creates_a_machine_keyed_by_equipment_uid_with_the_shared_key_header(): void
    {
        $this->fakeCms([$this->row()]);

        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame('synced', $result['outcome']);
        $this->assertSame('full', $result['mode']);
        $this->assertSame(1, $result['summary']['created']);

        $machine = $this->machine();
        $this->assertSame("EQP-{$this->uid}", $machine->equipment_uid);
        $this->assertSame('Sysmex XN-1000 Analyzer', $machine->machine_name);
        $this->assertSame('XN-1000', $machine->model);
        $this->assertSame($this->client->id, (int) $machine->client_ID);
        $this->assertSame('sbsi-makati-branch', $machine->branch_id);
        $this->assertSame("BP-{$this->uid}", $machine->cms_customer_uid);
        $this->assertEquals(1, $machine->cms_contract_active);

        Http::assertSent(fn (HttpRequest $r) => str_starts_with($r->url(), self::BASE . '/sync')
            && $r->method() === 'GET'
            && $r->header('X-Internal-Secret') === [self::KEY]);
        // No welcome email by default: the account is created silently.
        Http::assertSent(fn (HttpRequest $r) => str_contains($r->url(), 'customer-service.test/api/customers/provision')
            && $r['send_welcome_email'] === false);
    }

    public function test_failed_rows_keep_the_cursor_so_the_next_run_retries_them(): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([
            'cms.test/*' => Http::response(['data' => [$this->row()], 'meta' => ['last_page' => 1]], 200),
            'customer-service.test/*' => Http::response(['message' => 'Internal endpoint is not configured.'], 503),
        ]);

        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame(1, $result['summary']['failed']);
        $this->assertNull(Cache::get(CmsEquipmentSyncService::CURSOR_KEY));

        $this->fakeCms([$this->row()]);
        $retry = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame('full', $retry['mode']);
        $this->assertSame(1, $retry['summary']['created']);
    }

    public function test_welcome_email_can_be_turned_back_on(): void
    {
        config(['services.cms_ts.send_welcome_email' => true]);
        $this->fakeCms([$this->row()]);

        app(CmsEquipmentSyncService::class)->run();

        Http::assertSent(fn (HttpRequest $r) => str_contains($r->url(), 'customers/provision') && $r['send_welcome_email'] === true);
    }

    public function test_second_run_is_incremental_and_unchanged_rows_stay_unchanged(): void
    {
        $this->fakeCms([$this->row()]);
        app(CmsEquipmentSyncService::class)->run();

        $this->fakeCms([$this->row()]);
        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame('incremental', $result['mode']);
        $this->assertSame(1, $result['summary']['unchanged']);
        Http::assertSent(fn (HttpRequest $r) => str_contains(urldecode($r->url()), 'updated_since=2026-11-15T12:00:00+00:00'));
    }

    public function test_matches_an_existing_crms_machine_by_serial_and_attaches_the_equipment_uid(): void
    {
        $categoryId = DB::table('machine_categories')->insertGetId(['category_name' => "Cat {$this->uid}", 'created_at' => now(), 'updated_at' => now()]);
        $id = DB::table('machines')->insertGetId([
            'category_ID' => $categoryId, 'client_ID' => $this->client->id, 'machine_name' => 'Old name',
            'serial_number' => "SN-{$this->uid}", 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->fakeCms([$this->row()]);

        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame(1, $result['summary']['updated']);
        $machine = $this->machine();
        $this->assertSame($id, (int) $machine->machine_ID);
        $this->assertSame("EQP-{$this->uid}", $machine->equipment_uid);
        $this->assertSame('Sysmex XN-1000 Analyzer', $machine->machine_name);
    }

    public function test_a_corrected_serial_follows_the_equipment_uid(): void
    {
        $this->fakeCms([$this->row()]);
        app(CmsEquipmentSyncService::class)->run();
        $id = (int) $this->machine()->machine_ID;

        $this->fakeCms([$this->row([], ['serial_number' => "SN-FIXED-{$this->uid}"])]);
        app(CmsEquipmentSyncService::class)->run(full: true);

        $this->assertSame("SN-FIXED-{$this->uid}", DB::table('machines')->where('machine_ID', $id)->value('serial_number'));
    }

    public function test_missing_equipment_name_falls_back_to_brand_model_then_item_code(): void
    {
        $this->fakeCms([$this->row([], ['equipment_name' => null, 'brand' => null, 'model' => null])]);

        app(CmsEquipmentSyncService::class)->run();

        $this->assertSame('ITM-0041', $this->machine()->machine_name);
    }

    public function test_customer_without_email_is_skipped_and_counted(): void
    {
        $this->fakeCms([$this->row([], [], ['customer_email' => null])]);

        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame(1, $result['summary']['skipped']);
        $this->assertSame(['no_customer_email' => 1], $result['summary']['skipped_reasons']);
        $this->assertNull($this->machine());
        Http::assertNotSent(fn (HttpRequest $r) => str_contains($r->url(), 'customer-service.test'));
    }

    public function test_full_sync_marks_machines_the_cms_no_longer_lists_inactive_and_hides_them_from_customers(): void
    {
        $other = $this->row(['equipment_uid' => "EQP-B-{$this->uid}"], ['equipment_uid' => "EQP-B-{$this->uid}", 'serial_number' => "SN-B-{$this->uid}"]);
        $this->fakeCms([$this->row(), $other]);
        app(CmsEquipmentSyncService::class)->run();

        $this->fakeCms([$other]);
        $result = app(CmsEquipmentSyncService::class)->run(full: true);

        $this->assertGreaterThanOrEqual(1, $result['summary']['deactivated']);
        $this->assertEquals(0, $this->machine()->cms_contract_active);

        $labels = collect($this->actingAs($this->client, 'api')->getJson('/api/ticket-form-options')->json('equipment_options'))->pluck('label')->all();
        $this->assertNotContains("Sysmex XN-1000 Analyzer - SN-{$this->uid}", $labels);
        $this->assertContains("Sysmex XN-1000 Analyzer - SN-B-{$this->uid}", $labels);
    }

    public function test_an_empty_full_read_deactivates_nothing(): void
    {
        $this->fakeCms([$this->row()]);
        app(CmsEquipmentSyncService::class)->run();

        $this->fakeCms([]);
        $result = app(CmsEquipmentSyncService::class)->run(full: true);

        $this->assertSame(0, $result['summary']['deactivated']);
        $this->assertEquals(1, $this->machine()->cms_contract_active);
    }

    /**
     * @dataProvider cmsDownResponses
     */
    public function test_cms_down_keeps_local_machines_and_records_a_banner_state(int $status, string $reason): void
    {
        $this->fakeCms([$this->row()]);
        app(CmsEquipmentSyncService::class)->run();
        $before = $this->machine();

        $this->fakeCms([], $status);
        $result = app(CmsEquipmentSyncService::class)->run(full: true);

        $this->assertSame('failed', $result['outcome']);
        $this->assertEquals($before, $this->machine());
        $status = app(CmsEquipmentSyncService::class)->status();
        $this->assertFalse($status['reachable']);
        $this->assertSame($reason, $status['reason']);
        $this->assertNotNull($status['last_success_at']);
    }

    public static function cmsDownResponses(): array
    {
        return [
            'forbidden' => [403, 'forbidden'],
            'server error' => [500, 'unreachable'],
            'cloudflare tunnel gone' => [530, 'unreachable'],
        ];
    }

    public function test_timeout_is_caught_and_recorded(): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake(['cms.test/*' => fn () => throw new ConnectionException('cURL error 28: Operation timed out')]);

        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame('failed', $result['outcome']);
        $this->assertSame('unreachable', app(CmsEquipmentSyncService::class)->status()['reason']);
    }

    public function test_blank_config_short_circuits_without_any_request(): void
    {
        config(['services.cms_ts.base_url' => '']);
        Http::fake();

        $result = app(CmsEquipmentSyncService::class)->run();

        $this->assertSame('not_configured', $result['outcome']);
        Http::assertNothingSent();
    }

    public function test_status_endpoint_hides_internals_from_customers(): void
    {
        $this->fakeCms([], 530);
        app(CmsEquipmentSyncService::class)->run();

        $this->actingAs($this->client, 'api')->getJson('/api/integrations/cms/status')
            ->assertOk()
            ->assertJsonPath('reachable', false)
            ->assertJsonMissingPath('reason')
            ->assertJsonMissingPath('summary');
    }

    public function test_customers_cannot_trigger_a_sync(): void
    {
        Http::fake();

        $this->actingAs($this->client, 'api')->postJson('/api/integrations/cms/sync')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_command_exits_cleanly_when_cms_is_down(): void
    {
        $this->fakeCms([], 530);

        $this->artisan('cms:sync')->assertExitCode(0);
    }
}
