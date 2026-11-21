<?php

namespace App\Http\Controllers;

use App\Rules\NoMarkup;
use App\Services\HoldRequestService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Spec 0048: employee On Hold requests and the CS decision. Thin: validation here,
 * every rule in HoldRequestService.
 */
class HoldRequestController extends Controller
{
    public function __construct(protected HoldRequestService $holdRequests)
    {
    }

    /** POST /tickets/{ticketId}/hold-requests */
    public function store(Request $request, int $ticketId): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $validated = $request->validate([
            'remarks' => ['required', 'string', 'min:3', 'max:250', new NoMarkup()],
        ]);

        return $this->respond($this->holdRequests->create($ticketId, $request->user(), trim($validated['remarks'])));
    }

    /** POST /hold-requests/{id}/cancel */
    public function cancel(Request $request, int $id): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        return $this->respond($this->holdRequests->cancel($id, $request->user()));
    }

    /** POST /hold-requests/{id}/approve */
    public function approve(Request $request, int $id): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:1000', new NoMarkup()],
        ]);

        return $this->respond($this->holdRequests->approve($id, $request->user(), $validated['note'] ?? null));
    }

    /** POST /hold-requests/{id}/reject */
    public function reject(Request $request, int $id): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $validated = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:1000', new NoMarkup()],
        ]);

        return $this->respond($this->holdRequests->reject($id, $request->user(), trim($validated['reason'])));
    }

    /** GET /internal/tickets/{ticketId}/hold-requests/pending (internal.token) */
    public function pending(int $ticketId): JsonResponse
    {
        return $this->respond($this->holdRequests->pendingStatus($ticketId));
    }

    /** GET /internal/hold-requests/states?ticket_ids=1,2,3 (internal.token), for employee-service lists. */
    public function states(Request $request): JsonResponse
    {
        $ids = array_slice(array_filter(array_map('intval', explode(',', (string) $request->query('ticket_ids', '')))), 0, 500);

        return response()->json(['states' => (object) $this->holdRequests->statesFor($ids)]);
    }

    private function respond(array $result): JsonResponse
    {
        return response()->json($result['data'], $result['status']);
    }
}
