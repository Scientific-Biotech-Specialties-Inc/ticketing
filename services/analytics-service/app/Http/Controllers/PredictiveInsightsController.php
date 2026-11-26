<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AuthorizesReportAccess;
use App\Services\TicketForecastService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Predictive insights (spec 0050 slice 1, AC-3), moved from ticket-service's
 * AdminReportController::predictiveInsights with the same inputs, checks and JSON.
 */
class PredictiveInsightsController extends Controller
{
    use AuthorizesReportAccess;

    public function __construct(protected TicketForecastService $forecastService)
    {
    }

    /**
     * GET /api/ticketing/analytics/insights/predictive
     * Return forecasted ticket volume and recurring issue trends.
     */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($authError = $this->authorizeAdminRole($user)) {
            return $authError;
        }

        if ($branchError = $this->validateBranchAccess($user, $request)) {
            return $branchError;
        }

        $filters = [
            'horizon_days' => $request->query('horizon_days', 7),
            'branch' => $request->query('branch'),
            'branch_id' => $request->query('branch_id'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->forecastService->getPredictiveInsights($user, $filters, $forceRefresh);
        return response()->json($data);
    }
}
