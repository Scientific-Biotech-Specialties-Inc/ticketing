<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CRMS machine sync: every machine registered from the CRMS belongs to one SBSI branch.
 * Stored as the branch slug, the same key tickets.branch_id uses.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('machines') || Schema::hasColumn('machines', 'branch_id')) {
            return;
        }

        Schema::table('machines', function (Blueprint $table) {
            $table->string('branch_id', 64)->nullable()->index()->after('client_ID');
            $table->foreign('branch_id', 'machines_branch_id_fk')
                ->references('slug')->on('branches')->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('machines') || !Schema::hasColumn('machines', 'branch_id')) {
            return;
        }

        Schema::table('machines', function (Blueprint $table) {
            $table->dropForeign('machines_branch_id_fk');
            $table->dropIndex(['branch_id']);
            $table->dropColumn('branch_id');
        });
    }
};
