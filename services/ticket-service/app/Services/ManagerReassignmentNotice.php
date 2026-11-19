<?php

namespace App\Services;

use App\Helpers\RoleHelper;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Manager reassignment notice for CS.
 *
 * A Service or IT manager reassignment writes a `manager_reassigned` audit row (employee-service).
 * CS sees it on the Assigned queue and in the ticket modal until any CS user acknowledges it,
 * which writes a `manager_reassignment_acknowledged` row. One acknowledgement clears it for all CS.
 * Both rows are internal and never shown to customers.
 */
class ManagerReassignmentNotice
{
    public const EVENT = 'manager_reassigned';
    public const ACK_EVENT = 'manager_reassignment_acknowledged';

    /**
     * SQL condition: the ticket aliased `$alias` has a manager reassignment with no later acknowledgement.
     */
    public static function pendingSql(string $alias = 't'): string
    {
        return "EXISTS (SELECT 1 FROM ticket_audit_logs mr WHERE mr.ticket_ID = {$alias}.ticket_ID"
            . " AND mr.action_type = '" . self::EVENT . "'"
            . " AND NOT EXISTS (SELECT 1 FROM ticket_audit_logs ack WHERE ack.ticket_ID = {$alias}.ticket_ID"
            . " AND ack.action_type = '" . self::ACK_EVENT . "' AND ack.log_ID > mr.log_ID))";
    }

    /**
     * Adds `manager_reassignment` (or null) to each formatted ticket row that carries `ticket_ID`.
     */
    public function annotateRows(array $rows): array
    {
        $pending = $this->pendingFor(array_column($rows, 'ticket_ID'));

        return array_map(function ($row) use ($pending) {
            $row['manager_reassignment'] = $pending[(int) ($row['ticket_ID'] ?? 0)] ?? null;
            return $row;
        }, $rows);
    }

    /**
     * The latest manager reassignment not yet acknowledged, keyed by ticket id.
     *
     * @param  int[]  $ticketIds
     * @return array<int, array>
     */
    public function pendingFor(array $ticketIds): array
    {
        $ticketIds = array_values(array_unique(array_filter(array_map('intval', $ticketIds))));
        if (empty($ticketIds)) {
            return [];
        }

        $rows = DB::table('ticket_audit_logs')
            ->whereIn('ticket_ID', $ticketIds)
            ->whereIn('action_type', [self::EVENT, self::ACK_EVENT])
            ->orderBy('log_ID')
            ->get(['log_ID', 'ticket_ID', 'action_type', 'details', 'created_at']);

        // Walk in order: a reassignment sets the notice, a later acknowledgement clears it.
        $latest = [];
        foreach ($rows as $row) {
            $id = (int) $row->ticket_ID;
            if ($row->action_type === self::ACK_EVENT) {
                unset($latest[$id]);
                continue;
            }
            $latest[$id] = $row;
        }

        return array_map(fn ($row) => $this->present($row), $latest);
    }

    public function pendingForTicket(int $ticketId): ?array
    {
        return $this->pendingFor([$ticketId])[$ticketId] ?? null;
    }

    /**
     * POST /tickets/{ticketId}/manager-reassignment/acknowledge (CS or admin).
     */
    public function acknowledge(int $ticketId, $user): array
    {
        if (!RoleHelper::isCsOrAdmin($user)) {
            return ['status' => 403, 'data' => ['message' => 'Only Customer Service or Administrators can acknowledge a manager reassignment.', 'code' => 'FORBIDDEN']];
        }
        if (!DB::table('tickets')->where('ticket_ID', $ticketId)->exists()) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found.', 'code' => 'NOT_FOUND']];
        }

        $pending = $this->pendingForTicket($ticketId);
        if (!$pending) {
            // Already acknowledged (possibly by another CS user): nothing left to clear.
            return ['status' => 200, 'data' => ['acknowledged' => false, 'manager_reassignment' => null]];
        }

        $actorId = (int) ($user->emp_id ?? $user->id ?? 0);
        $role = RoleHelper::normalizeRole($user);
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => self::ACK_EVENT,
            'event_type' => self::ACK_EVENT,
            'action_by_ID' => $actorId,
            'actor_type' => 'employee',
            'actor_role' => in_array($role, ['admin', 'superadmin'], true) ? $role : 'cs',
            'details' => json_encode(['log_id' => $pending['log_id']]),
            'is_system' => 0,
            'is_internal' => 1,
            'created_at' => now(),
        ]);

        return ['status' => 200, 'data' => ['acknowledged' => true, 'manager_reassignment' => null]];
    }

    protected function present(object $row): array
    {
        $details = json_decode((string) $row->details, true) ?: [];

        return [
            'log_id' => (int) $row->log_ID,
            'manager_id' => isset($details['manager_id']) ? (int) $details['manager_id'] : null,
            'manager_name' => $details['manager_name'] ?? 'Department Manager',
            'department' => $details['department'] ?? null,
            'added' => array_values($details['added'] ?? []),
            'removed' => array_values($details['removed'] ?? []),
            'reassigned_at' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : null,
        ];
    }
}
