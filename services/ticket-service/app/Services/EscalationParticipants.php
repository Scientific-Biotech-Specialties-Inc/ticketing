<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Managers a ticket was escalated to. They may join that ticket's conversation.
 *
 * Each escalation writes one internal `escalated_to_managers` audit row; a manager keeps access
 * to the conversation once escalated to, so the history they joined stays readable.
 * messaging-service asks through GET /internal/tickets/{id}/escalation-managers.
 */
class EscalationParticipants
{
    public const EVENT = 'escalated_to_managers';

    /**
     * @param  int[]  $managerIds
     */
    public function record(int $ticketId, array $managerIds, int $actorId, string $actorType, ?string $reason): void
    {
        $managerIds = array_values(array_unique(array_filter(array_map('intval', $managerIds))));
        if (empty($managerIds)) {
            return;
        }

        $managers = DB::table('employees')
            ->whereIn('emp_id', $managerIds)
            ->selectRaw("emp_id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) as name, department")
            ->get()
            ->map(fn ($m) => ['id' => (int) $m->emp_id, 'name' => $m->name, 'department' => $m->department])
            ->values()
            ->all();

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => self::EVENT,
            'event_type' => self::EVENT,
            'action_by_ID' => $actorId,
            'actor_type' => $actorType,
            'details' => json_encode([
                'manager_ids' => $managerIds,
                'managers' => $managers,
                'reason' => $reason,
            ]),
            'is_system' => 0,
            'is_internal' => 1,
            'created_at' => now(),
        ]);
    }

    /**
     * Manager ids per ticket, for every escalation the tickets ever had.
     *
     * @param  int[]  $ticketIds
     * @return array<int, int[]>
     */
    public function managerIdsFor(array $ticketIds): array
    {
        $ticketIds = array_values(array_unique(array_filter(array_map('intval', $ticketIds))));
        if (empty($ticketIds)) {
            return [];
        }

        $byTicket = [];
        DB::table('ticket_audit_logs')
            ->whereIn('ticket_ID', $ticketIds)
            ->where('action_type', self::EVENT)
            ->get(['ticket_ID', 'details'])
            ->each(function ($row) use (&$byTicket) {
                $ids = (array) (json_decode((string) $row->details, true)['manager_ids'] ?? []);
                $tid = (int) $row->ticket_ID;
                $byTicket[$tid] = array_values(array_unique(array_merge($byTicket[$tid] ?? [], array_map('intval', $ids))));
            });

        return $byTicket;
    }

    /** @return int[] */
    public function managerIds(int $ticketId): array
    {
        return $this->managerIdsFor([$ticketId])[$ticketId] ?? [];
    }
}
