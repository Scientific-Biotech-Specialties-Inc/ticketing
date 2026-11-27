<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Super Admin Customers page API: create an item with its account, the duplicate guards, the
 * list, and access control. customer-service is faked; ticket-service only writes machines.
 */
class SuperAdminCustomerTest extends TestCase
{
    use DatabaseTransactions;

    private const CUSTOMER = 'http://customer-service.test';

    private string $uid;
    private string $branch;
    private string $otherBranch;
    private Employee $superAdmin;
    private Employee $admin;
    private Client $existing;

    /** What the fake customer-service answers, set per test. */
    private array $lookup = ['email_match' => null, 'organization' => null, 'organization_accounts' => []];
    private array $provision = [];
    private array $accounts = [];
    private bool $customerDown = false;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.customer.url' => self::CUSTOMER, 'services.internal.secret' => 'test-secret-0052']);

        $this->uid = substr(uniqid(), -8);
        $this->branch = "sac-a-{$this->uid}";
        $this->otherBranch = "sac-b-{$this->uid}";
        foreach ([[$this->branch, true], [$this->otherBranch, true], ["sac-off-{$this->uid}", false]] as $i => [$slug, $active]) {
            DB::table('branches')->insert([
                'slug' => $slug, 'name' => "SAC Branch {$i} {$this->uid}", 'code' => "S{$i}" . substr($this->uid, -4),
                'region' => 'NCR', 'is_active' => $active, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        DB::table('employees')->whereIn('emp_id', [89521, 89522])->delete();
        $this->superAdmin = Employee::create([
            'emp_id' => 89521, 'first_name' => 'Sue', 'last_name' => 'Per', 'email' => "sa.{$this->uid}@example.test",
            'role' => 'superadmin', 'department' => 'Executive', 'is_active' => 1, 'password_hash' => bcrypt('x'),
        ]);
        $this->admin = Employee::create([
            'emp_id' => 89522, 'first_name' => 'Ad', 'last_name' => 'Min', 'email' => "ad.{$this->uid}@example.test",
            'role' => 'admin', 'department' => 'Ops', 'is_active' => 1, 'password_hash' => bcrypt('x'),
        ]);

        $this->existing = Client::create([
            'client_name' => "Existing Hospital {$this->uid}", 'email' => "existing.{$this->uid}@example.test",
            'contact_number' => '', 'address' => '',
        ]);
        $this->accounts[$this->existing->id] = $this->account($this->existing->id, $this->existing->email, "Existing Hospital {$this->uid}");

        $this->fakeCustomerService();
    }

    private function account(int $id, string $email, string $hospital): array
    {
        return ['client_id' => $id, 'email' => $email, 'client_name' => $hospital, 'organization_id' => 7, 'organization_name' => $hospital];
    }

    private function fakeCustomerService(): void
    {
        Http::fake(function (HttpRequest $request) {
            if (!str_starts_with($request->url(), self::CUSTOMER)) {
                return Http::response(['status' => 'success'], 200);
            }
            if ($this->customerDown) {
                return Http::response(['message' => 'down'], 500);
            }

            $path = parse_url($request->url(), PHP_URL_PATH);
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            return match ($path) {
                '/api/internal/customers/lookup' => Http::response($this->lookup),
                '/api/internal/organizations' => Http::response(['data' => [['id' => 7, 'name' => 'Makati Med', 'account_count' => 2]]]),
                '/api/internal/customers/by-ids' => Http::response(['data' => isset($query['search'])
                    ? array_values(array_filter($this->accounts, fn ($a) => str_contains($a['email'], (string) $query['search'])))
                    : array_values(array_filter($this->accounts, fn ($a) => in_array((string) $a['client_id'], explode(',', (string) ($query['ids'] ?? '')), true)))]),
                '/api/customers/provision' => Http::response($this->provision, ($this->provision['status'] ?? '') === 'created' ? 201 : 200),
                default => Http::response([], 404),
            };
        });
    }

    /** Make the fake provision call create a real client row, as customer-service would. */
    private function provisionCreates(string $email, string $hospital): Client
    {
        $client = Client::create(['client_name' => $hospital, 'email' => $email, 'contact_number' => '', 'address' => '']);
        $this->provision = ['id' => $client->id, 'status' => 'created', 'organization_id' => 7];
        $this->accounts[$client->id] = $this->account($client->id, $email, $hospital);

        return $client;
    }

    private function body(array $over = []): array
    {
        return array_merge([
            'asset_type' => 'equipment',
            'item_name' => 'Hematology Analyzer',
            'brand' => 'Sysmex XN-1000',
            'serial_number' => "SAC-SN-{$this->uid}",
            'branch_id' => $this->branch,
            'email' => "new.{$this->uid}@example.test",
            'organization_name' => "New Hospital {$this->uid}",
            'mode' => 'new',
        ], $over);
    }

    private function asSuper()
    {
        return $this->actingAs($this->superAdmin, 'api');
    }

    public function test_new_hospital_and_email_creates_account_and_service_item(): void
    {
        $client = $this->provisionCreates("new.{$this->uid}@example.test", "New Hospital {$this->uid}");

        $this->asSuper()->postJson('/api/superadmin/customers', $this->body())
            ->assertStatus(201)
            ->assertJsonPath('account_status', 'created')
            ->assertJsonPath('welcome_email_sent', true)
            ->assertJsonPath('item.type', 'service')
            ->assertJsonPath('item.hospital_name', "New Hospital {$this->uid}")
            ->assertJsonPath('item.branch_id', $this->branch);

        $this->assertDatabaseHas('machines', [
            'serial_number' => "SAC-SN-{$this->uid}", 'client_ID' => $client->id, 'asset_type' => 'equipment',
            'branch_id' => $this->branch, 'brand' => 'Sysmex XN-1000', 'status' => 'Active',
        ]);
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/api/customers/provision')
            && $r->hasHeader('X-Internal-Secret', 'test-secret-0052')
            && $r['client_name'] === "New Hospital {$this->uid}");
    }

    public function test_attach_adds_only_a_machine_to_the_existing_account(): void
    {
        $this->lookup['email_match'] = ['client_id' => $this->existing->id, 'client_name' => 'Existing', 'email' => $this->existing->email, 'status' => 'active', 'organization_id' => 7];

        $this->asSuper()->postJson('/api/superadmin/customers', $this->body([
            'email' => strtoupper($this->existing->email), 'mode' => 'attach', 'attach_client_id' => $this->existing->id,
        ]))->assertStatus(201)->assertJsonPath('account_status', 'attached')->assertJsonPath('welcome_email_sent', false);

        $this->assertDatabaseHas('machines', ['serial_number' => "SAC-SN-{$this->uid}", 'client_ID' => $this->existing->id]);
        Http::assertNotSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/api/customers/provision'));
    }

    public function test_attach_to_a_different_account_is_a_mismatch(): void
    {
        $this->lookup['email_match'] = ['client_id' => $this->existing->id, 'client_name' => 'Existing', 'email' => $this->existing->email, 'status' => 'active', 'organization_id' => 7];

        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['mode' => 'attach', 'attach_client_id' => 999999999]))
            ->assertStatus(409)->assertJsonPath('code', 'attach_mismatch');
        $this->assertDatabaseMissing('machines', ['serial_number' => "SAC-SN-{$this->uid}"]);
    }

    public function test_server_refuses_new_mode_for_an_existing_email(): void
    {
        $this->lookup['email_match'] = ['client_id' => $this->existing->id, 'client_name' => 'Existing', 'email' => $this->existing->email, 'status' => 'inactive', 'organization_id' => 7];
        $this->lookup['organization_accounts'] = [['client_id' => 1, 'email' => 'x@x.test']];

        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['email' => $this->existing->email]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'email_exists')
            ->assertJsonPath('account.client_id', $this->existing->id);
        Http::assertNotSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/api/customers/provision'));
    }

    public function test_hospital_with_accounts_needs_confirmation_then_creates_a_second_account(): void
    {
        $this->lookup['organization'] = ['id' => 7, 'name' => 'Makati Med'];
        $this->lookup['organization_accounts'] = [['client_id' => $this->existing->id, 'email' => $this->existing->email]];

        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['organization_id' => 7, 'organization_name' => null]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'hospital_has_accounts')
            ->assertJsonPath('accounts.0.email', $this->existing->email);
        $this->assertDatabaseMissing('machines', ['serial_number' => "SAC-SN-{$this->uid}"]);

        $client = $this->provisionCreates("new.{$this->uid}@example.test", 'Makati Med');
        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['organization_id' => 7, 'confirm_same_hospital' => true]))
            ->assertStatus(201)->assertJsonPath('account_status', 'created');

        $this->assertDatabaseHas('machines', ['serial_number' => "SAC-SN-{$this->uid}", 'client_ID' => $client->id]);
        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/api/customers/provision')
            && $r['organization_id'] === 7 && $r['client_name'] === 'Makati Med');
    }

    public function test_duplicate_serial_is_rejected_and_the_existing_machine_is_unchanged(): void
    {
        $this->asSuper();
        $categoryId = app(\App\Services\CrmsMachineSyncService::class)->defaultCategoryId();
        DB::table('machines')->insert([
            'client_ID' => $this->existing->id, 'category_ID' => $categoryId, 'machine_name' => 'Old Analyzer',
            'serial_number' => "SAC-SN-{$this->uid}", 'branch_id' => $this->otherBranch, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->postJson('/api/superadmin/customers', $this->body())
            ->assertStatus(409)
            ->assertJsonPath('code', 'serial_taken')
            ->assertJsonPath('hospital_name', "Existing Hospital {$this->uid}")
            ->assertJsonPath('message', "Serial SAC-SN-{$this->uid} is already registered to Existing Hospital {$this->uid}");

        $this->assertDatabaseHas('machines', ['serial_number' => "SAC-SN-{$this->uid}", 'machine_name' => 'Old Analyzer', 'client_ID' => $this->existing->id, 'branch_id' => $this->otherBranch]);
        Http::assertNotSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/api/customers/provision'));
    }

    public function test_software_item_gets_a_generated_serial_and_the_software_category(): void
    {
        $client = $this->provisionCreates("new.{$this->uid}@example.test", "New Hospital {$this->uid}");

        $res = $this->asSuper()->postJson('/api/superadmin/customers', $this->body([
            'asset_type' => 'software', 'item_name' => 'LIS Pro', 'brand' => null, 'serial_number' => null,
        ]))->assertStatus(201)->assertJsonPath('item.type', 'software')->assertJsonPath('item.serial_number', null);

        $machine = DB::table('machines')->where('machine_ID', $res->json('item.machine_id'))->first();
        $this->assertMatchesRegularExpression("/^SW-{$client->id}-[A-Z0-9]{8}$/", $machine->serial_number);
        $this->assertSame('software', $machine->asset_type);
        $this->assertSame('Software', DB::table('machine_categories')->where('category_ID', $machine->category_ID)->value('category_name'));
    }

    public function test_inactive_or_unknown_branch_and_missing_fields_are_rejected(): void
    {
        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['branch_id' => "sac-off-{$this->uid}"]))
            ->assertStatus(422)->assertJsonStructure(['errors' => ['branch_id']]);
        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['branch_id' => 'atlantis']))->assertStatus(422);
        $this->asSuper()->postJson('/api/superadmin/customers', $this->body(['serial_number' => '', 'organization_name' => '']))
            ->assertStatus(422)->assertJsonStructure(['errors' => ['serial_number', 'organization_name']]);
        Http::assertNothingSent();
    }

    public function test_customer_service_down_answers_502_and_writes_no_machine(): void
    {
        $this->customerDown = true;

        $this->asSuper()->postJson('/api/superadmin/customers', $this->body())
            ->assertStatus(502)->assertJsonPath('message', 'Customer service is unavailable, please try again.');
        $this->assertDatabaseMissing('machines', ['serial_number' => "SAC-SN-{$this->uid}"]);

        $this->asSuper()->getJson('/api/superadmin/customers/organizations?search=mak')->assertStatus(502);
        $this->asSuper()->postJson('/api/superadmin/customers/check', ['email' => 'a@a.test'])->assertStatus(502);
    }

    public function test_check_and_organization_search_proxy_customer_service(): void
    {
        $this->lookup['organization'] = ['id' => 7, 'name' => 'Makati Med'];
        $this->lookup['organization_accounts'] = [['client_id' => 1, 'email' => 'a@makati.test']];

        $this->asSuper()->postJson('/api/superadmin/customers/check', ['email' => ' A@Makati.test ', 'organization_name' => 'makati med'])
            ->assertOk()->assertJsonPath('organization.id', 7)->assertJsonCount(1, 'organization_accounts');
        Http::assertSent(fn (HttpRequest $r) => str_contains($r->url(), '/api/internal/customers/lookup')
            && str_contains($r->url(), 'email=a%40makati.test'));

        $this->asSuper()->getJson('/api/superadmin/customers/organizations?search=mak')
            ->assertOk()->assertJsonPath('data.0.account_count', 2);
    }

    public function test_list_follows_branch_type_search_and_contract_status(): void
    {
        $this->asSuper();
        $categoryId = app(\App\Services\CrmsMachineSyncService::class)->defaultCategoryId();
        $base = ['client_ID' => $this->existing->id, 'category_ID' => $categoryId, 'created_at' => now(), 'updated_at' => now()];
        DB::table('machines')->insert([
            $base + ['machine_name' => "Active {$this->uid}", 'serial_number' => "L1-{$this->uid}", 'branch_id' => $this->branch, 'asset_type' => 'equipment', 'cms_contract_active' => 1, 'contract_end_date' => now()->addYear()->toDateString(), 'contract_code' => 'C-1'],
            $base + ['machine_name' => "Expired {$this->uid}", 'serial_number' => "L2-{$this->uid}", 'branch_id' => $this->branch, 'asset_type' => 'equipment', 'cms_contract_active' => 1, 'contract_end_date' => now()->subDay()->toDateString(), 'contract_code' => null],
            $base + ['machine_name' => "Soft {$this->uid}", 'serial_number' => "SW-X-{$this->uid}", 'branch_id' => $this->otherBranch, 'asset_type' => 'software', 'cms_contract_active' => null, 'contract_end_date' => null, 'contract_code' => null],
        ]);

        $res = $this->getJson("/api/superadmin/customers?branch_id={$this->branch}&search={$this->uid}")->assertOk();
        $res->assertJsonPath('meta.total', 2);
        $statuses = collect($res->json('data'))->pluck('contract_status', 'item_name');
        $this->assertSame('active', $statuses["Active {$this->uid}"]);
        $this->assertSame('expired', $statuses["Expired {$this->uid}"]);
        $this->assertSame($this->existing->email, $res->json('data.0.email'));
        $this->assertSame("SAC Branch 0 {$this->uid}", $res->json('data.0.branch_name'));

        $soft = $this->getJson("/api/superadmin/customers?type=software&search={$this->uid}")->assertOk();
        $soft->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.serial_number', null)->assertJsonPath('data.0.contract_status', 'none');

        $this->getJson("/api/superadmin/customers?contract_status=expired&search={$this->uid}")->assertOk()->assertJsonPath('meta.total', 1);
        $this->getJson("/api/superadmin/customers?search={$this->uid}&per_page=1&page=2")->assertOk()
            ->assertJsonPath('meta.total', 3)->assertJsonCount(1, 'data');

        // Searching by the account email finds all of that account's items through customer-service.
        $this->getJson('/api/superadmin/customers?search=' . urlencode($this->existing->email))->assertOk()->assertJsonPath('meta.total', 3);

        $this->getJson('/api/superadmin/customers?per_page=500')->assertStatus(422);
        $this->getJson('/api/superadmin/customers?type=hardware')->assertStatus(422);
    }

    public function test_list_still_loads_when_customer_service_is_down(): void
    {
        $this->asSuper();
        $categoryId = app(\App\Services\CrmsMachineSyncService::class)->defaultCategoryId();
        DB::table('machines')->insert(['client_ID' => $this->existing->id, 'category_ID' => $categoryId, 'machine_name' => "Down {$this->uid}", 'serial_number' => "D1-{$this->uid}", 'branch_id' => $this->branch, 'created_at' => now(), 'updated_at' => now()]);
        $this->customerDown = true;

        $this->getJson("/api/superadmin/customers?search={$this->uid}")->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('meta.directory_available', false)
            ->assertJsonPath('data.0.email', null);
    }

    public function test_every_route_is_superadmin_only(): void
    {
        $routes = [
            ['getJson', '/api/superadmin/customers', []],
            ['getJson', '/api/superadmin/customers/organizations?search=a', []],
            ['postJson', '/api/superadmin/customers/check', ['email' => 'a@a.test']],
            ['postJson', '/api/superadmin/customers', $this->body()],
        ];

        foreach ($routes as [$method, $url, $data]) {
            $this->actingAs($this->admin, 'api')->{$method}($url, $data)->assertStatus(403);
        }

        $this->app['auth']->forgetGuards();
        foreach ($routes as [$method, $url, $data]) {
            $this->{$method}($url, $data)->assertStatus(401);
        }
        Http::assertNothingSent();
    }
}
