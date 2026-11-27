<?php

namespace App\Http\Controllers;

use App\Rules\NoMarkup;
use App\Services\TicketReimbursementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * TS <-> SERMS reimbursement integration. Thin: validation here, rules in TicketReimbursementService.
 */
class TicketReimbursementController extends Controller
{
    public function __construct(protected TicketReimbursementService $reimbursements)
    {
    }

    /** GET /tickets/{ticketId}/reimbursement (auth.subsystem) */
    public function show(Request $request, int $ticketId): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        return $this->respond($this->reimbursements->show($ticketId, $request->user()));
    }

    /** POST /tickets/{ticketId}/reimbursement (auth.subsystem, multipart) */
    public function store(Request $request, int $ticketId): JsonResponse
    {
        if (!$request->user()) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01', 'max:9999999999.99'],
            'expense_category' => ['required', 'string', Rule::in(TicketReimbursementService::CATEGORIES)],
            'description' => ['required', 'string', 'min:3', 'max:255', new NoMarkup()],
            'expense_date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'receipts' => ['required', 'array', 'min:1', 'max:10'],
            'receipts.*' => ['file', 'mimes:jpeg,jpg,png,pdf', 'max:2048'],
        ], [
            'receipts.required' => 'Attach at least one receipt.',
            'receipts.*.mimes' => 'Receipts must be JPG, PNG, or PDF files.',
            'receipts.*.max' => 'Each receipt must be 2 MB or smaller.',
        ]);

        $validated['description'] = trim($validated['description']);

        return $this->respond($this->reimbursements->submit(
            $ticketId,
            $request->user(),
            $validated,
            $request->file('receipts', [])
        ));
    }

    private function respond(array $result): JsonResponse
    {
        return response()->json($result['data'], $result['status']);
    }
}
