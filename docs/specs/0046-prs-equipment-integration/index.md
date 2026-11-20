# 0046. PRS Equipment Ticket Intake Through the Tunnel

**Date**: 2026-11-17
**Status**: Proposed

## Summary

The Productivity Report System (PRS) lets SBSI employees raise a ticket about SBSI's own equipment without leaving the PRS. The PRS server sends the ticket, the equipment details, and whether it is a Service (hardware) or Software issue over the port forwarded tunnel to a new internal endpoint in `ticket-service`. That endpoint creates a normal internal ticket for the employee, and the PRS then sends the employee to that ticket in the ticketing system. CS decides the department and category during triage, and photos can follow in separate upload calls that still pass the ClamAV antivirus scan.

## Requirements

**User stories**:
- As an SBSI employee working in the PRS, I want to raise a ticket about company equipment from the PRS so that I do not retype the equipment and issue in another system.
- As that employee, I want to choose whether it is a Service (hardware) or Software issue in the PRS modal so that CS knows where to start.
- As that employee, I want to land on my new ticket right after I raise it so that I can follow it, chat, and add details.
- As the PRS, I want to attach the photos the employee already took so that the engineer sees the problem without asking again.
- As the PRS, I want to read a ticket's current status so that I can show it next to the report.
- As a Customer Support (CS) agent, I want PRS tickets clearly marked, with the equipment and reported issue type visible, so that I can route them to the right department and category.

**Acceptance criteria**:
- **AC-1**: `POST /api/ticketing/ticket/internal/prs/tickets` with a valid PRS key and a valid payload creates an internal ticket (`is_internal = 1`, ticket type `Internal`, `origin = 'prs'`, `external_reference = prs_reference`, `machine_ID = NULL`) whose requester is the single active employee matched by `requester_email` (ignoring case). It returns 201 with `ticket_ID`, `ticket_number`, `status`, and `ticket_url`.
- **AC-2**: The PRS routes accept only `X-Internal-Secret` equal to `PRS_TS_INTEGRATION_KEY`, compared in constant time. A missing or wrong key returns 401 `{ code: "INVALID_KEY" }`. When the key is blank on the server, every PRS route returns 503 `{ code: "NOT_CONFIGURED" }`. The PRS key never falls back to `INTERNAL_SERVICE_SECRET` or `INTERNAL_TOKEN`, the CRMS secret is rejected on PRS routes, and the PRS key is rejected on CRMS routes.
- **AC-3**: `issue_type` is required and is `hardware` or `software` (shown in the PRS modal as Service or Software). Any other value returns 422 `VALIDATION_FAILED`. It is stored as `tickets.reported_issue_type`. The PRS does not choose the department: the ticket is created with no requested department (the existing internal ticket behavior, where SLA timing starts from the requester's department), and CS sets the real department through the existing triage and assignment flow.
- **AC-4**: When `issue_type` is `hardware`, `equipment.name` and `equipment.serial_number` are required (422 `EQUIPMENT_REQUIRED` without them). When it is `software`, `equipment` is optional. Whatever equipment fields arrive (`name`, `serial_number`, `brand`, `model`, `asset_tag`, `location`) are stored as a JSON snapshot in `tickets.equipment_snapshot`. No row is created or changed in `machines` or `clients`.
- **AC-5**: When `category` matches a problem category name (ignoring case and surrounding spaces), the ticket gets that category. When `category` is missing or matches nothing, the ticket gets the seeded `For CS Triage` category and CS sets the real category during triage.
- **AC-6**: Priority always comes from the configured TS default priority. Any priority value in the payload is ignored.
- **AC-7**: A `prs_reference` that already exists for `origin = 'prs'` returns 200 with the existing ticket's body plus `"duplicate": true`, ignores the new payload, and creates nothing. Two concurrent calls with the same `prs_reference` produce exactly one ticket (a skipped ticket number from the losing call is acceptable).
- **AC-8**: The same rules as the TS internal ticket form apply. No active employee with that email returns 422 `REQUESTER_NOT_FOUND`. More than one active employee with that email returns 422 `REQUESTER_AMBIGUOUS`. A requester at the open ticket limit returns 422 `MAX_OPEN_TICKETS_REACHED` with `limit` and `open_ticket_count`. An unreadable limit configuration returns 503 `TICKET_LIMIT_CONFIGURATION_UNAVAILABLE`. A system under maintenance returns 503 `UNDER_MAINTENANCE`. Markup in the title or description, or a missing required field, returns 422 `VALIDATION_FAILED` with `errors`. An unknown `branch` returns 422 `UNKNOWN_BRANCH`.
- **AC-9**: `POST /api/ticketing/ticket/internal/prs/tickets/{ticket_number}/attachments` accepts one multipart `file` per call and an optional `Idempotency-Key` header. ticket-service forwards it to a new attachment-service route `POST /internal/attachments` (protected by `X-Internal-Token`) that scans it with ClamAV and saves it already linked to the ticket, with `uploaded_by_id` = the requester's `emp_id` and `uploaded_by_type = employee`. It returns 201 with `attachment_id`, `file_name`, `size`. A repeat `Idempotency-Key` on the same ticket returns 200 with the first upload's body and stores nothing new.
- **AC-10**: Attachment failures return clear codes: infected file 422 `FILE_INFECTED` (nothing kept), over the size limit 422 `FILE_TOO_LARGE`, type not on the configured allow list 422 `FILE_TYPE_NOT_ALLOWED`, ticket already at the configured file count 422 `FILE_LIMIT_REACHED`, ticket in a terminal status (Closed or Cancelled) 409 `TICKET_CLOSED`, ClamAV or attachment-service unreachable 503 `SCAN_UNAVAILABLE`. A ticket that does not exist or is not a PRS ticket returns the same 404 body either way. No attachment failure changes the ticket.
- **AC-11**: `GET /api/ticketing/ticket/internal/prs/tickets/{ticket_number}` returns `ticket_number`, `status`, `priority`, `category`, `department` (the current assignee's department name, null until assigned), `assignee_name` (null until assigned), `reported_issue_type`, `created_at`, `updated_at` (`tickets.updated_at`), and `ticket_url`. It returns the same 404 body for a missing ticket or any ticket whose `origin` is not `prs`.
- **AC-12**: `ticket_url` is `{EMPLOYEE_PORTAL_URL}/employee/my-tickets?ticket={ticket_number}`. A signed in requester who opens it lands on My Tickets with that ticket's detail view open. A signed in user who cannot see that ticket gets a "ticket not found" notice and the normal list. A user who is not signed in goes through the normal central auth login and then finds the ticket in My Tickets (returning to the exact ticket after login is out of scope, see Follow-up).
- **AC-13**: Creating a PRS ticket writes the usual ticket creation audit entry (actor stays the employee, `actor_type = employee`) with `origin: "prs"`, `source: "PRS Integration"`, and `prs_reference` added to its details, and the ticket timeline shows the entry as created "via PRS". It triggers the same notifications, SLA timer, and `TicketChanged` broadcast as a ticket from the TS internal form.
- **AC-14**: PRS tickets show a Title Case `PRS` source badge in the CS queue, in employee My Tickets, and in the ticket detail view. The detail view also shows an "Equipment (from PRS)" card with the snapshot fields, and the reported issue type (Service or Software). The CS queue has an Origin filter that narrows the list to PRS tickets. The backend accepts only known origin values for that filter.
- **AC-15**: Every `/internal/prs/` path returns 404 on the customer portal edge. Before go live, the tunnel that reaches the TS staff gateway forwards only the `/api/ticketing/ticket/internal/prs/` prefix (every other path is refused at the tunnel), and that tunnel configuration is documented in `docs/docker.md`.

## Decision

**Chosen option**: Option 1: Server to server push into a dedicated PRS intake endpoint, then redirect.

The PRS server creates the internal ticket through a new `/internal/prs` route group in `ticket-service`, authenticated by its own shared key. The ticket carries a snapshot of the SBSI equipment and the reported issue type, and CS routes it. Photos follow one per call through a new internal attachment route that keeps the ClamAV scan.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `api-testing` (`.claude/skills/api-testing/`) · `docker-runbook` (`.claude/skills/docker-runbook/`)

## Feature design

**Flow**:

```text
Employee in PRS              PRS server                          TS staff gateway (via path limited tunnel)
  modal: issue + equipment
  + Service / Software  -->  POST /internal/prs/tickets  ----->  ticket-service: check key, find employee,
                             (JSON, X-Internal-Secret)            snapshot equipment, create internal ticket
                             <----- 201 { ticket_number, ticket_url }
                             for each photo:
                             POST /internal/prs/tickets/{n}/attachments --> ticket-service --> attachment-service
                             (one file, optional Idempotency-Key)            POST /internal/attachments (ClamAV)
  browser sent to  <-------  302 to ticket_url
  employee portal            ({EMPLOYEE_PORTAL_URL}/employee/my-tickets?ticket={n})
```

The tunnel only carries PRS server to TS traffic. The employee's browser goes to `EMPLOYEE_PORTAL_URL` (the normal portal address, which already ends in `/ticketing`), not through the tunnel.

**Data model sketch**:

| Table (service) | Change | Detail |
|---|---|---|
| `tickets` (ticket-service) | add `external_reference` | `varchar(100)`, nullable, after `origin`. Holds `prs_reference`. Reusable by later integrations |
| `tickets` | add `equipment_snapshot` | `json`, nullable. `{ name, serial_number, brand, model, asset_tag, location }`, only the keys the PRS sent |
| `tickets` | add `reported_issue_type` | `varchar(20)`, nullable. `hardware` or `software` |
| `tickets` | add unique index | `UNIQUE(origin, external_reference)`. Many NULLs are allowed, so existing tickets are unaffected |
| `problem_categories` (ticket-service) | seed one row | `category_name = 'For CS Triage'`, inserted only when missing |
| `ticket_attachments` (attachment-service) | add `idempotency_key` | `varchar(100)`, nullable, plus `UNIQUE(ticket_id, idempotency_key)` |

`machines` and `clients` are not touched: SBSI equipment is not customer equipment, and PRS tickets always have `machine_ID = NULL`.

**State transitions**: none new. A PRS ticket starts in the configured default status and follows the existing internal ticket state machine. `AutoCloseInternalTickets` closes only Resolved tickets, so untriaged PRS tickets are never auto closed.

**Create payload** (`POST /internal/prs/tickets`, JSON):

| Field | Required | Rules |
|---|---|---|
| `prs_reference` | yes | string, max 100. The PRS report or request ID. Idempotency key |
| `requester_email` | yes | email. Must match exactly one active employee |
| `title` | yes | string, max 255, no markup. Trimmed and first letter capitalized (not rejected for casing) |
| `description` | yes | string, no markup |
| `issue_type` | yes | `hardware` or `software` (from the PRS modal: Service or Software) |
| `category` | no | string, max 255. Matched to a problem category name, else `For CS Triage` |
| `branch` | no | branch name, code, or slug (same matcher as the CRMS push). When absent, the requester's branch is used (existing behavior) |
| `equipment` | yes when `hardware` | object |
| `equipment.name`, `equipment.serial_number` | yes when `hardware` | string, max 255 each |
| `equipment.brand`, `equipment.model`, `equipment.asset_tag`, `equipment.location` | no | string, max 255 each |

```json
{
  "prs_reference": "PRS-RPT-2026-00123",
  "requester_email": "engineer@sbsi.example",
  "title": "Office printer jams on every print job",
  "description": "Second floor printer jams after one page since this morning.",
  "issue_type": "hardware",
  "category": "Office Equipment",
  "equipment": {
    "name": "Laser Printer",
    "serial_number": "VNB3K12345",
    "brand": "HP",
    "model": "LaserJet M404",
    "asset_tag": "SBSI-IT-0457",
    "location": "Makati, 2nd floor"
  }
}
```

**API surface** (public paths through the staff gateway; the ticket-service paths are `/api/internal/prs/...`):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/internal/prs/tickets` | POST | create payload above | 201 `{ ticket_ID, ticket_number, status, ticket_url }`; 200 same plus `duplicate: true` | `X-Internal-Secret` = PRS key | 401 `INVALID_KEY`, 422 (`VALIDATION_FAILED`, `REQUESTER_NOT_FOUND`, `REQUESTER_AMBIGUOUS`, `EQUIPMENT_REQUIRED`, `UNKNOWN_BRANCH`, `MAX_OPEN_TICKETS_REACHED`), 503 (`UNDER_MAINTENANCE`, `TICKET_LIMIT_CONFIGURATION_UNAVAILABLE`, `NOT_CONFIGURED`) |
| `/api/ticketing/ticket/internal/prs/tickets/{ticket_number}` | GET | path `ticket_number` | AC-11 fields | PRS key | 401, 404, 503 |
| `/api/ticketing/ticket/internal/prs/tickets/{ticket_number}/attachments` | POST | multipart `file` (one), header `Idempotency-Key` (optional) | 201 or 200 `{ attachment_id, file_name, size }` | PRS key | 401, 404, 409 `TICKET_CLOSED`, 422 (`FILE_INFECTED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FILE_LIMIT_REACHED`), 503 `SCAN_UNAVAILABLE` |
| attachment-service `/api/internal/attachments` (internal network only, not through the tunnel) | POST | multipart `file`, `ticket_id`, `uploaded_by_id`, `uploaded_by_type`, `max_ticket_files`, `idempotency_key` (optional) | 201 or 200 `{ attachment_id, file_name, size }` | `X-Internal-Token` = `INTERNAL_TOKEN` | 401, 422 with the same `code` values, 503 `SCAN_UNAVAILABLE` |

Every error body is `{ "message": "...", "code": "...", "errors": { field: [...] } }` (`errors` only on validation failures), so the PRS can branch on `code` and show `message`. The API contract tells the PRS to retry 503 and network errors with backoff, reusing the same `prs_reference` or `Idempotency-Key`, and never to retry 4xx unchanged.

Rate limit: a named limiter `prs` at 60 requests per minute keyed on the PRS caller (not the IP, since behind the tunnel every request has the cloudflared address).

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| create | requester `emp_id`, role, department, branch | the single `employees` row with `LOWER(email) = LOWER(requester_email)` and active; 0 rows → `REQUESTER_NOT_FOUND`, 2+ → `REQUESTER_AMBIGUOUS` |
| create | `ticket_number` | `NumberGeneratorService` with the requester department's code (spec 0043), inside `createInternalTicket` |
| create | SLA department | `createInternalTicket` with no requested department: the requester's department, else 2 (existing behavior) |
| create | `problem_category_ID` | `problem_categories` by `LOWER(TRIM(category_name))`; else the `For CS Triage` row |
| create | `priority_ID`, initial status | `TicketConfigurationService::getDefaultsConfig()` |
| create | `branch_id` | `branch` input through the CRMS branch matcher; else left empty so `createInternalTicket` uses `requesterBranchSlug` |
| create | `origin`, `external_reference`, `equipment_snapshot`, `reported_issue_type` | constant `prs`; `prs_reference`; `equipment` input (sent keys only); `issue_type` input |
| create | audit `source`, `prs_reference` | constant `PRS Integration`; `prs_reference` input, passed through the new `$options` argument |
| create, status | `ticket_url` | `rtrim(EMPLOYEE_PORTAL_URL, '/') . '/employee/my-tickets?ticket=' . rawurlencode(ticket_number)` |
| create | `duplicate` | an existing row matching `(origin = 'prs', external_reference)`, found before insert or after catching the unique violation |
| status | `status`, `priority`, `category` | names joined from `ticket_statuses`, `ticket_priorities`, `problem_categories` |
| status | `assignee_name`, `department` | the active `ticket_assignments` row joined to `employees` (first and last name, `department`); null when none |
| attachments | terminal status | `TicketStateMachine` terminal list (Closed, Cancelled) |
| attachments | size and type limits | attachment-service attachment config (`maxFileSizeMB`, allowed types), applied by the new internal route |
| attachments | per ticket file count limit | `TicketConfigurationService::getMaxFileCount()` in ticket-service, sent as `max_ticket_files`; attachment-service counts existing `ticket_attachments` rows for the ticket under a row lock |
| attachments | uploader | the ticket's requester `emp_id`, `uploaded_by_type = employee` |

**Key invariants**:
- A PRS ticket is always internal, always `origin = 'prs'`, always has a non null `external_reference` and `reported_issue_type`, and always has `machine_ID = NULL`.
- `(origin, external_reference)` is unique in the database. The intake service catches the unique violation, including one raised inside `createWithinLimit`'s transaction, and returns the existing ticket.
- `(ticket_id, idempotency_key)` is unique in `ticket_attachments`.
- Files never reach storage without a clean ClamAV result (invariant 5 in `AGENTS.md`). The new internal route reuses the existing scan code path, not a copy.
- ticket-service reaches attachment-service over REST only (invariant 3). attachment-service counts its own rows, and ticket-service never reads `ticket_attachments`.
- The PRS key can create tickets and read or attach only to tickets with `origin = 'prs'`.

**Security model**:
- **Caller**: only the PRS server, proven by `X-Internal-Secret` compared with `hash_equals` against `services.prs.secret`. Separate from the CRMS secret so either can be rotated alone. Key mismatches are logged (IP, path, time), never the key itself.
- **Network**: the tunnel forwards only the PRS path prefix (AC-15). The customer edge already returns 404 for `/internal/` (spec 0044). attachment-service `/internal/attachments` is reachable only on the Docker network and needs `INTERNAL_TOKEN`.
- **Employee in the browser**: the redirect carries only the ticket number, no token. The existing central auth session and internal ticket ownership checks decide who can open it.
- **Existence hiding**: missing and non PRS tickets return identical 404 bodies on PRS routes.
- **Input safety**: title and description pass `rejectMarkup` and `strip_tags`. Equipment fields are plain strings, stored as JSON and rendered as text (never HTML). TS never fetches a URL from the PRS.
- **Accepted risk**: a leaked PRS key can raise tickets in any active employee's name until it is rotated. The path limited tunnel, the rate limit, and the "via PRS" audit marker contain and trace this.
- **Compliance**: no new regulated data.

**Configuration required**:
- `PRS_TS_INTEGRATION_KEY`: the shared secret the PRS sends in `X-Internal-Secret`. Blank disables every PRS route (503). Root `.env`, passed to `ticket-service` in both compose files, read as `services.prs.secret` with no fallback.
- `INTERNAL_TOKEN` (existing): now also passed to and checked by `attachment-service` for `/internal/attachments`.
- `EMPLOYEE_PORTAL_URL` (existing, ends in `/ticketing`): base for `ticket_url`.
- Effective upload size: the smallest of the attachment config `maxFileSizeMB` (default 15 MB), the staff gateway `client_max_body_size` (20 MB), and the tunnel's request limit.
- PRS side (not in this repo): the tunnel base URL and the same key. A quick tunnel URL changes on restart, so the PRS must be updated each time.

**Critical test scenarios**:
- Happy path: a known employee raises a hardware ticket with equipment. It is internal, `origin = prs`, `machine_ID` null, snapshot and issue type stored, default priority, matched category, `ticket_url` returned. Verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**.
- A hardware ticket without `equipment.serial_number` returns `EQUIPMENT_REQUIRED`. A software ticket without equipment succeeds. `issue_type: "network"` returns `VALIDATION_FAILED`. Verifies **AC-3**, **AC-4**.
- An unknown category gets `For CS Triage`. Verifies **AC-5**.
- The same `prs_reference` twice (second with a changed title) returns the first ticket unchanged with `duplicate: true`. A forced unique violation returns the existing ticket. Verifies **AC-7**.
- Wrong key 401 `INVALID_KEY`, blank key 503 `NOT_CONFIGURED`, CRMS secret on a PRS route 401, PRS key on a CRMS route 401. Verifies **AC-2**.
- Unknown email, duplicate active email, limit reached, maintenance mode, unknown branch. Verifies **AC-8**.
- Attachment (attachment-service faked in ticket-service tests): a clean file returns 201, the same `Idempotency-Key` again returns 200 with one row, infected 422, over the limit 422, closed ticket 409, attachment-service down 503, non PRS ticket 404 with the same body as a missing one. Attachment-service tests cover the internal route with a fake ClamAV. Verifies **AC-9**, **AC-10**.
- Status for an unassigned PRS ticket returns null assignee and department. After assignment it returns both. A non PRS ticket returns 404. Verifies **AC-11**.
- Audit details carry `source` and `prs_reference`. The notification and broadcast are dispatched. Verifies **AC-13**.
- Frontend: `my-tickets?ticket=<number>` opens the detail view for the requester and shows a notice for someone else. The `PRS` badge, Equipment card, and Origin filter render. Verifies **AC-12**, **AC-14**.
- Customer edge `/internal/prs/tickets` returns 404 (checked against the customer server block in `nginx.prod.conf`). Verifies **AC-15**.

All backend tests run against an isolated test database (SQLite in memory or a dedicated test schema), never the shared `ticketing_system` database.

## Build plan

Build approach: none recorded in `AGENTS.md`, so this plan assumes Tracer Bullet (a thin end to end thread first, then thicken).

1. Thin thread (ticket-service). Migration: `external_reference`, `equipment_snapshot`, `reported_issue_type`, `UNIQUE(origin, external_reference)`, seed `For CS Triage`. Config: `services.prs.secret` (no fallback), `PRS_TS_INTEGRATION_KEY` in `.env.example` and both compose files. Let `VerifyInternalSecret` take a config key parameter (`internal.secret:prs`, default unchanged) and return `code` on 401 and 503. Register the `/internal/prs` group with the `prs` rate limiter. Add a thin `PrsTicketIntakeController` and `App\Services\Prs\PrsTicketIntakeService`, and give `TicketService::createInternalTicket` an `$options` argument (`origin`, `external_reference`, `equipment_snapshot`, `reported_issue_type`, `audit_details`) written into the insert and the audit details. Happy path and key feature tests. Satisfies **AC-1**, **AC-2**, **AC-13**.
2. Intake rules: `issue_type` and the equipment rule, the snapshot, category matching with the fallback, ignoring payload priority, the branch matcher, title normalizing, the requester lookup (not found and ambiguous), and the maintenance and limit checks that today live in `storeInternalTicket` (pull them into a small shared guard instead of copying them). Satisfies **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-8**.
3. Idempotency: look up `(prs, prs_reference)` first, and catch the unique violation (also inside `createWithinLimit`) to return the existing ticket with `duplicate: true`. Satisfies **AC-7**.
4. Status endpoint, limited to `origin = 'prs'`, with identical 404 bodies. Satisfies **AC-11**.
5. attachment-service internal route: a `VerifyInternalToken` middleware (`INTERNAL_TOKEN`), `POST /internal/attachments` that reuses the existing upload and ClamAV code path with an explicit uploader, links the file to `ticket_id` in the same call, enforces size, type, and `max_ticket_files` (count under a row lock), handles `idempotency_key`, and returns `code` values. Migration for `ticket_attachments.idempotency_key`. Pass `INTERNAL_TOKEN` to attachment-service in both compose files. Satisfies **AC-9**, **AC-10**.
6. ticket-service attachment endpoint: find the PRS ticket, reject terminal statuses, forward the file with the requester as uploader and `max_ticket_files` from config, and map the results. Satisfies **AC-9**, **AC-10**.
7. Frontend deep link: teach `EmployeeMyTickets` to read `?ticket=<number>`, open that ticket's detail view when it is in the user's list (or fetch it by number), and otherwise show a "ticket not found" notice. Satisfies **AC-12**.
8. Frontend and API marker: return `origin`, `reported_issue_type`, and `equipment_snapshot` from the CS queue (`/cs-dashboard`), the employee My Tickets list, and ticket detail endpoints. Add an allow listed `origin` filter to the CS queue. Show the Title Case `PRS` badge, the "Equipment (from PRS)" card, and the reported issue type per `DESIGN.md`. Show "via PRS" on the creation entry in the ticket timeline. Satisfies **AC-14**, **AC-13**.
9. SLA check: confirm `resolveSlaPolicy` falls back to the default policy for `For CS Triage`. If it does not, seed a default rule for that category in the step 1 migration. Satisfies **AC-5**.
10. Edge and docs: confirm the customer edge already returns 404 for `/internal/prs/`. Document the path limited tunnel configuration in `docs/docker.md` (forward only `/api/ticketing/ticket/internal/prs/`). Add a `PRS Ticket Intake` section to `docs/api-contracts.md` with the payload, responses, error codes, retry guidance, and the attachment internal route. Satisfies **AC-15**, **AC-2**.

## Consequences

**Positive**:
- Employees raise equipment tickets from where they already work, and the ticket lands in the normal internal queue with SLA, notifications, chat, and audit.
- Customer equipment data (`machines`, `clients`) stays clean: SBSI equipment never mixes with CMS or CRMS customer machines.
- The ticketing system never calls the PRS, so a dead PRS tunnel cannot break ticketing.
- `external_reference` and `equipment_snapshot` are generic, so a later SERMS or asset integration can reuse them.
- Uploads gain a proper internal path with error codes that other services can reuse.

**Negative / tradeoffs**:
- The PRS key can raise tickets in any active employee's name. A leak means fake tickets until the key is rotated.
- attachment-service is now in scope, with a new authenticated route and a migration.
- SBSI equipment is a snapshot, not a tracked asset: TS cannot show history across tickets for the same printer until internal assets are modelled.
- Every PRS ticket needs CS triage for department, and usually category, so CS workload grows and SLA timing uses the requester's department until CS routes it.
- Quick tunnel URLs change on restart, and the tunnel must be set up with a path rule, which adds an operations step.
- Photos arrive after the ticket, so a ticket can briefly have no attachments, and a failed upload is the PRS's job to retry.

**Neutral**:
- Two additive migrations (ticket-service and attachment-service). Rollback is a plain `down()` for each.
- `VerifyInternalSecret` gains an optional parameter and error codes. CRMS routes keep their behavior apart from the added `code`.
- `createInternalTicket` gains an optional `$options` argument. The TS internal form passes none and behaves as before.

## Follow-up

- [ ] Share the API contract (payload, error codes, retry rules, `ticket_url`) with the PRS team and agree on the `prs_reference` format.
- [ ] Decide who runs the tunnel to the TS staff gateway, and set it up with the path rule before go live (AC-15).
- [ ] Return to the exact ticket after login needs a `redirect` parameter (with an allow list) in the separate Auth Module login. Track it there if users ask for it.
- [ ] Consider modelling SBSI internal assets in TS later, so equipment history and repeat failures can be tracked. The `equipment_snapshot` keys are chosen to map onto such a table.
- [ ] The existing attachment-service `/bind` route has no authentication. This spec does not use it, but it should get its own fix.
- [x] Enrolled in [docs/scope/scope.md](../../scope/scope.md) as "PRS equipment ticket intake".

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
