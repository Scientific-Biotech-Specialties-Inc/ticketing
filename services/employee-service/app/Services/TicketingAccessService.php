<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Ticketing\Auth\Access\TicketingAccess;

/**
 * Spec 0045: handler departments and designated ticketing employees.
 *
 * employee-service owns `ticketing_handler_departments` and `employees.is_ticketing_employee`.
 * Methods return ['status' => int, 'data' => array] like EmployeeAssignmentService, so the
 * controller stays thin.
 *
 * Status filter semantics (AC-5, AC-9):
 *  - designated: flag true.
 *  - pending ("Not Yet Designated"): flag false and nobody has decided yet (designated_at null).
 *  - requestor: flag false after an explicit removal (designated_at set).
 */
class TicketingAccessService
{
    public const STATUS_DESIGNATED = 'designated';
    public const STATUS_REQUESTOR = 'requestor';
    public const STATUS_PENDING = 'pending';

    public function __construct(protected TicketCacheService $cacheService) {}

    // ─── Caller helpers ──────────────────────────────────────────────────────

    public function isSuperAdmin($user): bool
    {
        return $user && TicketingAccess::normalizeRole($user->role ?? '') === 'superadmin';
    }

    public function isBranchAdmin($user): bool
    {
        return $user && !$this->isSuperAdmin($user) && TicketingAccess::isAdmin($user);
    }

    private function actorId($user): int
    {
        return (int) ($user->emp_id ?? $user->id ?? 0);
    }

    // ─── Departments ─────────────────────────────────────────────────────────

    /**
     * AC-1: every distinct auth module department plus every saved one, with counts.
     */
    public function listDepartments(): array
    {
        $counts = DB::table('employees')
            ->where('is_active', true)
            ->whereNotNull('department')
            ->whereRaw("TRIM(department) <> ''")
            ->tap(fn ($q) => TicketingAccess::excludeAdmins($q))
            ->selectRaw('LOWER(TRIM(department)) as dept_key, MIN(TRIM(department)) as dept_name, COUNT(*) as active_staff_count, SUM(CASE WHEN is_ticketing_employee THEN 1 ELSE 0 END) as designated_count')
            ->groupBy(DB::raw('LOWER(TRIM(department))'))
            ->get()
            ->keyBy('dept_key');

        $saved = DB::table('ticketing_handler_departments')->get()
            ->keyBy(fn ($row) => TicketingAccess::normalizeDepartment($row->department_name));

        $keys = $counts->keys()->merge($saved->keys())->unique();

        return $keys->map(function ($key) use ($counts, $saved) {
            $row = $saved->get($key);
            $count = $counts->get($key);

            return [
                'department_name' => $row ? trim($row->department_name) : $count->dept_name,
                'is_enabled' => $row ? (bool) $row->is_enabled : false,
                'active_staff_count' => $count ? (int) $count->active_staff_count : 0,
                'designated_count' => $count ? (int) $count->designated_count : 0,
            ];
        })
            ->sortBy(fn ($d) => strtolower($d['department_name']))
            ->values()
            ->all();
    }

    /**
     * AC-2, AC-3, AC-4, AC-15: save the department toggles.
     *
     * @param array<int, array{department_name:string, is_enabled:bool}> $departments
     */
    public function saveDepartments(array $departments, $user): array
    {
        $actorId = $this->actorId($user);

        // One entry per normalized name; the last one wins if the caller sent duplicates.
        $incoming = [];
        foreach ($departments as $d) {
            $name = trim((string) $d['department_name']);
            if ($name === '') {
                return ['status' => 422, 'data' => ['message' => 'Department names cannot be empty.']];
            }
            $incoming[TicketingAccess::normalizeDepartment($name)] = ['name' => $name, 'enabled' => (bool) $d['is_enabled']];
        }

        return DB::transaction(function () use ($incoming, $actorId) {
            $saved = DB::table('ticketing_handler_departments')->lockForUpdate()->get()
                ->keyBy(fn ($row) => TicketingAccess::normalizeDepartment($row->department_name));

            $turningOff = [];
            foreach ($incoming as $key => $d) {
                $wasEnabled = (bool) optional($saved->get($key))->is_enabled;
                if ($wasEnabled && !$d['enabled']) {
                    $turningOff[] = $key;
                }
            }

            $affectedIds = empty($turningOff) ? [] : DB::table('employees')
                ->whereIn(DB::raw('LOWER(TRIM(department))'), $turningOff)
                ->where('is_ticketing_employee', true)
                ->pluck('emp_id')
                ->map(fn ($id) => (int) $id)
                ->all();

            // AC-3: refuse the whole save while anyone in a department being disabled holds open work.
            $blocking = TicketingAccess::openAssignmentsFor($affectedIds);
            if (!empty($blocking)) {
                return ['status' => 409, 'data' => [
                    'message' => 'Reassign the open tickets held by staff in these departments before turning them off.',
                    'blocking_tickets' => $blocking,
                ]];
            }

            $now = now();
            foreach ($incoming as $key => $d) {
                $row = $saved->get($key);
                $before = $row ? (bool) $row->is_enabled : false;

                if ($row) {
                    if ($before === $d['enabled']) {
                        continue;
                    }
                    DB::table('ticketing_handler_departments')->where('id', $row->id)->update([
                        'is_enabled' => $d['enabled'],
                        'updated_by' => $actorId,
                        'updated_at' => $now,
                    ]);
                } else {
                    if (!$d['enabled']) {
                        continue; // a name with no row already reads as disabled
                    }
                    DB::table('ticketing_handler_departments')->insert([
                        'department_name' => $d['name'],
                        'is_enabled' => true,
                        'updated_by' => $actorId,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }

                $cleared = [];
                if (!$d['enabled']) {
                    // AC-4: nobody in a disabled department stays a ticketing employee.
                    $cleared = DB::table('employees')
                        ->whereRaw('LOWER(TRIM(department)) = ?', [$key])
                        ->where('is_ticketing_employee', true)
                        ->pluck('emp_id')->map(fn ($id) => (int) $id)->all();

                    if (!empty($cleared)) {
                        DB::table('employees')->whereIn('emp_id', $cleared)->update([
                            'is_ticketing_employee' => false,
                            'designated_by' => $actorId,
                            'designated_at' => $now,
                        ]);
                    }
                }

                TicketingAccess::audit(
                    'ticketing_department_toggled',
                    $actorId,
                    'employee',
                    ['department_name' => $d['name'], 'is_enabled' => $before],
                    ['department_name' => $d['name'], 'is_enabled' => $d['enabled']],
                    ['department_name' => $d['name'], 'cleared_emp_ids' => $cleared]
                );
            }

            $this->invalidateCaches();

            return ['status' => 200, 'data' => [
                'message' => 'Ticketing departments saved.',
                'departments' => $this->listDepartments(),
            ]];
        });
    }

    // ─── Employees ───────────────────────────────────────────────────────────

    /**
     * AC-5, AC-9, AC-10: active, non admin staff in enabled departments.
     */
    public function listEmployees(array $filters, $user): array
    {
        $enabled = TicketingAccess::enabledDepartmentKeys();
        $perPage = max(1, min(100, (int) ($filters['per_page'] ?? 25)));
        $page = max(1, (int) ($filters['page'] ?? 1));

        $base = DB::table('employees')->where('is_active', true);
        TicketingAccess::excludeAdmins($base);

        if (empty($enabled)) {
            $base->whereRaw('1 = 0');
        } else {
            $base->whereIn(DB::raw('LOWER(TRIM(department))'), $enabled);
        }

        // AC-10: a branch admin only ever sees their own branch, whatever they send.
        if ($this->isBranchAdmin($user)) {
            $base->where('branch_id', (int) ($user->branch_id ?? 0));
        } elseif (!empty($filters['branch_id'])) {
            $base->where('branch_id', (int) $filters['branch_id']);
        }

        $pendingCount = (clone $base)
            ->where('is_ticketing_employee', false)
            ->whereNull('designated_at')
            ->count();

        $query = clone $base;

        if (!empty($filters['department'])) {
            $query->whereRaw('LOWER(TRIM(department)) = ?', [TicketingAccess::normalizeDepartment($filters['department'])]);
        }

        match ($filters['status'] ?? null) {
            self::STATUS_DESIGNATED => $query->where('is_ticketing_employee', true),
            self::STATUS_REQUESTOR => $query->where('is_ticketing_employee', false)->whereNotNull('designated_at'),
            self::STATUS_PENDING => $query->where('is_ticketing_employee', false)->whereNull('designated_at'),
            default => null,
        };

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $search) . '%';
            $query->where(function ($q) use ($like) {
                $q->where('first_name', 'like', $like)
                    ->orWhere('last_name', 'like', $like)
                    ->orWhere('email', 'like', $like)
                    ->orWhereRaw("CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) LIKE ?", [$like]);
            });
        }

        $total = (clone $query)->count();
        $rows = $query
            ->orderBy('first_name')
            ->orderBy('last_name')
            ->forPage($page, $perPage)
            ->get();

        return ['status' => 200, 'data' => [
            'data' => $rows->map(fn ($e) => $this->presentEmployee($e))->values()->all(),
            'total' => $total,
            'per_page' => $perPage,
            'current_page' => $page,
            'last_page' => max(1, (int) ceil($total / $perPage)),
            'pending_count' => $pendingCount,
        ]];
    }

    /**
     * AC-6, AC-7, AC-10, AC-15: designate or remove one person.
     */
    public function setDesignation(int $empId, bool $designate, $user): array
    {
        $actorId = $this->actorId($user);

        return DB::transaction(function () use ($empId, $designate, $user, $actorId) {
            $employee = DB::table('employees')->where('emp_id', $empId)->lockForUpdate()->first();
            if (!$employee) {
                return ['status' => 404, 'data' => ['message' => 'Employee not found.']];
            }

            if ($this->isBranchAdmin($user) && (int) $employee->branch_id !== (int) ($user->branch_id ?? 0)) {
                return ['status' => 403, 'data' => ['message' => 'You can only manage ticketing employees in your own branch.']];
            }

            if (TicketingAccess::isAdmin($employee)) {
                return ['status' => 422, 'data' => ['message' => 'Superadmin and admin accounts are not ticketing employees.']];
            }

            $before = (bool) $employee->is_ticketing_employee;

            if ($designate) {
                if (!$employee->is_active) {
                    return ['status' => 422, 'data' => ['message' => 'Only active staff can be ticketing employees.']];
                }
                if (!TicketingAccess::isDepartmentEnabled($employee->department)) {
                    return ['status' => 422, 'data' => [
                        'message' => "The {$employee->department} department does not handle tickets. Enable it first.",
                        'code' => 'DEPARTMENT_NOT_ENABLED',
                    ]];
                }
            } elseif ($before) {
                $blocking = TicketingAccess::openAssignmentsFor([$empId]);
                if (!empty($blocking)) {
                    return ['status' => 409, 'data' => [
                        'message' => 'Reassign this person\'s open tickets before removing them.',
                        'blocking_tickets' => $blocking,
                    ]];
                }
            }

            if ($before !== $designate || $employee->designated_at === null) {
                DB::table('employees')->where('emp_id', $empId)->update([
                    'is_ticketing_employee' => $designate,
                    'designated_by' => $actorId,
                    'designated_at' => now(),
                ]);

                TicketingAccess::audit(
                    $designate ? 'ticketing_employee_designated' : 'ticketing_employee_removed',
                    $actorId,
                    'employee',
                    ['emp_id' => $empId, 'is_ticketing_employee' => $before],
                    ['emp_id' => $empId, 'is_ticketing_employee' => $designate],
                    ['emp_id' => $empId, 'department' => $employee->department]
                );

                $this->invalidateCaches();
            }

            return ['status' => 200, 'data' => [
                'message' => $designate ? 'Ticketing employee added.' : 'Ticketing employee removed.',
                'employee' => $this->presentEmployee(DB::table('employees')->where('emp_id', $empId)->first()),
            ]];
        });
    }

    /**
     * AC-8, AC-15: designate every active, not yet designated person in one enabled department.
     */
    public function bulkDesignate(string $departmentName, $user): array
    {
        $actorId = $this->actorId($user);
        $key = TicketingAccess::normalizeDepartment($departmentName);

        if (!TicketingAccess::isDepartmentEnabled($departmentName)) {
            return ['status' => 422, 'data' => [
                'message' => "The {$departmentName} department does not handle tickets. Enable it first.",
                'code' => 'DEPARTMENT_NOT_ENABLED',
            ]];
        }

        return DB::transaction(function () use ($key, $departmentName, $user, $actorId) {
            $query = DB::table('employees')
                ->where('is_active', true)
                ->where('is_ticketing_employee', false)
                ->whereRaw('LOWER(TRIM(department)) = ?', [$key]);
            TicketingAccess::excludeAdmins($query);

            if ($this->isBranchAdmin($user)) {
                $query->where('branch_id', (int) ($user->branch_id ?? 0));
            }

            $ids = $query->lockForUpdate()->pluck('emp_id')->map(fn ($id) => (int) $id)->all();

            if (!empty($ids)) {
                DB::table('employees')->whereIn('emp_id', $ids)->update([
                    'is_ticketing_employee' => true,
                    'designated_by' => $actorId,
                    'designated_at' => now(),
                ]);

                TicketingAccess::audit(
                    'ticketing_employees_bulk_designated',
                    $actorId,
                    'employee',
                    ['department_name' => $departmentName, 'emp_ids' => $ids, 'is_ticketing_employee' => false],
                    ['department_name' => $departmentName, 'emp_ids' => $ids, 'is_ticketing_employee' => true],
                    ['department_name' => $departmentName, 'designated_count' => count($ids)]
                );

                $this->invalidateCaches();
            }

            return ['status' => 200, 'data' => [
                'message' => count($ids) . ' ticketing employee(s) added.',
                'designated_count' => count($ids),
            ]];
        });
    }

    // ─── Presentation ────────────────────────────────────────────────────────

    public function presentEmployee($e): array
    {
        $status = $e->is_ticketing_employee
            ? self::STATUS_DESIGNATED
            : ($e->designated_at === null ? self::STATUS_PENDING : self::STATUS_REQUESTOR);

        return [
            'emp_id' => (int) $e->emp_id,
            'name' => trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')),
            'email' => $e->email,
            'department' => $e->department,
            'branch' => $e->branch,
            'branch_id' => $e->branch_id !== null ? (int) $e->branch_id : null,
            'ticketing_role' => $this->ticketingRole($e),
            'is_ticketing_employee' => (bool) $e->is_ticketing_employee,
            'designation_status' => $status,
            'designated_at' => $e->designated_at,
        ];
    }

    /**
     * Read only role label derived from the auth sourced role and position level.
     */
    public function ticketingRole($e): string
    {
        $position = strtolower(trim((string) ($e->position_level ?? '')));
        $role = strtolower(trim((string) ($e->role ?? '')));

        if ($position === 'manager' || str_contains($role, 'manager')) {
            return 'Manager';
        }
        if (in_array($role, ['customer service', 'customer support', 'cs', 'head of cs', 'head of customer service'], true)) {
            return 'Customer Service';
        }

        return 'Technician';
    }

    /**
     * Step 9: designation changes alter who is assignable, so drop the cached lists (SCAN based).
     */
    private function invalidateCaches(): void
    {
        Cache::forget('department_managers:cache');
        try {
            $this->cacheService->clearTicketCaches();
        } catch (\Throwable $e) {
            // cache outages must not fail an access change that already committed
        }
    }
}
