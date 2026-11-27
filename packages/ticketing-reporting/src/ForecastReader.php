<?php

namespace Ticketing\Reporting;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Builds the predictive insights payload from stored forecast rows (spec 0050 AC-1a).
 *
 * Read only: it uses query builder reads on branch_ticket_forecasts and branch_recurring_issue_trends and
 * never writes or recalculates. analytics-service's TicketForecastService tops the rows up first when
 * needed, then returns insights(). ticket-service's predictive_risk report calls insights() directly
 * (no top up) until spec 0050 slice 3 moves that report.
 *
 * The payload is byte for byte what ticket-service's TicketForecastService returned when it read the same
 * rows through Eloquent models, so the model casts are reproduced here: integer and float columns, and
 * datetime columns serialized the way Eloquent serializes them (ISO 8601 in UTC, with microseconds).
 */
final class ForecastReader
{
    public const MINIMUM_HISTORICAL_DAYS = 14;

    public const MAX_HORIZON_DAYS = 30;

    /** Casts the single branch trend rows carried as BranchRecurringIssueTrend models. */
    private const TREND_CASTS = [
        'item_id' => 'int',
        'recent_frequency' => 'int',
        'baseline_frequency' => 'float',
        'change_percentage' => 'float',
        'calculated_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /** The horizon every caller uses: 1 to 30 days, 7 when not given. */
    public static function clampHorizon($horizonDays): int
    {
        return max(1, min((int) ($horizonDays ?? 7), self::MAX_HORIZON_DAYS));
    }

    /** True when the resolved branch is the All Branches scope (SuperAdmin). */
    public static function isAllBranches(object $branch): bool
    {
        return ($branch->slug ?? null) === 'all' || (string) ($branch->id ?? '') === 'all';
    }

    /**
     * How many of the requested forecast days are stored from today on (at most $horizonDays).
     * A caller that may recalculate compares this with the horizon to decide on a top up.
     */
    public static function futureRowCount(object $branch, int $horizonDays): int
    {
        $horizonDays = self::clampHorizon($horizonDays);
        $query = DB::table('branch_ticket_forecasts')->where('forecast_date', '>=', Carbon::today()->toDateString());

        $count = self::isAllBranches($branch)
            ? $query->distinct()->count('forecast_date')
            : $query->where('branch_id', self::branchId($branch))->count();

        return min($count, $horizonDays);
    }

    /**
     * The predictive insights payload for a resolved branch scope (BranchScope::resolve), from stored rows only.
     */
    public static function insights(object $branch, int $horizonDays): array
    {
        $horizonDays = self::clampHorizon($horizonDays);

        return self::isAllBranches($branch)
            ? self::allBranchesInsights($horizonDays)
            : self::branchInsights($branch, $horizonDays);
    }

    private static function allBranchesInsights(int $horizonDays): array
    {
        // Statuses are 'success' or 'insufficient_data', so MAX() is 'success' whenever at least one branch has a real forecast.
        $forecasts = DB::table('branch_ticket_forecasts')
            ->where('forecast_date', '>=', Carbon::today()->toDateString())
            ->select(
                'forecast_date',
                DB::raw('SUM(predicted_volume) as predicted_volume'),
                DB::raw('SUM(lower_bound) as lower_bound'),
                DB::raw('SUM(upper_bound) as upper_bound'),
                DB::raw('MAX(calculation_status) as calculation_status'),
                DB::raw('MAX(historical_days_used) as max_days_used'),
                DB::raw("MAX(CASE WHEN calculation_status = 'success' THEN historical_days_used END) as success_days_used")
            )
            ->groupBy('forecast_date')
            ->orderBy('forecast_date', 'asc')
            ->limit($horizonDays)
            ->get();

        $allBranches = ['id' => 'all', 'name' => 'All Branches', 'slug' => 'all'];

        $first = $forecasts->first();
        if ($first && $first->calculation_status === 'insufficient_data') {
            return self::insufficientData(
                $allBranches,
                (int) $first->max_days_used,
                'Insufficient historical data for reliable projection in any branch. Minimum ' . self::MINIMUM_HISTORICAL_DAYS . ' days required.'
            );
        }

        $trends = DB::table('branch_recurring_issue_trends')
            ->select(
                'issue_type',
                'item_id',
                'item_name',
                DB::raw('AVG(change_percentage) as change_percentage'),
                DB::raw('SUM(recent_frequency) as recent_frequency'),
                DB::raw('SUM(baseline_frequency) as baseline_frequency')
            )
            ->groupBy('issue_type', 'item_id', 'item_name')
            ->orderBy('change_percentage', 'desc')
            ->orderBy('item_id', 'asc')
            ->get()
            ->map(fn ($row) => [
                'issue_type' => $row->issue_type,
                'item_id' => self::toInt($row->item_id),
                'item_name' => $row->item_name,
                'change_percentage' => self::toFloat($row->change_percentage),
                'recent_frequency' => self::toInt($row->recent_frequency),
                'baseline_frequency' => self::toFloat($row->baseline_frequency),
            ]);

        return [
            'status' => 'success',
            'branch' => $allBranches,
            'historical_basis' => [
                'days_used' => (int) ($first->success_days_used ?? 0),
                'minimum_days_required' => self::MINIMUM_HISTORICAL_DAYS,
                'model' => '7-day Weighted Moving Average with Day-of-Week Seasonality (Global)',
            ],
            'volume_forecast' => self::forecastList($forecasts),
            'recurring_issues' => self::splitTrends($trends),
        ];
    }

    private static function branchInsights(object $branch, int $horizonDays): array
    {
        $branchId = self::branchId($branch);

        $forecasts = DB::table('branch_ticket_forecasts')
            ->where('branch_id', $branchId)
            ->where('forecast_date', '>=', Carbon::today()->toDateString())
            ->orderBy('forecast_date', 'asc')
            ->limit($horizonDays)
            ->get();

        $branchInfo = [
            'id' => $branch->id ?? 1,
            'name' => $branch->name ?? 'Main Branch',
            'slug' => $branch->slug ?? 'main',
        ];

        $first = $forecasts->first();
        if ($first && $first->calculation_status === 'insufficient_data') {
            return self::insufficientData(
                $branchInfo,
                self::toInt($first->historical_days_used),
                'Insufficient historical data for reliable projection. Minimum ' . self::MINIMUM_HISTORICAL_DAYS . ' days required.'
            );
        }

        $trends = DB::table('branch_recurring_issue_trends')
            ->where('branch_id', $branchId)
            ->orderBy('change_percentage', 'desc')
            ->orderBy('id', 'asc')
            ->get()
            ->map(fn ($row) => self::castRow((array) $row, self::TREND_CASTS));

        return [
            'status' => 'success',
            'branch' => $branchInfo,
            'historical_basis' => [
                'days_used' => $first !== null ? self::toInt($first->historical_days_used) : 14,
                'minimum_days_required' => self::MINIMUM_HISTORICAL_DAYS,
                'model' => '7-day Weighted Moving Average with Day-of-Week Seasonality',
            ],
            'volume_forecast' => self::forecastList($forecasts),
            'recurring_issues' => self::splitTrends($trends),
        ];
    }

    private static function insufficientData(array $branch, ?int $daysUsed, string $message): array
    {
        return [
            'status' => 'insufficient_data',
            'branch' => $branch,
            'historical_basis' => [
                'days_used' => $daysUsed,
                'minimum_days_required' => self::MINIMUM_HISTORICAL_DAYS,
            ],
            'message' => $message,
            'volume_forecast' => [],
            'recurring_issues' => [
                'categories' => [],
                'machines' => [],
            ],
        ];
    }

    /** forecast_date comes back as a 'Y-m-d' string (no model date cast), so it is parsed once here. */
    private static function forecastList($forecasts): array
    {
        return $forecasts->map(function ($f) {
            $date = Carbon::parse($f->forecast_date);

            return [
                'date' => $date->toDateString(),
                'day_of_week' => $date->format('D'),
                'predicted_volume' => (int) $f->predicted_volume,
                'lower_bound' => (int) $f->lower_bound,
                'upper_bound' => (int) $f->upper_bound,
            ];
        })->all();
    }

    private static function splitTrends($trends): array
    {
        return [
            'categories' => $trends->where('issue_type', 'category')->values()->all(),
            'machines' => $trends->where('issue_type', 'machine')->values()->all(),
        ];
    }

    private static function branchId(object $branch): int
    {
        return (int) ($branch->id ?? 1);
    }

    /** Applies Eloquent style casts in place, keeping the column order (and so the JSON key order). */
    private static function castRow(array $row, array $casts): array
    {
        foreach ($casts as $column => $type) {
            if (!array_key_exists($column, $row)) {
                continue;
            }
            $row[$column] = match ($type) {
                'int' => self::toInt($row[$column]),
                'float' => self::toFloat($row[$column]),
                'datetime' => self::toJsonDate($row[$column]),
            };
        }

        return $row;
    }

    private static function toInt($value): ?int
    {
        return $value === null ? null : (int) $value;
    }

    private static function toFloat($value): ?float
    {
        return $value === null ? null : (float) $value;
    }

    /** Eloquent's datetime serialization: the stored value read in the app timezone, written as ISO 8601 UTC. */
    private static function toJsonDate($value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse($value)->toJSON();
    }
}
