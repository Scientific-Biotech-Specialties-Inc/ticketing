<?php

namespace App\Http\Controllers;

use App\Services\TicketReimbursementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * SERMS -> TS internal endpoints (internal.serms: X-Internal-Token or X-Internal-Secret).
 */
class InternalSermsController extends Controller
{
    public function __construct(protected TicketReimbursementService $reimbursements)
    {
    }

    /** GET /internal/tickets?search=&status=&limit=100 — SERMS ticket picker. */
    public function tickets(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', 'string', 'max:60'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $result = $this->reimbursements->ticketsForSerms(
            $validated['search'] ?? null,
            $validated['status'] ?? null,
            (int) ($validated['limit'] ?? 100)
        );

        return response()->json($result['data'], $result['status']);
    }

    /** POST /internal/reimbursements/status — SERMS pushes a claim status change. */
    public function reimbursementStatus(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ticket_id' => ['required', 'integer', 'min:1'],
            'ticket_number' => ['nullable', 'string', 'max:64'],
            'reimbursement_id' => ['nullable'],
            'reference_no' => ['nullable', 'string', 'max:32'],
            'status' => ['required', 'string', 'max:40'],
            'message' => ['nullable', 'string', 'max:2000'],
            'rejection_comment' => ['nullable', 'string', 'max:5000'],
            'updated_at' => ['nullable', 'date'],
        ]);

        $result = $this->reimbursements->applyWebhook($validated);

        return response()->json($result['data'], $result['status']);
    }
}
