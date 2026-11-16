<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 3.1 CMS equipment sync: machines pulled from the CMS keep their canonical CMS keys.
 *
 * - equipment_uid       CMS "EQP-{contract_id}", the upsert key (falls back to serial_number)
 * - cms_customer_uid    CMS "BP-*", "SUP-*" or "CUST-*"
 * - contract_code       CMS contract code, shown to staff
 * - contract_end_date   the contract's end date; a passed date hides the machine from customers
 * - cms_contract_active null = not from the CMS; false = the CMS no longer lists it (never deleted,
 *                       tickets reference machines), hidden from the customer machine picker
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('machines') || Schema::hasColumn('machines', 'equipment_uid')) {
            return;
        }

        Schema::table('machines', function (Blueprint $table) {
            $table->string('equipment_uid', 64)->nullable()->unique()->after('machine_ID');
            $table->string('cms_customer_uid', 64)->nullable()->index()->after('client_ID');
            $table->string('contract_code', 64)->nullable()->after('cms_customer_uid');
            $table->date('contract_end_date')->nullable()->after('contract_code');
            $table->boolean('cms_contract_active')->nullable()->after('contract_end_date');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('machines') || !Schema::hasColumn('machines', 'equipment_uid')) {
            return;
        }

        Schema::table('machines', function (Blueprint $table) {
            $table->dropUnique(['equipment_uid']);
            $table->dropIndex(['cms_customer_uid']);
            $table->dropColumn(['equipment_uid', 'cms_customer_uid', 'contract_code', 'contract_end_date', 'cms_contract_active']);
        });
    }
};
