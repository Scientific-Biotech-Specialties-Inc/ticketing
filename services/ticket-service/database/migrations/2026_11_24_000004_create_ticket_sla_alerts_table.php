<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Database cleanup, phase 5, release 1 (spec 0049).
 *
 * Moves the SLA checker's alert bookkeeping (sla_risk_notified_at, sla_breach_notified_at,
 * last_sla_breach_alert_at) out of tickets into a 1:1 table, ticket_sla_alerts. The old columns stay
 * on tickets until release 2 so a container still running the previous code never hits a missing column.
 *
 * up() copies every ticket that has at least one of the three values set (insertOrIgnore, so a rerun adds nothing).
 * down() copies the current values back onto tickets, then drops the table. Per column the row wins when it is set;
 * when the row holds null the tickets value is kept (AC-8), because a null in the row only means "not recorded here"
 * (an old container may have written the old column after the backfill). Nothing ever clears an alert timestamp.
 */
return new class extends Migration
{
    private const ALERT_COLUMNS = ['sla_risk_notified_at', 'sla_breach_notified_at', 'last_sla_breach_alert_at'];

    public function up(): void
    {
        if (!Schema::hasTable('ticket_sla_alerts')) {
            Schema::create('ticket_sla_alerts', function (Blueprint $table) {
                $table->unsignedBigInteger('ticket_id')->primary();
                $table->dateTime('sla_risk_notified_at')->nullable();
                $table->dateTime('sla_breach_notified_at')->nullable();
                $table->dateTime('last_sla_breach_alert_at')->nullable();
                $table->timestamps();

                $table->foreign('ticket_id')->references('ticket_ID')->on('tickets')->cascadeOnDelete();
            });
        }

        $now = now();
        DB::table('tickets')
            ->where(function ($q) {
                foreach (self::ALERT_COLUMNS as $column) {
                    $q->orWhereNotNull($column);
                }
            })
            ->orderBy('ticket_ID')
            ->select(array_merge(['ticket_ID'], self::ALERT_COLUMNS))
            ->chunk(500, function ($tickets) use ($now) {
                $rows = [];
                foreach ($tickets as $ticket) {
                    $rows[] = [
                        'ticket_id' => $ticket->ticket_ID,
                        'sla_risk_notified_at' => $ticket->sla_risk_notified_at,
                        'sla_breach_notified_at' => $ticket->sla_breach_notified_at,
                        'last_sla_breach_alert_at' => $ticket->last_sla_breach_alert_at,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
                DB::table('ticket_sla_alerts')->insertOrIgnore($rows);
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('ticket_sla_alerts')) {
            return;
        }

        if (Schema::hasTable('tickets') && Schema::hasColumn('tickets', 'sla_risk_notified_at')) {
            DB::statement(
                'UPDATE tickets t INNER JOIN ticket_sla_alerts a ON a.ticket_id = t.ticket_ID SET '
                . 't.sla_risk_notified_at = COALESCE(a.sla_risk_notified_at, t.sla_risk_notified_at), '
                . 't.sla_breach_notified_at = COALESCE(a.sla_breach_notified_at, t.sla_breach_notified_at), '
                . 't.last_sla_breach_alert_at = COALESCE(a.last_sla_breach_alert_at, t.last_sla_breach_alert_at)'
            );
        }

        Schema::dropIfExists('ticket_sla_alerts');
    }
};
