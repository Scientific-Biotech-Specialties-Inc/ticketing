<?php

namespace App\Services;

use App\Exceptions\HoldRequestConflictException;
use App\Exceptions\InvalidTicketTransitionException;
use App\Helpers\RoleHelper;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0048: employees ask Customer Service to put a ticket On Hold; CS approves or rejects.
 *
 * Approval runs the existing hold transition (TicketService::holdTicket), which closes the
 * request inside its own transaction (HoldRequestRecorder::closeForHold), so a ticket is held
 * if and only if CS approved it. Every method returns ['status' => int, 'data' => array].
 */
class HoldRequestService
{
    public function __construct(
        protected TicketService $ticketService,
        protected TicketStateMachine $stateMachine,
        protected HoldRequestRecorder $recorder,
        protected TicketNotificationService $notificationService,
        protected TicketCacheService $cacheService
    ) {
    }

    /**
     * POST /tickets/{ticketId}/hold-requests (AC-3, AC-4).
     */
    public function create(int $ticketId, $user, string $remarks): array
    {
        $empId = $this->employeeId($user);
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return $this->error(404, 'Ticket not found.', 'NOT_FOUND');
        }
        if (!$empId || !$this->isAssigned($ticketId, $empId)) {
            return $this->error(403, 'Only an employee assigned to this ticket can request On Hold.', 'NOT_ASSIGNED');
        }

        try {
            $requestId = DB::transaction(function () use ($ticketId, $empId, $remarks) {
                // Serialises concurrent requests for one ticket: at most one pending row.
                $locked = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();

                $currentState = $this->stateMachine->resolveState($locked);
                if ($currentState === TicketStateMachine::STATE_ON_HOLD) {
                    throw new HoldRequestConflictException('TICKET_ON_HOLD', 'This ticket is already On Hold.', 422);
                }

                try {
                    $this->stateMachine->validateTransition($locked, $currentState, TicketStateMachine::STATE_ON_HOLD);
                } catch (InvalidTicketTransitionException $e) {
                    throw new HoldRequestConflictException('INVALID_TICKET_TRANSITION', $e->getMessage(), 422);
                }

                if ($this->pendingQuery($ticketId)->exists()) {
                    throw new HoldRequestConflictException('HOLD_REQUEST_PENDING', 'An On Hold request is already pending CS review for this ticket.', 409);
                }

                $hasPendingReassign = DB::table('reassignment_requests')
                    ->where('ticket_id', $ticketId)
                    ->where('status', 'pending')
                    ->exists();
                if ($hasPendingReassign) {
                    throw new HoldRequestConflictException('REASSIGNMENT_PENDING', 'A reassignment request is pending for this ticket. Wait for CS to decide it first.', 409);
                }

                $id = DB::table(HoldRequestRecorder::TABLE)->insertGetId([
                    'ticket_ID' => $ticketId,
                    'requested_by_emp_id' => $empId,
                    'remarks' => $remarks,
                    'status' => HoldRequestRecorder::STATUS_PENDING,
                    'requested_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $this->recorder->writeAudit($ticketId, 'hold_requested', $empId, 'employee', [
                    'hold_request_id' => (int) $id,
                    'remarks' => $remarks,
                ]);

                return (int) $id;
            });
        } catch (HoldRequestConflictException $e) {
            return $this->error($e->httpStatus, $e->getMessage(), $e->errorCode);
        }

        $this->afterChange($ticketId, 'hold_request_created');

        // AC-8: every CS user gets an in app notification that opens the ticket.
        try {
            $ref = TicketNumberGeneratorService::refFor($ticketId);
            $name = $this->employeeName($empId) ?: 'An employee';
            $this->notificationService->notifyCS(
                'On Hold Requested',
                "{$name} requested On Hold for {$ref}",
                $ticketId,
                ['type' => 'hold_request', 'ticket_id' => $ticketId, 'ticket_ref' => $ref, 'hold_request_id' => $requestId],
                null,
                'status_update'
            );
        } catch (\Throwable $e) {
            Log::warning("Failed to notify CS of hold request {$requestId}: " . $e->getMessage());
        }

        return ['status' => 201, 'data' => ['hold_request' => $this->present($this->find($requestId))]];
    }

    /**
     * POST /hold-requests/{id}/cancel (AC-7). Only the requester.
     */
    public function cancel(int $requestId, $user): array
    {
        $row = $this->find($requestId);
        if (!$row) {
            return $this->error(404, 'Hold request not found.', 'NOT_FOUND');
        }
        $empId = $this->employeeId($user);
        if (!$empId || (int) $row->requested_by_emp_id !== $empId) {
            return $this->error(403, 'Only the employee who sent this request can cancel it.', 'FORBIDDEN');
        }

        $closed = DB::transaction(fn () => $this->recorder->cancelPending(
            (int) $row->ticket_ID,
            'cancelled by requester',
            $empId,
            'employee',
            $requestId
        ));
        if ($closed === 0) {
            return $this->notPending();
        }

        $this->afterChange((int) $row->ticket_ID, 'hold_request_cancelled');

        return ['status' => 200, 'data' => ['hold_request' => $this->present($this->find($requestId))]];
    }

    /**
     * POST /hold-requests/{id}/approve (AC-10, AC-12, AC-17).
     */
    public function approve(int $requestId, $user, ?string $note): array
    {
        $row = $this->find($requestId);
        if (!$row) {
            return $this->error(404, 'Hold request not found.', 'NOT_FOUND');
        }
        if (!RoleHelper::isCsOrAdmin($user)) {
            return $this->error(403, 'Only Customer Service or Administrators can approve a hold request.', 'FORBIDDEN');
        }
        if ($row->status !== HoldRequestRecorder::STATUS_PENDING) {
            return $this->notPending();
        }

        $ticketId = (int) $row->ticket_ID;
        $requesterId = (int) $row->requested_by_emp_id;

        // AC-17: the requester must still be assigned, otherwise the request is void.
        if (!$this->isAssigned($ticketId, $requesterId)) {
            $closed = DB::transaction(fn () => $this->recorder->cancelPending(
                $ticketId,
                'requester no longer assigned',
                0,
                'system',
                $requestId
            ));
            if ($closed > 0) {
                $this->afterChange($ticketId, 'hold_request_cancelled');
            }
            return $this->error(409, 'The employee who sent this request is no longer assigned, so the request was cancelled.', 'REQUESTER_NOT_ASSIGNED');
        }

        $note = $note !== null && trim($note) !== '' ? trim($note) : null;

        try {
            $result = $this->ticketService->holdTicket($ticketId, $user, (string) $row->remarks, [
                'hold_request_id' => $requestId,
                'hold_request_note' => $note,
                'skip_assignee_notify_emp_id' => $requesterId,
            ]);
        } catch (HoldRequestConflictException $e) {
            return $this->error($e->httpStatus, $e->getMessage(), $e->errorCode);
        }

        if (($result['status'] ?? 500) !== 200) {
            return $result;
        }
        // The ticket was already On Hold (another CS user won the race), so nothing was approved here.
        if (empty($result['data']['transitioned'])) {
            return $this->notPending();
        }

        $this->notifyRequester($requesterId, $ticketId, 'Hold Request Approved', 'Hold request approved for {ref}', 'hold_request_approved', $requestId);

        return [
            'status' => 200,
            'data' => [
                'hold_request' => $this->present($this->find($requestId)),
                'ticket_status' => 'On Hold',
            ],
        ];
    }

    /**
     * POST /hold-requests/{id}/reject (AC-11, AC-12). The ticket is unchanged.
     */
    public function reject(int $requestId, $user, string $reason): array
    {
        $row = $this->find($requestId);
        if (!$row) {
            return $this->error(404, 'Hold request not found.', 'NOT_FOUND');
        }
        if (!RoleHelper::isCsOrAdmin($user)) {
            return $this->error(403, 'Only Customer Service or Administrators can reject a hold request.', 'FORBIDDEN');
        }

        $ticketId = (int) $row->ticket_ID;
        $reviewerId = (int) ($user->emp_id ?? $user->id ?? 0);
        $role = RoleHelper::normalizeRole($user);
        $actorType = in_array($role, ['admin', 'superadmin'], true) ? $role : 'cs';

        $rejected = DB::transaction(function () use ($requestId, $ticketId, $reviewerId, $actorType, $reason) {
            $locked = DB::table(HoldRequestRecorder::TABLE)->where('hold_request_ID', $requestId)->lockForUpdate()->first();
            if (!$locked || $locked->status !== HoldRequestRecorder::STATUS_PENDING) {
                return false;
            }

            DB::table(HoldRequestRecorder::TABLE)->where('hold_request_ID', $requestId)->update([
                'status' => HoldRequestRecorder::STATUS_REJECTED,
                'reviewed_by_id' => $reviewerId > 0 ? $reviewerId : null,
                'review_note' => $reason,
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);

            // ticket_status_ID is kept so the employee banner can hide once the status changes (AC-12).
            $this->recorder->writeAudit($ticketId, 'hold_request_rejected', $reviewerId, $actorType, [
                'hold_request_id' => $requestId,
                'reason' => $reason,
                'ticket_status_ID' => (int) DB::table('tickets')->where('ticket_ID', $ticketId)->value('ticket_status_ID'),
            ]);

            return true;
        });

        if (!$rejected) {
            return $this->notPending();
        }

        $this->afterChange($ticketId, 'hold_request_rejected');
        $this->notifyRequester((int) $row->requested_by_emp_id, $ticketId, 'Hold Request Rejected', "Hold request rejected for {ref}: {$reason}", 'hold_request_rejected', $requestId);

        return ['status' => 200, 'data' => ['hold_request' => $this->present($this->find($requestId))]];
    }

    /**
     * GET /internal/tickets/{ticketId}/hold-requests/pending (employee-service guard).
     */
    public function pendingStatus(int $ticketId): array
    {
        if (!DB::table('tickets')->where('ticket_ID', $ticketId)->exists()) {
            return $this->error(404, 'Ticket not found.', 'NOT_FOUND');
        }

        return ['status' => 200, 'data' => ['pending' => $this->pendingQuery($ticketId)->exists()]];
    }

    /**
     * Staff ticket details fields (AC-9, AC-12). Never called for customers.
     *
     * @return array{pending_hold_request: ?array, latest_rejected_hold_request: ?array}
     */
    public function detailsFor(object $ticket): array
    {
        $ticketId = (int) $ticket->ticket_ID;
        $pending = $this->pendingQuery($ticketId)->orderByDesc('hold_request_ID')->first();

        $rejected = null;
        if (!$pending) {
            $latest = DB::table(HoldRequestRecorder::TABLE)->where('ticket_ID', $ticketId)->orderByDesc('hold_request_ID')->first();
            if ($latest && $latest->status === HoldRequestRecorder::STATUS_REJECTED) {
                // Shown until the employee files a new request (it would be the latest) or the status changes.
                $audit = DB::table('ticket_audit_logs')
                    ->where('ticket_ID', $ticketId)
                    ->where('action_type', 'hold_request_rejected')
                    ->orderByDesc('log_ID')
                    ->value('details');
                $statusAtRejection = (int) (json_decode((string) $audit, true)['ticket_status_ID'] ?? 0);
                if ($statusAtRejection === 0 || $statusAtRejection === (int) $ticket->ticket_status_ID) {
                    $rejected = $latest;
                }
            }
        }

        return [
            'pending_hold_request' => $pending ? $this->present($pending) : null,
            'latest_rejected_hold_request' => $rejected ? $this->present($rejected) : null,
        ];
    }

    /**
     * Status column display for staff ticket lists: ticket id => 'pending' | 'rejected'.
     * Same rule as detailsFor(): 'rejected' only while the latest request is the rejected one
     * and the ticket still has the status it had when CS rejected it. Never sent to customers.
     *
     * @param  array<int|string> $ticketIds
     * @return array<int, string>
     */
    public function statesFor(array $ticketIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ticketIds))));
        if (empty($ids)) {
            return [];
        }

        $latestIds = DB::table(HoldRequestRecorder::TABLE)
            ->whereIn('ticket_ID', $ids)
            ->groupBy('ticket_ID')
            ->selectRaw('MAX(hold_request_ID) as id')
            ->pluck('id');
        if ($latestIds->isEmpty()) {
            return [];
        }

        $latest = DB::table(HoldRequestRecorder::TABLE)
            ->whereIn('hold_request_ID', $latestIds)
            ->whereIn('status', [HoldRequestRecorder::STATUS_PENDING, HoldRequestRecorder::STATUS_REJECTED])
            ->get(['ticket_ID', 'status']);

        $rejectedTicketIds = $latest->where('status', HoldRequestRecorder::STATUS_REJECTED)->pluck('ticket_ID')->map(fn ($v) => (int) $v)->all();
        $currentStatus = [];
        $statusAtRejection = [];
        if (!empty($rejectedTicketIds)) {
            $currentStatus = DB::table('tickets')->whereIn('ticket_ID', $rejectedTicketIds)->pluck('ticket_status_ID', 'ticket_ID')->all();
            DB::table('ticket_audit_logs')
                ->whereIn('ticket_ID', $rejectedTicketIds)
                ->where('action_type', 'hold_request_rejected')
                ->orderByDesc('log_ID')
                ->get(['ticket_ID', 'details'])
                ->each(function ($row) use (&$statusAtRejection) {
                    $tid = (int) $row->ticket_ID;
                    if (!array_key_exists($tid, $statusAtRejection)) {
                        $statusAtRejection[$tid] = (int) (json_decode((string) $row->details, true)['ticket_status_ID'] ?? 0);
                    }
                });
        }

        $states = [];
        foreach ($latest as $row) {
            $tid = (int) $row->ticket_ID;
            if ($row->status === HoldRequestRecorder::STATUS_PENDING) {
                $states[$tid] = 'pending';
                continue;
            }
            $atRejection = $statusAtRejection[$tid] ?? 0;
            if ($atRejection === 0 || $atRejection === (int) ($currentStatus[$tid] ?? 0)) {
                $states[$tid] = 'rejected';
            }
        }

        return $states;
    }

    /**
     * Adds hold_request_state ('pending' | 'rejected' | null) to each staff list row (keyed by ticket_ID).
     *
     * @param  array<int, array> $rows
     * @return array<int, array>
     */
    public function annotateRows(array $rows): array
    {
        $states = $this->statesFor(array_map(fn ($r) => $r['ticket_ID'] ?? 0, $rows));
        foreach ($rows as $i => $row) {
            $rows[$i]['hold_request_state'] = $states[(int) ($row['ticket_ID'] ?? 0)] ?? null;
        }
        return $rows;
    }

    /**
     * The hold_request shape from the spec's API surface.
     */
    public function present(?object $row): ?array
    {
        if (!$row) {
            return null;
        }

        $iso = fn ($v) => $v ? Carbon::parse($v)->toIso8601String() : null;
        $requesterId = (int) $row->requested_by_emp_id;
        $reviewerId = $row->reviewed_by_id ? (int) $row->reviewed_by_id : null;

        return [
            'id' => (int) $row->hold_request_ID,
            'ticket_id' => (int) $row->ticket_ID,
            'status' => $row->status,
            'remarks' => $row->remarks,
            'requested_by' => ['id' => $requesterId, 'name' => $this->employeeName($requesterId)],
            'requested_at' => $iso($row->requested_at),
            'reviewed_by' => $reviewerId ? ['id' => $reviewerId, 'name' => $this->employeeName($reviewerId)] : null,
            'review_note' => $row->review_note,
            'reviewed_at' => $iso($row->reviewed_at),
        ];
    }

    // ─── helpers ────────────────────────────────────────────────────────────

    protected function find(int $requestId): ?object
    {
        return DB::table(HoldRequestRecorder::TABLE)->where('hold_request_ID', $requestId)->first();
    }

    protected function pendingQuery(int $ticketId)
    {
        return DB::table(HoldRequestRecorder::TABLE)
            ->where('ticket_ID', $ticketId)
            ->where('status', HoldRequestRecorder::STATUS_PENDING);
    }

    /** The verified employee identity on the request, never the body. Customers have none. */
    protected function employeeId($user): ?int
    {
        if (!$user || $user instanceof \App\Models\Client) {
            return null;
        }
        $id = (int) ($user->emp_id ?? 0);
        return $id > 0 ? $id : null;
    }

    protected function isAssigned(int $ticketId, int $empId): bool
    {
        return DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $empId)
            ->whereNull('completed_at')
            ->exists();
    }

    /** @var array<int, string> */
    private array $names = [];

    protected function employeeName(int $empId): string
    {
        if (!isset($this->names[$empId])) {
            $row = DB::table('employees')->where('emp_id', $empId)->first(['first_name', 'last_name']);
            $this->names[$empId] = $row ? trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? '')) : '';
        }
        return $this->names[$empId];
    }

    /** AC-18: live refresh for the CS modal and the employee page. */
    protected function afterChange(int $ticketId, string $action): void
    {
        $this->cacheService->clearTicketCaches($ticketId);
        try {
            $this->notificationService->broadcastTicketChange($action, $ticketId);
        } catch (\Throwable $e) {
            Log::warning("Failed to broadcast {$action} for ticket {$ticketId}: " . $e->getMessage());
        }
    }

    protected function notifyRequester(int $empId, int $ticketId, string $title, string $template, string $type, int $requestId): void
    {
        try {
            $ref = TicketNumberGeneratorService::refFor($ticketId);
            $this->notificationService->notifyRecipient(
                $empId,
                'employee',
                $title,
                str_replace('{ref}', $ref, $template),
                $ticketId,
                ['type' => $type, 'ticket_id' => $ticketId, 'ticket_ref' => $ref, 'hold_request_id' => $requestId],
                'status_update'
            );
        } catch (\Throwable $e) {
            Log::warning("Failed to notify requester of hold request {$requestId}: " . $e->getMessage());
        }
    }

    protected function notPending(): array
    {
        return $this->error(409, 'This hold request has already been decided or cancelled.', 'HOLD_REQUEST_NOT_PENDING');
    }

    protected function error(int $status, string $message, string $code): array
    {
        return ['status' => $status, 'data' => ['message' => $message, 'code' => $code]];
    }
}
