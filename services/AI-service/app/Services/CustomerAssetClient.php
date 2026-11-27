<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Reads a customer's pickable equipment and software from ticket-service over
 * REST with the internal token. AI-service never reads ticket-service tables.
 */
class CustomerAssetClient
{
    /**
     * @return array<int, array{machine_ID:int, name:string, asset_type:string, serial_number:?string, category_name:string}>|null
     *         null when ticket-service could not be reached (the caller must not block on it)
     */
    public function forCustomer(int $clientId): ?array
    {
        $cacheKey = "ai:customer-assets:{$clientId}";
        $cached = Cache::get($cacheKey);
        if (is_array($cached)) {
            return $cached;
        }

        try {
            $response = Http::withHeaders(['X-Internal-Token' => (string) config('services.internal.token', '')])
                ->acceptJson()
                ->connectTimeout(2)
                ->timeout(4)
                ->get(rtrim((string) config('services.ticket_service.url'), '/') . "/internal/customers/{$clientId}/assets");

            if (!$response->successful()) {
                Log::warning("Customer asset list returned HTTP {$response->status()} for client {$clientId}.");
                return null;
            }

            $assets = array_values(array_filter((array) $response->json('data', []), fn ($a) => isset($a['machine_ID'], $a['name'])));
            Cache::put($cacheKey, $assets, now()->addSeconds(60));

            return $assets;
        } catch (\Throwable $e) {
            Log::warning("Customer asset list unavailable for client {$clientId}: " . $e->getMessage());
            return null;
        }
    }
}
