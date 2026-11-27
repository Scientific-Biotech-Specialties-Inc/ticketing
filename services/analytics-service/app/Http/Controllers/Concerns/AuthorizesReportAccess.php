<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin report access rules, copied verbatim from ticket-service's AdminReportController:
 * the same allowed roles, the same branch rule and the same 403 messages as the endpoints they replace.
 */
trait AuthorizesReportAccess
{
    /**
     * Verify that the authenticated user holds an Admin or SuperAdmin role.
     */
    protected function authorizeAdminRole($user): ?JsonResponse
    {
        if (!$user) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        $allowedRoles = ['superadmin', 'super admin', 'admin', 'branch admin', 'branchadmin', 'branch_admin', 'systemadministrator', 'itadmin', 'it admin'];

        if (!in_array($role, $allowedRoles, true)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Admin role required to view operational reports.',
            ], 403);
        }

        return null;
    }

    /**
     * Enforce server-side branch security.
     * Prevents non-superadmin users from querying other branches.
     */
    protected function validateBranchAccess($user, Request $request): ?JsonResponse
    {
        $role = strtolower(trim((string) ($user->role ?? '')));
        $isSuperAdmin = in_array($role, ['superadmin', 'super admin'], true);

        if ($isSuperAdmin) {
            return null; // SuperAdmins may inspect any branch
        }

        // If client specified an explicit branch or branch_id parameter, verify it matches the user's branch
        $requestedBranchId = $request->query('branch_id');
        $requestedBranchSlug = $request->query('branch');

        $userBranchId = (string) ($user->branch_id ?? '');
        $userBranch = strtolower(trim((string) ($user->branch ?? '')));

        if ($requestedBranchId !== null && $requestedBranchId !== '') {
            $reqId = strtolower(trim((string) $requestedBranchId));
            if ($reqId === 'all' || ($reqId !== $userBranchId && $reqId !== $userBranch)) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Access denied: Cross-branch reporting access is prohibited.',
                ], 403);
            }
        }

        if ($requestedBranchSlug !== null && $requestedBranchSlug !== '') {
            $reqSlug = strtolower(trim((string) $requestedBranchSlug));
            if ($reqSlug === 'all' || ($reqSlug !== $userBranch && $reqSlug !== $userBranchId)) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Access denied: Cross-branch reporting access is prohibited.',
                ], 403);
            }
        }

        return null;
    }
}
