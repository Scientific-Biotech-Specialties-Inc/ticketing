<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * Clears analytics-service's report caches (spec 0050).
 *
 * Every report key analytics writes starts with analytics_ (analytics_emp_perf_v4_, analytics_dept_perf_v3_,
 * analytics_operational_report_v3_, analytics_perf_dashboard_v1_), so one pattern covers them. Keys are found
 * with Redis SCAN in chunks, never KEYS (AGENTS.md invariant 6). ticket-service's caches are left alone:
 * after an ETL sync the dashboards reload with their own force refresh option instead (AC-5).
 */
class ReportCacheService
{
    private const PATTERN = '*analytics_*';

    private const CHUNK = 100;

    private const MAX_LOOPS = 1000;

    public function clearReportCaches(): void
    {
        try {
            $redis = Redis::connection('cache');
            $prefix = (string) (config('cache.prefix') ?? 'laravel_cache');

            if (config('database.redis.client', 'phpredis') === 'phpredis') {
                $client = $redis->client();
                $iterator = null;
                $loops = 0;
                do {
                    $keys = $client->scan($iterator, self::PATTERN, self::CHUNK);
                    if ($keys === false) {
                        break;
                    }
                    foreach ($keys ?: [] as $key) {
                        $this->forget($key, $prefix);
                    }
                    $loops++;
                } while ($iterator > 0 && $loops < self::MAX_LOOPS);
            } else {
                $iterator = 0;
                $loops = 0;
                do {
                    [$iterator, $keys] = $redis->scan($iterator, ['match' => self::PATTERN, 'count' => self::CHUNK]);
                    foreach ($keys ?: [] as $key) {
                        $this->forget($key, $prefix);
                    }
                    $loops++;
                } while ($iterator != 0 && $loops < self::MAX_LOOPS);
            }
        } catch (\Throwable $e) {
            Log::warning('Analytics report cache clearing failed: ' . $e->getMessage());
        }
    }

    /**
     * SCAN returns full Redis keys (connection prefix plus cache prefix plus key); the cache store wants the
     * bare key, so strip both and forget it through the store, which deletes the right Redis key.
     */
    private function forget(string $redisKey, string $cachePrefix): void
    {
        $key = $redisKey;
        $at = strpos($key, $cachePrefix);
        if ($at !== false) {
            $key = substr($key, $at + strlen($cachePrefix));
        }
        $key = ltrim($key, ':');

        if ($key !== '') {
            Cache::forget($key);
        }
    }
}
