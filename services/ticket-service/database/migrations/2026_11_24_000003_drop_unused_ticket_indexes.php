<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Database cleanup, phase 5a (tickets indexes).
 *
 * tickets carried 32 indexes. These six serve no query and only cost writes (the SLA checker
 * updates the *_notified_at / *_alert_at columns every minute):
 *
 * - tickets_branch_id_index: redundant, idx_tickets_branch_created_at and idx_tickets_branch_status
 *   both start with branch_id. No foreign key depends on it.
 * - tickets_origin_index: no query filters or sorts on origin.
 * - tickets_last_reminder_sent_at_index, tickets_sla_risk_notified_at_index,
 *   tickets_sla_breach_notified_at_index, tickets_last_sla_breach_alert_at_index: these columns
 *   are only selected and written; the reminder cooldown and SLA alert checks compare them in PHP
 *   after loading the ticket.
 *
 * down() recreates them with their original names.
 */
return new class extends Migration
{
    /** index name => column */
    private const INDEXES = [
        'tickets_branch_id_index' => 'branch_id',
        'tickets_origin_index' => 'origin',
        'tickets_last_reminder_sent_at_index' => 'last_reminder_sent_at',
        'tickets_sla_risk_notified_at_index' => 'sla_risk_notified_at',
        'tickets_sla_breach_notified_at_index' => 'sla_breach_notified_at',
        'tickets_last_sla_breach_alert_at_index' => 'last_sla_breach_alert_at',
    ];

    public function up(): void
    {
        $existing = $this->existingIndexes();

        Schema::table('tickets', function (Blueprint $table) use ($existing) {
            foreach (array_keys(self::INDEXES) as $name) {
                if (in_array($name, $existing, true)) {
                    $table->dropIndex($name);
                }
            }
        });
    }

    public function down(): void
    {
        $existing = $this->existingIndexes();

        Schema::table('tickets', function (Blueprint $table) use ($existing) {
            foreach (self::INDEXES as $name => $column) {
                if (!in_array($name, $existing, true) && Schema::hasColumn('tickets', $column)) {
                    $table->index($column, $name);
                }
            }
        });
    }

    /** @return string[] */
    private function existingIndexes(): array
    {
        return array_map(fn (array $index) => $index['name'], Schema::getIndexes('tickets'));
    }
};
