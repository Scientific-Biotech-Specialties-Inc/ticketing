<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Department scope for assignments made by a Service or IT department manager.
 *
 * A department manager may only add or remove assignees from their own department.
 * Assignees from other departments on the same ticket must be kept as they are.
 * CS, admins and non managers are not limited here (their rules live elsewhere).
 */
class ManagerAssignmentScope
{
    /** Departments whose managers are limited to their own staff. */
    protected const SCOPED_DEPARTMENTS = ['service', 'it'];

    /**
     * The caller's employees row when the caller is a Service or IT department manager, else null.
     */
    public function scopedManager($user): ?object
    {
        $email = strtolower(trim((string) ($user->email ?? '')));
        if ($email === '') {
            return null;
        }

        $emp = DB::table('employees')
            ->whereRaw('LOWER(email) = ?', [$email])
            ->select('emp_id', 'first_name', 'last_name', 'role', 'department', 'position_level', 'technical_role')
            ->first();
        if (!$emp) {
            return null;
        }

        $role = strtolower(trim((string) ($emp->role ?? '')));
        if (in_array($role, ['admin', 'superadmin', 'super admin'], true)) {
            return null;
        }

        $isManager = strtolower(trim((string) ($emp->position_level ?? ''))) === 'manager'
            || str_contains($role, 'manager')
            || str_contains(strtolower((string) ($emp->technical_role ?? '')), 'manager');
        $dept = strtolower(trim((string) ($emp->department ?? '')));

        return $isManager && in_array($dept, self::SCOPED_DEPARTMENTS, true) ? $emp : null;
    }

    /**
     * Error message when the new assignee set adds or removes anyone outside the manager's department, else null.
     *
     * @param  int[]  $newEmployeeIds
     */
    public function violation(object $manager, int $ticketId, array $newEmployeeIds): ?string
    {
        $dept = strtolower(trim((string) $manager->department));
        $current = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->whereNull('completed_at')
            ->pluck('employee_ID')
            ->map(fn ($id) => (int) $id)
            ->all();
        $new = array_map('intval', $newEmployeeIds);

        $changed = array_values(array_unique(array_merge(
            array_diff($new, $current),
            array_diff($current, $new)
        )));
        if (empty($changed)) {
            return null;
        }

        $outside = DB::table('employees')
            ->whereIn('emp_id', $changed)
            ->whereRaw("LOWER(TRIM(COALESCE(department, ''))) <> ?", [$dept])
            ->exists();

        return $outside
            ? "You can only assign or remove employees from the {$manager->department} department."
            : null;
    }
}
