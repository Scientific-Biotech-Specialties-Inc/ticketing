<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0048: hold requests live in ticket-service. Before an employee changes a ticket's status
 * or asks for reassignment, ask ticket-service (internal endpoint) whether an On Hold request is
 * pending. Fails closed: if ticket-service cannot answer, the caller returns 503.
 */
class HoldRequestGate
{
    /**
     * @return bool|null true when a request is pending, false when not, null when ticket-service
     *                   could not be reached or answered with an error (fail closed).
     */
    public function hasPendingRequest(int $ticketId): ?bool
    {
        try {
            $baseUrl = rtrim((string) config('services.ticket_service.url', 'http://ticket-service:8000'), '/');
            $response = Http::timeout(5)
                ->acceptJson()
                ->withHeaders(['X-Internal-Token' => (string) config('services.internal_token', '')])
                ->get("{$baseUrl}/api/internal/tickets/{$ticketId}/hold-requests/pending");

            if (!$response->successful()) {
                Log::warning("Hold request check failed for ticket {$ticketId}: HTTP " . $response->status());
                return null;
            }

            return (bool) $response->json('pending', false);
        } catch (\Throwable $e) {
            Log::warning("Hold request check failed for ticket {$ticketId}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Spec 0048: ticket id => 'pending' | 'rejected' for the status column of employee ticket lists.
     * Display only, so it fails open: an empty map when ticket-service cannot answer.
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

        try {
            $baseUrl = rtrim((string) config('services.ticket_service.url', 'http://ticket-service:8000'), '/');
            $response = Http::timeout(3)
                ->acceptJson()
                ->withHeaders(['X-Internal-Token' => (string) config('services.internal_token', '')])
                ->get("{$baseUrl}/api/internal/hold-requests/states", ['ticket_ids' => implode(',', array_slice($ids, 0, 500))]);

            if (!$response->successful()) {
                Log::warning('Hold request states lookup failed: HTTP ' . $response->status());
                return [];
            }

            $states = [];
            foreach ((array) $response->json('states', []) as $id => $state) {
                $states[(int) $id] = (string) $state;
            }
            return $states;
        } catch (\Throwable $e) {
            Log::warning('Hold request states lookup failed: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Shared error responses so employee-update and reassign-request answer the same way.
     */
    public function blockedResponse(?bool $pending): ?array
    {
        if ($pending === null) {
            return [
                'status' => 503,
                'data' => [
                    'message' => 'Could not confirm the ticket\'s On Hold request status. Please try again in a moment.',
                    'code' => 'HOLD_REQUEST_CHECK_UNAVAILABLE',
                ],
            ];
        }
        if ($pending) {
            return [
                'status' => 409,
                'data' => [
                    'message' => 'On Hold request pending CS review. Wait for Customer Service to decide, or cancel the request.',
                    'code' => 'HOLD_REQUEST_PENDING',
                ],
            ];
        }

        return null;
    }
}
