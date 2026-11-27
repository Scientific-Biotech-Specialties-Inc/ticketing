# 0045. Rationale: ticketing access controls

## Context

The ticketing system has no access control of its own for staff. Any user holding a valid central auth JWT is accepted by `VerifyEmployeeJwt` and created as an `employees` row on first request. Their ticketing role is guessed from the department and role strings: anything containing "service", "engineer", or the plain role "Employee" becomes `service`, which is the technician role. The auth sync in `customer-service` pulls every Engineer, Manager, Employee and Supervisor from every department and applies the same guess.

The result in the live data on 2026-11-17: the ticketing system only routes work to two departments (`Service`, `IT` in its own `departments` table), but 23 staff from Finance (4), HR (2), Sales & Marketing (9), Operations (6), Executive (1) and RA/QA (1) hold the `service` role and are treated as assignable. The auth module also sends inconsistent spellings (`IT` and `IT Department`).

Internal tickets (spec 0008) are raised by staff from any department, so simply locking non support departments out would break internal ticketing. The superadmin needs a way to say which departments supply ticket handlers, and which specific people inside them actually handle tickets, while everyone else stays able to request help. Branch admins run their own branch's staffing and need to manage the people part for their branch.

## Options considered

### Option 1: Flag on employees plus a handler department table (chosen)

Add `is_ticketing_employee`, `designated_by`, `designated_at` to `employees`, and a `ticketing_handler_departments` table, both in `employee-service`. Existing roles stay; eligibility queries add one filter.

**Pros**:
- One where clause on a table every service already reads.
- No change to the many role branches across services and the frontend.
- Department pool and person designation are clearly separate.

**Cons**:
- Every assignable staff query must be found and updated; a missed one leaks requestors into pickers.
- History lives in the audit log, not in its own table.

### Option 2: New `requestor` role

Map non designated staff to a new role value at login and sync.

**Pros**:
- Role checks alone separate requestors from handlers.

**Cons**:
- Every role switch in every service and the frontend must learn a new value; any unhandled branch falls through to undefined behaviour.
- The ticketing role (CS, technician, manager) and the "may handle tickets" decision get mixed into one field, and the auth sync would fight the designation on every run.

### Option 3: Separate designations table

`ticketing_employee_designations (emp_id, designated_by, timestamps)`.

**Pros**:
- Clean history per designation.

**Cons**:
- Every eligibility query needs a join, across three services.

### Option 4: Store the department list in configuration-service

A JSON setting next to the other system settings.

**Pros**:
- Fits the idea of "configuration".

**Cons**:
- `employee-service` would need an HTTP call on every eligibility and sync check, and the list could not be joined against `employees`.

## Rationale

The real problem is that eligibility is inferred from free text that was never meant to carry it. An explicit flag on the row everyone already reads fixes that with the smallest change, and keeps the auth derived role as the single source for *what kind* of handler someone is (the engineer chose to keep deriving the role from auth). Putting the department table in `employee-service` keeps both halves of the decision with the service that owns staff, departments and assignment eligibility, which respects the no direct database coupling rule better than splitting it across services.

Individual designation (rather than whole departments) was chosen so nobody starts receiving tickets because of a change in the auth module. The 409 block on disabling or removing someone with open tickets guarantees no ticket is left with a person who can no longer act on it. The one exception is a department change coming from the auth module itself, which the ticketing system cannot refuse, so it clears the flag and raises an alert instead.

The go live seed (enable the four real handler departments, designate their active staff) means assignment keeps working on day one and the fix for the 23 misclassified staff takes effect immediately.
