<?php

namespace App\Http\Controllers;

use App\Services\DepartmentManagerResolver;
use App\Services\DepartmentRoutingService;
use Illuminate\Http\Request;

/**
 * Spec 0051: department ticket routing with manager triage. Thin controller; the rules live in
 * DepartmentRoutingService. The acting employee always comes from the verified token (spec 0034).
 */
class DepartmentRoutingController extends Controller
{
    public function __construct(
        protected DepartmentRoutingService $routing,
        protected DepartmentManagerResolver $resolver,
    ) {}

    /**
     * GET /assignable-departments
     */
    public function assignableDepartments(Request $request)
    {
        if (!$this->routing->canRoute($request->user())) {
            return response()->json(['message' => 'Only Customer Service can route tickets to a department.'], 403);
        }

        return response()->json(['departments' => $this->routing->assignableDepartments()]);
    }

    /**
     * POST /tickets/{ticketId}/assign-department
     */
    public function assignDepartment(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$this->routing->canRoute($user)) {
            return response()->json(['message' => 'Only Customer Service can route tickets to a department.'], 403);
        }

        if ($request->has('employee_ids')) {
            return response()->json([
                'message' => 'Choose members or a department, not both.',
                'code' => 'ROUTE_MODE_CONFLICT',
            ], 422);
        }

        $validated = $request->validate([
            'department_id' => ['required', 'integer'],
            'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $actor = $this->resolver->employeeForUser($user);
        if (!$actor) {
            return response()->json(['message' => 'Your employee record was not found.'], 403);
        }

        return $this->respond($this->routing->route($ticketId, $actor, $validated));
    }

    /**
     * GET /department-queue
     */
    public function queue(Request $request)
    {
        $actor = $this->resolver->employeeForUser($request->user());
        if (!$actor) {
            return response()->json(['message' => 'Only a department manager has a Department queue.'], 403);
        }

        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(100, max(1, (int) $request->query('per_page', 25)));

        return $this->respond($this->routing->queue($actor, $page, $perPage));
    }

    /**
     * POST /tickets/{ticketId}/department-claim
     */
    public function claim(Request $request, int $ticketId)
    {
        $actor = $this->resolver->employeeForUser($request->user());
        if (!$actor) {
            return response()->json(['message' => 'Only a manager this ticket was routed to can act on it.'], 403);
        }

        return $this->respond($this->routing->claim($ticketId, $actor, $request->user()));
    }

    /**
     * POST /tickets/{ticketId}/department-delegate
     */
    public function delegate(Request $request, int $ticketId)
    {
        $actor = $this->resolver->employeeForUser($request->user());
        if (!$actor) {
            return response()->json(['message' => 'Only a manager this ticket was routed to can act on it.'], 403);
        }

        $validated = $request->validate([
            'employee_ids' => ['required', 'array', 'min:1'],
            'employee_ids.*' => ['integer', 'distinct'],
            'override_reason' => ['nullable', 'string', 'max:500'],
        ]);

        return $this->respond($this->routing->delegate(
            $ticketId,
            $actor,
            $validated['employee_ids'],
            $validated['override_reason'] ?? null
        ));
    }

    /**
     * POST /tickets/{ticketId}/department-return
     */
    public function returnToCs(Request $request, int $ticketId)
    {
        $actor = $this->resolver->employeeForUser($request->user());
        if (!$actor) {
            return response()->json(['message' => 'Only a manager this ticket was routed to can act on it.'], 403);
        }

        $validated = $request->validate([
            'reason' => ['required', 'string', 'min:10', 'max:500'],
        ]);

        return $this->respond($this->routing->returnToCs($ticketId, $actor, $validated['reason']));
    }

    private function respond(array $result)
    {
        return response()->json($result['data'], $result['status']);
    }
}
