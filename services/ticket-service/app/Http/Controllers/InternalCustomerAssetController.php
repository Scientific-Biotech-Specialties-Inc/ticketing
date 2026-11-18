<?php

namespace App\Http\Controllers;

use App\Services\CustomerAssetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0047 (AC-7): AI-service reads a customer's pickable equipment and software over REST,
 * with the internal token, instead of reading ticket-service tables.
 */
class InternalCustomerAssetController extends Controller
{
    public function __construct(protected CustomerAssetService $assets) {}

    public function index(int $clientId): JsonResponse
    {
        if (!DB::table('clients')->where('id', $clientId)->exists()) {
            return response()->json(['message' => 'Customer not found.'], 404);
        }

        return response()->json(['data' => $this->assets->listFor($clientId)]);
    }
}
