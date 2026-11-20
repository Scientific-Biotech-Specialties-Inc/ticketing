# 0048. CS approved On Hold requests for employees

**Date**: 2026-11-18
**Status**: In Progress

## Summary

Employees can no longer put a ticket On Hold (or Pending) by themselves. They send an On Hold request with a remark, and Customer Service reviews it, reads the remark, and approves or rejects it. Only an approval actually holds the ticket and pauses the SLA (the response time clock). Every step (request, cancel, approve, reject) shows on the staff timeline and is hidden from the customer, who only sees the status change to On Hold and one generic update.

## Context

Today the employee Ticket Update page offers `Pending` and `On Hold` in its status dropdown, and `POST /tickets/{id}/employee-update` in employee-service writes the new status straight to the ticket. Both statuses map to the On Hold state in the ticket state machine, so either one pauses the SLA clock. Nobody in Customer Service sees or agrees to that pause before it happens, which means a ticket can be parked, and its SLA frozen, on the employee's word alone.

Customer Service already has its own hold path: `POST /tickets/{id}/hold` in ticket-service (CS or admin only, reason required). It runs the `hold` transition in `TicketStateMachine`, saves `held_from_status_ID` and `hold_reason`, pauses the SLA, writes an internal note, writes an `is_internal = 1` timeline row, notifies the customer with a generic "placed on hold" message (no reason), and broadcasts `TicketChanged`. Resume returns the ticket to the held status (spec 0038 AC-28).

The codebase also already has a request then approve pattern: reassignment requests (employee asks, CS approves or denies, customers never see it). The customer timeline filter in `AuditTimelineService` hides rows with `is_internal = 1` and hides reassignment action types by name.

There is a second employee path that can set any status: `EmployeeAssigned.jsx` calls the generic `updateTicket` with a `statusId` map that includes `Pending` (7) and `On Hold` (11). Closing only the Ticket Update page would leave that door open.

## Requirements

**User stories**:
- As an employee, I want to ask CS to put my ticket On Hold, with a remark explaining why, so that the SLA pauses only for a reason CS agrees with.
- As CS, I want to see the employee's remark and approve or reject the request so that tickets are never parked without my say.
- As CS, I want every hold request and decision on the staff timeline so that the history explains why the ticket was held.
- As a customer, I want to see only that my ticket is On Hold, without internal remarks, so that staff discussions stay internal.

**Acceptance criteria**:

*Employee can no longer set Pending or On Hold directly*
- **AC-1**: The status dropdown on the employee Ticket Update page offers only `In Progress` and `Resolved`. `Pending` and `On Hold` are removed.
- **AC-2**: `POST /tickets/{id}/employee-update` (employee-service) rejects `status` = `Pending` or `On Hold` with 422 and code `HOLD_APPROVAL_REQUIRED`. Any other employee facing route that changes `ticket_status_ID` (including the `updateTicket` path used by `EmployeeAssigned.jsx`) rejects status 7 or 11 from an employee the same way. CS and admin are unaffected.

*Requesting*
- **AC-3**: The Ticket Update page shows a "Request On Hold" card (next to "Request Reassignment"). It opens a modal with a required remark (3 to 250 characters, no markup, with a character counter). Submitting calls `POST /api/tickets/{id}/hold-requests` and, on success, shows a success banner and the pending state (AC-6).
- **AC-4**: A request is accepted only when the caller is an employee assigned to the ticket, the ticket is not already On Hold, the state machine allows a hold from the ticket's current state, and there is no pending hold request and no pending reassignment request on the ticket. Each failure returns its own code: 403 `NOT_ASSIGNED`, 422 `TICKET_ON_HOLD`, 422 `INVALID_TICKET_TRANSITION`, 409 `HOLD_REQUEST_PENDING`, 409 `REASSIGNMENT_PENDING`. The page shows the message from the response.
- **AC-5**: A reassignment request is refused with 409 `HOLD_REQUEST_PENDING` while a hold request is pending on the ticket.
- **AC-6**: While a request is pending, the ticket keeps its status and the SLA keeps running. The employee can still add work logs and internal notes. The status form and the Request Reassignment button are disabled with the message "On Hold request pending CS review", and `employee-update` rejects any `status` change, including proof submission, with 409 `HOLD_REQUEST_PENDING`.
- **AC-7**: The requesting employee can cancel a pending request (`POST /api/hold-requests/{id}/cancel`). The request becomes `cancelled` and the page returns to normal.

*CS review*
- **AC-8**: A new request sends an in app notification to all CS users: "<employee name> requested On Hold for <ticket ref>". Clicking it opens that ticket in the CS ticket modal.
- **AC-9**: The CS ticket modal shows a banner for a pending hold request with the employee's name, the request time, the full remark, and Approve and Reject buttons.
- **AC-10**: Approve (`POST /api/hold-requests/{id}/approve`) takes an optional CS note (up to 1000 characters). It puts the ticket On Hold through the existing hold transition with the employee's remark as `hold_reason`, so `held_from_status_ID`, the SLA pause and resume (spec 0038 AC-28) all work as they do today. The request becomes `approved`, with the reviewer, the time and the note saved.
- **AC-11**: Reject (`POST /api/hold-requests/{id}/reject`) requires a reason (3 to 1000 characters). The ticket is unchanged and the request becomes `rejected` with the reviewer, the time and the reason saved.
- **AC-12**: The requesting employee gets an in app notification on approve ("Hold request approved for <ticket ref>") or reject ("Hold request rejected for <ticket ref>: <reason>"). On approve, the existing "Assigned Ticket Placed On Hold" message is not also sent to the requester. On the Ticket Update page, the latest rejected request shows a banner with the CS reason until the employee files a new request or the status changes.
- **AC-13**: When CS uses the existing direct Hold button while a request is pending, the request closes as `approved` with that CS user as reviewer, in the same database transaction as the hold.

*Timeline and customer privacy*
- **AC-14**: Each step writes a `ticket_audit_logs` row with `is_internal = 1`: `hold_requested` (actor employee, details: remarks), `hold_request_cancelled` (actor employee, or system for AC-16), `hold_request_approved` (actor CS, details: note, `via` = `request` or `direct_hold`), `hold_request_rejected` (actor CS, details: reason). Staff timelines show them with the remark, note or reason.
- **AC-15**: The customer timeline never shows these rows: `AuditTimelineService` drops `is_internal` rows (as today) and also drops any `action_type` starting with `hold_request`. On approval the customer sees only the ticket status `On Hold` and the existing generic "Ticket Placed On Hold" notification, which carries no remark, note or reason. The customer ticket API never returns hold request data.

*Edge cases*
- **AC-16**: Any state machine transition that does not end in On Hold (resolve, close, escalate, return to CS, and so on) closes a pending request as `cancelled`, actor `system`, with details "ticket moved to <status>".
- **AC-17**: Approve and reject act only on a `pending` request. A second decision, or a decision on a cancelled request, gets 409 `HOLD_REQUEST_NOT_PENDING` and changes nothing. Approve also checks the requester is still assigned. If not, the request is closed as `cancelled` (system) and the call returns 409 `REQUESTER_NOT_ASSIGNED`.
- **AC-18**: Creating, cancelling and deciding a request each dispatch `TicketChanged` (approval already does through the hold transition) and clear the ticket caches with the existing `SCAN` based `clearTicketCaches`, so the CS modal and the employee page refresh live.

## Options considered

### Option 1: Own the flow in ticket-service, reusing the hold transition

A new `hold_requests` table, `HoldRequestService` and thin `HoldRequestController` in ticket-service. Approval calls the existing `holdTicket` and `hold` transition. Closing pending requests happens inside the state machine transaction, so a direct hold and an approval share one code path. Employee-service asks ticket-service over an internal endpoint whether a request is pending before it allows a status change.

**Pros**:
- Hold, resume, SLA pause and the timeline already live here, so approval is a call, not a copy.
- Approve and the hold commit in one transaction, so there's no half state where a request is "approved" but the ticket isn't held.
- No cross service call on the approve path.

**Cons**:
- Employee-service needs one internal REST call on status changes, which adds a dependency (it fails closed when ticket-service is down).
- The request flow sits in a different service from the reassignment requests it mirrors.

### Option 2: Own the flow in employee-service, next to reassignment

Store the requests in employee-service beside `reassignment_requests`. Approval calls ticket-service `POST /tickets/{id}/hold` over REST.

**Pros**:
- Sits next to the closest existing pattern, and `employee-update` can check pending requests locally.

**Cons**:
- Approval spans two services with no shared transaction. If the REST hold fails after the request is marked approved (or the other way round), the two drift apart and need repair logic.
- A direct CS hold in ticket-service can't close the request without a callback into employee-service.

### Option 3: Reuse `reassignment_requests` with a type column

One requests table for both workflows.

**Pros**:
- Fewer tables and shared list queries.

**Cons**:
- It mixes two workflows with different fields and outcomes, and it inherits Option 2's cross service approval problem.

## Decision

**Chosen option**: Option 1: Own the flow in ticket-service, reusing the hold transition.

Employees file On Hold requests in a new ticket-service `hold_requests` table. CS approval runs the existing hold transition, which also closes the request atomically. Employee-service blocks direct Pending and On Hold and asks ticket-service before allowing status changes while a request is pending.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`)

## Rationale

The force that matters most is atomicity. The whole point is that a ticket is held if and only if CS approved it. Ticket-service already owns the hold transition, its SLA pause and its audit row, all inside one database transaction. Closing the request in that same transaction makes the "approved but not held" and "held but still pending" states impossible, including the race where CS clicks the direct Hold button while a request is open (AC-13). Option 2 can only reach that with compensating logic across two services, which is exactly the failure that pages someone at 2am.

The cost is one internal call from employee-service when an employee changes status. That call already has a pattern (`internal.token` routes, as in spec 0047), it only fires on status changes, and failing closed is the right default here: when ticket-service is unreachable, the status change would fail anyway.

Removing `Pending` from employees (rather than putting it behind approval too) was the engineer's call. It closes the SLA loophole with less surface, since `Pending` and `On Hold` are the same state in the machine. Existing tickets already in `Pending` are left alone, and CS can move them as today.

## Feature design

**Data model sketch** (new table, ticket-service migration):

| Field | Type | Null | Notes |
|---|---|---|---|
| `hold_request_ID` | bigint, PK, auto increment | no | |
| `ticket_ID` | bigint unsigned, FK to `tickets.ticket_ID`, cascade on delete | no | indexed |
| `requested_by_emp_id` | bigint unsigned | no | indexed. No FK (employees belong to employee-service) |
| `remarks` | varchar(250) | no | the employee's reason |
| `status` | varchar(20) | no | `pending`, `approved`, `rejected`, `cancelled`. Default `pending` |
| `reviewed_by_id` | bigint unsigned | yes | the CS user who decided, or null for system cancel |
| `review_note` | text | yes | optional approve note, required reject reason, or system cancel detail |
| `requested_at` | timestamp | no | |
| `reviewed_at` | timestamp | yes | set on approve, reject or cancel |
| `created_at`, `updated_at` | timestamp | | |

Index on (`ticket_ID`, `status`). Relationship: one ticket has many hold requests (1:N). At most one `pending` row per ticket, enforced by the service with `lockForUpdate` on the ticket row (MySQL has no partial unique index). No change to `tickets`.

**State transitions** (hold request):

```
pending ──approve──► approved   (ticket → On Hold, same transaction)
pending ──reject───► rejected   (ticket unchanged)
pending ──cancel───► cancelled  (employee, or system on AC-16 / AC-17)
approved, rejected, cancelled: final
```

The ticket itself only changes on approve (`hold` transition) and is otherwise untouched by this feature.

**API surface** (ticket-service unless noted):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/tickets/{ticketId}/hold-requests` | POST | `remarks`: string (req, 3 to 250, NoMarkup) | 201 `{ hold_request }` | employee JWT, assigned to ticket | 403 `NOT_ASSIGNED`, 409 `HOLD_REQUEST_PENDING`, 409 `REASSIGNMENT_PENDING`, 422 `TICKET_ON_HOLD`, 422 `INVALID_TICKET_TRANSITION`, 422 validation |
| `/api/hold-requests/{id}/cancel` | POST | none | 200 `{ hold_request }` | employee JWT, the requester | 403, 404, 409 `HOLD_REQUEST_NOT_PENDING` |
| `/api/hold-requests/{id}/approve` | POST | `note`: string (opt, max 1000, NoMarkup) | 200 `{ hold_request, ticket_status: "On Hold" }` | CS or admin (`RoleHelper::isCsOrAdmin`) | 403, 404, 409 `HOLD_REQUEST_NOT_PENDING`, 409 `REQUESTER_NOT_ASSIGNED`, 422 `INVALID_TICKET_TRANSITION` |
| `/api/hold-requests/{id}/reject` | POST | `reason`: string (req, 3 to 1000, NoMarkup) | 200 `{ hold_request }` | CS or admin | 403, 404, 409 `HOLD_REQUEST_NOT_PENDING`, 422 validation |
| `/api/tickets/{ticketId}` (existing details) | GET | none | adds `pending_hold_request` and `latest_rejected_hold_request` (staff only) | existing | omitted for customers |
| `/api/internal/tickets/{ticketId}/hold-requests/pending` | GET | none | 200 `{ pending: bool }` | `internal.token` | 404 |
| employee-service `/api/tickets/{ticketId}/employee-update` (existing) | POST | `status` | unchanged | existing | new 422 `HOLD_APPROVAL_REQUIRED`, new 409 `HOLD_REQUEST_PENDING`, 503 when the pending check can't reach ticket-service |
| employee-service `/api/tickets/{ticketId}/reassign-request` (existing) | POST | unchanged | unchanged | existing | new 409 `HOLD_REQUEST_PENDING` (via the internal endpoint) |

`hold_request` shape: `{ id, ticket_id, status, remarks, requested_by: { id, name }, requested_at, reviewed_by: { id, name } | null, review_note, reviewed_at }`.

New routes are under ticket-service's existing `/api/` prefix, so the gateway needs no new `location` block. Confirm this in both `nginx.conf` and `nginx.prod.conf` during the build.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Create request | `ticket_ID` | route param |
| Create request | `requested_by_emp_id` | the verified employee identity on the request (same as ticket details uses), never the body |
| Create request | assigned check | `ticket_assignments` row for (ticket, employee) with `completed_at` null |
| Create request | can hold from current state | `TicketStateMachine::resolveState` + `validateTransition` to `STATE_ON_HOLD` |
| Create request | reassignment pending | `reassignment_requests` with `status = pending` (read only, same shared read the state machine checks already do) |
| CS notification | employee name | the actor name lookup `AuditTimelineService` already uses for employee actors |
| CS notification | ticket ref | `TicketNumberGeneratorService::refFor` |
| Approve | `hold_reason` | `hold_requests.remarks` |
| Approve | `held_from_status_ID`, SLA pause | existing `hold` transition (unchanged) |
| Approve | `reviewed_by_id` | the verified CS user on the request |
| Approve / reject | `review_note` | `note` / `reason` body field |
| Direct hold closes request | reviewer, `via = direct_hold` | the CS user running `POST /tickets/{id}/hold` |
| System cancel | `review_note` | "ticket moved to <target status name>" from the transition |
| Employee page banner | pending or rejected request | `pending_hold_request` / `latest_rejected_hold_request` in ticket details |
| CS modal banner | remark, name, time | `pending_hold_request` in ticket details |
| Customer view | status `On Hold` + generic message | `tickets.ticket_status_ID` + existing `holdTicket` customer notification |

**Key invariants**:
- A ticket enters On Hold only through the `hold` transition, run by CS or admin (direct or by approving).
- At most one `pending` hold request per ticket.
- Approving a request and holding the ticket commit together or not at all. Inside the `hold` transaction, the approve path locks its request row and aborts the whole transaction if it is no longer `pending`.
- Every non hold transition leaves no `pending` request behind (AC-16).
- Hold request rows and their audit rows are never returned to a customer.

**Security model**:
- Create and cancel: only an employee assigned to the ticket. Cancel is limited to the requester.
- Approve and reject: `RoleHelper::isCsOrAdmin`.
- Reading request data: assigned employees and CS or admin, through ticket details. Customers never get it (the field is left out for customer callers, and the timeline filter drops the rows).
- All text inputs use the `NoMarkup` rule (already in ticket-service `app/Rules`).
- The internal pending check uses `internal.token`, not a user token.

**Configuration required**: none new. Employee-service reuses its existing ticket-service base URL and internal token settings.

**Critical test scenarios**:
- Happy path: employee requests with a remark, CS sees the banner, approves with a note. The ticket is On Hold, the SLA paused, the request approved, and staff see three internal timeline rows. Verifies **AC-3**, **AC-9**, **AC-10**, **AC-14**.
- Customer privacy: after approval, the customer timeline has no `hold_request*` row and no remark, and the customer details payload has no hold request fields. Verifies **AC-15**.
- Bypass closed: employee posts `status=On Hold` or `status=Pending` to `employee-update`, and status 11 through the `updateTicket` path. All get 422 `HOLD_APPROVAL_REQUIRED`. Verifies **AC-2**.
- Race: CS clicks direct Hold while a request is pending, so the request becomes approved via `direct_hold`. Two CS approve at once: one succeeds, the other gets 409 and the ticket is held once. Verifies **AC-13**, **AC-17**.
- While pending: employee status change and proof submission get 409, work log succeeds. Verifies **AC-6**.
- Auto cancel: CS resolves the ticket while a request is pending, so the request is cancelled by system. Verifies **AC-16**.
- Permission: a non assigned employee creating, another employee cancelling, and an employee approving all get 403. Verifies **AC-4**, **AC-7**, **AC-10**.

## Build plan

Ordered as tracer bullet slices (no build approach is recorded for this project, so this is the assumed default): first one thin path from request to approval end to end, then the remaining outcomes, then the guards.

1. Migration `create_hold_requests_table` in ticket-service for the data model above, satisfies **AC-3**, **AC-10**
2. `HoldRequestService` + `HoldRequestController` (thin) with create and approve. Approve calls `TicketService::holdTicket` with the request id in the transition context. In `TicketStateMachine`'s hold transaction, lock and close the pending request (approved, via `request` or `direct_hold`) and write `hold_request_approved`. Write `hold_requested` on create. Satisfies **AC-4**, **AC-10**, **AC-13**, **AC-14**
3. Add `pending_hold_request` and `latest_rejected_hold_request` to staff ticket details. Satisfies **AC-9**, **AC-12**
4. Frontend thin path: `ticketService.js` calls, a "Request On Hold" card and modal on `EmployeeTicketUpdate.jsx`, and the CS modal banner with Approve (optional note) in `CSModals.jsx`, following `DESIGN.md`. Satisfies **AC-3**, **AC-9**, **AC-10**
5. Reject and cancel endpoints plus their UI (required reason modal, the rejected banner, a Cancel request button). Satisfies **AC-7**, **AC-11**, **AC-12**
6. Notifications: CS on create, requester on decision, and skip the duplicate assigned employee hold message for the requester. Satisfies **AC-8**, **AC-12**
7. `TicketChanged` dispatch and `clearTicketCaches` on create, cancel and reject. Satisfies **AC-18**
8. State machine: on any non hold transition, cancel a pending request (system) and write `hold_request_cancelled`. Satisfies **AC-16**
9. Approve guard for a requester no longer assigned, and the 409 handling for an already decided request. Satisfies **AC-17**
10. Customer timeline filter: drop `action_type LIKE 'hold_request%'` for customers. Leave hold fields out of customer payloads. Satisfies **AC-15**
11. Internal endpoint `GET /api/internal/tickets/{id}/hold-requests/pending`. In employee-service: reject `Pending`/`On Hold` (`HOLD_APPROVAL_REQUIRED`), reject status changes while pending (fail closed with 503 when ticket-service is unreachable), and block `reassign-request` while pending. Satisfies **AC-2**, **AC-5**, **AC-6**
12. Find and close the `updateTicket` path: make the ticket-service route behind it reject status 7 and 11 from employees. Remove `Pending` and `On Hold` from `STATUS_OPTIONS` and from the employee status map in `EmployeeAssigned.jsx`. Satisfies **AC-1**, **AC-2**
13. Disable the status form and Request Reassignment while pending, with the message. Satisfies **AC-6**
14. Tests: feature tests for each endpoint and race above (on an isolated test database, never the shared dev database), plus frontend tests for the card, the banners and the dropdown. Satisfies **AC-1** to **AC-18**

## Consequences

**Positive**:
- The SLA can only be paused by CS, so SLA numbers can be trusted again.
- One hold code path: direct hold and approved hold behave identically, including resume.
- The customer view is unchanged from today's CS hold, so there's no new privacy surface.

**Negative / tradeoffs**:
- Employees wait on CS before a ticket is held, and the SLA keeps running meanwhile. Slow CS review now costs SLA time.
- Employee-service status changes now depend on ticket-service being reachable (fail closed).
- `TicketStateMachine` gains hold request awareness, a bit more logic in a central class.
- The hold request flow and reassignment requests live in different services despite looking alike.

**Neutral**:
- Tickets already in `Pending` stay as they are. Employees just can't choose `Pending` again.
- New audit action types appear on staff timelines, so any staff timeline label map may need the four new types.

## Migration plan

**Strategy**: ordered deploy, no data migration.
**Phases**:
1. Deploy ticket-service: the migration, the hold request endpoints, the internal pending endpoint, the state machine hooks and the timeline filter. Nothing changes for employees yet.
2. Deploy employee-service: the `HOLD_APPROVAL_REQUIRED` and pending checks. It calls the endpoint from phase 1, so it must ship second (shipping it first would make every employee status change fail closed with 503).
3. Deploy the frontend: the dropdown change, the request card and the CS banner.
**Rollback**: revert in reverse order. The `hold_requests` table can stay (nothing else reads it). Any requests still `pending` at rollback are simply ignored, and CS can hold those tickets directly.
**Risks**: the internal token or base URL is misconfigured in employee-service, which blocks all employee status changes. Smoke test one status change right after phase 2.

## Follow-up

- [ ] Decide whether CS needs a queue page of all pending hold requests once volume grows (out of scope now, the modal banner plus notification was chosen).
- [ ] Consider moving reassignment requests to ticket-service too, so both request flows share one home.
- [ ] Email for these notifications was left out on purpose. SMTP authentication is currently failing in the employee-service logs, which is worth fixing separately.
