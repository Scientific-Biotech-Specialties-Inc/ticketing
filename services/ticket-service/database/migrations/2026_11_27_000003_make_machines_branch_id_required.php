<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Every machine (equipment or software) belongs to one branch.
 *
 * Machines without a branch get the default branch (services.tickets.default_branch, SBSI Makati),
 * the same branch TicketBranchResolver already falls back to, then the column becomes NOT NULL.
 * The foreign key can no longer set the branch to null, so deleting a branch that still has
 * machines is blocked instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('machines') || !Schema::hasColumn('machines', 'branch_id')) {
            return;
        }

        $default = (string) config('services.tickets.default_branch', 'sbsi-makati-branch');
        // A machine with no branch, or one pointing at a branch that does not exist (rows written with
        // foreign key checks off), gets the default branch. Done before any schema change, because
        // MySQL cannot roll back a half finished ALTER.
        $unknownBranch = fn ($q) => $q->whereNull('branch_id')
            ->orWhereNotIn('branch_id', DB::table('branches')->select('slug'));

        if ($default !== '' && DB::table('branches')->where('slug', $default)->exists()) {
            DB::table('machines')->where($unknownBranch)->update(['branch_id' => $default]);
        }

        $missing = DB::table('machines')->where($unknownBranch)->count();
        if ($missing > 0) {
            throw new RuntimeException(
                "{$missing} machines have no valid branch and the default branch \"{$default}\" does not exist. "
                . 'Seed the branches (2026_11_12_000001_seed_sbsi_branches) or set TICKET_DEFAULT_BRANCH, then migrate again.'
            );
        }

        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        $this->dropBranchForeignKey();
        DB::statement('ALTER TABLE machines MODIFY branch_id VARCHAR(64) NOT NULL');
        DB::statement('ALTER TABLE machines ADD CONSTRAINT machines_branch_id_fk FOREIGN KEY (branch_id) REFERENCES branches (slug) ON DELETE RESTRICT');
    }

    public function down(): void
    {
        if (!Schema::hasTable('machines') || !Schema::hasColumn('machines', 'branch_id') || DB::getDriverName() !== 'mysql') {
            return;
        }

        $this->dropBranchForeignKey();
        DB::statement('ALTER TABLE machines MODIFY branch_id VARCHAR(64) NULL');
        DB::statement('ALTER TABLE machines ADD CONSTRAINT machines_branch_id_fk FOREIGN KEY (branch_id) REFERENCES branches (slug) ON DELETE SET NULL');
    }

    private function dropBranchForeignKey(): void
    {
        $exists = DB::table('information_schema.referential_constraints')
            ->where('constraint_schema', DB::getDatabaseName())
            ->where('table_name', 'machines')
            ->where('constraint_name', 'machines_branch_id_fk')
            ->exists();

        if ($exists) {
            DB::statement('ALTER TABLE machines DROP FOREIGN KEY machines_branch_id_fk');
        }
    }
};
