<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Services\TicketBranchResolver;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * New tickets always get a branch, so branch scoped staff views include them.
 * Customer tickets used to be saved with no branch and only showed under Main Branch.
 */
class TicketBranchAssignmentTest extends TestCase
{
    use DatabaseTransactions;

    private int $makatiId;
    private int $cebuId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        $this->makatiId = $this->branch('sbsi-makati-branch', 'SBSI Makati Branch', 'SBSI-MKT');
        $this->cebuId = $this->branch('sbsi-cebu-branch', 'SBSI Cebu Branch', 'SBSI-CEB');
        config(['services.tickets.default_branch' => 'sbsi-makati-branch']);

        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open']);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 2], ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('problem_categories')->updateOrInsert(
            ['category_name' => 'Software', 'branch_id' => null],
            ['is_active' => 1, 'updated_at' => now()]
        );

        Http::fake([
            '*/ticket-configurations/limits' => Http::response(['value' => ['isUnlimited' => true, 'limit' => 100]], 200),
            '*' => Http::response(['data' => ['category_id' => null, 'confidence' => 0]], 200),
        ]);
    }

    private function branch(string $slug, string $name, string $code): int
    {
        $existing = DB::table('branches')->where('slug', $slug)->value('id');
        if ($existing) {
            return (int) $existing;
        }

        return (int) DB::table('branches')->insertGetId([
            'slug' => $slug,
            'name' => $name,
            'code' => $code,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function machine(?int $branchId): int
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            return DB::table('machines')->insertGetId([
                'category_ID' => DB::table('machine_categories')->value('category_ID'),
                'client_ID' => DB::table('clients')->value('id') ?? 1,
                'machine_name' => 'Patient Monitor',
                'serial_number' => 'SN-' . strtoupper(uniqid()),
                'model' => 'VS-900',
                'brand' => 'Philips',
                'branch_id' => $branchId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    public function test_a_ticket_without_equipment_gets_the_default_makati_branch(): void
    {
        $this->assertSame('sbsi-makati-branch', app(TicketBranchResolver::class)->resolve(null, null));
    }

    public function test_the_equipment_branch_wins_over_the_default(): void
    {
        $machine = $this->machine($this->cebuId);

        $this->assertSame('sbsi-cebu-branch', app(TicketBranchResolver::class)->resolve(null, $machine));
    }

    public function test_equipment_with_no_branch_falls_back_to_the_default(): void
    {
        $machine = $this->machine(null);

        $this->assertSame('sbsi-makati-branch', app(TicketBranchResolver::class)->resolve(null, $machine));
    }

    public function test_an_explicit_branch_wins_over_everything(): void
    {
        $machine = $this->machine($this->makatiId);

        $this->assertSame('sbsi-cebu-branch', app(TicketBranchResolver::class)->resolve('sbsi-cebu-branch', $machine));
    }

    public function test_the_requesting_employees_branch_is_used_before_the_default(): void
    {
        $this->assertSame('sbsi-cebu-branch', app(TicketBranchResolver::class)->resolve(null, null, 'SBSI Cebu Branch'));
    }

    public function test_an_unknown_default_leaves_the_ticket_without_a_branch(): void
    {
        config(['services.tickets.default_branch' => 'no-such-branch']);

        $this->assertNull(app(TicketBranchResolver::class)->resolve(null, null));
    }

    public function test_a_customer_ticket_is_saved_with_the_makati_branch(): void
    {
        $uid = uniqid();
        $client = Client::create([
            'client_name' => "Branch Hospital {$uid}",
            'email' => "branch.{$uid}@client.test",
            'contact_number' => '0000000000',
            'address' => '1 Test Way',
        ]);

        // Seeded software has no branch of its own, so the default branch applies (spec 0047 AC-16).
        if (!DB::table('machine_categories')->where('category_name', 'Software')->exists()) {
            DB::table('machine_categories')->insert(['category_name' => 'Software', 'created_at' => now(), 'updated_at' => now()]);
        }
        app(\App\Services\CustomerAssetService::class)->seedMissing($client->id);
        $lis = DB::table('machines')->where('serial_number', \App\Services\CustomerAssetService::seedSerial($client->id, 'LIS'))->value('machine_ID');

        $this->actingAs($client, 'api')->postJson('/api/tickets', [
            'title' => 'Portal Login Fails',
            'description' => 'The customer portal rejects my password every time I sign in.',
            'machine_ID' => $lis,
        ])->assertSuccessful();

        $ticket = DB::table('tickets')->where('created_by', $client->id)->latest('ticket_ID')->first();
        $this->assertSame('sbsi-makati-branch', $ticket->branch_id);
    }
}
