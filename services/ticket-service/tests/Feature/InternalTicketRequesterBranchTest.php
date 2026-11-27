<?php

namespace Tests\Feature;

use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * An internal ticket raised without a branch belongs to the requester's own branch, so the CS
 * of that branch sees it on their dashboard. Before this, it was saved with a NULL branch, which
 * branch scoped queues only show to the main branch.
 */
class InternalTicketRequesterBranchTest extends TestCase
{
    use DatabaseTransactions;

    private object $branch;
    private object $otherBranch;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);
        Event::fake();

        if (!DB::table('ticket_types')->where('type_name', 'Internal')->exists()) {
            DB::table('ticket_types')->insert(['type_name' => 'Internal', 'created_at' => now(), 'updated_at' => now()]);
        }

        $uid = substr(uniqid(), -8);
        foreach (['branch' => 'RBA', 'otherBranch' => 'RBB'] as $prop => $code) {
            $id = DB::table('branches')->insertGetId([
                'slug' => "req-branch-{$code}-{$uid}",
                'name' => "Requester Branch {$code} {$uid}",
                'code' => "{$code}{$uid}",
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->{$prop} = DB::table('branches')->where('id', $id)->first();
        }
    }

    private function requester(array $over = []): Employee
    {
        return Employee::create(array_merge([
            'emp_id' => random_int(700000, 799999),
            'first_name' => 'Branch',
            'last_name' => 'Requester',
            'email' => 'requester.' . uniqid() . '@branch.test',
            'role' => 'service',
            'department' => 'Operations',
            'position_level' => 'Employee',
            'branch_id' => $this->branch->id,
            'branch' => $this->branch->name,
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ], $over));
    }

    private function create(Employee $user, array $over = [])
    {
        return $this->actingAs($user)->postJson('/api/tickets/internal', array_merge([
            'department_id' => 2,
            'problem_category_ID' => (int) DB::table('problem_categories')->value('problem_category_ID'),
            'title' => 'Printer Not Working',
            'description' => 'The office printer shows a paper jam.',
        ], $over));
    }

    private function savedBranch(): ?string
    {
        return DB::table('tickets')->where('title', 'Printer Not Working')->orderByDesc('ticket_ID')->value('branch_id');
    }

    public function test_uses_the_requesters_branch_when_none_is_sent(): void
    {
        $this->create($this->requester())->assertSuccessful();

        $this->assertSame($this->branch->slug, $this->savedBranch());
    }

    public function test_falls_back_to_the_branch_name_when_the_id_is_missing(): void
    {
        $this->create($this->requester(['branch_id' => null, 'branch' => strtoupper($this->branch->name)]))->assertSuccessful();

        $this->assertSame($this->branch->slug, $this->savedBranch());
    }

    public function test_keeps_an_explicit_branch_from_the_request(): void
    {
        $this->create($this->requester(), ['branch_id' => $this->otherBranch->slug])->assertSuccessful();

        $this->assertSame($this->otherBranch->slug, $this->savedBranch());
    }

    public function test_stays_null_when_the_requester_has_no_branch(): void
    {
        $this->create($this->requester(['branch_id' => null, 'branch' => null]))->assertSuccessful();

        $this->assertNull($this->savedBranch());
    }
}
