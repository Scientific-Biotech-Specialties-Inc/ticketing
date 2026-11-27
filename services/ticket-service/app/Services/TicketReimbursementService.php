<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * TS side of the TS <-> SERMS reimbursement integration.
 *
 * - The employee who worked a Resolved or Closed ticket (assignee or delegated) files one claim,
 *   forwarded to SERMS with its receipts. SERMS owns the claim; TS keeps a local copy
 *   (ticket_reimbursements) so the ticket views do not depend on SERMS being up.
 * - Status reaches TS by pull (refreshed on view, at most once a minute) or by SERMS webhook.
 * - SERMS lists TS tickets through ticketsForSerms().
 *
 * Every public method returns ['status' => int, 'data' => array] for the controller to send.
 */
class TicketReimbursementService
{
    /** Ticket statuses that open reimbursement (the work is done). */
    public const ELIGIBLE_STATUSES = ['Resolved', 'Closed'];

    /** SERMS expense categories (names are accepted by SERMS in place of IDs). */
    public const CATEGORIES = ['Meals', 'Travel', 'Supplies', 'Accommodation', 'Transportation', 'Others'];

    /** A claim in this SERMS status is final; a new claim may be filed for the ticket. */
    public const TERMINAL_REJECTED = 'rejected';

    private const PULL_INTERVAL_SECONDS = 60;

    public function __construct(
        private SermsClient $serms,
        private TicketAccessService $access,
        private SLAService $slaService,
    ) {
    }

    /** GET /tickets/{ticketId}/reimbursement */
    public function show(int $ticketId, $user): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return $this->error(404, 'Ticket not found.');
        }
        if ($user instanceof \App\Models\Client || !$this->access->canView($user, $ticket)) {
            return $this->error(403, 'You do not have access to this ticket.');
        }

        $row = DB::table('ticket_reimbursements')->where('ticket_ID', $ticketId)->first();
        if ($row && $this->isStale($row)) {
            $row = $this->refreshFromSerms($row);
        }

        return [
            'status' => 200,
            'data' => [
                'data' => $row ? $this->present($row) : null,
                'eligible' => $this->isEligibleStatus($ticket),
                'can_submit' => $this->canSubmit($user, $ticket, $row),
                'categories' => self::CATEGORIES,
            ],
        ];
    }

    /**
     * POST /tickets/{ticketId}/reimbursement
     *
     * @param array{amount: float|string, expense_category: string, description: string, expense_date: string} $input
     * @param UploadedFile[] $receipts
     */
    public function submit(int $ticketId, $user, array $input, array $receipts): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return $this->error(404, 'Ticket not found.');
        }
        if ($user instanceof \App\Models\Client || !$this->worksOn($user, $ticket)) {
            return $this->error(403, 'Only the employee assigned to this ticket can request a reimbursement.');
        }
        if (!$this->isEligibleStatus($ticket)) {
            return $this->error(422, 'A reimbursement can be requested only once the ticket is Resolved or Closed.');
        }

        $existing = DB::table('ticket_reimbursements')->where('ticket_ID', $ticketId)->first();
        if ($existing && !$this->isRejected($existing->status)) {
            return [
                'status' => 409,
                'data' => ['message' => 'A reimbursement is already filed for this ticket.', 'data' => $this->present($existing)],
            ];
        }

        $empId = (int) ($user->emp_id ?? $user->id ?? 0);
        $name = trim(((string) ($user->first_name ?? '')) . ' ' . ((string) ($user->last_name ?? '')));
        if ($name === '') {
            $name = (string) ($user->name ?? $user->email ?? 'Employee');
        }

        $result = $this->serms->submit([
            'ticket_id' => $ticketId,
            'ticket_number' => (string) ($ticket->ticket_number ?? ''),
            'employee_email' => (string) ($user->email ?? ''),
            'employee_name' => $name,
            'employee_id' => $empId > 0 ? (string) $empId : null,
            'department' => (string) ($user->department ?? ''),
            'amount' => number_format((float) $input['amount'], 2, '.', ''),
            'expense_category' => $input['expense_category'],
            'description' => $input['description'],
            'expense_date' => $input['expense_date'],
        ], $receipts);

        if (!$result['ok']) {
            return $this->sermsFailure($result);
        }

        $body = $result['body'];
        $now = now();
        $values = [
            'submitted_by_emp_id' => $empId ?: null,
            'serms_reimbursement_id' => isset($body['reimbursement_id']) ? (string) $body['reimbursement_id'] : null,
            'reference_no' => $body['reference_no'] ?? null,
            'status' => $this->normalizeStatus($body['status'] ?? 'submitted'),
            'message' => $this->clip($body['message'] ?? null, 500),
            'amount' => round((float) $input['amount'], 2),
            'expense_category' => $input['expense_category'],
            'description' => $input['description'],
            'expense_date' => $input['expense_date'],
            'receipt_count' => count($receipts),
            'rejection_comment' => null,
            'approved_at' => null,
            'serms_updated_at' => $now,
            'last_synced_at' => $now,
            'submitted_at' => $now,
            'updated_at' => $now,
        ];

        DB::table('ticket_reimbursements')->updateOrInsert(
            ['ticket_ID' => $ticketId],
            $existing ? $values : $values + ['created_at' => $now]
        );

        $row = DB::table('ticket_reimbursements')->where('ticket_ID', $ticketId)->first();

        return [
            'status' => $result['status'] === 201 ? 201 : 200,
            'data' => ['message' => $body['message'] ?? 'Reimbursement submitted to SERMS.', 'data' => $this->present($row)],
        ];
    }

    /**
     * POST /internal/reimbursements/status (SERMS webhook).
     *
     * @param array{ticket_id: int, ticket_number?: ?string, reimbursement_id?: mixed, reference_no?: ?string,
     *              status: string, message?: ?string, rejection_comment?: ?string, updated_at?: ?string} $payload
     */
    public function applyWebhook(array $payload): array
    {
        $ticketId = (int) $payload['ticket_id'];
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return $this->error(404, 'Ticket not found.');
        }
        if (!empty($payload['ticket_number']) && (string) $ticket->ticket_number !== (string) $payload['ticket_number']) {
            return $this->error(422, 'ticket_number does not match ticket_id.');
        }

        $existing = DB::table('ticket_reimbursements')->where('ticket_ID', $ticketId)->first();
        $values = $this->statusValues($payload, $existing);
        if (!$existing) {
            $values['created_at'] = now();
            $values['submitted_at'] = now();
        }

        DB::table('ticket_reimbursements')->updateOrInsert(['ticket_ID' => $ticketId], $values);
        $row = DB::table('ticket_reimbursements')->where('ticket_ID', $ticketId)->first();

        return ['status' => 200, 'data' => ['message' => 'Reimbursement status updated.', 'data' => $this->present($row)]];
    }

    /** GET /internal/tickets (SERMS ticket picker). */
    public function ticketsForSerms(?string $search, ?string $status, int $limit): array
    {
        $limit = max(1, min(100, $limit));

        $query = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as s', 's.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as p', 'p.priority_ID', '=', 't.priority_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->select([
                't.*',
                's.status_name',
                'p.priority_name',
                'e.first_name as assignee_first_name',
                'e.last_name as assignee_last_name',
                'e.email as assignee_email',
            ]);

        $search = trim((string) $search);
        if ($search !== '') {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search) . '%';
            $query->where(function ($q) use ($like) {
                $q->where('t.ticket_number', 'like', $like)->orWhere('t.title', 'like', $like);
            });
        }

        $status = trim((string) $status);
        if ($status !== '') {
            $query->whereRaw('LOWER(s.status_name) = ?', [strtolower($status)]);
        }

        $departmentNames = [];
        $rows = $query->orderByDesc('t.updated_at')->orderByDesc('t.ticket_ID')->limit($limit)->get();

        $data = $rows->map(function ($t) use (&$departmentNames) {
            $deptId = $this->slaService->resolveDepartmentForTicket($t);
            if (!array_key_exists($deptId, $departmentNames)) {
                $departmentNames[$deptId] = DB::table('departments')->where('id', $deptId)->value('name');
            }
            $assigneeName = trim(((string) $t->assignee_first_name) . ' ' . ((string) $t->assignee_last_name));

            return [
                'ticket_id' => (int) $t->ticket_ID,
                'ticket_number' => $t->ticket_number,
                'title' => $t->title,
                'status' => $t->status_name,
                'priority' => $t->priority_name,
                'assignee_name' => $assigneeName !== '' ? $assigneeName : null,
                'assignee_email' => $t->assignee_email,
                'department' => $departmentNames[$deptId],
                'created_at' => $this->iso($t->created_at),
                'updated_at' => $this->iso($t->updated_at),
            ];
        })->values()->all();

        return ['status' => 200, 'data' => ['data' => $data]];
    }

    // ─── Rules ────────────────────────────────────────────────────────────────

    private function worksOn($user, object $ticket): bool
    {
        $empId = (int) ($user->emp_id ?? $user->id ?? 0);
        if ($empId <= 0) {
            return false;
        }
        if ((int) ($ticket->assigned_to ?? 0) === $empId) {
            return true;
        }

        return DB::table('ticket_assignments')
            ->where('ticket_ID', (int) $ticket->ticket_ID)
            ->where('employee_ID', $empId)
            ->exists();
    }

    private function canSubmit($user, object $ticket, ?object $row): bool
    {
        return $this->isEligibleStatus($ticket)
            && $this->worksOn($user, $ticket)
            && (!$row || $this->isRejected($row->status));
    }

    private function isEligibleStatus(object $ticket): bool
    {
        $name = DB::table('ticket_statuses')->where('ticket_status_ID', $ticket->ticket_status_ID)->value('status_name');

        return in_array($name, self::ELIGIBLE_STATUSES, true);
    }

    private function isRejected(?string $status): bool
    {
        return $this->normalizeStatus((string) $status) === self::TERMINAL_REJECTED;
    }

    private function isStale(object $row): bool
    {
        if ($this->isRejected($row->status) || !$this->serms->isConfigured()) {
            return false;
        }

        return !$row->last_synced_at
            || Carbon::parse($row->last_synced_at)->lt(now()->subSeconds(self::PULL_INTERVAL_SECONDS));
    }

    /** Pull the latest SERMS status. On any failure the cached row is kept and shown. */
    private function refreshFromSerms(object $row): object
    {
        $result = $this->serms->statusByTicket((int) $row->ticket_ID);
        $values = ['last_synced_at' => now()];

        if ($result['ok']) {
            $values = $this->statusValues($result['body'], $row) + $values;
            if (isset($result['body']['amount']) && is_numeric($result['body']['amount'])) {
                $values['amount'] = round((float) $result['body']['amount'], 2);
            }
            if (!empty($result['body']['approved_at'])) {
                $values['approved_at'] = $this->toDateTime($result['body']['approved_at']);
            }
        }

        DB::table('ticket_reimbursements')->where('ticket_reimbursement_ID', $row->ticket_reimbursement_ID)->update($values);

        return DB::table('ticket_reimbursements')->where('ticket_reimbursement_ID', $row->ticket_reimbursement_ID)->first();
    }

    /** Status fields shared by the pull and the webhook. */
    private function statusValues(array $body, ?object $existing): array
    {
        $status = $this->normalizeStatus((string) ($body['status'] ?? ($existing->status ?? 'submitted')));

        $values = [
            'status' => $status,
            'serms_reimbursement_id' => isset($body['reimbursement_id']) ? (string) $body['reimbursement_id'] : ($existing->serms_reimbursement_id ?? null),
            'reference_no' => $body['reference_no'] ?? ($existing->reference_no ?? null),
            'message' => $this->clip($body['message'] ?? ($existing->message ?? null), 500),
            'rejection_comment' => array_key_exists('rejection_comment', $body) ? $body['rejection_comment'] : ($existing->rejection_comment ?? null),
            'serms_updated_at' => $this->toDateTime($body['updated_at'] ?? null) ?? now(),
            'last_synced_at' => now(),
            'updated_at' => now(),
        ];

        if ($status === 'approved' && empty($existing->approved_at)) {
            $values['approved_at'] = now();
        }

        return $values;
    }

    private function sermsFailure(array $result): array
    {
        $body = $result['body'];

        return match (true) {
            $result['status'] === 422 => [
                'status' => 422,
                'data' => array_filter([
                    'message' => $body['message'] ?? 'SERMS rejected the reimbursement request.',
                    'errors' => $body['errors'] ?? null,
                ]),
            ],
            in_array($result['status'], [401, 403], true) => $this->error(502, 'SERMS refused the request (integration credentials). Please contact an administrator.'),
            default => $this->error(502, $result['status'] === 0
                ? ($body['message'] ?? 'SERMS could not be reached. Please try again later.')
                : 'SERMS could not process the request. Please try again later.'),
        };
    }

    // ─── Presentation & helpers ──────────────────────────────────────────────

    private function present(object $row): array
    {
        return [
            'ticket_id' => (int) $row->ticket_ID,
            'reimbursement_id' => $row->serms_reimbursement_id,
            'reference_no' => $row->reference_no,
            'status' => $row->status,
            'message' => $row->message,
            'amount' => $row->amount !== null ? (float) $row->amount : null,
            'expense_category' => $row->expense_category,
            'description' => $row->description,
            'expense_date' => $row->expense_date ? substr((string) $row->expense_date, 0, 10) : null,
            'receipt_count' => (int) $row->receipt_count,
            'rejection_comment' => $row->rejection_comment,
            'approved_at' => $this->iso($row->approved_at),
            'submitted_at' => $this->iso($row->submitted_at),
            'updated_at' => $this->iso($row->serms_updated_at ?? $row->updated_at),
            'can_resubmit' => $this->isRejected($row->status),
        ];
    }

    /** SERMS statuses are compared case-insensitively ("Rejected" == "rejected"); stored lowercase with underscores. */
    private function normalizeStatus(string $status): string
    {
        $status = strtolower(trim($status));
        $status = preg_replace('/[\s-]+/', '_', $status) ?? $status;

        return $status !== '' ? substr($status, 0, 40) : 'submitted';
    }

    private function clip(?string $value, int $max): ?string
    {
        return $value === null ? null : mb_substr($value, 0, $max);
    }

    private function toDateTime($value): ?Carbon
    {
        if (empty($value)) {
            return null;
        }
        try {
            return Carbon::parse($value)->setTimezone(config('app.timezone'));
        } catch (\Throwable) {
            return null;
        }
    }

    private function iso($value): ?string
    {
        return $value ? Carbon::parse($value)->toIso8601String() : null;
    }

    private function error(int $status, string $message): array
    {
        return ['status' => $status, 'data' => ['message' => $message]];
    }
}
