<?php

namespace Tests\Feature;

use App\Models\Client;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * CRMS machine sync: POST /internal/crms/machines registers a customer's machine
 * (name, brand, serial, customer name and email, SBSI branch).
 */
class CrmsMachineSyncTest extends TestCase
{
    use DatabaseTransactions;

    private const SECRET = 'test-crms-secret';

    private string $uid;
    private Client $client;
    private string $branchSlug;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.internal.secret' => self::SECRET, 'services.customer.url' => 'http://customer-service.test']);

        $this->uid = uniqid();
        $this->client = Client::create([
            'client_name' => "CRMS Customer {$this->uid}",
            'email' => "crms.{$this->uid}@example.test",
            'contact_number' => '',
            'address' => '',
        ]);

        $this->branchSlug = "crms-test-{$this->uid}";
        DB::table('branches')->insert([
            'slug' => $this->branchSlug,
            'name' => "SBSI Testville{$this->uid} Branch",
            'code' => 'T' . substr($this->uid, -5),
            'region' => 'NCR',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->fakeProvision($this->client->id, 'exists');
    }

    private function fakeProvision(int $id, string $status, int $http = 200): void
    {
        // A second Http::fake() only appends stubs behind the first, so start from a clean factory.
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([
            'customer-service.test/*' => Http::response(['id' => $id, 'status' => $status], $http),
            '*' => Http::response(['status' => 'success'], 200),
        ]);
    }

    private function record(array $over = []): array
    {
        return array_merge([
            'machine_name' => 'Hematology Analyzer',
            'brand' => 'Sysmex',
            'serial_number' => "SN-{$this->uid}",
            'customer_name' => $this->client->client_name,
            'customer_email' => $this->client->email,
            'branch' => "SBSI Testville{$this->uid} Branch",
        ], $over);
    }

    private function sync(array $body, ?string $secret = self::SECRET)
    {
        return $this->postJson('/api/internal/crms/machines', $body, $secret === null ? [] : ['X-Internal-Secret' => $secret]);
    }

    public function test_requires_the_internal_secret(): void
    {
        $this->sync($this->record(), null)->assertStatus(401);
        $this->sync($this->record(), 'wrong')->assertStatus(401);
        $this->assertDatabaseMissing('machines', ['serial_number' => "SN-{$this->uid}"]);
    }

    public function test_fails_closed_without_a_configured_secret(): void
    {
        config(['services.internal.secret' => '']);
        $this->sync($this->record())->assertStatus(503);
    }

    public function test_creates_a_machine_for_the_provisioned_customer(): void
    {
        $this->sync($this->record())
            ->assertStatus(201)
            ->assertJson(['status' => 'created', 'client_ID' => $this->client->id, 'branch_id' => $this->branchSlug]);

        $this->assertDatabaseHas('machines', [
            'serial_number' => "SN-{$this->uid}",
            'machine_name' => 'Hematology Analyzer',
            'brand' => 'Sysmex',
            'client_ID' => $this->client->id,
            'branch_id' => $this->branchSlug,
        ]);

        Http::assertSent(fn (HttpRequest $r) => $r->url() === 'http://customer-service.test/api/customers/provision'
            && $r->hasHeader('X-Internal-Secret', self::SECRET)
            && $r['email'] === $this->client->email
            && $r['client_name'] === $this->client->client_name);
    }

    public function test_resending_the_same_record_is_unchanged_and_changes_update(): void
    {
        $this->sync($this->record())->assertStatus(201);
        $this->sync($this->record())->assertStatus(200)->assertJson(['status' => 'unchanged']);
        $this->sync($this->record(['machine_name' => 'Hematology Analyzer XN-1000']))
            ->assertStatus(200)->assertJson(['status' => 'updated']);

        $this->assertSame(1, DB::table('machines')->where('serial_number', "SN-{$this->uid}")->count());
        $this->assertDatabaseHas('machines', ['serial_number' => "SN-{$this->uid}", 'machine_name' => 'Hematology Analyzer XN-1000']);
    }

    public function test_matches_the_branch_by_code_slug_or_short_name(): void
    {
        foreach (['T' . substr($this->uid, -5), $this->branchSlug, "testville{$this->uid}"] as $i => $value) {
            $this->sync($this->record(['serial_number' => "SN-{$this->uid}-{$i}", 'branch' => $value]))
                ->assertStatus(201)->assertJson(['branch_id' => $this->branchSlug]);
        }
    }

    public function test_unknown_branch_and_missing_fields_are_rejected(): void
    {
        $this->sync($this->record(['branch' => 'Atlantis']))->assertStatus(422)->assertJsonPath('status', 'failed');
        $this->sync($this->record(['customer_email' => 'not-an-email', 'serial_number' => '']))
            ->assertStatus(422)->assertJsonStructure(['errors' => ['customer_email', 'serial_number']]);
        Http::assertNothingSent();
    }

    public function test_provisioning_failure_returns_502_and_saves_nothing(): void
    {
        $this->fakeProvision(0, 'error', 500);
        $this->sync($this->record())->assertStatus(502);
        $this->assertDatabaseMissing('machines', ['serial_number' => "SN-{$this->uid}"]);
    }

    public function test_batch_reports_each_record(): void
    {
        $response = $this->sync(['machines' => [
            $this->record(),
            $this->record(['serial_number' => "SN-{$this->uid}-B", 'brand' => null]),
            $this->record(['serial_number' => "SN-{$this->uid}-C", 'branch' => 'Atlantis']),
        ]]);

        $response->assertStatus(200)
            ->assertJson(['summary' => ['received' => 3, 'created' => 2, 'updated' => 0, 'unchanged' => 0, 'failed' => 1]])
            ->assertJsonPath('results.2.index', 2)
            ->assertJsonPath('results.2.status', 'failed');

        $this->sync(['machines' => []])->assertStatus(422);
    }

    public function test_lists_active_branches(): void
    {
        $this->getJson('/api/internal/crms/branches', ['X-Internal-Secret' => self::SECRET])
            ->assertOk()
            ->assertJsonFragment(['slug' => $this->branchSlug]);
        $this->getJson('/api/internal/crms/branches')->assertStatus(401);
    }
}
