<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Department scope for assignments made by a department manager.
 *
 * A department manager may only add or remove assignees from their own department.
 * Assignees from other departments on the same ticket must be kept as they are.
 * CS, admins and non managers are not limited here (their rules live elsewhere).
 *
 * Spec 0051 (AC-11): the scope applies to managers of any department a superadmin set to
 * accept routed tickets (departments.accepts_tickets), instead of a hardcoded Service and IT list.
 */
class ManagerAssignmentScope
{
    public function __construct(protected DepartmentManagerResolver $resolver) {}

    /**
     * The caller's employees row when the caller manages a department that accepts routed tickets, else null.
     */
    public function scopedManager($user): ?object
    {
        $emp = $this->resolver->employeeForUser($user);

        return $this->resolver->managedDepartment($emp, true) ? $emp : null;
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
