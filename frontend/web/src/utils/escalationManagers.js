/**
 * Escalation follows the assigned employees, not the ticket category: each assignee's
 * department escalates to that department's manager. An IT assignee plus a Service assignee
 * means both the IT manager and the Service manager are notified.
 *
 * The ticket-service resolves the real recipients when the ticket is escalated
 * (SLAService::resolveAssigneeDepartmentManagers); these helpers only preview them in the UI.
 */

const DEPARTMENT_KEYS = {
  it: 'it',
  'it support': 'it',
  service: 'service',
  'customer service': 'cs',
  cs: 'cs',
};

const normalize = (value) => String(value || '').trim().toLowerCase();

const isManager = (emp) =>
  normalize(emp?.position_level) === 'manager' || normalize(emp?.role).includes('manager');

/**
 * Unique departments of the given assignees, in first seen order.
 * Accepts employee objects, or ids looked up in `employees`.
 */
export const getAssigneeDepartments = (assignees = [], employees = []) => {
  const seen = new Map();
  (assignees || []).forEach((entry) => {
    const emp = typeof entry === 'object' && entry !== null
      ? entry
      : (employees || []).find((e) => String(e.id ?? e.emp_id) === String(entry));
    const dept = String(emp?.department || '').trim();
    if (dept && !seen.has(normalize(dept))) seen.set(normalize(dept), dept);
  });
  return Array.from(seen.values());
};

/**
 * The manager for one department: the configured department manager first
 * (`department_managers` from the eligibility endpoint), then an active manager in `employees`.
 */
export const findDepartmentManager = (department, departmentManagers = null, employees = []) => {
  const key = DEPARTMENT_KEYS[normalize(department)];
  const configured = key ? departmentManagers?.[key] : null;
  if (configured?.name) return { ...configured, department: configured.department || department };

  const fromDirectory = (employees || []).find(
    (e) => normalize(e.department) === normalize(department) && isManager(e)
  );
  return fromDirectory ? { ...fromDirectory, department: fromDirectory.department || department } : null;
};

/**
 * One row per assignee department: `{ department, manager }` (manager is null when none is known).
 */
export const getEscalationManagers = (assignees = [], departmentManagers = null, employees = []) =>
  getAssigneeDepartments(assignees, employees).map((department) => ({
    department,
    manager: findDepartmentManager(department, departmentManagers, employees),
  }));
