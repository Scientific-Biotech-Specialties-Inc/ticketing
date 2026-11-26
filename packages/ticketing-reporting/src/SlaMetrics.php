<?php

namespace Ticketing\Reporting;

use Illuminate\Support\Carbon;

/**
 * The per ticket SLA clock, shared by ticket-service (SLAService::computeTicketSlaMetrics delegates here)
 * and SlaOutcomeService, so one rule decides the SLA state everywhere (spec 0050 AC-13).
 *
 * Pure: reads only the ticket row it is given, never the database.
 *
 * SLA status, in order:
 *   1. SLA Unavailable: assignment failed at creation (sla_status = 'SLA Unavailable')
 *   2. No SLA Configured: no SLA source column and no resolution_due_at
 *   3. Paused: on hold
 *   4. Compliant or Breached: closed or resolved, by resolved_at (else closed_at) against resolution_due_at
 *   5. Breached: now is past resolution_due_at
 *   6. At Risk: within 4 hours of resolution_due_at
 *   7. On Track
 * Tickets with no due date never get a guessed (24 or 48 hour) status.
 */
final class SlaMetrics
{
    /** Ticket columns that link a ticket to an SLA source. */
    public const SLA_SOURCE_COLUMNS = ['branch_sla_policy_id', 'branch_priority_override_id', 'sla_rule_id', 'sla_ID'];

    /** Minutes before resolution_due_at at which an open ticket counts as At Risk. */
    public const AT_RISK_MINUTES = 240;

    public static function compute($ticket): array
    {
        $result = fn (string $status, $dueAt = null, $remaining = null, array $flags = []) => array_merge([
            'status' => $status,
            'due_at' => $dueAt ? $dueAt->toIso8601String() : null,
            'time_remaining_minutes' => $remaining,
            'is_breached' => false,
            'is_at_risk' => false,
            'is_paused' => false,
        ], $flags);

        if (!$ticket) {
            return $result('On Track');
        }

        $now = now();
        $statusName = strtolower(trim((string) ($ticket->status_name ?? $ticket->status ?? '')));
        $isClosedOrResolved = in_array($statusName, ['closed', 'resolved'], true);
        $isOnHold = in_array($statusName, ['on hold', 'on-hold', 'paused'], true) || ((int) ($ticket->ticket_status_ID ?? 0) === 11);

        $resDueAtRaw = $ticket->resolution_due_at ?? null;
        $resDueAt = $resDueAtRaw ? Carbon::parse($resDueAtRaw) : null;
        $resolvedAtRaw = ($ticket->resolved_at ?? null) ?: ($ticket->closed_at ?? null);
        $resolvedAt = $resolvedAtRaw ? Carbon::parse($resolvedAtRaw) : null;

        // 1. SLA assignment failed at creation; tickets:backfill-sla repairs it.
        if (($ticket->sla_status ?? null) === 'SLA Unavailable') {
            return $result('SLA Unavailable', null, null, ['is_unavailable' => true]);
        }

        // 2. No SLA source and no due date.
        $hasSource = false;
        foreach (self::SLA_SOURCE_COLUMNS as $column) {
            if (!empty($ticket->{$column} ?? null)) {
                $hasSource = true;
                break;
            }
        }
        if (!$hasSource && !$resDueAt) {
            return $result('No SLA Configured', null, null, ['is_unavailable' => true]);
        }

        // 3. On Hold: the clock is paused.
        if ($isOnHold) {
            return $result('Paused', $resDueAt, $resDueAt ? max(0, $now->diffInMinutes($resDueAt, false)) : null, ['is_paused' => true]);
        }

        // 4. Closed or Resolved.
        if ($isClosedOrResolved) {
            $isBreached = $resDueAt !== null && ($resolvedAt ?: $now)->gt($resDueAt);
            return $result($isBreached ? 'Breached' : 'Compliant', $resDueAt, 0, ['is_breached' => $isBreached]);
        }

        if (!$resDueAt) {
            return $result('On Track');
        }

        // 5. Breached.
        if ($now->gt($resDueAt)) {
            return $result('Breached', $resDueAt, 0, ['is_breached' => true]);
        }

        // 6. At Risk.
        $remaining = (int) $now->diffInMinutes($resDueAt, false);
        if ($resDueAt->lte($now->copy()->addMinutes(self::AT_RISK_MINUTES))) {
            return $result('At Risk', $resDueAt, $remaining, ['is_at_risk' => true]);
        }

        // 7. On Track.
        return $result('On Track', $resDueAt, $remaining);
    }
}
