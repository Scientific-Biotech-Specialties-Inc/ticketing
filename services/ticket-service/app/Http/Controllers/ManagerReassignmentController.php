<?php

namespace App\Http\Controllers;

use App\Services\ManagerReassignmentNotice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ManagerReassignmentController extends Controller
{
    public function __construct(protected ManagerReassignmentNotice $notice)
    {
    }

    /**
     * CS acknowledges a department manager reassignment, clearing the notice for all CS users.
     */
    public function acknowledge(Request $request, int $ticketId): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $result = $this->notice->acknowledge($ticketId, $request->user());

        return response()->json($result['data'], $result['status']);
    }
}
