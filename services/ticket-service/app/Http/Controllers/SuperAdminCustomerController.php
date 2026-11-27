<?php

namespace App\Http\Controllers;

use App\Exceptions\CustomerItemConflictException;
use App\Exceptions\CustomerItemInsertException;
use App\Exceptions\CustomerServiceUnavailableException;
use App\Services\SuperAdminCustomerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * Super Admin Customers page API: list items, search hospitals, check an email or hospital, and
 * create an item with its account. Super Admin only; the work lives in SuperAdminCustomerService.
 */
class SuperAdminCustomerController extends Controller
{
    private const UNAVAILABLE = 'Customer service is unavailable, please try again.';

    public function __construct(private readonly SuperAdminCustomerService $customers)
    {
    }

    public function index(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validator = Validator::make($request->query(), [
            'search' => 'nullable|string|max:255',
            'type' => ['nullable', Rule::in([SuperAdminCustomerService::TYPE_SERVICE, SuperAdminCustomerService::TYPE_SOFTWARE])],
            'contract_status' => ['nullable', Rule::in(['active', 'expired', 'none'])],
            'branch_id' => 'nullable|string|max:64',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        return response()->json($this->customers->list($validator->validated()));
    }

    public function organizations(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validator = Validator::make($request->query(), [
            'search' => 'required|string|min:1|max:255',
            'limit' => 'nullable|integer|min:1|max:20',
        ]);
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        try {
            $data = $this->customers->searchOrganizations((string) $request->query('search'), (int) $request->query('limit', 20));
        } catch (CustomerServiceUnavailableException $e) {
            return $this->unavailable();
        }

        return response()->json(['data' => $data]);
    }

    public function check(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validator = Validator::make($request->all(), [
            'email' => 'required|email|max:255',
            'organization_id' => 'nullable|integer|min:1',
            'organization_name' => 'nullable|string|max:255',
        ]);
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        try {
            $result = $this->customers->check(
                (string) $request->input('email'),
                $request->filled('organization_id') ? (int) $request->input('organization_id') : null,
                $request->filled('organization_name') ? (string) $request->input('organization_name') : null,
            );
        } catch (CustomerServiceUnavailableException $e) {
            return $this->unavailable();
        }

        return response()->json($result);
    }

    public function store(Request $request): JsonResponse
    {
        if ($denied = $this->denyUnlessSuperAdmin($request)) {
            return $denied;
        }

        $validator = Validator::make($request->all(), [
            'asset_type' => ['required', Rule::in(['equipment', 'software'])],
            'item_name' => 'required|string|max:255',
            'brand' => 'nullable|string|max:255',
            'serial_number' => 'exclude_if:asset_type,software|required|string|max:255',
            'branch_id' => [
                'required', 'string', 'max:64',
                Rule::exists('branches', 'slug')->where('is_active', 1),
            ],
            'email' => 'required|email|max:255',
            'mode' => ['required', Rule::in(['new', 'attach'])],
            'attach_client_id' => 'required_if:mode,attach|nullable|integer|min:1',
            'organization_id' => 'nullable|integer|min:1',
            'organization_name' => 'nullable|string|max:255',
            'confirm_same_hospital' => 'sometimes|boolean',
        ], [
            'branch_id.exists' => 'Choose an active SBSI branch.',
        ]);
        $validator->after(function ($v) use ($request) {
            if ($request->input('mode') === 'new' && !$request->filled('organization_id') && trim((string) $request->input('organization_name')) === '') {
                $v->errors()->add('organization_name', 'Choose a hospital or add a new one.');
            }
        });
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        $input = $validator->validated();
        $input['confirm_same_hospital'] = filter_var($request->input('confirm_same_hospital', false), FILTER_VALIDATE_BOOLEAN);

        try {
            $result = $this->customers->create($input, $request->user()?->getAuthIdentifier());
        } catch (CustomerItemConflictException $e) {
            return response()->json(['code' => $e->conflictCode, 'message' => $e->getMessage()] + $e->data, 409);
        } catch (CustomerServiceUnavailableException $e) {
            return $this->unavailable();
        } catch (CustomerItemInsertException $e) {
            $message = $e->accountStatus === 'created'
                ? 'The account was created but the item could not be saved. Try again: the account will be reused.'
                : 'The item could not be saved. Please try again.';

            return response()->json([
                'message' => $message,
                'account_status' => $e->accountStatus,
                'client_id' => $e->clientId,
            ], 500);
        }

        return response()->json($result, 201);
    }

    private function denyUnlessSuperAdmin(Request $request): ?JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $role = strtolower(str_replace([' ', '_', '-'], '', (string) ($user->role ?? '')));
        if ($role !== 'superadmin') {
            return response()->json(['message' => 'Access denied: Super Admin role required.'], 403);
        }

        return null;
    }

    private function invalid(array $errors): JsonResponse
    {
        return response()->json(['message' => 'Validation failed.', 'errors' => $errors], 422);
    }

    private function unavailable(): JsonResponse
    {
        return response()->json(['message' => self::UNAVAILABLE], 502);
    }
}
