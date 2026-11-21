<?php

namespace App\Services;

use App\Models\Message;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Lets the managers a ticket was escalated to read and join its conversation.
 *
 * Who was escalated to is owned by ticket-service (GET /internal/tickets/{id}/escalation-managers);
 * this service never reads ticket-service tables for it. A manager reads the thread once escalated
 * to and posts after joining, which leaves one "joined the conversation" system message.
 */
class EscalationAccess
{
    public const JOIN_EVENT = 'manager_joined';

    /** @var array<int, int[]> manager ids per ticket, per request */
    protected array $cache = [];

    public function isEscalationManager(int $ticketId, int $empId): bool
    {
        if ($ticketId <= 0 || $empId <= 0) {
            return false;
        }

        if (!array_key_exists($ticketId, $this->cache)) {
            $this->cache[$ticketId] = [];
            try {
                $base = rtrim((string) env('TICKET_SERVICE_URL', 'http://ticket-service:8000'), '/');
                $res = Http::timeout(3)
                    ->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')])
                    ->get("{$base}/api/internal/tickets/{$ticketId}/escalation-managers");
                if ($res->successful()) {
                    $this->cache[$ticketId] = array_map('intval', (array) $res->json('manager_ids', []));
                }
            } catch (\Throwable $e) {
                // Fail closed: without an answer the manager is treated as not escalated to.
                Log::warning("Escalation manager lookup failed for ticket {$ticketId}: " . $e->getMessage());
            }
        }

        return in_array($empId, $this->cache[$ticketId], true);
    }

    public function hasJoined(int $ticketId, int $empId): bool
    {
        return Message::where('ticket_id', $ticketId)
            ->where('event', self::JOIN_EVENT)
            ->where('joined_emp_id', $empId)
            ->exists();
    }

    /** "Service Manager", "IT Manager", or "Manager" when the department is unknown. */
    public static function roleLabel($employee): string
    {
        $dept = trim((string) ($employee->department ?? ''));
        if ($dept === '') {
            return 'Manager';
        }

        return (strtolower($dept) === 'it' ? 'IT' : ucwords(strtolower($dept))) . ' Manager';
    }
}
