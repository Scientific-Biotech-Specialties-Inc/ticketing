<?php

namespace App\Http\Controllers;

use App\Services\EscalationParticipants;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class InternalEscalationParticipantsController extends Controller
{
    public function __construct(protected EscalationParticipants $participants)
    {
    }

    /**
     * GET /internal/tickets/{ticketId}/escalation-managers (messaging-service, internal token).
     */
    public function show(int $ticketId): JsonResponse
    {
        if (!DB::table('tickets')->where('ticket_ID', $ticketId)->exists()) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        return response()->json(['manager_ids' => $this->participants->managerIds($ticketId)]);
    }
}
