<?php

namespace App\Services;

use App\Support\TechnicalDepartments;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Live summary and breached queue for Service, IT and Customer Service managers (spec 0031 AC-7, AC-8).
 *
 * Scope always comes from the manager's own employees row, never from the request:
 *   Service or IT manager  tickets whose assignee's department is the manager's department
 *   CS manager             every ticket in the branch, unassigned ones included
 * Every scope is limited to the manager's branch. Breaches use SlaOutcomeService (open, past due, not on hold).
 */
class ManagerDashboardService
{
    public const CACHE_TTL = 30;
    public const CUSTOMER_SERVICE = 'Customer Service';

    private const NOT_OPEN_STATUSES = ['resolved', 'closed', 'discarded', 'cancelled'];

    protected SlaOutcomeService $slaOutcomes;
    protected SLAService $slaService;
    protected TicketDashboardService $dashboardService;

    public function __construct(
        ?SlaOutcomeService $slaOutcomes = null,
        ?SLAService $slaService = null,
        ?TicketDashboardService $dashboardService = null
    ) {
        $this->slaOutcomes = $slaOutcomes ?? app(SlaOutcomeService::class);
        $this->slaService = $slaService ?? app(SLAService::class);
        $this->dashboardService = $dashboardService ?? app(TicketDashboardService::class);
    }

    /**
     * The department a manager may see, or null when the manager's department has no dashboard.
     * Returns the canonical name ("Service", "IT", "Customer Service").
     */
    public static function supportedDepartment(?string $department): ?string
    {
        if ($department !== null && strcasecmp(trim($department), self::CUSTOMER_SERVICE) === 0) {
            return self::CUSTOMER_SERVICE;
        }

        return TechnicalDepartments::canonical($department);
    }

    public static function isManager(object $employee): bool
    {
        return strcasecmp(trim((string) ($employee->position_level ?? '')), 'Manager') === 0;
    }

    /**
     * Build the AC-7 payload for a manager's employees row. Callers check isManager and supportedDepartment first.
     */
    public function forManager(object $manager, bool $forceRefresh = false): array
    {
        $department = self::supportedDepartment($manager->department ?? null);
        $isBranchMode = $department === self::CUSTOMER_SERVICE;
        $branch = $this->resolveBranch($manager);

        $cacheKey = 'manager_dash_' . ($isBranchMode ? 'all' : strtolower((string) $department)) . '_' . $branch->id;
        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($department, $isBranchMode, $branch) {
            return $this->compute($department, $isBranchMode, $branch);
        });
    }

    protected function compute(string $department, bool $isBranchMode, object $branch): array
    {
        $now = now();

        $query = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->whereNotIn(DB::raw('LOWER(TRIM(ts.status_name))'), self::NOT_OPEN_STATUSES);

        $this->dashboardService->applyBranchTicketFilter($query, $branch);

        if (!$isBranchMode) {
            // AC-8: Service and IT scopes are by the assignee's department; unassigned tickets are not in them.
            $query->whereRaw('LOWER(TRIM(e.department)) = ?', [TechnicalDepartments::normalize($department)]);
        }

        $openTickets = $query->select(
            't.ticket_ID',
            't.ticket_number',
            't.title',
            't.ticket_status_ID',
            'ts.status_name',
            'tp.priority_name',
            't.assigned_to',
            'e.first_name as assignee_first_name',
            'e.last_name as assignee_last_name',
            'e.email as assignee_email',
            'e.department as assignee_department',
            't.resolution_due_at',
            't.resolved_at',
            't.closed_at',
            't.sla_status',
            't.created_at'
        )->get();

        $unassigned = 0;
        $withinSla = 0;
        $breachedQueue = [];

        foreach ($openTickets as $t) {
            if (empty($t->assigned_to)) {
                $unassigned++;
            }

            if ($this->slaOutcomes->isOpenBreach($t, $now)) {
                $dueAt = Carbon::parse($t->resolution_due_at);
                $breachedQueue[] = [
                    'ticket_ID' => (int) $t->ticket_ID,
                    'ticket_number' => TicketNumberGeneratorService::refFor($t->ticket_ID, $t->ticket_number ?? null),
                    'title' => $t->title,
                    'status_name' => $t->status_name,
                    'priority_name' => $t->priority_name,
                    'department' => empty($t->assigned_to) ? null : ($t->assignee_department ?: null),
                    'assignee_id' => empty($t->assigned_to) ? null : (int) $t->assigned_to,
                    'assignee_name' => empty($t->assigned_to) ? null : $this->assigneeName($t),
                    'resolution_due_at' => $dueAt->toIso8601String(),
                    'overdue_minutes' => (int) $dueAt->diffInMinutes($now),
                    'created_at' => $t->created_at ? Carbon::parse($t->created_at)->toIso8601String() : null,
                ];
                continue;
            }

            if ($this->isWithinSla($t, $now)) {
                $withinSla++;
            }
        }

        // Most overdue first.
        usort($breachedQueue, fn ($a, $b) => strcmp($a['resolution_due_at'], $b['resolution_due_at']));

        return [
            'scope' => [
                'department' => $department,
                'branch_id' => $branch->id,
                'branch_name' => $branch->name,
                'mode' => $isBranchMode ? 'branch' : 'department',
            ],
            'summary' => [
                'total_open' => $openTickets->count(),
                'unassigned' => $unassigned,
                'within_sla' => $withinSla,
                'breached' => count($breachedQueue),
            ],
            'breached_queue' => $breachedQueue,
            'generated_at' => $now->toIso8601String(),
        ];
    }

    /**
     * The manager's ticket list (Service / IT manager tickets page): open tickets in the
     * manager's scope, with their assignees and whether each is escalated or breached.
     * Same scope as the dashboard: assignee department (any open assignment, or assigned_to)
     * for Service and IT managers, the whole branch for the CS manager. Not cached, so a
     * reassignment shows on the next load.
     *
     * @return array{scope: array, tickets: array<int, array>}
     */
    public function ticketsForManager(object $manager): array
    {
        $department = self::supportedDepartment($manager->department ?? null);
        $isBranchMode = $department === self::CUSTOMER_SERVICE;
        $branch = $this->resolveBranch($manager);
        $now = now();

        $query = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->whereNotIn(DB::raw('LOWER(TRIM(ts.status_name))'), self::NOT_OPEN_STATUSES);

        $this->dashboardService->applyBranchTicketFilter($query, $branch);

        if (!$isBranchMode) {
            $deptNorm = TechnicalDepartments::normalize($department);
            $query->where(function ($q) use ($deptNorm) {
                $q->whereExists(function ($sub) use ($deptNorm) {
                    $sub->select(DB::raw(1))
                        ->from('ticket_assignments as ta')
                        ->join('employees as ae', 'ae.emp_id', '=', 'ta.employee_ID')
                        ->whereColumn('ta.ticket_ID', 't.ticket_ID')
                        ->whereNull('ta.completed_at')
                        ->whereRaw('LOWER(TRIM(ae.department)) = ?', [$deptNorm]);
                })->orWhereExists(function ($sub) use ($deptNorm) {
                    $sub->select(DB::raw(1))
                        ->from('employees as oe')
                        ->whereColumn('oe.emp_id', 't.assigned_to')
                        ->whereRaw('LOWER(TRIM(oe.department)) = ?', [$deptNorm]);
                });
            });
        }

        $rows = $query->select(
            't.ticket_ID',
            't.ticket_number',
            't.title',
            't.description',
            't.ticket_status_ID',
            'ts.status_name',
            't.priority_ID',
            'tp.priority_name',
            'pc.category_name',
            't.assigned_to',
            't.resolution_due_at',
            't.resolved_at',
            't.closed_at',
            't.sla_status',
            't.escalation_reason',
            't.created_at',
            't.updated_at'
        )->orderByDesc('t.updated_at')->get();

        $ticketIds = $rows->pluck('ticket_ID')->map(fn ($id) => (int) $id)->all();
        $assigneesByTicket = [];
        if (!empty($ticketIds)) {
            DB::table('ticket_assignments as ta')
                ->join('employees as e', 'e.emp_id', '=', 'ta.employee_ID')
                ->whereIn('ta.ticket_ID', $ticketIds)
                ->whereNull('ta.completed_at')
                ->select('ta.ticket_ID', 'e.emp_id', 'e.first_name', 'e.last_name', 'e.department', 'ta.assignment_status')
                ->orderBy('ta.assigned_at')
                ->get()
                ->each(function ($a) use (&$assigneesByTicket) {
                    $name = trim("{$a->first_name} {$a->last_name}");
                    $assigneesByTicket[(int) $a->ticket_ID][] = [
                        'id' => (int) $a->emp_id,
                        'name' => $name !== '' ? $name : 'Engineer #' . $a->emp_id,
                        'department' => $a->department,
                        'assignment_status' => $a->assignment_status,
                    ];
                });
        }

        $tickets = $rows->map(function ($t) use ($now, $assigneesByTicket) {
            $isEscalated = strcasecmp(trim((string) $t->status_name), 'Escalated') === 0;
            $isBreached = $this->slaOutcomes->isOpenBreach($t, $now);

            return [
                'ticket_ID' => (int) $t->ticket_ID,
                'id' => TicketNumberGeneratorService::refFor($t->ticket_ID, $t->ticket_number ?? null),
                'title' => $t->title,
                'description' => $t->description,
                'status' => $t->status_name,
                'ticket_status_ID' => (int) $t->ticket_status_ID,
                'priority' => $t->priority_name,
                'priority_ID' => $t->priority_ID ? (int) $t->priority_ID : null,
                'category' => $t->category_name,
                'assigned_to' => $t->assigned_to ? (int) $t->assigned_to : null,
                'assignees' => $assigneesByTicket[(int) $t->ticket_ID] ?? [],
                'resolution_due_at' => $t->resolution_due_at ? Carbon::parse($t->resolution_due_at)->toIso8601String() : null,
                'sla_status' => $isBreached ? 'Breached' : $t->sla_status,
                'escalation_reason' => $t->escalation_reason,
                'is_escalated' => $isEscalated,
                'is_breached' => $isBreached,
                // Managers step in only on escalated or breached tickets.
                'can_reassign' => $isEscalated || $isBreached,
                'created_at' => $t->created_at ? Carbon::parse($t->created_at)->toIso8601String() : null,
                'updated_at' => $t->updated_at ? Carbon::parse($t->updated_at)->toIso8601String() : null,
            ];
        })->values()->all();

        return [
            'scope' => [
                'department' => $department,
                'branch_id' => $branch->id,
                'branch_name' => $branch->name,
                'mode' => $isBranchMode ? 'branch' : 'department',
            ],
            'tickets' => $tickets,
        ];
    }

    /**
     * Open, has an SLA, not on hold, and not yet past its resolution deadline.
     */
    protected function isWithinSla(object $ticket, Carbon $now): bool
    {
        if (empty($ticket->resolution_due_at)) {
            return false;
        }

        $metrics = $this->slaService->computeTicketSlaMetrics($ticket);
        if (($metrics['status'] ?? '') === 'No SLA Configured' || !empty($metrics['is_paused'])) {
            return false;
        }

        return Carbon::parse($ticket->resolution_due_at)->gte($now);
    }

    protected function resolveBranch(object $manager): object
    {
        $branchId = (int) ($manager->branch_id ?? 0);
        $row = $branchId > 0 ? DB::table('branches')->where('id', $branchId)->first() : null;

        if ($row) {
            return $row;
        }

        // Employees without a branch id belong to the main branch (same rule the admin scoping uses).
        return DB::table('branches')->where('id', 1)->first()
            ?? (object) ['id' => 1, 'slug' => 'main', 'name' => 'Main Branch', 'code' => 'MAIN'];
    }

    protected function assigneeName(object $t): string
    {
        $name = trim("{$t->assignee_first_name} {$t->assignee_last_name}");
        if ($name !== '') {
            return $name;
        }

        $prefix = explode('@', (string) ($t->assignee_email ?? ''))[0] ?? '';

        return $prefix !== '' ? ucwords(str_replace(['.', '_', '-'], ' ', $prefix)) : 'Employee #' . $t->assigned_to;
    }
}
