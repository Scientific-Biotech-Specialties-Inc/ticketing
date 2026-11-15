<?php

namespace App\Http\Controllers;

use App\Exceptions\CustomerProvisioningException;
use App\Services\CrmsMachineSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Inbound feed from the CRMS: registers customers' machines so customers can pick them when
 * filing a ticket. Guarded by X-Internal-Secret (internal.secret) and never exposed on the
 * customer edge (any /internal/ path returns 404 there).
 */
class CrmsMachineSyncController extends Controller
{
    public const MAX_BATCH = 100;

    private const RULES = [
        'machine_name' => ['required', 'string', 'max:255'],
        'brand' => ['nullable', 'string', 'max:255'],
        'serial_number' => ['required', 'string', 'max:255'],
        'customer_name' => ['required', 'string', 'max:255'],
        'customer_email' => ['required', 'email', 'max:255'],
        'branch' => ['required', 'string', 'max:255'],
    ];

    public function __construct(private CrmsMachineSyncService $sync)
    {
    }

    /**
     * POST /internal/crms/machines
     *
     * Body is either one record, or {"machines": [record, ...]} with up to 100 records.
     * One record answers 201 (created), 200 (updated or unchanged), 422 or 502.
     * A batch always answers 200 with a per record result and a summary.
     */
    public function store(Request $request): JsonResponse
    {
        if (!$request->has('machines')) {
            $result = $this->syncOne($request->all());

            return response()->json($result, $this->httpStatus($result));
        }

        $machines = $request->input('machines');
        if (!is_array($machines) || !array_is_list($machines) || count($machines) === 0 || count($machines) > self::MAX_BATCH) {
            return response()->json([
                'message' => 'machines must be a list of 1 to ' . self::MAX_BATCH . ' records.',
            ], 422);
        }

        $results = [];
        foreach ($machines as $index => $record) {
            $results[] = ['index' => $index] + $this->syncOne(is_array($record) ? $record : []);
        }

        $summary = ['received' => count($results), 'created' => 0, 'updated' => 0, 'unchanged' => 0, 'failed' => 0];
        foreach ($results as $row) {
            $summary[$row['status']]++;
        }

        return response()->json(['summary' => $summary, 'results' => $results]);
    }

    /**
     * GET /internal/crms/branches: the branch values the sync accepts (name, code or slug).
     */
    public function branches(): JsonResponse
    {
        $branches = DB::table('branches')
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['slug', 'name', 'code', 'region']);

        return response()->json(['data' => $branches]);
    }

    private function syncOne(array $record): array
    {
        $validator = Validator::make($record, self::RULES);
        if ($validator->fails()) {
            return $this->failed('Validation failed.', $validator->errors()->toArray(), 422, $record);
        }

        $data = $validator->validated();
        $branch = $this->sync->resolveBranch($data['branch']);
        if (!$branch) {
            return $this->failed('Unknown SBSI branch.', [
                'branch' => ["No SBSI branch matches \"{$data['branch']}\". Use a name, code or slug from GET /internal/crms/branches."],
            ], 422, $record);
        }

        try {
            return $this->sync->sync($data, $branch);
        } catch (CustomerProvisioningException $e) {
            return $this->failed($e->getMessage(), [], 502, $record);
        }
    }

    private function failed(string $message, array $errors, int $http, array $record): array
    {
        return array_filter([
            'status' => 'failed',
            'serial_number' => is_scalar($record['serial_number'] ?? null) ? (string) $record['serial_number'] : null,
            'message' => $message,
            'errors' => $errors ?: null,
            'http_status' => $http,
        ], fn ($value) => $value !== null);
    }

    private function httpStatus(array $result): int
    {
        return match ($result['status']) {
            'created' => 201,
            'failed' => $result['http_status'],
            default => 200,
        };
    }
}
