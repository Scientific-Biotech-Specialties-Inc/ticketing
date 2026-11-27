<?php

namespace Tests\Concerns;

use Illuminate\Support\Facades\Schema;

/**
 * Builds the customer tables in the in memory test database, then runs the real hospitals
 * migration on top so tests exercise its schema and backfill.
 */
trait CreatesCustomerTables
{
    protected function createCustomerTables(): void
    {
        if (!Schema::hasTable('clients')) {
            Schema::create('clients', function ($table) {
                $table->id();
                $table->string('client_name');
                $table->string('email')->unique();
                $table->string('address')->nullable();
                $table->string('contact_number')->nullable();
                $table->boolean('status')->default(true);
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('clients_credentials')) {
            Schema::create('clients_credentials', function ($table) {
                $table->id();
                $table->unsignedBigInteger('client_id');
                $table->string('password_hash');
                $table->integer('failed_login_count')->default(0);
                $table->timestamp('locked_until')->nullable();
                $table->timestamp('last_login_at')->nullable();
                $table->timestamp('password_change_at')->nullable();
                $table->timestamps();
            });
        }

        $this->hospitalsMigration()->up();
    }

    protected function hospitalsMigration(): object
    {
        return require base_path('database/migrations/2026_11_27_000001_create_customer_organizations_table.php');
    }
}
