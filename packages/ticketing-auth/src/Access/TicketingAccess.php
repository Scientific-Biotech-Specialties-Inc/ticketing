<?php

namespace Ticketing\Auth\Access;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0045: ticketing access rules shared by every service.
 *
 * employee-service owns `ticketing_handler_departments` and the `employees.is_ticketing_employee`
 * flag. The auth sync paths (customer-service, ticket-service, employee-service) and the shared
 * JWT middleware all need the same rules, so they live here once instead of being copied.
 *
 * Rules:
 *  - Superadmin and admin roles bypass ticketing access entirely (AC-13).
 *  - Department names match trimmed and case insensitive (AC-2).
 *  - A non terminal ticket is any status other than Resolved, Closed, Discarded or Cancelled.
 */
class TicketingAccess
{
    /** Normalized (lowercase, spaces/underscores/hyphens removed) admin role names. */
    public const ADMIN_ROLES = ['admin', 'superadmin', 'itadmin', 'administrator', 'systemadministrator'];

    /** Ticket statuses that no longer count as an open assignment (matches ManagerDashboardService). */
    public const TERMINAL_STATUSES = ['resolved', 'closed', 'discarded', 'cancelled'];

    public const NOT_TICKETING_MESSAGE = 'This employee is not a ticketing employee.';

    public static function normalizeDepartment(?string $name): string
    {
        return strtolower(trim((string) $name));
    }

    public static function normalizeRole(?string $role): string
    {
        return strtolower(str_replace([' ', '_', '-'], '', trim((string) $role)));
    }

    /**
     * True for superadmin and admin staff, judged by role or position level.
     */
    public static function isAdmin($employee): bool
    {
        if (!$employee) {
            return false;
        }

        $role = self::normalizeRole(self::field($employee, 'role'));
        $position = self::normalizeRole(self::field($employee, 'position_level'));

        return in_array($role, self::ADMIN_ROLES, true) || in_array($position, ['admin', 'superadmin'], true);
    }

    /**
     * SQL fragment that excludes admin roles from an `employees` query (alias optional).
     */
    public static function excludeAdmins($query, string $alias = ''): void
    {
        $p = $alias !== '' ? $alias . '.' : '';
        $query->whereNotIn(DB::raw("LOWER(REPLACE(REPLACE(REPLACE(COALESCE({$p}role, ''), ' ', ''), '_', ''), '-', ''))"), self::ADMIN_ROLES)
            ->whereNotIn(DB::raw("LOWER(COALESCE({$p}position_level, ''))"), ['admin', 'superadmin']);
    }

    /**
     * Normalized names of every enabled handler department.
     *
     * @return string[]
     */
    public static function enabledDepartmentKeys(): array
    {
        return DB::table('ticketing_handler_departments')
            ->where('is_enabled', true)
            ->pluck('department_name')
            ->map(fn ($name) => self::normalizeDepartment($name))
            ->unique()
            ->values()
            ->all();
    }

    public static function isDepartmentEnabled(?string $department): bool
    {
        $key = self::normalizeDepartment($department);
        if ($key === '') {
            return false;
        }

        return in_array($key, self::enabledDepartmentKeys(), true);
    }

    /**
     * Database read of the designation flag (never the cached session). Admins always pass.
     *
     * If the column does not exist yet (the migration has not run in this database), this returns
     * true so the service keeps today's role based behaviour, matching the spec's rollback plan.
     */
    public static function isTicketingEmployee(int $empId): bool
    {
        try {
            $employee = DB::table('employees')
                ->where('emp_id', $empId)
                ->first(['emp_id', 'role', 'position_level', 'is_active', 'is_ticketing_employee']);
        } catch (\Illuminate\Database\QueryException $e) {
            if (self::isMissingSchema($e)) {
                return true;
            }
            throw $e;
        }

        if (!$employee) {
            return false;
        }

        if (self::isAdmin($employee)) {
            return true;
        }

        return (bool) $employee->is_ticketing_employee && (bool) $employee->is_active;
    }

    /**
     * Apply the "designated and active" filter to an assignable staff query on `employees`.
     */
    public static function onlyTicketingEmployees($query, string $alias = ''): void
    {
        $p = $alias !== '' ? $alias . '.' : '';
        $query->where($p . 'is_ticketing_employee', true)->where($p . 'is_active', true);
    }

    /**
     * Open (non terminal) ticket assignments held by the given employees.
     *
     * @param int[] $empIds
     * @return array<int, array{ticket_ID:int, ticket_number:?string, title:?string, assignee_id:int, assignee_name:string, department:?string}>
     */
    public static function openAssignmentsFor(array $empIds): array
    {
        $empIds = array_values(array_unique(array_map('intval', $empIds)));
        if (empty($empIds)) {
            return [];
        }

        return DB::table('ticket_assignments as ta')
            ->join('tickets as t', 't.ticket_ID', '=', 'ta.ticket_ID')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->join('employees as e', 'e.emp_id', '=', 'ta.employee_ID')
            ->whereIn('ta.employee_ID', $empIds)
            ->where(function ($q) {
                $q->whereNull('ts.status_name')
                    ->orWhereNotIn(DB::raw('LOWER(TRIM(ts.status_name))'), self::TERMINAL_STATUSES);
            })
            ->orderBy('t.ticket_ID')
            ->get([
                't.ticket_ID',
                't.ticket_number',
                't.title',
                'e.emp_id',
                'e.first_name',
                'e.last_name',
                'e.department',
            ])
            ->map(fn ($r) => [
                'ticket_ID' => (int) $r->ticket_ID,
                'ticket_number' => $r->ticket_number,
                'title' => $r->title,
                'assignee_id' => (int) $r->emp_id,
                'assignee_name' => trim(($r->first_name ?? '') . ' ' . ($r->last_name ?? '')),
                'department' => $r->department,
            ])
            ->values()
            ->all();
    }

    /**
     * Write one ticket access audit row (AC-15). ticket_ID is always null for these events.
     */
    public static function audit(string $action, int $actorId, string $actorType, array $before, array $after, array $details = [], bool $isSystem = false): void
    {
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => $action,
            'event_type' => 'ticketing_access',
            'action_by_ID' => $actorId,
            'actor_type' => $actorType,
            'details' => json_encode($details),
            'before_state' => json_encode($before),
            'after_state' => json_encode($after),
            'is_system' => $isSystem,
            'is_internal' => true,
            'created_at' => now(),
        ]);
    }

    /**
     * AC-14: called by every sync and login path after it writes a new `employees.department`.
     *
     * When a designated, non admin employee lands in a department that is not enabled, the flag
     * is cleared, an audit row is written, and the superadmins plus the employee's branch admin
     * get an in app alert listing the open tickets that now need reassigning. Their tickets stay
     * assigned. Never throws: a failure here must not break login or the sync.
     *
     * @param object|array $before the employee row as it was before the department write
     */
    public static function handleDepartmentChange($before, ?string $newDepartment, string $source): void
    {
        try {
            if (!$before) {
                return;
            }

            $empId = (int) self::field($before, 'emp_id');
            $wasDesignated = (bool) self::field($before, 'is_ticketing_employee');
            $oldDepartment = self::field($before, 'department');

            if ($empId <= 0 || !$wasDesignated || self::isAdmin($before)) {
                return;
            }
            if (self::normalizeDepartment($oldDepartment) === self::normalizeDepartment($newDepartment)) {
                return;
            }
            if (self::isDepartmentEnabled($newDepartment)) {
                return;
            }

            DB::table('employees')->where('emp_id', $empId)->update([
                'is_ticketing_employee' => false,
                'designated_by' => null,
                'designated_at' => now(),
            ]);

            $openTickets = self::openAssignmentsFor([$empId]);

            self::audit(
                'ticketing_employee_auto_removed',
                $empId,
                'system',
                ['is_ticketing_employee' => true, 'department' => $oldDepartment],
                ['is_ticketing_employee' => false, 'department' => $newDepartment],
                ['emp_id' => $empId, 'source' => $source, 'open_ticket_ids' => array_column($openTickets, 'ticket_ID')],
                true
            );

            self::alertDepartmentChange($before, $oldDepartment, $newDepartment, $openTickets);
        } catch (\Throwable $e) {
            Log::warning('Ticketing access auto removal failed: ' . $e->getMessage());
        }
    }

    /**
     * In app alert to every superadmin and the affected employee's branch admin.
     */
    protected static function alertDepartmentChange($employee, ?string $oldDepartment, ?string $newDepartment, array $openTickets): void
    {
        $empId = (int) self::field($employee, 'emp_id');
        $branchId = self::field($employee, 'branch_id');
        $name = trim((self::field($employee, 'first_name') ?? '') . ' ' . (self::field($employee, 'last_name') ?? '')) ?: (self::field($employee, 'email') ?? "Employee #{$empId}");

        $recipients = DB::table('employees')
            ->where('is_active', true)
            ->where(function ($q) use ($branchId) {
                $q->whereIn(DB::raw("LOWER(REPLACE(REPLACE(REPLACE(COALESCE(role, ''), ' ', ''), '_', ''), '-', ''))"), ['superadmin']);
                if ($branchId !== null && $branchId !== '') {
                    $q->orWhere(function ($admin) use ($branchId) {
                        $admin->whereRaw('LOWER(TRIM(COALESCE(role, \'\'))) = ?', ['admin'])
                            ->where('branch_id', (int) $branchId);
                    });
                }
            })
            ->pluck('emp_id')
            ->unique();

        $ticketList = empty($openTickets)
            ? 'They hold no open tickets.'
            : 'Open tickets to reassign: ' . implode(', ', array_map(
                fn ($t) => ($t['ticket_number'] ?: ('#' . $t['ticket_ID'])) . ' (' . ($t['title'] ?? '') . ')',
                $openTickets
            )) . '.';

        $message = "{$name} moved from " . ($oldDepartment ?: 'no department') . ' to ' . ($newDepartment ?: 'no department')
            . ', which does not handle tickets, so they are no longer a ticketing employee. ' . $ticketList;

        $data = json_encode([
            'type' => 'ticketing_access_auto_removed',
            'emp_id' => $empId,
            'old_department' => $oldDepartment,
            'new_department' => $newDepartment,
            'blocking_tickets' => $openTickets,
        ]);

        foreach ($recipients as $recipientId) {
            DB::table('notifications')->insert([
                'recipient_id' => (int) $recipientId,
                'recipient_type' => 'employee',
                'title' => 'Ticketing Employee Removed',
                'message' => $message,
                'ticket_id' => null,
                'data' => $data,
                'is_read' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    protected static function isMissingSchema(\Illuminate\Database\QueryException $e): bool
    {
        $msg = $e->getMessage();
        return str_contains($msg, 'Unknown column') || str_contains($msg, 'no such column')
            || str_contains($msg, "doesn't exist") || str_contains($msg, 'no such table');
    }

    protected static function field($row, string $key)
    {
        if (is_array($row)) {
            return $row[$key] ?? null;
        }
        if (is_object($row)) {
            return $row->{$key} ?? null;
        }
        return null;
    }
}
