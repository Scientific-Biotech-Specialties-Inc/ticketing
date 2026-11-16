<?php

namespace App\Services\Cms;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Read only client for the CMS TS integration API (spec 3.1). CMS is the source of truth for
 * customers' equipment; TS only ever sends GET requests.
 *
 * Never throws. Blank configuration, a 403, any 5xx (530 from a dead trycloudflare.com tunnel) or a
 * network timeout comes back as a failed CmsFetchResult so callers keep their local data intact.
 */
class CmsTsClient
{
    public function isConfigured(): bool
    {
        return $this->baseUrl() !== '' && (string) config('services.cms_ts.key', '') !== '';
    }

    /**
     * Fetches every page of GET {base}/sync.
     *
     * @param  array<string, scalar>  $query  include_pending, include_expired, updated_since, ...
     */
    public function fetchSync(array $query = []): CmsFetchResult
    {
        if (!$this->isConfigured()) {
            return CmsFetchResult::failure('not_configured', 'CMS integration is not configured.');
        }

        $perPage = max(1, min(200, (int) config('services.cms_ts.per_page', 200)));
        $maxPages = max(1, (int) config('services.cms_ts.max_pages', 100));
        $rows = [];
        $page = 1;

        do {
            $response = $this->get('/sync', $query + ['per_page' => $perPage, 'page' => $page]);
            if ($response instanceof CmsFetchResult) {
                return $response;
            }

            $data = $response['data'] ?? null;
            if (!is_array($data)) {
                return $this->fail('bad_response', 'CMS returned an unexpected response.', ['page' => $page]);
            }

            array_push($rows, ...array_values(array_filter($data, 'is_array')));
            $lastPage = max(1, (int) ($response['meta']['last_page'] ?? 1));
            $page++;
        } while ($page <= $lastPage && $page <= $maxPages);

        if ($page <= $lastPage) {
            Log::warning('CMS sync: stopped at the page limit', ['max_pages' => $maxPages, 'last_page' => $lastPage]);

            return CmsFetchResult::success($rows, complete: false);
        }

        return CmsFetchResult::success($rows, complete: true);
    }

    /**
     * @return array<string, mixed>|CmsFetchResult decoded JSON, or the failure
     */
    private function get(string $path, array $query): array|CmsFetchResult
    {
        try {
            $response = Http::acceptJson()
                ->connectTimeout(max(1, (int) config('services.cms_ts.connect_timeout', 3)))
                ->timeout(max(1, (int) config('services.cms_ts.timeout', 5)))
                ->withHeaders(['X-Internal-Secret' => (string) config('services.cms_ts.key')])
                ->get($this->baseUrl() . $path, $query);
        } catch (\Throwable $e) {
            return $this->fail('unreachable', 'CMS is unreachable.', ['error' => $e->getMessage()]);
        }

        if ($response->status() === 401 || $response->status() === 403) {
            return $this->fail('forbidden', 'CMS rejected the integration key.', ['status' => $response->status()]);
        }

        if (!$response->successful()) {
            return $this->fail('unreachable', 'CMS is unreachable.', [
                'status' => $response->status(),
                'body' => mb_substr($response->body(), 0, 300),
            ]);
        }

        $json = $response->json();

        return is_array($json) ? $json : $this->fail('bad_response', 'CMS returned an unexpected response.');
    }

    private function fail(string $reason, string $message, array $context = []): CmsFetchResult
    {
        Log::warning('CMS sync: ' . $message, ['reason' => $reason] + $context);

        return CmsFetchResult::failure($reason, $message);
    }

    private function baseUrl(): string
    {
        return rtrim(trim((string) config('services.cms_ts.base_url', '')), '/');
    }
}
