<?php

namespace Ticketing\Reporting;

use Illuminate\Support\Facades\DB;

/**
 * The technical staff of a branch (spec 0050 AC-13), shared by ticket-service (Admin dashboard
 * active_employees_count) and analytics-service (performance and workload). Moved from
 * TicketDashboardService::getBranchEmployees, with the spec 0045 ticketing employee filter.
 */
final class BranchEmployees
{
    /**
     * Get active technical department employees (Service and IT by default) belonging to the target branch.
     */
    public static function for(object $branch): array
    {
        $branchId = (string) ($branch->id ?? '1');
        $branchSlug = (string) ($branch->slug ?? 'main');
        $branchName = (string) ($branch->name ?? 'Main Branch');
        $isMainBranch = ($branchId === '1' || $branchSlug === 'main' || $branchSlug === 'main-office');

        $query = DB::table('employees as e')
            ->where('e.is_active', true)
            ->whereRaw('LOWER(TRIM(COALESCE(e.role, ""))) NOT IN (?, ?, ?, ?, ?, ?, ?)', [
                'superadmin',
                'super admin',
                'admin',
                'it admin',
                'customer service',
                'head of cs',
                'head of customer service',
            ]);

        TechnicalDepartments::applyEmployeeFilter($query, 'e');
        // Spec 0045 (AC-11): the workload view lists designated ticketing employees only.
        \Ticketing\Auth\Access\TicketingAccess::onlyTicketingEmployees($query, 'e');

        if ($branchSlug !== 'all' && $branchId !== 'all') {
            $query->where(function ($q) use ($branchId, $branchSlug, $branchName, $isMainBranch) {
                $q->where('e.branch_id', $branchId)
                  ->orWhere('e.branch', $branchSlug)
                  ->orWhere('e.branch', $branchName);

                if ($isMainBranch) {
                    $q->orWhereNull('e.branch_id')
                      ->orWhereNull('e.branch')
                      ->orWhere('e.branch', 'Main')
                      ->orWhere('e.branch', 'Main Branch');
                }
            });
        }

        return $query->select('e.emp_id', 'e.first_name', 'e.last_name', 'e.email', 'e.department', 'e.role')->get()->all();
    }
}
