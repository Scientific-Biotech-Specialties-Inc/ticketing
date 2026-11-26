<?php

namespace Ticketing\Reporting;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The departments that handle tickets (spec 0031 AC-1, AC-2).
 *
 * Source of truth, in order:
 *   1. config('ticketing.technical_departments') when TICKETING_TECHNICAL_DEPARTMENTS is set (explicit override);
 *   2. the active rows of the superadmin managed `departments` table, so adding, renaming or
 *      deactivating a department changes the admin dashboards without a deploy;
 *   3. Service and IT when neither gives a name (table missing, unreachable or every row inactive).
 * Department names are matched case insensitively after trimming, so "it " and "IT" are the same.
 */
class TechnicalDepartments
{
    private const DEFAULTS = ['Service', 'IT'];

    private const CACHE_KEY = 'ticketing:technical_departments:v1';

    /** Seconds a department change in the superadmin settings takes to reach the dashboards. */
    private const CACHE_TTL = 60;

    /**
     * Seconds the in-process copy is reused, so per-ticket canonical() calls do not each hit the cache store.
     * The copy lives on the app container, so every test (fresh app) starts clean and a long running
     * worker still picks up changes.
     */
    private const MEMO_TTL = 5;

    private const MEMO_BINDING = 'ticketing.technical_departments.memo';

    /**
     * Configured department names, in their display spelling.
     *
     * @return array<int, string>
     */
    public static function list(): array
    {
        $app = app();
        if ($app->bound(self::MEMO_BINDING)) {
            [$list, $at] = $app->make(self::MEMO_BINDING);
            if ((microtime(true) - $at) < self::MEMO_TTL) {
                return $list;
            }
        }

        $list = self::resolve();
        $app->instance(self::MEMO_BINDING, [$list, microtime(true)]);

        return $list;
    }

    /** Drop the cached list, for example right after a department is changed. */
    public static function flush(): void
    {
        $app = app();
        if ($app->bound(self::MEMO_BINDING)) {
            $app->forgetInstance(self::MEMO_BINDING);
        }

        try {
            Cache::forget(self::CACHE_KEY);
        } catch (Throwable) {
            // The cache store being down must not break the caller.
        }
    }

    /**
     * @return array<int, string>
     */
    private static function resolve(): array
    {
        $configured = config('ticketing.technical_departments');
        if (is_string($configured)) {
            $configured = explode(',', $configured);
        }

        $list = is_array($configured) ? self::unique($configured) : [];
        if ($list === []) {
            $list = self::unique(self::activeDepartmentNames());
        }

        return $list !== [] ? $list : self::DEFAULTS;
    }

    /**
     * Active department names from the superadmin managed table, cached briefly.
     *
     * @return array<int, string>
     */
    private static function activeDepartmentNames(): array
    {
        $query = fn () => DB::table('departments')
            ->where('is_active', true)
            ->orderBy('id')
            ->pluck('name')
            ->map(fn ($name) => (string) $name)
            ->all();

        try {
            return Cache::remember(self::CACHE_KEY, self::CACHE_TTL, $query);
        } catch (Throwable) {
            try {
                return $query();
            } catch (Throwable) {
                return [];
            }
        }
    }

    /**
     * Trimmed, non-empty names with case-insensitive duplicates removed, first spelling kept.
     *
     * @param array<int, mixed> $configured
     * @return array<int, string>
     */
    private static function unique(array $configured): array
    {
        $list = [];
        foreach ($configured as $dept) {
            $dept = trim((string) $dept);
            if ($dept !== '' && !in_array(self::normalize($dept), array_map([self::class, 'normalize'], $list), true)) {
                $list[] = $dept;
            }
        }

        return $list;
    }

    /**
     * Lowercased, trimmed names used for comparisons and SQL bindings.
     *
     * @return array<int, string>
     */
    public static function normalizedList(): array
    {
        return array_map([self::class, 'normalize'], self::list());
    }

    public static function contains(?string $department): bool
    {
        if ($department === null || trim($department) === '') {
            return false;
        }

        return in_array(self::normalize($department), self::normalizedList(), true);
    }

    /**
     * The configured display name for a department, or null when it is not a technical department.
     */
    public static function canonical(?string $department): ?string
    {
        if (!self::contains($department)) {
            return null;
        }

        $needle = self::normalize((string) $department);
        foreach (self::list() as $dept) {
            if (self::normalize($dept) === $needle) {
                return $dept;
            }
        }

        return null;
    }

    /**
     * Limit an employees query to technical departments: LOWER(TRIM(alias.department)) IN (...).
     *
     * @param \Illuminate\Database\Query\Builder|\Illuminate\Database\Eloquent\Builder $query
     */
    public static function applyEmployeeFilter($query, string $alias = 'e')
    {
        $values = self::normalizedList();
        $placeholders = implode(', ', array_fill(0, count($values), '?'));
        $column = $alias !== '' ? "{$alias}.department" : 'department';

        return $query->whereRaw("LOWER(TRIM(COALESCE({$column}, ''))) IN ({$placeholders})", $values);
    }

    public static function normalize(string $department): string
    {
        return strtolower(trim($department));
    }
}
