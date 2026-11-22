<?php

namespace App\Services;

use App\Exceptions\PrsRequestException;
use App\Models\Employee;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * PRS -> TS internal ticket intake.
 *
 * PRS raises tickets on behalf of a staff member who already exists in the auth service, so every
 * ticket created here is an INTERNAL ticket: is_internal = true, requested_by = the employee's
 * emp_id, equipment named as free text (no customer machine is touched). The write itself goes
 * through TicketService::createInternalTicket so a PRS ticket picks up ticket numbering, SLA
 * assignment, audit logging, notifications, the Reverb broadcast and cache invalidation exactly as
 * a ticket typed into the employee UI does.
 *
 * Everything PRS specific lives here: identity resolution by email, reference data mapping
 * (category / priority / branch), attachment pass-through to attachment-service, and the
 * prs_ticket_requests ledger that makes a retried push idempotent.
 */
class PrsTicketService
{
    public function __construct(
        protected TicketService $ticketService,
        protected CategoryTrack $categoryTrack
    ) {}

    /**
     * Accept a PRS ticket push.
     *
     * @param array<string, mixed> $data  Validated request fields.
     * @param UploadedFile[] $files       Raw uploads, forwarded to attachment-service for scanning.
     * @return array{payload: array<string, mixed>, duplicate: bool}
     *
     * @throws PrsRequestException
     */
    public function create(array $data, array $files = []): array
    {
        $requestId = trim((string) $data['prs_request_id']);

        // Idempotency first: a retry after a dropped tunnel must not raise a second ticket.
        $existing = DB::table('prs_ticket_requests')->where('prs_request_id', $requestId)->first();
        if ($existing && $existing->ticket_ID && $this->ticketExists((int) $existing->ticket_ID)) {
            return ['payload' => $this->payload((int) $existing->ticket_ID, $existing), 'duplicate' => true];
        }

        $employee = $this->resolveEmployee((string) $data['email']);
        $categoryId = $this->resolveCategory((string) $data['category']);
        $priorityId = $this->resolvePriority($data['priority'] ?? null);
        $branchSlug = $this->resolveBranch($data['branch'] ?? null);

        // Equipment is named as free text on internal tickets; the serial / brand / model PRS sends
        // have no column on `tickets`, so they live on the ledger row and are echoed back on reads.
        $equipmentName = $this->equipmentLabel($data);

        $attachmentIds = $files === [] ? [] : $this->uploadAttachments($files, $employee);

        $validated = [
            'machine_ID' => null,
            'equipment_name' => $equipmentName,
            'problem_category_ID' => $categoryId,
            'priority_ID' => $priorityId,
            'branch_id' => $branchSlug,
            'title' => trim((string) $data['title']),
            'description' => trim((string) ($data['description'] ?? '')) ?: ('Raised from PRS for ' . $equipmentName . '.'),
            'attachments' => $attachmentIds,
        ];

        $result = $this->ticketService->createInternalTicket(
            $validated,
            $employee,
            $this->categoryTrack->departmentIdFor($categoryId)
        );

        $ticketId = (int) ($result['ticket']->ticket_ID ?? 0);
        if ($ticketId <= 0) {
            throw new PrsRequestException('Ticket creation did not return an id.', 'TICKET_NOT_CREATED', 500);
        }

        // TicketService creates internal tickets with origin 'manual'; mark PRS ones so dashboards
        // and reports can tell where they came from.
        DB::table('tickets')->where('ticket_ID', $ticketId)->update(['origin' => 'prs']);

        $ledger = $this->recordLedger($requestId, $data, $employee, $ticketId, $existing->id ?? null);

        return ['payload' => $this->payload($ticketId, $ledger), 'duplicate' => false];
    }

    /**
     * Current state of a ticket PRS raised. Only tickets that came from PRS are visible here, so the
     * shared secret cannot be used to enumerate the whole ticket table.
     *
     * @return array<string, mixed>
     *
     * @throws PrsRequestException
     */
    public function show(int $ticketId): array
    {
        $ledger = DB::table('prs_ticket_requests')->where('ticket_ID', $ticketId)->first();
        if (!$ledger || !$this->ticketExists($ticketId)) {
            throw new PrsRequestException('No PRS ticket found for that id.', 'TICKET_NOT_FOUND', 404);
        }

        return $this->payload($ticketId, $ledger);
    }

    // ─── Identity & reference data ───────────────────────────────────────────────

    /** @throws PrsRequestException */
    protected function resolveEmployee(string $email): Employee
    {
        $email = strtolower(trim($email));
        $employee = Employee::whereRaw('LOWER(email) = ?', [$email])->first();

        if (!$employee) {
            throw new PrsRequestException(
                "No staff account exists for {$email}. The requester must be an active employee.",
                'EMPLOYEE_NOT_FOUND'
            );
        }

        if (isset($employee->is_active) && !(bool) $employee->is_active) {
            throw new PrsRequestException(
                "The staff account for {$email} is deactivated.",
                'EMPLOYEE_INACTIVE'
            );
        }

        return $employee;
    }

    /** @throws PrsRequestException */
    protected function resolveCategory(string $category): int
    {
        $category = trim($category);

        $id = ctype_digit($category)
            ? DB::table('problem_categories')->where('problem_category_ID', (int) $category)->value('problem_category_ID')
            : DB::table('problem_categories')->whereRaw('LOWER(category_name) = ?', [strtolower($category)])->value('problem_category_ID');

        if (!$id) {
            throw new PrsRequestException(
                "Unknown category \"{$category}\".",
                'UNKNOWN_CATEGORY',
                422,
                ['valid_categories' => DB::table('problem_categories')->where('is_active', true)->pluck('category_name')->all()]
            );
        }

        return (int) $id;
    }

    /** @throws PrsRequestException */
    protected function resolvePriority(?string $priority): ?int
    {
        $priority = trim((string) $priority);
        if ($priority === '') {
            return null; // TicketService applies the configured default.
        }

        $id = DB::table('ticket_priorities')
            ->whereRaw('LOWER(priority_name) = ?', [strtolower($priority)])
            ->value('priority_ID');

        if (!$id) {
            throw new PrsRequestException(
                "Unknown priority \"{$priority}\".",
                'UNKNOWN_PRIORITY',
                422,
                ['valid_priorities' => DB::table('ticket_priorities')->pluck('priority_name')->all()]
            );
        }

        return (int) $id;
    }

    /**
     * Accepts a branch slug, name or code and returns the slug (tickets.branch_id holds the slug).
     * Null when PRS sends none, which lets TicketBranchResolver fall back to the requesting
     * employee's own branch. An unrecognised branch is rejected rather than silently dropped,
     * because the branch drives routing and the SLA policy.
     *
     * @throws PrsRequestException
     */
    protected function resolveBranch(?string $branch): ?string
    {
        $branch = trim((string) $branch);
        if ($branch === '') {
            return null;
        }

        $needle = strtolower($branch);
        $slug = DB::table('branches')
            ->where('is_active', true)
            ->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(slug) = ?', [$needle])
                  ->orWhereRaw('LOWER(name) = ?', [$needle])
                  ->orWhereRaw('LOWER(code) = ?', [$needle]);
            })
            ->value('slug');

        if (!$slug) {
            throw new PrsRequestException(
                "Unknown branch \"{$branch}\".",
                'UNKNOWN_BRANCH',
                422,
                ['valid_branches' => DB::table('branches')->where('is_active', true)->pluck('slug')->all()]
            );
        }

        return (string) $slug;
    }

    /**
     * One readable label for the ticket row, e.g.
     * "Ultrasound Scanner (GE Vivid S70, SN: ABC-123)". Capped at the column's 150 chars.
     */
    protected function equipmentLabel(array $data): string
    {
        $name = trim((string) $data['equipment_name']);

        $makeModel = implode(' ', array_filter([
            trim((string) ($data['brand'] ?? '')),
            trim((string) ($data['model'] ?? '')),
        ], fn ($v) => $v !== ''));

        $serial = trim((string) ($data['serial_number'] ?? ''));

        $suffix = array_filter([
            $makeModel,
            $serial === '' ? '' : "SN: {$serial}",
        ], fn ($v) => $v !== '');

        $label = $suffix === [] ? $name : $name . ' (' . implode(', ', $suffix) . ')';

        return mb_substr($label, 0, 150);
    }

    // ─── Attachments ─────────────────────────────────────────────────────────────

    /**
     * Forward PRS uploads to attachment-service, which streams every file to the ClamAV daemon
     * before persistence. PRS never talks to attachment-service directly and never receives an
     * attachment id until the file is clean.
     *
     * attachment-service resolves the uploader from a bearer token, and a PRS push has none: it is
     * a service to service call with no user session. We therefore authenticate with the cluster
     * INTERNAL_TOKEN and name the staff member we already resolved from the email, so the stored
     * attachment still records who it belongs to.
     *
     * @param UploadedFile[] $files
     * @return int[]
     *
     * @throws PrsRequestException
     */
    protected function uploadAttachments(array $files, Employee $uploader): array
    {
        $request = Http::timeout(60)
            ->acceptJson()
            ->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')]);

        foreach ($files as $file) {
            $request = $request->attach(
                'attachments[]',
                fopen($file->getRealPath(), 'r'),
                $file->getClientOriginalName(),
                ['Content-Type' => $file->getClientMimeType() ?: 'application/octet-stream']
            );
        }

        try {
            $response = $request->post('http://attachment-service:8000/api/upload', [
                'is_proof' => 'false',
                'uploaded_by_id' => (int) $uploader->emp_id,
                'uploaded_by_type' => 'employee',
            ]);
        } catch (\Throwable $e) {
            Log::error('PrsTicketService: attachment-service unreachable: ' . $e->getMessage());
            throw new PrsRequestException(
                'Attachment storage is unavailable. Retry with the same prs_request_id.',
                'ATTACHMENT_SERVICE_UNAVAILABLE',
                502
            );
        }

        $body = $response->json() ?? [];

        // Any flagged file fails the whole push: creating a ticket that silently lacks evidence PRS
        // believes it attached is worse than making them retry with a clean file.
        if (!empty($body['virus_detected']) || !empty($body['has_threats'])) {
            throw new PrsRequestException(
                $body['message'] ?? 'The attachment was rejected by the virus scanner.',
                'ATTACHMENT_REJECTED',
                422,
                ['quarantined' => array_map(
                    fn ($q) => is_array($q) ? ($q['file_name'] ?? ($q['name'] ?? 'file')) : 'file',
                    is_array($body['quarantined'] ?? null) ? $body['quarantined'] : []
                )]
            );
        }

        if (!$response->successful()) {
            throw new PrsRequestException(
                $body['message'] ?? 'Attachment upload failed.',
                'ATTACHMENT_UPLOAD_FAILED',
                $response->status() === 422 ? 422 : 502
            );
        }

        return array_values(array_filter(array_map(
            fn ($a) => isset($a['id']) ? (int) $a['id'] : null,
            is_array($body['attachments'] ?? null) ? $body['attachments'] : []
        )));
    }

    // ─── Ledger & payload ────────────────────────────────────────────────────────

    protected function recordLedger(string $requestId, array $data, Employee $employee, int $ticketId, ?int $existingId): ?object
    {
        $row = [
            'prs_request_id' => $requestId,
            'prs_equipment_id' => trim((string) $data['prs_equipment_id']),
            'equipment_name' => mb_substr(trim((string) $data['equipment_name']), 0, 150),
            'serial_number' => trim((string) ($data['serial_number'] ?? '')) ?: null,
            'brand' => trim((string) ($data['brand'] ?? '')) ?: null,
            'model' => trim((string) ($data['model'] ?? '')) ?: null,
            'requester_email' => strtolower(trim((string) $data['email'])),
            'requested_by' => (int) $employee->emp_id,
            'ticket_ID' => $ticketId,
            'updated_at' => now(),
        ];

        if ($existingId) {
            DB::table('prs_ticket_requests')->where('id', $existingId)->update($row);
        } else {
            DB::table('prs_ticket_requests')->insert($row + ['created_at' => now()]);
        }

        return DB::table('prs_ticket_requests')->where('prs_request_id', $requestId)->first();
    }

    protected function ticketExists(int $ticketId): bool
    {
        return DB::table('tickets')->where('ticket_ID', $ticketId)->exists();
    }

    /** @return array<string, mixed> */
    protected function payload(int $ticketId, ?object $ledger): array
    {
        $ticket = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as s', 's.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as p', 'p.priority_ID', '=', 't.priority_ID')
            ->leftJoin('problem_categories as c', 'c.problem_category_ID', '=', 't.problem_category_ID')
            ->where('t.ticket_ID', $ticketId)
            ->select(
                't.ticket_ID',
                't.ticket_number',
                't.title',
                't.equipment_name',
                't.branch_id',
                't.created_at',
                't.resolution_due_at',
                't.resolved_at',
                't.closed_at',
                's.status_name',
                'p.priority_name',
                'c.category_name'
            )
            ->first();

        return [
            'ticket_id' => $ticketId,
            'ticket_number' => $ticket->ticket_number ?? null,
            'ticket_url' => $this->ticketUrl($ticketId),
            'ticket_status' => $ticket->status_name ?? null,
            'priority' => $ticket->priority_name ?? null,
            'category' => $ticket->category_name ?? null,
            'branch' => $ticket->branch_id ?? null,
            'title' => $ticket->title ?? null,
            'equipment_name' => $ticket->equipment_name ?? null,
            'created_at' => $this->iso($ticket->created_at ?? null),
            'sla_due_at' => $this->iso($ticket->resolution_due_at ?? null),
            'resolved_at' => $this->iso($ticket->resolved_at ?? null),
            'closed_at' => $this->iso($ticket->closed_at ?? null),
            'prs_request_id' => $ledger->prs_request_id ?? null,
            'prs_equipment_id' => $ledger->prs_equipment_id ?? null,
            'serial_number' => $ledger->serial_number ?? null,
            'brand' => $ledger->brand ?? null,
            'model' => $ledger->model ?? null,
            'requested_by_email' => $ledger->requester_email ?? null,
        ];
    }

    /**
     * Where a staff member opens this ticket in the ticketing SPA. Null when PRS_TICKET_URL_BASE is
     * unset, so PRS stores no URL rather than a localhost link it can never use.
     */
    protected function ticketUrl(int $ticketId): ?string
    {
        $base = rtrim((string) config('services.prs.ticket_url_base', ''), '/');

        return $base === '' ? null : "{$base}/ticketing/tickets/{$ticketId}";
    }

    protected function iso($value): ?string
    {
        if (empty($value)) {
            return null;
        }

        try {
            return Carbon::parse($value)->toIso8601String();
        } catch (\Throwable) {
            return null;
        }
    }
}
