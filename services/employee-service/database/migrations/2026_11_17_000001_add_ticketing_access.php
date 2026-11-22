<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0045: ticketing access.
 *
 * Adds the handler department list (which auth module departments may work tickets)
 * and the per employee designation flag. Seeds today's real handler set (AC-16):
 * Service, IT, IT Department and Customer Service are enabled, and every active,
 * non admin employee in them is designated. Everyone else becomes a requestor.
 */
return new class extends Migration
{
    /** Departments enabled at go live (AC-16). */
    private const SEED_DEPARTMENTS = ['Service', 'IT', 'IT Department', 'Customer Service'];

    /** Normalized (lowercase, no spaces/underscores/hyphens) role names that bypass ticketing access (AC-13). */
    private const ADMIN_ROLES = ['admin', 'superadmin', 'itadmin', 'administrator', 'systemadministrator'];

    public function up(): void
    {
        if (!Schema::hasTable('ticketing_handler_departments')) {
            Schema::create('ticketing_handler_departments', function (Blueprint $table) {
                $table->id();
                $table->string('department_name', 255)->unique();
                $table->boolean('is_enabled')->default(false);
                $table->unsignedBigInteger('updated_by')->nullable();
                $table->timestamps();
            });
        }

        Schema::table('employees', function (Blueprint $table) {
            if (!Schema::hasColumn('employees', 'is_ticketing_employee')) {
                $table->boolean('is_ticketing_employee')->default(false)->index();
            }
            if (!Schema::hasColumn('employees', 'designated_by')) {
                $table->unsignedBigInteger('designated_by')->nullable();
            }
            if (!Schema::hasColumn('employees', 'designated_at')) {
                $table->timestamp('designated_at')->nullable();
            }
        });

        $this->seed();
    }

    private function seed(): void
    {
        $now = now();

        foreach (self::SEED_DEPARTMENTS as $name) {
            $exists = DB::table('ticketing_handler_departments')
                ->whereRaw('LOWER(TRIM(department_name)) = ?', [strtolower($name)])
                ->exists();
            if (!$exists) {
                DB::table('ticketing_handler_departments')->insert([
                    'department_name' => $name,
                    'is_enabled' => true,
                    'updated_by' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        $normalizedDepartments = array_map('strtolower', self::SEED_DEPARTMENTS);

        DB::table('employees')
            ->where('is_active', true)
            ->whereIn(DB::raw('LOWER(TRIM(COALESCE(department, \'\')))'), $normalizedDepartments)
            ->whereNotIn(DB::raw("LOWER(REPLACE(REPLACE(REPLACE(COALESCE(role, ''), ' ', ''), '_', ''), '-', ''))"), self::ADMIN_ROLES)
            ->whereNotIn(DB::raw("LOWER(COALESCE(position_level, ''))"), ['admin', 'superadmin'])
            ->update([
                'is_ticketing_employee' => true,
                'designated_by' => null,
                'designated_at' => $now,
            ]);
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            if (Schema::hasColumn('employees', 'is_ticketing_employee')) {
                $table->dropIndex(['is_ticketing_employee']);
                $table->dropColumn('is_ticketing_employee');
            }
            if (Schema::hasColumn('employees', 'designated_by')) {
                $table->dropColumn('designated_by');
            }
            if (Schema::hasColumn('employees', 'designated_at')) {
                $table->dropColumn('designated_at');
            }
        });

        Schema::dropIfExists('ticketing_handler_departments');
    }
};
