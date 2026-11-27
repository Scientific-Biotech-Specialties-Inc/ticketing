<?php

use App\Support\OrganizationName;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Hospitals (customer organizations): one hospital can own many customer logins.
 *
 * Adds clients.organization_id and backfills it: one hospital per distinct normalized
 * client_name, linked to every client with that name. client_name itself is never changed,
 * so rolling back loses nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('customer_organizations')) {
            Schema::create('customer_organizations', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->string('normalized_name')->unique();
                $table->timestamps();
            });
        }

        if (!Schema::hasColumn('clients', 'organization_id')) {
            Schema::table('clients', function (Blueprint $table) {
                $table->unsignedBigInteger('organization_id')->nullable()->index()->after('client_name');
                $table->foreign('organization_id', 'clients_organization_id_fk')
                    ->references('id')->on('customer_organizations')
                    ->nullOnDelete();
            });
        }

        $this->backfill();
    }

    public function down(): void
    {
        if (Schema::hasColumn('clients', 'organization_id')) {
            Schema::table('clients', function (Blueprint $table) {
                // SQLite cannot drop a foreign key by name; it never created one on an existing table.
                if (DB::getDriverName() !== 'sqlite') {
                    $table->dropForeign('clients_organization_id_fk');
                }
                $table->dropIndex(['organization_id']);
                $table->dropColumn('organization_id');
            });
        }

        Schema::dropIfExists('customer_organizations');
    }

    /** One pass over clients in chunks of 500, linking each to the hospital for its normalized name. */
    private function backfill(): void
    {
        $idsByKey = [];

        DB::table('clients')
            ->whereNull('organization_id')
            ->select(['id', 'client_name'])
            ->orderBy('id')
            ->chunkById(500, function ($clients) use (&$idsByKey) {
                foreach ($clients as $client) {
                    $key = OrganizationName::normalize($client->client_name);
                    if ($key === '') {
                        continue;
                    }

                    if (!isset($idsByKey[$key])) {
                        $existing = DB::table('customer_organizations')->where('normalized_name', $key)->value('id');
                        $idsByKey[$key] = $existing ?: DB::table('customer_organizations')->insertGetId([
                            'name' => trim((string) $client->client_name),
                            'normalized_name' => $key,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }

                    DB::table('clients')->where('id', $client->id)->update(['organization_id' => $idsByKey[$key]]);
                }
            });
    }
};
