<?php

namespace App\Http\Controllers;

use App\Services\TicketingAccessService;
use Illuminate\Http\Request;

/**
 * Spec 0045: ticketing access endpoints (AC-1 to AC-10).
 *
 * Department write is superadmin only. Department read and employee designation are open to
 * superadmins (all branches) and branch admins (own branch, enforced in the service from the
 * verified token, never from a query parameter).
 */
class TicketingAccessController extends Controller
{
    public function __construct(protected TicketingAccessService $access) {}

    /** GET /ticketing-access/departments */
    public function departments(Request $request)
    {
        if ($denied = $this->denyUnlessAdmin($request)) {
            return $denied;
        }

        return response()->json(['departments' => $this->access->listDepartments()]);
    }

    /** PUT /ticketing-access/departments */
    public function saveDepartments(Request $request)
    {
        if (!$this->access->isSuperAdmin($request->user())) {
            return response()->json(['message' => 'Only a superadmin can change ticketing departments.'], 403);
        }

        $validated = $request->validate([
            'departments' => ['required', 'array', 'min:1'],
            'departments.*.department_name' => ['required', 'string', 'max:255'],
            'departments.*.is_enabled' => ['required', 'boolean'],
        ]);

        $result = $this->access->saveDepartments($validated['departments'], $request->user());
        return response()->json($result['data'], $result['status']);
    }

    /** GET /ticketing-access/employees */
    public function employees(Request $request)
    {
        if ($denied = $this->denyUnlessAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'department' => ['nullable', 'string', 'max:255'],
            'branch_id' => ['nullable', 'integer'],
            'status' => ['nullable', 'in:designated,requestor,pending'],
            'search' => ['nullable', 'string', 'max:255'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $result = $this->access->listEmployees($validated, $request->user());
        return response()->json($result['data'], $result['status']);
    }

    /** PUT /ticketing-access/employees/{empId} */
    public function updateEmployee(Request $request, int $empId)
    {
        if ($denied = $this->denyUnlessAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'is_ticketing_employee' => ['required', 'boolean'],
        ]);

        $result = $this->access->setDesignation($empId, (bool) $validated['is_ticketing_employee'], $request->user());
        return response()->json($result['data'], $result['status']);
    }

    /** POST /ticketing-access/employees/bulk-designate */
    public function bulkDesignate(Request $request)
    {
        if ($denied = $this->denyUnlessAdmin($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'department_name' => ['required', 'string', 'max:255'],
        ]);

        $result = $this->access->bulkDesignate(trim($validated['department_name']), $request->user());
        return response()->json($result['data'], $result['status']);
    }

    private function denyUnlessAdmin(Request $request)
    {
        $user = $request->user();

        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        if ($this->access->isSuperAdmin($user)) {
            return null;
        }

        if ($this->access->isBranchAdmin($user)) {
            if (empty($this->access->adminBranchId($user))) {
                return response()->json(['message' => 'Your account has no branch, so there are no employees to manage.'], 403);
            }
            return null;
        }

        return response()->json(['message' => 'Only a superadmin or branch admin can manage ticketing access.'], 403);
    }
}
