<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Services\CustomerAssetService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0047: customers report every problem against one of their own equipment or software items,
 * and the item decides the category (equipment is Service, software is Software).
 */
class CustomerAssetIntakeTest extends TestCase
{
    use DatabaseTransactions;

    private int $service;
    private int $software;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open']);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 2], ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]);
        $this->service = $this->category('Service');
        $this->software = $this->category('Software');
        if (!DB::table('machine_categories')->where('category_name', 'Software')->exists()) {
            DB::table('machine_categories')->insert(['category_name' => 'Software', 'created_at' => now(), 'updated_at' => now()]);
        }

        Http::fake([
            '*/ticket-configurations/limits' => Http::response(['value' => ['isUnlimited' => true, 'limit' => 100]], 200),
            '*' => Http::response([], 200),
        ]);
    }

    private function category(string $name): int
    {
        DB::table('problem_categories')->updateOrInsert(
            ['category_name' => $name, 'branch_id' => null],
            ['is_active' => 1, 'updated_at' => now()]
        );

        return (int) DB::table('problem_categories')->where('category_name', $name)->whereNull('branch_id')->value('problem_category_ID');
    }

    private function client(): Client
    {
        $uid = uniqid();
        return Client::create([
            'client_name' => "Asset Hospital {$uid}",
            'email' => "asset.{$uid}@client.test",
            'contact_number' => '0000000000',
            'address' => '1 Test Way',
        ]);
    }

    private function equipment(Client $client, ?string $status = 'active'): int
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            return DB::table('machines')->insertGetId([
                'category_ID' => DB::table('machine_categories')->value('category_ID'),
                'client_ID' => $client->id,
                'asset_type' => 'equipment',
                'machine_name' => 'Mindray BC-5390',
                'serial_number' => 'SN-' . strtoupper(uniqid()),
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    private function seededSoftware(Client $client, string $code): int
    {
        app(CustomerAssetService::class)->seedMissing($client->id);

        return (int) DB::table('machines')->where('serial_number', CustomerAssetService::seedSerial($client->id, $code))->value('machine_ID');
    }

    private function create(Client $client, array $payload)
    {
        return $this->actingAs($client, 'api')->postJson('/api/tickets', array_merge([
            'title' => 'Analyzer Not Printing',
            'description' => 'The analyzer stopped printing results this morning.',
        ], $payload));
    }

    public function test_form_options_list_only_the_customers_items_and_seed_software_once(): void
    {
        $client = $this->client();
        $other = $this->client();
        $mine = $this->equipment($client);
        $theirs = $this->equipment($other);

        $first = $this->actingAs($client, 'api')->getJson('/api/ticket-form-options')->assertOk()->json('assets');
        $this->actingAs($client, 'api')->getJson('/api/ticket-form-options')->assertOk();

        $ids = array_column($first, 'machine_ID');
        $this->assertContains($mine, $ids);
        $this->assertNotContains($theirs, $ids);
        $software = array_values(array_filter($first, fn ($a) => $a['asset_type'] === 'software'));
        $this->assertCount(3, $software);
        $this->assertNull($software[0]['serial_number'], 'Software never exposes its serial code');
        $this->assertSame(3, DB::table('machines')->where('client_ID', $client->id)->where('asset_type', 'software')->count());
    }

    public function test_equipment_ticket_gets_the_service_category_whatever_the_browser_sends(): void
    {
        $client = $this->client();
        $machine = $this->equipment($client);

        $this->create($client, ['machine_ID' => $machine, 'problem_category_ID' => $this->software])->assertSuccessful();

        $ticket = DB::table('tickets')->where('created_by', $client->id)->latest('ticket_ID')->first();
        $this->assertSame($machine, (int) $ticket->machine_ID);
        $this->assertSame($this->service, (int) $ticket->problem_category_ID);
    }

    public function test_software_ticket_keeps_its_software_item_and_gets_the_software_category(): void
    {
        $client = $this->client();
        $lis = $this->seededSoftware($client, 'LIS');

        $this->create($client, ['machine_ID' => $lis])->assertSuccessful();

        $ticket = DB::table('tickets')->where('created_by', $client->id)->latest('ticket_ID')->first();
        $this->assertSame($lis, (int) $ticket->machine_ID);
        $this->assertSame($this->software, (int) $ticket->problem_category_ID);
    }

    public function test_a_ticket_without_an_item_is_rejected(): void
    {
        $client = $this->client();

        $this->create($client, [])->assertStatus(422)->assertJsonValidationErrors('machine_ID');
    }

    public function test_another_customers_item_is_rejected(): void
    {
        $client = $this->client();
        $other = $this->client();
        $theirs = $this->equipment($other);

        $this->create($client, ['machine_ID' => $theirs])->assertStatus(422)->assertJsonValidationErrors('machine_ID');
    }

    public function test_a_retired_item_cannot_be_chosen(): void
    {
        $client = $this->client();
        $retired = $this->equipment($client, 'retired');

        $this->create($client, ['machine_ID' => $retired])->assertStatus(422)->assertJsonValidationErrors('machine_ID');
        $assets = app(CustomerAssetService::class)->listFor($client->id);
        $this->assertNotContains($retired, array_column($assets, 'machine_ID'));
    }

    public function test_changing_the_item_on_an_open_ticket_sets_the_category_again(): void
    {
        $client = $this->client();
        $machine = $this->equipment($client);
        $lis = $this->seededSoftware($client, 'LIS');
        $this->create($client, ['machine_ID' => $machine])->assertSuccessful();
        $ticketId = (int) DB::table('tickets')->where('created_by', $client->id)->latest('ticket_ID')->value('ticket_ID');

        $this->actingAs($client, 'api')->patchJson("/api/tickets/{$ticketId}", [
            'machine_ID' => $lis,
            'problem_category_ID' => $this->service,
        ])->assertSuccessful();

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertSame($lis, (int) $ticket->machine_ID);
        $this->assertSame($this->software, (int) $ticket->problem_category_ID);
    }

    public function test_editing_to_another_customers_item_or_none_is_rejected(): void
    {
        $client = $this->client();
        $other = $this->client();
        $machine = $this->equipment($client);
        $theirs = $this->equipment($other);
        $this->create($client, ['machine_ID' => $machine])->assertSuccessful();
        $ticketId = (int) DB::table('tickets')->where('created_by', $client->id)->latest('ticket_ID')->value('ticket_ID');

        $this->actingAs($client, 'api')->patchJson("/api/tickets/{$ticketId}", ['machine_ID' => $theirs])->assertStatus(422);
        $this->actingAs($client, 'api')->patchJson("/api/tickets/{$ticketId}", ['machine_ID' => null])->assertStatus(422);
    }

    public function test_internal_endpoint_needs_the_internal_token_and_returns_the_customers_items(): void
    {
        $client = $this->client();
        $machine = $this->equipment($client);
        putenv('INTERNAL_TOKEN=test-internal-token');
        $_ENV['INTERNAL_TOKEN'] = $_SERVER['INTERNAL_TOKEN'] = 'test-internal-token';

        // The shared internal.token middleware refuses a missing token with 403.
        $this->getJson("/api/internal/customers/{$client->id}/assets")->assertStatus(403);

        $data = $this->withHeaders(['X-Internal-Token' => 'test-internal-token'])
            ->getJson("/api/internal/customers/{$client->id}/assets")
            ->assertOk()
            ->json('data');

        $this->assertContains($machine, array_column($data, 'machine_ID'));
        $this->withHeaders(['X-Internal-Token' => 'test-internal-token'])
            ->getJson('/api/internal/customers/999999999/assets')
            ->assertStatus(404);
    }

    public function test_seed_command_is_a_dry_run_by_default_and_links_tickets_with_apply(): void
    {
        $client = $this->client();
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'AST-' . strtoupper(uniqid()),
            'title' => 'Lis Transmission Error',
            'description' => 'Results are not reaching the LIS.',
            'created_by' => $client->id,
            'ticket_type_ID' => 2,
            'is_internal' => false,
            'ticket_status_ID' => 1,
            'priority_ID' => DB::table('ticket_priorities')->value('priority_ID'),
            'problem_category_ID' => $this->software,
            'machine_ID' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->artisan('assets:seed-customer-software', ['--link-ticket' => ["{$ticketId}:LIS"]])->assertSuccessful();
        $this->assertSame(0, DB::table('machines')->where('client_ID', $client->id)->count(), 'Dry run changes nothing');
        $this->assertNull(DB::table('tickets')->where('ticket_ID', $ticketId)->value('machine_ID'));

        $this->artisan('assets:seed-customer-software', ['--apply' => true, '--link-ticket' => ["{$ticketId}:LIS"]])->assertSuccessful();
        $lis = (int) DB::table('machines')->where('serial_number', CustomerAssetService::seedSerial($client->id, 'LIS'))->value('machine_ID');
        $this->assertGreaterThan(0, $lis);
        $this->assertSame($lis, (int) DB::table('tickets')->where('ticket_ID', $ticketId)->value('machine_ID'));
    }
}
