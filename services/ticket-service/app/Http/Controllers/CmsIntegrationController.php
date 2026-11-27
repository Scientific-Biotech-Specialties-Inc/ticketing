<?php

namespace App\Http\Controllers;

use App\Services\Cms\CmsEquipmentSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Spec 3.1: CMS equipment sync state for the UI banner, and a manual "Sync now" for admins.
 * Pages never call the CMS themselves; they only read the last recorded state.
 */
class CmsIntegrationController extends Controller
{
    private const SYNC_ROLES = ['admin', 'superadmin', 'super admin'];

    public function __construct(private CmsEquipmentSyncService $sync)
    {
    }

    /**
     * GET /integrations/cms/status (any signed in user)
     */
    public function status(Request $request): JsonResponse
    {
        $status = $this->sync->status();

        // Customers only need to know whether the machine list may be stale.
        if ($request->user() instanceof \App\Models\Client) {
            unset($status['summary'], $status['reason']);
        }

        return response()->json($status);
    }

    /**
     * POST /integrations/cms/sync (Admin or SuperAdmin). Body: {"full": bool}
     */
    public function sync(Request $request): JsonResponse
    {
        $user = $request->user();
        $role = strtolower(trim((string) ($user->role ?? '')));
        if ($user instanceof \App\Models\Client || !in_array($role, self::SYNC_ROLES, true)) {
            return response()->json(['message' => 'Access denied: Admin or SuperAdmin role required.'], 403);
        }

        $result = $this->sync->run(filter_var($request->input('full', false), FILTER_VALIDATE_BOOLEAN));

        $http = match ($result['outcome']) {
            'synced', 'partial' => 200,
            'busy' => 409,
            'not_configured' => 503,
            default => 502,
        };

        return response()->json($result + ['status' => $this->sync->status()], $http);
    }
}
