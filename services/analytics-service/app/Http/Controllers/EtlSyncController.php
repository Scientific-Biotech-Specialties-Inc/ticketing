<?php

namespace App\Http\Controllers;

use App\Services\ReportCacheService;
use App\Services\TicketForecastService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Ticketing\Reporting\BranchScope;

/**
 * Synchronous ETL sync (spec 0050 slice 1, AC-4), moved from ticket-service's
 * TicketDashboardController::triggerEtl with the same role checks, branch rules, messages and response.
 *
 * It clears only analytics-service's report caches. The pages that call it reload their dashboards with
 * their own force refresh option afterwards (AC-5), so no call back to ticket-service is needed.
 */
class EtlSyncController extends Controller
{
    /**
     * POST /api/ticketing/analytics/etl/sync
     */
    public function sync(
        Request $request,
        TicketForecastService $forecastService,
        ReportCacheService $cacheService
    ) {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        if (!in_array($role, ['admin', 'superadmin', 'super admin'], true)) {
            return response()->json(['message' => 'Access denied: Admin or SuperAdmin role required.'], 403);
        }

        $isSuperAdmin = in_array($role, ['superadmin', 'super admin'], true);
        $fullSync = filter_var($request->input('full_sync', false), FILTER_VALIDATE_BOOLEAN);
        $requestedBranchId = $request->input('branch_id');

        // Non-superadmin cannot trigger ETL for other branches
        if (!$isSuperAdmin && !empty($requestedBranchId)) {
            $userBranchId = (string) ($user->branch_id ?? '');
            if ((string) $requestedBranchId !== $userBranchId && strtolower((string) $requestedBranchId) !== 'current' && strtolower((string) $requestedBranchId) !== 'assigned') {
                return response()->json(['message' => 'Access denied: You are restricted to your assigned branch scope.'], 403);
            }
        }

        $startTime = microtime(true);

        $recordsProcessed = 0;
        if ($isSuperAdmin && ($fullSync || empty($requestedBranchId) || strtolower((string) $requestedBranchId) === 'all')) {
            $forecastResults = $forecastService->calculateAndPersistAllBranches(7);
            foreach ($forecastResults as $branchResult) {
                $recordsProcessed += (int) ($branchResult['records_processed'] ?? 0);
            }
        } else {
            $branch = BranchScope::resolve($user, ['branch_id' => $requestedBranchId]);
            $forecastResult = $forecastService->calculateAndPersistBranchForecasts($branch, 7);
            $recordsProcessed = (int) ($forecastResult['records_processed'] ?? 0);
        }

        // Invalidate analytics report caches (ticket-service caches are refreshed by the callers, AC-5)
        $cacheService->clearReportCaches();

        $durationMs = (int) round((microtime(true) - $startTime) * 1000);

        return response()->json([
            'status' => 'success',
            'message' => 'ETL synchronization completed successfully.',
            'records_processed' => $recordsProcessed,
            'duration_ms' => $durationMs,
            'timestamp' => Carbon::now()->toIso8601String(),
        ]);
    }
}
