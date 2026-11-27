# 0051. Department ticket routing with manager triage

**Date**: 2026-11-27
**Status**: In Progress

## Summary

Customer Service (CS) can now send a ticket to a whole department instead of picking people by name. The department manager then decides: work the ticket personally, hand it to people in the department, or send it back to CS with a reason. A superadmin chooses which departments CS is allowed to route to. This keeps the existing assignment flow and statuses, and adds one column on `departments`, one column on `tickets`, and a small set of new endpoints in `employee-service`.

## Context

Today CS must pick one or more named employees in the assign modal (`POST /tickets/{id}/assign` in `employee-service`). CS often does not know who inside IT or Service is free or best suited. Department managers know this, but they only get involved after CS has already picked someone, through the reassignment scope in `ManagerAssignmentScope` (hardcoded to Service and IT).

Constraints that shape the design:
- There is no team entity. `employees.department` is a free text name matched against `departments.name`, and `position_level` already carries `manager`, `lead`, `senior`, `mid`, `junior`.
- `ticket_assignments` already supports several assignees per ticket, a pending state (`Pending Assignment`), self accept, reminders (`last_reminder_sent_at`), and assignment periods.
- All services share the `ticketing_system` database (spec 0026). Cache invalidation must use `SCAN` (`TicketCacheService::clearTicketCaches`). Actor identity must come from the verified token, never the request body (spec 0034).
- The state machine is duplicated in `ticket-service` and `employee-service` (`TicketStateMachine`), and `Assigned` (which `Pending Assignment` maps to) does not allow a move back to `Open`.

Assumption: the build approach is not recorded in `AGENTS.md` or the scope header, so the build plan uses end to end (Tracer Bullet) slices.

## Requirements

**User stories**:
- As a CS agent, I want to route a ticket to a department so that its manager, who knows the team, picks the right person.
- As a department manager, I want to see tickets routed to my department in one place, and either take them, hand them to my people, or send them back to CS.
- As a superadmin, I want to choose which departments accept routed tickets so that CS only sees departments that actually work tickets.

**Acceptance criteria**:
- **AC-1**: A superadmin can turn `accepts_tickets` on or off for any department in the existing department form. `PUT /departments/{id}` accepts it and `GET /departments` returns it. A non superadmin gets 403.
- **AC-2**: The migration turns `accepts_tickets` on for the departments named Service and IT (case insensitive). Every other department starts off.
- **AC-3**: The CS assign modal has a Members or Department toggle. CS can choose one or the other, never both. Department mode lists only active departments with `accepts_tickets = true`. A department with no active manager shows as disabled with the note "No active manager".
- **AC-4**: When CS routes a ticket to a department, it moves to `Pending Assignment`. `tickets.assigned_department_id` is set, every active manager of that department gets one open pending `ticket_assignments` row, an audit log row `department_assigned` is written, and each manager gets a bell notification and an email.
- **AC-5**: The server rejects a department route with 422 when: the department is inactive or not accepting tickets (`DEPARTMENT_NOT_ROUTABLE`), it has no active manager (`DEPARTMENT_HAS_NO_MANAGER`), the ticket is unclassified (existing `NEEDS_CLASSIFICATION`), or the move is not a valid transition (existing `INVALID_TICKET_TRANSITION`). A caller who is not CS, admin or superadmin gets 403.
- **AC-6**: A manager sees a Department queue tab listing tickets routed to their department where they still hold an open pending row. It shows ticket number, title, category, priority, SLA label, the routing CS agent, and when it was routed.
- **AC-7**: Accept: the manager takes the ticket and becomes its owner through the existing accept flow (`In Progress`, employee owned). The other managers' rows close, and an audit log row `department_claimed` is written.
- **AC-8**: Assign members: the manager picks one or more active employees of their own department. The same category track eligibility and override reason rules as CS assignment apply. The manager's row and the other managers' rows close, the members get pending rows and the usual assignment notification, and an audit log row `department_delegated` is written. `assigned_department_id` stays set.
- **AC-9**: Return to CS: the manager must give a reason (10 to 500 characters). The ticket goes back to `Open` with `assigned_to` and `assigned_department_id` cleared and every open manager row closed. An audit log row `department_returned` with the reason is written, and CS gets a notification (the agent who routed it included). Only allowed while no manager has acted yet.
- **AC-10**: First to act wins. If a second manager tries Accept, Assign members or Return after another manager already acted, they get 409 `DEPARTMENT_ALREADY_CLAIMED` and nothing changes.
- **AC-11**: After delegating, the manager keeps oversight. They can still add or remove assignees in their own department through the existing manager scope. That scope now applies to managers of any department with `accepts_tickets = true`, instead of the hardcoded Service and IT list.
- **AC-12**: While a ticket waits in a department queue, CS can reroute it from the assign modal (to members or another department). Doing so closes the open manager rows and writes the matching audit row.
- **AC-13**: The SLA clock keeps running while the ticket waits for the manager. Pending manager rows get the same reminders as any pending assignee.
- **AC-14**: The ticket timeline shows "Routed to <department> by <CS agent>", then "Claimed by", "Assigned to <members> by", or "Returned to CS by <manager>: <reason>".
- **AC-15**: CS ticket lists show a department routed ticket that nobody has acted on yet as "Waiting on <department>".
- **AC-16**: Assigning members directly works exactly as it does today (regression).

## Options considered

### Option 1: Manager as pending assignee, reuse Pending Assignment (chosen)
Routing creates normal pending `ticket_assignments` rows for the department's managers and records the department on the ticket. Manager actions reuse the existing accept and assign internals.

**Pros**: no new status, so the SLA, dashboards, reminders and state machine keep working. Reuses eligibility, notifications and assignment periods.
**Cons**: the closed manager rows appear in assignment history, so analytics must leave them out. Department routed and person routed tickets share one status, so filters need `assigned_department_id`.

### Option 2: New "With Department" status and a separate department queue table
A dedicated status plus a `ticket_department_queue` table, with no assignment rows until the manager acts.

**Pros**: very clear reporting, and no placeholder assignment rows.
**Cons**: touches both state machines, SLA rules, every status filter and dashboard, and duplicates reminder and notification logic.

### Option 3: Real Teams entity inside departments
Teams with members and a lead, where routing targets a team.

**Pros**: finer routing in large departments.
**Cons**: new tables, admin screens and membership upkeep that nobody asked for. The engineer confirmed that a team means the whole department.

## Decision

**Chosen option**: Option 1: Manager as pending assignee, reuse Pending Assignment.

CS routes a ticket to a superadmin approved department. Every active manager of that department gets a pending assignment, and the first one to accept, delegate or return it owns that decision.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `api-testing` (`.claude/skills/api-testing/`)

## Rationale

The existing pending assignment machinery already does most of what department routing needs: several pending people, self accept, reminders, SLA, notifications. Adding a status would ripple through two state machine copies and every dashboard for no gain the engineer asked for. Recording the department on `tickets` (not only in the audit log) keeps "routed via IT" filterable and reportable after the manager delegates.

Decisions settled during design (pick, then the runner up):
- **New endpoints in a `DepartmentRoutingService`, instead of overloading `POST /assign`.** `assignTicket` is already large and drives CS, manager and accept branches, so a separate thin controller plus service keeps the rules testable and leaves direct assignment untouched (AC-16). Runner up: a `department_id` field on `/assign`.
- **First to act is detected through the caller's own row.** Every action locks the ticket row (`lockForUpdate`) and requires the caller's pending row to still be open. The winner closes everyone else's rows, so a late second manager finds their row closed and gets 409. No extra "claimed" column is needed. Runner up: a `department_claimed_at` column.
- **Return to Open is a guarded transition inside the service, not a widened transition table.** Adding `Open` to `Assigned.allowed` in `DEFAULT_TRANSITIONS` would let other flows drop tickets back to Open. The service checks its own preconditions (department routed, no one acted) and performs the move. Runner up: widen the table in both copies.
- **`tickets.assigned_to` points at the first manager (lowest `emp_id`) while pending.** This matches how multi assignee tickets already use `assigned_to` (first of the list), so existing "assigned to me" queries keep working. It is replaced by the claimer, or by the first delegated member. Runner up: leave it null, which risks breaking dashboards that join on it.
- **Closed manager rows use `assignment_status = 'department_closed'`** so analytics and workload counts can leave them out, and they get `completed_at = now()`.

## Feature design

**Data model sketch**:

| Table | Change | Type | Notes |
|---|---|---|---|
| `departments` | add `accepts_tickets` | boolean, not null, default `false` | Superadmin switch. Migration sets `true` for names Service and IT |
| `tickets` | add `assigned_department_id` | unsigned bigint, nullable, FK `departments.id`, `nullOnDelete`, indexed | Set on route, kept after delegation, cleared on return or CS reroute to members |
| `ticket_assignments` | none | | Manager rows are normal rows (`assignment_status = 'assigned'`). When closed by a department action: `assignment_status = 'department_closed'`, `completed_at = now()` |
| `ticket_audit_logs` | none | | New `action_type` values: `department_assigned`, `department_claimed`, `department_delegated`, `department_returned`, `department_rerouted` (FK stays nullable and non cascading) |

Relationships: one department has many tickets (`assigned_department_id`). Department managers are resolved, not stored (see Value sourcing).

**State transitions** (only the department path, using existing states):

| From | Action | To | Who |
|---|---|---|---|
| Open / Reassigned | Route to department | Pending Assignment (Assigned) | CS, admin, superadmin |
| Pending Assignment | Accept | In Progress (Employee owned) | First manager to act |
| Pending Assignment | Assign members | Pending Assignment (members pending) | First manager to act |
| Pending Assignment | Return to CS | Open (guarded in service) | First manager to act |
| Pending Assignment | Reroute | Pending Assignment | CS |

**API surface** (all in `employee-service`, reached through the existing `/api/ticketing/employee` gateway prefix, so no Nginx change):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/departments` | GET | none | adds `accepts_tickets` per row | existing | |
| `/departments/{id}` | PUT | `accepts_tickets`: bool (optional) | updated department | superadmin | 403, 404, 422 |
| `/assignable-departments` | GET | none | `[{id, name, code, manager_count, routable}]` (only `is_active` and `accepts_tickets`) | CS, admin, superadmin | 403 |
| `/tickets/{id}/assign-department` | POST | `department_id`: int (req), `priority_ID`: int (opt), `note`: string ≤500 (opt) | ticket, `assigned_department_id`, `manager_ids` | CS, admin, superadmin | 403, 404, 422 `DEPARTMENT_NOT_ROUTABLE` / `DEPARTMENT_HAS_NO_MANAGER` / `NEEDS_CLASSIFICATION` / `INVALID_TICKET_TRANSITION` |
| `/department-queue` | GET | none | list of queue rows (AC-6 fields) | department manager | 403 |
| `/tickets/{id}/department-claim` | POST | none | ticket | manager with open pending row | 403, 404, 409 `DEPARTMENT_ALREADY_CLAIMED` |
| `/tickets/{id}/department-delegate` | POST | `employee_ids`: int[] ≥1 (req), `override_reason`: string (req when someone is outside the category track) | ticket, assignees | manager with open pending row | 403, 404, 409, 422 (outside department, ineligible without reason, inactive employee) |
| `/tickets/{id}/department-return` | POST | `reason`: string 10..500 (req) | ticket | manager with open pending row | 403, 404, 409, 422 |

CS reroute (AC-12) uses `/assign` (members) or `/assign-department` (another department). Both close open manager rows first and write `department_rerouted`. `/assign` clears `assigned_department_id` when CS reroutes to members.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| All actions | Acting employee | Verified token identity resolved to `employees` row (spec 0034), never a body field |
| List and route | Department routable | `departments.is_active AND departments.accepts_tickets` |
| List and route | Department managers | `employees` where `is_active = 1`, `LOWER(TRIM(department)) = LOWER(TRIM(departments.name))`, and (`LOWER(position_level) = 'manager'` or `role` or `technical_role` contains "manager"), the same rule as `ManagerAssignmentScope` |
| List | `manager_count`, `routable` | count of the manager set above, and `routable = manager_count > 0` |
| Route | `tickets.assigned_to` | lowest `emp_id` in the manager set |
| Route | Status id | `ticket_statuses` row named "Pending Assignment" (existing lookup) |
| Queue | Routing CS agent, routed at | latest `ticket_audit_logs` row `department_assigned` for the ticket (`action_by_ID`, `created_at`) |
| Queue | SLA label | existing `EmployeeAssignmentService::slaLabel` |
| Claim / delegate / return | "Already acted" | caller's `ticket_assignments` row for the ticket is no longer open (`completed_at` not null) |
| Delegate | Allowed members | active employees whose department matches the manager's department; eligibility from the existing category track check used by CS assignment |
| Return | CS recipients | `TicketNotificationService::notifyCS`, plus the routing agent from the `department_assigned` audit row |
| Notify managers | Email template | new event key `ticket_department_routed` in configuration-service email templates, falling back to the existing `ticket_assigned` template when it is missing |
| Timeline | Department name | `departments.name` via `assigned_department_id`, also copied into audit `details` so the history survives renames or deletes |

**Key invariants**:
- A ticket is department routed or person routed, never both at once at route time.
- While `assigned_department_id` is set and the ticket is `Pending Assignment` with manager rows open, only one manager action ever succeeds (row lock plus open row check, one transaction).
- Return is only possible before anyone acted, and it always leaves `assigned_department_id` null and zero open assignment rows.
- A manager can only delegate to their own department.
- Every department action writes exactly one audit row, clears ticket caches with `SCAN`, and dispatches `TicketChanged`.

**Security model**:
- Route and list: CS, admin and superadmin roles (same role set as the existing CS assign branch).
- Queue, claim, delegate, return: only a resolved department manager who holds an open pending row on that ticket. Anyone else gets 403.
- Toggle `accepts_tickets`: superadmin only (existing check in `DepartmentController`).
- `reason`, `note` and `override_reason` are stored with `strip_tags` and length limits.
- No new PII. No compliance scope.

**Configuration required**: none (no new env vars). One seeded email template row (`ticket_department_routed`) in configuration-service.

**Critical test scenarios**:
- Happy path: superadmin enables a department, CS routes, two managers see it in the queue, manager A delegates to two members, members accept. Verifies **AC-1**, **AC-3**, **AC-4**, **AC-6**, **AC-8**.
- Claim path: manager accepts and becomes owner, and the other manager's queue empties. Verifies **AC-7**.
- Race: managers A and B act at the same moment, one succeeds and the other gets 409 with no changes. Verifies **AC-10**.
- Return: manager returns with a reason, the ticket is Open and unassigned, CS is notified, and the timeline shows the reason. A return with a short reason gets 422. Verifies **AC-9**, **AC-14**.
- Rejections: department off, no manager, unclassified ticket, CS sending both modes. Verifies **AC-5**, **AC-3**.
- Auth: an employee who is not a manager calls claim and gets 403. A manager of another department calls delegate and gets 403. A non superadmin toggles the switch and gets 403. Verifies **AC-1**, **AC-5**.
- Delegate outside department or without override for an ineligible member gets 422. Verifies **AC-8**.
- Manager scope follows the switch: a manager of a newly enabled department can reassign within it. Verifies **AC-11**.
- CS reroute closes manager rows. Verifies **AC-12**.
- Direct assignment regression suite still passes. Verifies **AC-16**.

## Build plan

1. Migration (employee-service): add `departments.accepts_tickets` and set it to true for Service and IT. Migration (ticket-service, owner of `tickets`): add `tickets.assigned_department_id` with FK and index. Satisfies **AC-1**, **AC-2**, **AC-4**
2. Tracer slice, CS to manager: `DepartmentManagerResolver` (shared manager rule), `GET /assignable-departments`, `POST /tickets/{id}/assign-department` in a new `DepartmentRoutingController` plus `DepartmentRoutingService` (row lock, pending rows, audit, cache clear, `TicketChanged`, bell and email). Satisfies **AC-4**, **AC-5**, **AC-13**
3. CS assign modal (`AssignModal` in `frontend/web/src/components/CSModals.jsx`): Members or Department toggle, routable list with disabled "No active manager" rows, error codes shown as messages. Satisfies **AC-3**
4. `GET /department-queue` plus a shared `DepartmentQueueTab` component on the manager ticket pages (`ITManagerTickets.jsx`, `ServiceManagerTickets.jsx`, and `EmployeeMyTickets.jsx` for managers of other enabled departments). Satisfies **AC-6**
5. Claim endpoint and UI action (reuses the existing accept internals inside the locked transaction, closes the other rows). Satisfies **AC-7**, **AC-10**
6. Delegate endpoint and UI (reuses the eligibility check and `assignTicket` with the acting manager, closes manager rows, keeps `assigned_department_id`). Satisfies **AC-8**, **AC-10**
7. Return endpoint and UI (guarded move to Open, clears department and assignee, `notifyCS` plus routing agent). Satisfies **AC-9**, **AC-10**
8. Superadmin department form: `accepts_tickets` switch, plus `DepartmentController::update` validation and `GET /departments` output. Satisfies **AC-1**
9. Generalize `ManagerAssignmentScope` from the hardcoded Service and IT list to departments with `accepts_tickets = true`. Satisfies **AC-11**
10. CS reroute: `/assign` and `/assign-department` close open manager rows, write `department_rerouted`, and `/assign` clears `assigned_department_id`. Satisfies **AC-12**
11. Timeline labels in `AuditTimelineService` for the new action types, plus the "Waiting on <department>" label in CS lists (`CSAssigned.jsx`, `CSIncoming.jsx`). Satisfies **AC-14**, **AC-15**
12. Seed the `ticket_department_routed` email template in configuration-service. Satisfies **AC-4**
13. Exclude `assignment_status = 'department_closed'` rows from workload, performance and assignment period metrics (employee-service workload, analytics-service reporting reads). Satisfies **AC-13**, **AC-16**
14. Feature tests for every scenario above (on an isolated test database, never `ticketing_system`), plus frontend tests for the toggle and the queue tab. Satisfies **AC-1** to **AC-16**

## Consequences

**Positive**:
- CS no longer has to guess who is free. Managers triage with their own knowledge of the team.
- No new status. SLA, reminders, dashboards and the state machine keep working unchanged.
- One manager scope rule driven by data instead of a hardcoded department list.

**Negative / tradeoffs**:
- Closed manager rows add noise to `ticket_assignments`. Every metric that counts assignments must leave out `department_closed`, and missing one will inflate manager workload numbers.
- A ticket waiting on a slow department still burns SLA. This is intended, but it will show up as manager breaches.
- If every manager of a department is deactivated while tickets are pending, those tickets sit in the queue until CS reroutes them (AC-15 makes them visible, but nothing reroutes them automatically).
- Matching managers by department name stays fragile, because renaming a department or mistyping `employees.department` silently drops managers.

**Neutral**:
- Two migrations in two services, both additive and nullable, or with a default (safe on a live system).
- New audit `action_type` values that downstream readers (analytics, timeline) need to know about.

## Migration plan

**Strategy**: no migration of live data needed. Additive columns only.
**Phases**:
1. Deploy the migrations (new column defaults are safe for running code).
2. Deploy the backend and frontend together. Until a superadmin changes anything, only Service and IT are routable.
**Rollback**: revert the code. The columns can stay (unused), or the migrations can be rolled back once no ticket has `assigned_department_id` set.
**Risks**: analytics counting `department_closed` rows before task 13 lands, so ship task 13 in the same release.

## Follow-up

- [ ] Consider linking `employees` to `departments` by id instead of by name (a separate decision, it touches every department query).
- [ ] Decide later whether a department with zero active managers should alert the superadmin automatically.
- [x] Scope row added in `docs/scope/scope.md`.
