<?php

namespace App\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0051: the one rule for "who manages a department", shared by department routing and
 * the manager assignment scope.
 *
 * Employees link to departments by name (employees.department is free text). A manager is an
 * active employee whose department matches the department name (case and space insensitive) and
 * whose position_level is manager, or whose role or technical_role mentions manager.
 * Admins and superadmins are never counted as department managers.
 */
class DepartmentManagerResolver
{
    private const ADMIN_ROLES = ['admin', 'superadmin', 'super admin'];

    /**
     * True when the employees row is a manager by the shared rule (department not checked).
     */
    public function isManager(object $employee): bool
    {
        $role = strtolower(trim((string) ($employee->role ?? '')));
        if (in_array($role, self::ADMIN_ROLES, true)) {
            return false;
        }

        return strtolower(trim((string) ($employee->position_level ?? ''))) === 'manager'
            || str_contains($role, 'manager')
            || str_contains(strtolower((string) ($employee->technical_role ?? '')), 'manager');
    }

    /**
     * Active managers of the department, lowest emp_id first.
     */
    public function managersFor(object $department): Collection
    {
        return $this->managerQuery((string) $department->name)
            ->orderBy('emp_id')
            ->get(['emp_id', 'first_name', 'last_name', 'email', 'department', 'role', 'position_level', 'technical_role']);
    }

    /**
     * Manager counts for several departments at once, keyed by normalized department name.
     *
     * @param  string[]  $names
     * @return array<string, int>
     */
    public function managerCounts(array $names): array
    {
        $normalized = array_values(array_unique(array_map(fn ($n) => $this->normalize($n), $names)));
        if (empty($normalized)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($normalized), '?'));

        return $this->managerFilter(DB::table('employees'))
            ->whereRaw("LOWER(TRIM(COALESCE(department, ''))) IN ({$placeholders})", $normalized)
            ->selectRaw("LOWER(TRIM(department)) as dept, COUNT(*) as total")
            ->groupByRaw('LOWER(TRIM(department))')
            ->pluck('total', 'dept')
            ->map(fn ($n) => (int) $n)
            ->all();
    }

    /**
     * The employees row for the authenticated user. Identity always comes from the verified
     * token user (spec 0034), never from a request body field.
     */
    public function employeeForUser($user): ?object
    {
        if (!$user || $user instanceof \App\Models\Client) {
            return null;
        }

        $columns = ['emp_id', 'first_name', 'last_name', 'email', 'department', 'role', 'position_level', 'technical_role', 'is_active'];

        $empId = $user->emp_id ?? null;
        if ($empId) {
            $row = DB::table('employees')->where('emp_id', (int) $empId)->first($columns);
            if ($row) {
                return $row;
            }
        }

        $email = strtolower(trim((string) ($user->email ?? '')));

        return $email === ''
            ? null
            : DB::table('employees')->whereRaw('LOWER(email) = ?', [$email])->first($columns);
    }

    /**
     * The departments row the employee manages, when they are an active manager of a department.
     * With $routableOnly, the department must also be active and accept routed tickets.
     */
    public function managedDepartment(?object $employee, bool $routableOnly = false): ?object
    {
        if (!$employee || !(bool) ($employee->is_active ?? true) || !$this->isManager($employee)) {
            return null;
        }

        $name = $this->normalize((string) ($employee->department ?? ''));
        if ($name === '') {
            return null;
        }

        return DB::table('departments')
            ->whereRaw('LOWER(TRIM(name)) = ?', [$name])
            ->when($routableOnly, fn ($q) => $q->where('is_active', true)->where('accepts_tickets', true))
            ->first();
    }

    public function normalize(string $name): string
    {
        return strtolower(trim($name));
    }

    private function managerQuery(string $departmentName)
    {
        return $this->managerFilter(DB::table('employees'))
            ->whereRaw("LOWER(TRIM(COALESCE(department, ''))) = ?", [$this->normalize($departmentName)]);
    }

    private function managerFilter($query)
    {
        return $query
            ->where('is_active', 1)
            ->whereRaw("LOWER(TRIM(COALESCE(role, ''))) NOT IN (?, ?, ?)", self::ADMIN_ROLES)
            ->where(function ($q) {
                $q->whereRaw("LOWER(TRIM(COALESCE(position_level, ''))) = 'manager'")
                    ->orWhereRaw("LOWER(COALESCE(role, '')) LIKE '%manager%'")
                    ->orWhereRaw("LOWER(COALESCE(technical_role, '')) LIKE '%manager%'");
            });
    }
}
