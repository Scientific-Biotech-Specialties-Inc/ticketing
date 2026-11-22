<?php

namespace App\Http\Controllers;

use App\Exceptions\PrsRequestException;
use App\Exceptions\TicketLimitConfigurationUnavailableException;
use App\Exceptions\TicketLimitExceededException;
use App\Services\PrsTicketService;
use App\Services\TicketConfigurationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * PRS facing intake (X-Internal-Secret via the internal.prs middleware).
 *
 * PRS pushes an equipment repair request with the staff member's email; we raise it as an internal
 * ticket under that employee and hand back the ticket's identity plus the URL where the employee
 * opens it. Validation and response shaping only — the work lives in PrsTicketService.
 */
class InternalPrsController extends Controller
{
    public function __construct(protected PrsTicketService $prsTicketService) {}

    /**
     * POST /api/internal/prs/tickets (multipart/form-data)
     *
     * 201 on creation, 200 when prs_request_id has already been seen (idempotent retry).
     */
    public function store(Request $request): JsonResponse
    {
        // Maintenance mode gates every intake path, the same as customer and employee creation.
        if (trim(strtolower(TicketConfigurationService::getSystemStatus())) === 'under maintenance') {
            return $this->error(
                'Ticket creation is temporarily disabled for scheduled maintenance. Retry with the same prs_request_id.',
                'UNDER_MAINTENANCE',
                503
            );
        }

        try {
            $data = $request->validate([
                'prs_request_id' => ['required', 'string', 'max:100'],
                'prs_equipment_id' => ['required', 'string', 'max:100'],
                'equipment_name' => ['required', 'string', 'max:150'],
                'serial_number' => ['nullable', 'string', 'max:150'],
                'brand' => ['nullable', 'string', 'max:150'],
                'model' => ['nullable', 'string', 'max:150'],
                'email' => ['required', 'email', 'max:255'],
                'branch' => ['nullable', 'string', 'max:150'],
                'title' => ['required', 'string', 'max:255'],
                'category' => ['required', 'string', 'max:100'],
                'description' => ['nullable', 'string', 'max:5000'],
                'priority' => ['nullable', 'string', 'max:50'],
                'attachment' => ['nullable', 'array', 'max:' . TicketConfigurationService::getMaxFileCount()],
                'attachment.*' => ['file'],
            ]);
        } catch (ValidationException $e) {
            return response()->json([
                'status' => 'error',
                'code' => 'VALIDATION_FAILED',
                'message' => 'The request is missing or malformed fields.',
                'errors' => $e->errors(),
            ], 422);
        }

        // Accept either `attachment[]` (what PRS is documented to send) or `attachments[]`.
        $files = array_values(array_filter(
            $request->file('attachment') ?? $request->file('attachments') ?? [],
            fn ($f) => $f && $f->isValid()
        ));

        try {
            $result = $this->prsTicketService->create($data, $files);
        } catch (PrsRequestException $e) {
            return $this->error($e->getMessage(), $e->code_, $e->status, $e->context);
        } catch (TicketLimitExceededException $e) {
            return $this->error($e->getMessage(), 'MAX_OPEN_TICKETS_REACHED', 422, [
                'limit' => $e->limit,
                'open_ticket_count' => $e->openTicketCount,
            ]);
        } catch (TicketLimitConfigurationUnavailableException $e) {
            return $this->error($e->getMessage(), 'TICKET_LIMIT_CONFIGURATION_UNAVAILABLE', 503);
        } catch (\Throwable $e) {
            Log::error('InternalPrsController::store failed', [
                'prs_request_id' => $data['prs_request_id'],
                'error' => $e->getMessage(),
            ]);

            return $this->error(
                'The ticket could not be created. Retry with the same prs_request_id.',
                'INTERNAL_ERROR',
                500
            );
        }

        return response()->json([
            'status' => 'success',
            'duplicate' => $result['duplicate'],
            'data' => $result['payload'],
        ], $result['duplicate'] ? 200 : 201);
    }

    /** GET /api/internal/prs/tickets/{ticketId} — current state of a ticket PRS raised. */
    public function show(int $ticketId): JsonResponse
    {
        try {
            $payload = $this->prsTicketService->show($ticketId);
        } catch (PrsRequestException $e) {
            return $this->error($e->getMessage(), $e->code_, $e->status, $e->context);
        }

        return response()->json(['status' => 'success', 'data' => $payload]);
    }

    /** @param array<string, mixed> $context */
    protected function error(string $message, string $code, int $status, array $context = []): JsonResponse
    {
        return response()->json(array_merge([
            'status' => 'error',
            'code' => $code,
            'message' => $message,
        ], $context), $status);
    }
}
