<?php

namespace Tests;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabaseState;

/**
 * RefreshDatabase for analytics-service on MySQL.
 *
 * analytics reads tables other services own (tickets, employees, branches, ...) and its own migrations
 * reference some of them (foreign keys to branches and employees). So on the first test of a run the
 * database is wiped, the read only tables are created from the shared fixture schema
 * (packages/ticketing-reporting/tests/fixtures/schema.sql), and only then do analytics' own migrations run.
 * Every test after that runs inside a transaction, as with RefreshDatabase.
 *
 * Use this trait instead of RefreshDatabase in every analytics test that touches the database.
 */
trait RefreshReportingDatabase
{
    use RefreshDatabase;

    protected function refreshTestDatabase()
    {
        if (!RefreshDatabaseState::$migrated) {
            $this->artisan('db:wipe', ['--force' => true]);
            $this->loadReportingSql('fixtures/schema.sql');
            $this->artisan('migrate', ['--force' => true]);

            $this->app[Kernel::class]->setArtisan(null);

            RefreshDatabaseState::$migrated = true;
        }

        $this->beginDatabaseTransaction();
    }
}
