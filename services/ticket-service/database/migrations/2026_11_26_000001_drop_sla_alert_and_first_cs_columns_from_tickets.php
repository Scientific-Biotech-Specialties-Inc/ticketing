<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Database cleanup, phase 5, release 2 (spec 0049, AC-9).
 *
 * Ship only after the release 2 go/no go checklist in the spec passes: every ticket-service and
 * employee-service container runs release 1 code. An old employee-service still writing
 * first_cs_response_at after this drop fails its assignment transaction (MySQL 1054).
 *
 * up() first moves every alert timestamp still present only on tickets into ticket_sla_alerts
 * (missing rows are inserted, null columns are filled, a value already in the row always wins),
 * then drops the three alert columns and the unused first_cs_response_at. No alert timestamp is lost.
 *
 * down() adds the four columns back as nullable dateTime and copies the alert timestamps back from
 * ticket_sla_alerts. first_cs_response_at comes back empty (its data is not kept).
 */
return new class extends Migration
{
    private const ALERT_COLUMNS = ['sla_risk_notified_at', 'sla_breach_notified_at', 'last_sla_breach_alert_at'];
    private const DROPPED_COLUMNS = ['sla_risk_notified_at', 'sla_breach_notified_at', 'last_sla_breach_alert_at', 'first_cs_response_at'];

    public function up(): void
    {
        if (!Schema::hasTable('tickets')) {
            return;
        }

        $this->backfillAlertTable();

        foreach (self::DROPPED_COLUMNS as $column) {
            if (Schema::hasColumn('tickets', $column)) {
                Schema::table('tickets', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('tickets')) {
            return;
        }

        foreach (self::DROPPED_COLUMNS as $column) {
            if (!Schema::hasColumn('tickets', $column)) {
                Schema::table('tickets', function (Blueprint $table) use ($column) {
                    $table->dateTime($column)->nullable();
                });
            }
        }

        if (Schema::hasTable('ticket_sla_alerts')) {
            $set = collect(self::ALERT_COLUMNS)->map(fn ($c) => "t.{$c} = a.{$c}")->implode(', ');
            DB::statement("UPDATE tickets t INNER JOIN ticket_sla_alerts a ON a.ticket_id = t.ticket_ID SET {$set}");
        }
    }

    /**
     * Copy alert timestamps that exist only on tickets into ticket_sla_alerts, before the drop.
     * Set based, so it stays one statement each however many tickets there are.
     */
    private function backfillAlertTable(): void
    {
        if (!Schema::hasTable('ticket_sla_alerts')) {
            return;
        }

        $present = array_values(array_filter(self::ALERT_COLUMNS, fn ($c) => Schema::hasColumn('tickets', $c)));
        if ($present === []) {
            return;
        }

        $now = now()->toDateTimeString();
        $columns = implode(', ', $present);
        $selected = collect($present)->map(fn ($c) => "t.{$c}")->implode(', ');
        $anySet = collect($present)->map(fn ($c) => "t.{$c} IS NOT NULL")->implode(' OR ');

        // 1. Tickets with an old value and no row yet. INSERT IGNORE, so a row created meanwhile is left alone.
        DB::statement(
            "INSERT IGNORE INTO ticket_sla_alerts (ticket_id, {$columns}, created_at, updated_at) "
            . "SELECT t.ticket_ID, {$selected}, ?, ? FROM tickets t "
            . "LEFT JOIN ticket_sla_alerts a ON a.ticket_id = t.ticket_ID "
            . "WHERE a.ticket_id IS NULL AND ({$anySet})",
            [$now, $now]
        );

        // 2. Existing rows with a null column the old column can fill. The row's own value always wins.
        $fill = collect($present)->map(fn ($c) => "a.{$c} = COALESCE(a.{$c}, t.{$c})")->implode(', ');
        DB::statement("UPDATE ticket_sla_alerts a INNER JOIN tickets t ON t.ticket_ID = a.ticket_id SET {$fill}");
    }
};
