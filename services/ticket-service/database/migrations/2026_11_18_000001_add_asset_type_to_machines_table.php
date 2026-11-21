<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0047 (AC-1): equipment and software share the machines table.
 * asset_type defaults to equipment, so every existing row stays equipment with no backfill.
 * Also adds the "Software" machine category that seeded and imported software points to.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('machines', 'asset_type')) {
            Schema::table('machines', function (Blueprint $table) {
                $table->string('asset_type', 20)->default('equipment')->after('client_ID');
                $table->index(['client_ID', 'asset_type'], 'machines_client_asset_type_index');
            });
        }

        if (!DB::table('machine_categories')->where('category_name', 'Software')->exists()) {
            DB::table('machine_categories')->insert([
                'category_name' => 'Software',
                'description' => 'Customer software, seeded or imported.',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('machines', 'asset_type')) {
            Schema::table('machines', function (Blueprint $table) {
                $table->dropIndex('machines_client_asset_type_index');
                $table->dropColumn('asset_type');
            });
        }

        $softwareCategory = DB::table('machine_categories')->where('category_name', 'Software')->value('category_ID');
        if ($softwareCategory && !DB::table('machines')->where('category_ID', $softwareCategory)->exists()) {
            DB::table('machine_categories')->where('category_ID', $softwareCategory)->delete();
        }
    }
};
