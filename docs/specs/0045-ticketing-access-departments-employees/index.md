# 0045. Ticketing access: handler departments and designated ticketing employees

**Date**: 2026-11-17
**Status**: In Progress
**Mode**: ENHANCEMENT
**Related**: 0008 (superadmin configuration), 0009 (central auth branch payload), 0010 (reassignment and eligibility), 0011 (system security alerts), 0029 (audit governance)

## Summary

Today every person in the central auth module who opens the ticketing system is treated as someone who works tickets, so Finance, HR, Sales and Operations staff show up as assignable technicians. This spec adds two controls. The superadmin picks which auth module departments are **handler departments** (the pool of people who may work tickets), and then the superadmin, or a branch admin for their own branch, picks the individual **ticketing employees** from that pool. Everyone else from any department still signs in, but only as a **requestor** (someone who raises and follows their own internal tickets). Superadmin and admin roles are never affected.

## Requirements

**User stories**:
- As a superadmin, I want to choose which departments' staff may handle tickets so that people outside support and service never receive assignments.
- As a superadmin or branch admin, I want to pick exactly which people are ticketing employees so that nobody starts receiving tickets without a decision.
- As a staff member who is not a ticketing employee, I want to still raise and follow my own internal tickets so that I can get help without being put in a work queue.
- As a superadmin, I want every change recorded so that I can see who changed access and when.

**Acceptance criteria**:
- **AC-1**: Under Ticket Configuration, the superadmin sees a "Ticketing Access" tab with a Departments section listing every distinct auth module department (the distinct `employees.department` values, plus any department already saved), each with an on or off toggle and a count of active staff in it. Spelling variants (for example `IT` and `IT Department`) are listed as separate rows.
- **AC-2**: Saving the department list persists it to `ticketing_handler_departments`. Department names match trimmed and case insensitive.
- **AC-3**: Turning a department off is refused with HTTP 409 when any ticketing employee in that department still holds an open ticket assignment. The response lists those tickets (ticket number, title, assignee) and the UI shows them so the superadmin can reassign first. Nothing is saved in that case.
- **AC-4**: Turning a department off (when allowed) clears `is_ticketing_employee` for every employee in it.
- **AC-5**: The Ticketing Employees section lists the active staff in enabled departments, with filters for department, branch, status (Ticketing Employee, Requestor, Not Yet Designated) and a name or email search. Each row shows name, email, department, branch, the ticketing role derived from auth (read only), and a toggle.
- **AC-6**: A person can be designated only while their department is enabled; otherwise the API returns 422.
- **AC-7**: Removing a person's designation is refused with HTTP 409 while they hold an open ticket assignment, listing the tickets, the same as AC-3.
- **AC-8**: An "Add everyone in this department" action designates every active, not yet designated person in one enabled department (limited to the caller's branch for a branch admin) in one request.
- **AC-9**: Staff who join an enabled department later (via the auth sync or first login) arrive with `is_ticketing_employee = false` and appear under the "Not Yet Designated" filter, with a count badge on the tab.
- **AC-10**: A branch admin has a "Ticketing Employees" page in the admin portal (`/admin/ticketing-employees`) that shows and edits only employees in their own branch. A branch admin can view the department list but cannot change it (403 on the department write endpoint). A branch admin toggling an employee in another branch gets 403.
- **AC-11**: Only designated, active employees appear in any assignment picker, employee status list, workload view, or auto assignment candidate set, and only they can be assigned to or accept a ticket. Assigning or accepting with a non designated employee returns 403 with the message "This employee is not a ticketing employee."
- **AC-12**: A non designated staff member who signs in lands in the employee portal limited to My Tickets, Messages, Notifications and Profile (plus ticket detail and history detail for their own tickets). Work queue routes (dashboard, incoming, assigned, machine, progress, ticket update, manager dashboards) redirect to My Tickets, and their APIs return 403.
- **AC-13**: Superadmin and admin roles bypass both rules: they are never blocked, never listed as ticketing employees, and their access is unchanged.
- **AC-14**: When a designated person's auth module department changes to one that is not enabled (seen on sync or login), their designation is cleared automatically. Their open tickets stay assigned, and the superadmin and their branch admin receive an in app alert listing the tickets that need reassigning.
- **AC-15**: Every department toggle, designation, removal, bulk add and automatic removal writes a `ticket_audit_logs` row with `ticket_ID` null, the actor, and before and after values.
- **AC-16**: At go live the migration enables `Service`, `IT`, `IT Department` and `Customer Service`, and designates every active employee in those departments (excluding superadmin and admin roles). Every other department starts disabled, and its staff become requestors.

## Decision

**Chosen option**: Option 1, a flag on `employees` plus a handler department table owned by `employee-service`, checked wherever assignable staff are chosen.

Keep each staff member's existing role, add an explicit `is_ticketing_employee` flag that every assignment path filters on, and give the superadmin (and branch admins, for people only) a screen to manage it.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

`ticketing_handler_departments` (new, owned by `employee-service`)
| Field | Type | Rules |
|---|---|---|
| `id` | bigint PK | |
| `department_name` | string(255) | unique; compared trimmed and lowercased |
| `is_enabled` | boolean | default false |
| `updated_by` | unsigned bigint, nullable | emp_id of the superadmin who last changed it |
| `created_at`, `updated_at` | timestamps | |

`employees` (existing, owned by `employee-service`; three new columns)
| Field | Type | Rules |
|---|---|---|
| `is_ticketing_employee` | boolean | default false, indexed |
| `designated_by` | unsigned bigint, nullable | emp_id of who last changed the flag (null for the seed and automatic removals) |
| `designated_at` | timestamp, nullable | |

Relationship: `employees.department` matches `ticketing_handler_departments.department_name` by normalized name. This is a soft match, not a foreign key, because the department string comes from the auth module.

**State transitions** (per employee):
```
 Requestor (flag false) ──designate (dept enabled)──► Ticketing Employee (flag true)
 Ticketing Employee ──remove (no open assignments)──► Requestor
 Ticketing Employee ──dept disabled / auth dept change──► Requestor (auto)
 New staff in enabled dept ──► Requestor, listed as "Not Yet Designated"
```
"Not Yet Designated" is a derived view (flag false and department enabled), not a stored state.

**API surface** (all on `employee-service`, reached through the gateway at `/api/ticketing/employee/...`; staff JWT required, same middleware group as `POST /departments`):
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/ticketing-access/departments` | GET | none | `[{department_name, is_enabled, active_staff_count, designated_count}]` | superadmin, admin (read) | 401, 403 |
| `/ticketing-access/departments` | PUT | `departments: [{department_name:string, is_enabled:bool}]` (req) | updated list | superadmin | 403, 409 `{blocking_tickets:[{ticket_ID, ticket_number, title, assignee_name, department}]}`, 422 |
| `/ticketing-access/employees` | GET | `department?`, `branch_id?`, `status? (designated\|requestor\|pending)`, `search?`, `page?`, `per_page? (default 25, max 100)` | paginated `[{emp_id, name, email, department, branch, branch_id, ticketing_role, is_ticketing_employee, designated_at}]`, `pending_count` | superadmin (all), admin (own branch forced) | 401, 403 |
| `/ticketing-access/employees/{empId}` | PUT | `is_ticketing_employee:bool` (req) | updated row | superadmin, admin (own branch) | 403, 404, 409 `{blocking_tickets}`, 422 dept not enabled |
| `/ticketing-access/employees/bulk-designate` | POST | `department_name:string` (req) | `{designated_count}` | superadmin, admin (own branch) | 403, 422 dept not enabled |

Existing endpoints changed:
| Endpoint | Change |
|---|---|
| Staff profile (`customer-service` `getProfile`, and the cached auth user) | adds `is_ticketing_employee` |
| Assign and accept ticket (`employee-service` `EmployeeAssignmentService::assignTicket`, `acceptTicket`, reassignment) | rejects non designated employees with 403 |
| Employee status and directory lists (`customer-service` `employeeStatuses`, `employee-service` directory, any auto assignment candidate query) | filter `is_ticketing_employee = true` |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Department list | department names | `SELECT DISTINCT TRIM(department) FROM employees WHERE is_active` (already synced from the auth module) union `ticketing_handler_departments.department_name` |
| Department list | `is_enabled` | `ticketing_handler_departments.is_enabled`; a name with no row is shown as disabled |
| Department list | `active_staff_count`, `designated_count` | counts over `employees` by normalized department, excluding superadmin and admin roles |
| Employee list | `ticketing_role` | derived from existing `employees.role` and `position_level` (Customer Service, Service or Technician, Manager), read only |
| Employee list | `branch`, `branch_id` | `employees.branch`, `employees.branch_id` |
| Admin scoping | caller's branch | the authenticated admin's `branch_id` from the verified JWT user (spec 0009); any `branch_id` query param from an admin is ignored |
| 409 response | open assignments | `ticket_assignments` joined to `tickets` where the ticket status is not terminal (Closed, Resolved, Cancelled, using the existing open status helper) |
| Profile flag | `is_ticketing_employee` | `employees.is_ticketing_employee` |
| Auto removal | "department no longer enabled" | the sync or login writes a new `employees.department`; compare against `ticketing_handler_departments` |
| Alert recipients | superadmin, branch admin | employees with role superadmin, plus the admin whose `branch_id` equals the affected employee's |
| Audit row | actor, before, after | the authenticated user's emp_id; the old and new flag or toggle values |

**Key invariants**:
- `is_ticketing_employee = true` implies the employee's normalized department has `is_enabled = true` and `is_active = true`.
- No path assigns a ticket to, or lets a ticket be accepted by, an employee with the flag false. This is checked against the database row at assign or accept time, never only against the cached session.
- Superadmin and admin roles are excluded from every count and list, and their access is never gated.
- The auth sync (`customer-service` `AuthController::autoSyncWithAuthModule`, `ticket-service` `EmployeeDirectorySyncService`, `employee-service` directory sync) and the login upsert (`VerifyEmployeeJwt::resolveUserEntity`) never set the flag to true. They only insert new rows with false, and clear it when the department is no longer enabled.
- Disabling a department or removing a person never leaves an open ticket held by a non designated person, except through the AC-14 automatic path, which always raises the alert.

**Security model**:
- Department write: superadmin only. Department read: superadmin and admin.
- Employee designation read and write: superadmin across all branches; admin only where `employees.branch_id` equals the admin's own `branch_id`, enforced on the server from the verified token.
- Requestor guard: every work queue API (incoming, assigned, accept, employee update, workload, manager queues) returns 403 when the caller is a non designated, non admin staff member. The frontend route guard is for user experience only; the server guard is the real control.
- No new credentials or PII beyond what `employees` already stores. Every change is audit logged (AC-15).

**Configuration required**: none (no new env vars).

**UI requirements** (follow `DESIGN.md` tokens, the 8px grid, Lucide icons, skeleton loaders for lists, `Loader2` only on save buttons, Title Case badges):
- Superadmin: new group "Access" in the `SuperAdminTicketConfig` tab list with a subtab "Ticketing Access" (`/superadmin/config/ticketing-access`). Section 1 is Departments (toggle list with counts, save bar). Section 2 is Ticketing Employees (filters, table, row toggle, "Add everyone in this department", "Not Yet Designated" count badge).
- Admin: new sidebar item "Ticketing Employees" in the admin layout, the same table limited to their branch, and a read only department list.
- A 409 opens a modal listing the blocking tickets with a link to each ticket.
- Badges: `Ticketing Employee`, `Requestor`, `Not Yet Designated`.
- Requestor portal: the employee sidebar shows only My Tickets, Messages, Notifications, Profile when `is_ticketing_employee` is false and the role is not an admin role.

**Critical test scenarios**:
- Happy path: superadmin enables `Service`, designates a person, the person appears in the CS assignment picker and can accept a ticket. Verifies **AC-2**, **AC-5**, **AC-11**.
- Failure: disabling `IT` while an IT technician holds an open ticket returns 409 with that ticket, and nothing changes. Verifies **AC-3**.
- Failure: removing a designated person with an open ticket returns 409. Verifies **AC-7**.
- Validation: designating a Finance employee while Finance is disabled returns 422. Verifies **AC-6**.
- Permission: a branch admin toggling an employee in another branch gets 403, and a PUT on departments gets 403. Verifies **AC-10**.
- Permission: an HR staff member calling the assigned queue API gets 403, and the UI routes them to My Tickets. Verifies **AC-12**.
- Bypass: a superadmin from department `Super Admin` (disabled) still reaches every page. Verifies **AC-13**.
- Sync: the auth payload moves a designated IT employee to Finance, the flag clears, and an alert is raised with their open tickets. Verifies **AC-14**.
- New hire: the sync inserts a new Service employee who is listed as Not Yet Designated, not assignable. Verifies **AC-9**.
- Audit: each write produces one `ticket_audit_logs` row with null ticket. Verifies **AC-15**.
- Seed: after migration, Finance and HR staff are requestors and Service, IT, IT Department and Customer Service staff are designated. Verifies **AC-16**.

## Build plan

Build approach: none recorded in `AGENTS.md`, so this assumes Tracer Bullet (a thin end to end thread first, then thicken).

1. Migration in `employee-service`: create `ticketing_handler_departments`; add `is_ticketing_employee` (default false, indexed), `designated_by`, `designated_at` to `employees`; seed the four departments enabled and designate their active, non admin staff. Satisfies **AC-2**, **AC-16**.
2. `TicketingAccessService` in `employee-service/app/Services/` (thin controller rule): normalized department matching, open assignment lookup, designate, remove, bulk designate, department save with the 409 check and cascade clear, and audit writes. Satisfies **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-7**, **AC-8**, **AC-15**.
3. `TicketingAccessController` and the five routes, with superadmin and admin branch scoping. Satisfies **AC-1**, **AC-5**, **AC-10**.
4. Enforce eligibility: filter `is_ticketing_employee = true` in every assignable staff query, and reject non designated employees in assign, accept and reassign. Find them by searching for `employees` queries filtered on role `service` or `customer service` across `customer-service`, `employee-service` and `ticket-service`. Satisfies **AC-11**.
5. Superadmin UI: the "Access" group and "Ticketing Access" subtab (departments plus employees, 409 modal). Satisfies **AC-1**, **AC-3**, **AC-5**, **AC-7**, **AC-8**, **AC-9**.
6. Sync and login: make the three sync paths and `VerifyEmployeeJwt::resolveUserEntity` insert new staff with the flag false and clear it on a move to a disabled department, raising the in app alert through the existing system alert dispatcher (spec 0011) to the superadmin and branch admin. Satisfies **AC-9**, **AC-14**.
7. Profile flag and requestor guard: add `is_ticketing_employee` to the profile and auth user, add a server side guard (middleware) on work queue routes, and trim the employee portal routes and sidebar on the frontend. Satisfies **AC-12**, **AC-13**.
8. Admin portal page `/admin/ticketing-employees` and sidebar item. Satisfies **AC-10**.
9. Redis cache invalidation (`SCAN` chunking, never `KEYS`) for any cached employee or assignment lists touched by a designation change. Satisfies **AC-11**.

## Consequences

**Positive**:
- Finance, HR, Sales, Operations, Executive and RA/QA staff stop appearing as technicians right away, while still being able to raise internal tickets.
- One explicit, auditable flag replaces guesswork from department names.

**Negative / tradeoffs**:
- New staff in a handler department cannot receive tickets until someone designates them. That is intentional, but it is one more admin task, and the "Not Yet Designated" badge exists to keep it visible.
- The department list depends on free text from the auth module. A renamed department in the auth module shows up as a new, disabled row, and its staff silently become requestors (AC-14 alerts only for staff who held the flag).
- Every assignable staff query must remember the new filter. A missed query keeps showing requestors; the assign and accept guard is the backstop.
- The cached auth session can show a stale `is_ticketing_employee` in the UI until it expires. Server guards read the database, so this affects only which menu items show.

**Neutral**:
- `ticket_audit_logs` gains non ticket rows (`ticket_ID` null), which is allowed by the existing nullable, non cascading foreign key rule.

## Migration plan

**Strategy**: single migration with seed, no feature flag (the seed preserves today's real handler set).
**Phases**:
1. Deploy the migration and seed (step 1), then the eligibility filters and guards (steps 4, 7) in the same release, so no window exists where the flag is false but still ignored.
2. Superadmin reviews the seeded list and removes anyone who should not handle tickets.
**Rollback**: the migration `down()` drops the table and the three columns. Reverting the release restores role based eligibility.
**Risks**: a sync running between the migration and the code deploy could insert staff with false; this is harmless (they become Not Yet Designated). Staff from `IT Department` are seeded alongside `IT`, so verify those spellings against the live data at deploy time.

## Follow-up

- [ ] Ask the auth module team whether an authoritative department list endpoint can be exposed; it would replace the distinct value scan.
- [ ] Consider merging `IT` and `IT Department` in the auth module so the list has one IT row.
- [ ] `DESIGN.md` describes a Vue and shadcn stack, but `frontend/web` is React 19. Apply its tokens and spacing to the React components, and reconcile the guideline wording separately.
