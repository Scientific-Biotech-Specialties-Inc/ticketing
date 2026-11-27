<?php

namespace Ticketing\Reporting;

use Illuminate\Support\Facades\DB;

/**
 * The one branch scope rule for dashboards and reports (spec 0050 AC-13), shared by ticket-service and
 * analytics-service. Moved unchanged from TicketDashboardService::resolveBranchScope and
 * applyBranchTicketFilter.
 *
 * SuperAdmin may pick any branch or All Branches (the default). Everyone else is locked to their own
 * branch and gets a 403 when they ask for another one.
 */
final class BranchScope
{
    /**
     * Resolve branch record for the given user, enforcing server-side branch restriction for non-SuperAdmin.
     */
    public static function resolve($user, array $filters = []): object
    {
        $role = strtolower(trim((string) ($user->role ?? '')));
        $isSuperAdmin = in_array($role, ['superadmin', 'super admin'], true);

        $branch = null;

        if (!$isSuperAdmin && $user) {
            // Non-SuperAdmin Admin must be strictly locked to their branch
            if (!empty($user->branch_id)) {
                $branch = is_numeric($user->branch_id)
                    ? DB::table('branches')->where('id', (int) $user->branch_id)->first()
                    : DB::table('branches')->where('slug', (string) $user->branch_id)->first();
            }
            if (!$branch && !empty($user->branch)) {
                $branch = DB::table('branches')
                    ->where('slug', strtolower(trim($user->branch)))
                    ->orWhereRaw('LOWER(name) = ?', [strtolower(trim($user->branch))])
                    ->orWhereRaw('LOWER(code) = ?', [strtolower(trim($user->branch))])
                    ->first();
            }

            // Check if non-superadmin provided an explicit branch filter to attempt cross-branch access
            $target = trim((string) ($filters['branch'] ?? $filters['branch_id'] ?? ''));
            if ($target !== '' && strtolower($target) !== 'current' && strtolower($target) !== 'assigned') {
                $targetLower = strtolower($target);
                $userBranchId = (string) ($user->branch_id ?? '');
                $userBranchActualId = $branch ? (string) $branch->id : $userBranchId;
                $userBranchSlug = $branch ? strtolower((string) $branch->slug) : '';
                $userBranchCode = $branch ? strtolower((string) $branch->code) : '';
                $userBranchName = $branch ? strtolower((string) $branch->name) : strtolower(trim((string) ($user->branch ?? '')));

                $isMatch = (
                    $target === $userBranchId ||
                    $target === $userBranchActualId ||
                    $targetLower === $userBranchSlug ||
                    $targetLower === $userBranchCode ||
                    $targetLower === $userBranchName
                );

                if (!$isMatch) {
                    abort(403, 'Access denied: You are restricted to your assigned branch scope.');
                }
            }
        } else {
            // SuperAdmin can view 'all' (global scope) or a specified branch or default to 'all' or 'main'
            $target = trim((string) ($filters['branch'] ?? $filters['branch_id'] ?? ''));
            if (strtolower($target) === 'all') {
                return self::allBranches();
            }
            if ($target !== '') {
                $branch = DB::table('branches')
                    ->where('slug', $target)
                    ->orWhere('id', is_numeric($target) ? (int)$target : -1)
                    ->orWhereRaw('LOWER(code) = ?', [strtolower($target)])
                    ->first();
            } else {
                // No branch picked means All Branches. The superadmin is global, so a branch that happens to sit
                // on their employee row (admin@example.com carries Main Branch) must not narrow their view.
                return self::allBranches();
            }
        }

        if (!$branch) {
            $branch = DB::table('branches')->where('slug', 'main')->orWhere('id', 1)->first();
        }

        if (!$branch) {
            $branch = (object) [
                'id' => 1,
                'slug' => 'main',
                'name' => 'Main Branch',
                'code' => 'MAIN',
                'region' => 'NCR',
            ];
        }

        return $branch;
    }

    /**
     * Apply server-side branch filter to tickets table query (tickets aliased as `t`).
     */
    public static function applyTicketFilter($query, object $branch): void
    {
        $branchId = (string) ($branch->id ?? '1');
        $branchSlug = (string) ($branch->slug ?? 'main');

        // AC-3: When SuperAdmin selects All Branches, do not apply branch filter
        if ($branchSlug === 'all' || $branchId === 'all') {
            return;
        }

        $branchCode = (string) ($branch->code ?? 'MAIN');
        $isMainBranch = ($branchId === '1' || $branchSlug === 'main' || $branchSlug === 'main-office' || $branchCode === 'MAIN');

        $query->where(function ($q) use ($branchId, $branchSlug, $branchCode, $isMainBranch) {
            $q->where('t.branch_id', $branchId)
              ->orWhere('t.branch_id', $branchSlug)
              ->orWhere('t.branch_id', $branchCode);

            if ($isMainBranch) {
                $q->orWhereNull('t.branch_id')
                  ->orWhere('t.branch_id', '')
                  ->orWhere('t.branch_id', 'main')
                  ->orWhere('t.branch_id', 'main-office')
                  ->orWhere('t.branch_id', '1');
            }
        });
    }

    private static function allBranches(): object
    {
        return (object) [
            'id' => 'all',
            'slug' => 'all',
            'name' => 'All Branches',
            'code' => 'ALL',
            'region' => 'Global',
        ];
    }
}
