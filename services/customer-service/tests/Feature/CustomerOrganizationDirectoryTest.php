<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\CustomerOrganization;
use App\Support\OrganizationName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\CreatesCustomerTables;
use Tests\TestCase;

/**
 * Hospitals (customer organizations): normalization, backfill, provisioning links and the
 * internal lookups ticket-service uses for the Super Admin Customers page.
 */
class CustomerOrganizationDirectoryTest extends TestCase
{
    use CreatesCustomerTables;

    private const SECRET = 'test-internal-secret-0052';

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);
        Mail::fake();
        $this->createCustomerTables();
        config(['services.internal.secret' => self::SECRET]);
    }

    private function headers(): array
    {
        return ['X-Internal-Secret' => self::SECRET];
    }

    private function makeClient(string $name, string $email, ?int $orgId = null, bool $active = true): Client
    {
        $id = DB::table('clients')->insertGetId([
            'client_name' => $name,
            'email' => $email,
            'address' => '',
            'contact_number' => '',
            'status' => $active,
            'organization_id' => $orgId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return Client::findOrFail($id);
    }

    public function test_normalize_ignores_case_punctuation_and_extra_spaces(): void
    {
        $this->assertSame('st luke s medical', OrganizationName::normalize("St. Luke's  Medical"));
        $this->assertSame('makati med', OrganizationName::normalize(' makati med. '));
        $this->assertSame('', OrganizationName::normalize('...'));
    }

    public function test_backfill_groups_clients_by_normalized_name(): void
    {
        // Roll back so the clients exist before the migration runs, as in production.
        $this->hospitalsMigration()->down();
        foreach ([['Makati Med', 'a@makati.test'], ['makati med.', 'b@makati.test'], ['Other Hospital', 'c@other.test']] as [$name, $email]) {
            DB::table('clients')->insert(['client_name' => $name, 'email' => $email, 'address' => '', 'contact_number' => '', 'created_at' => now(), 'updated_at' => now()]);
        }

        $this->hospitalsMigration()->up();

        $this->assertSame(2, DB::table('customer_organizations')->count());
        $a = DB::table('clients')->where('email', 'a@makati.test')->value('organization_id');
        $b = DB::table('clients')->where('email', 'b@makati.test')->value('organization_id');
        $this->assertNotNull($a);
        $this->assertSame($a, $b);
        // The backfill never rewrites client_name.
        $this->assertSame('makati med.', DB::table('clients')->where('email', 'b@makati.test')->value('client_name'));
    }

    public function test_provision_creates_and_reuses_a_hospital_by_normalized_name(): void
    {
        $this->postJson('/api/customers/provision', ['client_name' => "St. Luke's Medical Center", 'email' => 'one@stlukes.test'], $this->headers())
            ->assertStatus(201)->assertJsonPath('status', 'created');
        $this->postJson('/api/customers/provision', ['client_name' => "ST. LUKE'S medical center", 'email' => 'two@stlukes.test'], $this->headers())
            ->assertStatus(201);

        $this->assertSame(1, CustomerOrganization::count());
        $org = CustomerOrganization::first();
        $this->assertSame("St. Luke's Medical Center", $org->name);
        $this->assertSame(2, Client::where('organization_id', $org->id)->count());
        $this->assertSame("St. Luke's Medical Center", Client::where('email', 'two@stlukes.test')->value('client_name'));
    }

    public function test_provision_links_to_the_given_organization_and_rejects_an_unknown_one(): void
    {
        $org = CustomerOrganization::resolveByName('Asian Hospital');

        $this->postJson('/api/customers/provision', ['client_name' => 'Asian Hospital Annex', 'email' => 'annex@asian.test', 'organization_id' => $org->id], $this->headers())
            ->assertStatus(201)->assertJsonPath('organization_id', $org->id);
        $this->assertSame('Asian Hospital', Client::where('email', 'annex@asian.test')->value('client_name'));

        $this->postJson('/api/customers/provision', ['client_name' => 'X', 'email' => 'x@x.test', 'organization_id' => 999999], $this->headers())
            ->assertStatus(422)->assertJsonStructure(['errors' => ['organization_id']]);
    }

    public function test_organization_search_matches_normalized_names_with_account_counts(): void
    {
        $org = CustomerOrganization::resolveByName("St. Luke's Medical Center");
        CustomerOrganization::resolveByName('Makati Medical Center');
        $this->makeClient($org->name, 'a@stlukes.test', $org->id);
        $this->makeClient($org->name, 'b@stlukes.test', $org->id);

        $res = $this->getJson('/api/internal/organizations?search=' . urlencode('St Lukes'), $this->headers())->assertOk();
        $res->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', "St. Luke's Medical Center")
            ->assertJsonPath('data.0.account_count', 2);

        $this->getJson('/api/internal/organizations?search=' . urlencode("St. Luke's"), $this->headers())
            ->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/internal/organizations?search=medical&limit=1', $this->headers())
            ->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/internal/organizations', $this->headers())->assertStatus(422);
    }

    public function test_lookup_returns_the_email_match_and_the_hospital_accounts(): void
    {
        $org = CustomerOrganization::resolveByName('Makati Medical Center');
        $owner = $this->makeClient($org->name, 'Owner@Makati.test', $org->id, false);
        $this->makeClient($org->name, 'second@makati.test', $org->id);

        $this->getJson('/api/internal/customers/lookup?email=' . urlencode('  owner@makati.TEST ') . '&organization_name=' . urlencode('makati medical center.'), $this->headers())
            ->assertOk()
            ->assertJsonPath('email_match.client_id', $owner->id)
            ->assertJsonPath('email_match.status', 'inactive')
            ->assertJsonPath('email_match.organization_id', $org->id)
            ->assertJsonPath('organization.id', $org->id)
            ->assertJsonCount(2, 'organization_accounts');

        $this->getJson('/api/internal/customers/lookup?email=new@new.test&organization_name=Brand%20New', $this->headers())
            ->assertOk()
            ->assertJsonPath('email_match', null)
            ->assertJsonPath('organization', null)
            ->assertJsonCount(0, 'organization_accounts');
    }

    public function test_by_ids_resolves_accounts_and_search_finds_ids(): void
    {
        $org = CustomerOrganization::resolveByName("St. Luke's Medical Center");
        $a = $this->makeClient($org->name, 'alpha@stlukes.test', $org->id);
        $b = $this->makeClient('Lone Clinic', 'beta@lone.test');

        $this->getJson("/api/internal/customers/by-ids?ids={$a->id},{$b->id}", $this->headers())
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonFragment(['client_id' => $a->id, 'organization_name' => "St. Luke's Medical Center"]);

        $this->getJson('/api/internal/customers/by-ids?search=' . urlencode('st lukes'), $this->headers())
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.client_id', $a->id);
        $this->getJson('/api/internal/customers/by-ids?search=beta@', $this->headers())
            ->assertOk()->assertJsonPath('data.0.client_id', $b->id);

        $tooMany = implode(',', range(1, 101));
        $this->getJson("/api/internal/customers/by-ids?ids={$tooMany}", $this->headers())->assertStatus(422);
        $this->getJson('/api/internal/customers/by-ids', $this->headers())->assertStatus(422);
    }

    public function test_internal_routes_require_the_secret(): void
    {
        foreach (['/api/internal/organizations?search=a', '/api/internal/customers/lookup?email=a@a.test', '/api/internal/customers/by-ids?ids=1'] as $url) {
            $this->getJson($url)->assertStatus(401);
            $this->getJson($url, ['X-Internal-Secret' => 'wrong'])->assertStatus(401);
        }
    }
}
