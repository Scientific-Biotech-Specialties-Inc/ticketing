<?php

namespace App\Services;

use App\Exceptions\HoldRequestConflictException;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0048: database only writer for hold_requests rows and their internal audit rows.
 *
 * Every method must run inside the caller's transaction (the hold transition, any other
 * state transition, or a HoldRequestService action), so a request is closed together with
 * the ticket change that closed it, or not at all.
 */
class HoldRequestRecorder
{
    public const TABLE = 'hold_requests';

    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_CANCELLED = 'cancelled';

    public const VIA_REQUEST = 'request';
    public const VIA_DIRECT_HOLD = 'direct_hold';

    /**
     * The ticket just entered On Hold through the hold transition.
     *
     * With $holdRequestId (CS approving a request, AC-10): lock that row and abort the whole
     * transaction when it is no longer pending (AC-17, the double approve race).
     * Without it (CS direct Hold, AC-13): close any pending request as approved via direct_hold.
     */
    public function closeForHold(int $ticketId, ?int $holdRequestId, int $actorId, string $actorType, ?string $note = null): void
    {
        if ($holdRequestId) {
            $row = DB::table(self::TABLE)
                ->where('hold_request_ID', $holdRequestId)
                ->where('ticket_ID', $ticketId)
                ->lockForUpdate()
                ->first();

            if (!$row || $row->status !== self::STATUS_PENDING) {
                throw new HoldRequestConflictException();
            }
            $via = self::VIA_REQUEST;
        } else {
            $row = DB::table(self::TABLE)
                ->where('ticket_ID', $ticketId)
                ->where('status', self::STATUS_PENDING)
                ->lockForUpdate()
                ->first();

            if (!$row) {
                return;
            }
            $via = self::VIA_DIRECT_HOLD;
            $note = null;
        }

        DB::table(self::TABLE)->where('hold_request_ID', $row->hold_request_ID)->update([
            'status' => self::STATUS_APPROVED,
            'reviewed_by_id' => $actorId > 0 ? $actorId : null,
            'review_note' => $note,
            'reviewed_at' => now(),
            'updated_at' => now(),
        ]);

        $this->writeAudit($ticketId, 'hold_request_approved', $actorId, $actorType, [
            'hold_request_id' => (int) $row->hold_request_ID,
            'note' => $note,
            'via' => $via,
        ]);
    }

    /**
     * Close every pending request on the ticket as cancelled (AC-7 by the requester, AC-16 and
     * AC-17 by the system). Returns the number of rows closed.
     */
    public function cancelPending(int $ticketId, string $detail, int $actorId = 0, string $actorType = 'system', ?int $onlyRequestId = null): int
    {
        $query = DB::table(self::TABLE)
            ->where('ticket_ID', $ticketId)
            ->where('status', self::STATUS_PENDING);
        if ($onlyRequestId) {
            $query->where('hold_request_ID', $onlyRequestId);
        }
        $rows = $query->lockForUpdate()->get();

        foreach ($rows as $row) {
            DB::table(self::TABLE)->where('hold_request_ID', $row->hold_request_ID)->update([
                'status' => self::STATUS_CANCELLED,
                'reviewed_by_id' => null,
                'review_note' => $detail,
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);

            $this->writeAudit($ticketId, 'hold_request_cancelled', $actorId, $actorType, [
                'hold_request_id' => (int) $row->hold_request_ID,
                'details' => $detail,
            ]);
        }

        return $rows->count();
    }

    /**
     * AC-16: called from a state transition that does not end in On Hold.
     */
    public function cancelForTransition(int $ticketId, ?int $targetStatusId): int
    {
        $statusName = $targetStatusId
            ? (DB::table('ticket_statuses')->where('ticket_status_ID', $targetStatusId)->value('status_name') ?: "status {$targetStatusId}")
            : 'a new status';

        return $this->cancelPending($ticketId, "ticket moved to {$statusName}");
    }

    /**
     * AC-14: every hold request step is an internal (staff only) timeline row.
     */
    public function writeAudit(int $ticketId, string $action, int $actorId, string $actorType, array $details): void
    {
        $isSystem = $actorType === 'system' || $actorId <= 0;

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => $action,
            'event_type' => $action,
            'action_by_ID' => $isSystem ? 0 : $actorId,
            'actor_type' => $isSystem ? 'system' : $actorType,
            'actor_role' => $isSystem ? null : $actorType,
            'before_state' => null,
            'after_state' => null,
            'details' => json_encode($details),
            'is_system' => $isSystem ? 1 : 0,
            'is_internal' => 1,
            'created_at' => now(),
        ]);
    }
}
