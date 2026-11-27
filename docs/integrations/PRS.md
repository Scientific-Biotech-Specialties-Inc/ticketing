# PRS → Ticketing System (TS) Integration Guide

**Audience:** the PRS development team. This file is written to be handed to your AI coding assistant
as a build prompt, or read directly. Everything needed to implement the PRS side is here — you do
not need access to the Ticketing System's source code or repository.

---

## 1. What this integration does

A staff member working in PRS finds a piece of equipment that needs repair and raises a ticket
without leaving PRS. PRS calls the Ticketing System, TS creates an **internal ticket** attributed to
that staff member, and TS returns the ticket's identity plus a URL where the staff member can open
it.

```
Staff member in PRS clicks "Request Repair"
        │
        │  (1) PRS server → TS:  POST /internal/prs/tickets   (server-to-server, secret header)
        ▼
TS resolves the staff email to their existing staff account,
creates an internal ticket, assigns SLA, notifies the service desk
        │
        │  (2) TS → PRS:  201 with ticket_id, ticket_number, ticket_url, sla_due_at
        ▼
PRS stores ticket_id against its equipment record and shows the staff member the ticket reference
```

The requester **must already exist as an active staff account** in the shared auth service. PRS does
not create accounts, and TS will reject a push whose email is unknown.

### Scope of this phase

| Capability | This phase | Later |
|---|---|---|
| PRS pushes ticket data to TS | ✅ | ✅ |
| PRS reads ticket status from TS | ✅ (poll) | ✅ |
| `ticket_url` returned for PRS to store / link | ✅ | ✅ |
| TS pushes status changes to a PRS callback | ❌ | planned |
| Staff member auto-signed-in on redirect | ❌ | planned |

Until the callback exists, poll the status endpoint. The `ticket_url` is returned now so that
nothing in your integration has to change when the redirect handoff is added.

---

## 2. Connection

| Item | Value |
|---|---|
| Base URL | supplied separately — a temporary port-forward hostname during development |
| Auth header | `X-Internal-Secret: <secret>` on **every** request |
| Secret | supplied separately, out of band |
| Content type | `multipart/form-data` for the create call |

**Store the base URL and the secret in your own configuration or environment variables. Do not
hardcode either.** The base URL is a development tunnel and changes whenever it is restarted; it
will be replaced with a permanent hostname at deployment. The path never changes.

```
TS_API_URL=https://<supplied-hostname>
TS_INTERNAL_SECRET=<supplied-secret>
```

### Verify connectivity first

This endpoint is public and needs no secret. If it returns JSON, the connection is working:

```bash
curl "$TS_API_URL/api/ticketing/ticket/branches"
```

```json
{ "branches": [ { "id": "sbsi-makati-branch", "name": "SBSI Makati Branch", "code": "MKT" } ],
  "count": 7 }
```

The `id` field is the **branch slug** — this is what you send as `branch`.

---

## 3. Create a ticket

```
POST {TS_API_URL}/api/ticketing/ticket/internal/prs/tickets
X-Internal-Secret: <secret>
Content-Type: multipart/form-data
```

### Request fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `prs_request_id` | string (≤100) | ✅ | **Your** unique id for this request. Used as the idempotency key — see §6. |
| `prs_equipment_id` | string (≤100) | ✅ | Your equipment record id. Echoed back so you can correlate. |
| `equipment_name` | string (≤150) | ✅ | e.g. `Ultrasound Scanner` |
| `serial_number` | string (≤150) | ◻️ | Stored and echoed back |
| `brand` | string (≤150) | ◻️ | e.g. `GE` |
| `model` | string (≤150) | ◻️ | e.g. `Vivid S70` |
| `email` | email | ✅ | The requesting staff member. Must be an **active** staff account, else `422`. |
| `branch` | string (≤150) | ◻️ | Branch slug, name or code. Omit to inherit the requester's own branch. |
| `title` | string (≤255) | ✅ | Short problem summary |
| `category` | string (≤100) | ✅ | `Service` for equipment repair. See §5. |
| `description` | string (≤5000) | ◻️ | Free text. Omitted, TS generates a short default. |
| `priority` | string (≤50) | ◻️ | `Low` / `Medium` / `High` / `Critical`. Omitted, TS applies its default. |
| `attachment[]` | file[] | ◻️ | Photos or documents. Every file is virus-scanned — see §7. |

`brand`, `model` and `serial_number` are folded into the ticket's equipment label, so the service
desk sees e.g. `Ultrasound Scanner (GE Vivid S70, SN: SN-ABC-123)`.

### Example

```bash
curl -X POST "$TS_API_URL/api/ticketing/ticket/internal/prs/tickets" \
  -H "X-Internal-Secret: $TS_INTERNAL_SECRET" \
  --form-string "prs_request_id=PRS-REQ-5512" \
  --form-string "prs_equipment_id=PRS-EQ-0099" \
  --form-string "equipment_name=Ultrasound Scanner" \
  --form-string "serial_number=SN-ABC-123" \
  --form-string "brand=GE" \
  --form-string "model=Vivid S70" \
  --form-string "email=juan.delacruz@company.test" \
  --form-string "branch=sbsi-makati-branch" \
  --form-string "title=Scanner probe not reading" \
  --form-string "category=Service" \
  --form-string "description=The probe shows no image on channel two." \
  --form-string "priority=High" \
  -F "attachment[]=@/path/to/fault.jpg"
```

### Success response — `201 Created`

```json
{
  "status": "success",
  "duplicate": false,
  "data": {
    "ticket_id": 1842,
    "ticket_number": "SVC-MKT-2026-0043",
    "ticket_url": "https://<ts-host>/ticketing/tickets/1842",
    "ticket_status": "Open",
    "priority": "High",
    "category": "Service",
    "branch": "sbsi-makati-branch",
    "title": "Scanner probe not reading",
    "equipment_name": "Ultrasound Scanner (GE Vivid S70, SN: SN-ABC-123)",
    "created_at": "2026-11-22T08:14:03+00:00",
    "sla_due_at": "2026-11-24T08:14:03+00:00",
    "resolved_at": null,
    "closed_at": null,
    "prs_request_id": "PRS-REQ-5512",
    "prs_equipment_id": "PRS-EQ-0099",
    "serial_number": "SN-ABC-123",
    "brand": "GE",
    "model": "Vivid S70",
    "requested_by_email": "juan.delacruz@company.test"
  }
}
```

### Fields worth storing

| Field | Why |
|---|---|
| `ticket_id` | **Required.** Your permanent handle on the ticket; used for the status read. |
| `ticket_number` | The human reference to show staff, e.g. on the equipment record |
| `ticket_url` | Where a staff member opens the ticket. May be `null` while the TS host is not configured. |
| `sla_due_at` | When TS is committed to resolving. The most useful field to surface to your users. |
| `ticket_status` | `Open` at creation |

---

## 4. Read ticket status

```
GET {TS_API_URL}/api/ticketing/ticket/internal/prs/tickets/{ticket_id}
X-Internal-Secret: <secret>
```

Returns `{ "status": "success", "data": { … } }` with the **same `data` shape** as the create
response, so one parser serves both. Watch `ticket_status`, `resolved_at` and `closed_at`.

Only tickets that PRS itself raised are visible here. A `ticket_id` belonging to any other ticket
returns `404`.

**Possible statuses:** `Open`, `In Progress`, `Pending`, `Pending Evaluation`, `On Hold`,
`Escalated`, `Resolved`, `Reopened`, `Closed`, `Discarded`.

Poll no more than once every few minutes per open ticket. A push callback will replace polling in a
later phase.

---

## 5. Reference data

Do not hardcode these lists — fetch them, cache them for a few minutes, and refresh. Categories and
branches are administrator-editable on the TS side and will drift.

| Data | Endpoint | Field to use |
|---|---|---|
| Branches | `GET {TS_API_URL}/api/ticketing/ticket/branches` | `branches[].id` (the slug) |
| Categories & priorities | `GET {TS_API_URL}/api/ticketing/ticket/ticket-form-options` | category name, priority name |

Current values, for orientation only:

- **Category:** `Service` (equipment repair, calibration, maintenance), `Software` (applications,
  logins, network, system access)
- **Priority:** `Low`, `Medium`, `High`, `Critical`

`category` determines which department the ticket is routed to, so send `Service` for equipment
faults. Both the create call and the error response for an unknown value list what is valid.

---

## 6. Idempotency — read this before implementing retries

The development connection is a port-forwarded tunnel and **will** drop requests mid-flight. Your
request may be processed by TS even though you never receive the response.

`prs_request_id` makes this safe:

- **First** push with a given `prs_request_id` → `201`, `"duplicate": false`, ticket created.
- **Any later** push with the same `prs_request_id` → `200`, `"duplicate": true`, and the **same**
  `ticket_id`. No second ticket is created.

Rules:

1. Generate `prs_request_id` **once**, when the staff member submits, and persist it before calling.
2. On retry, resend the **same** `prs_request_id`. Never generate a new one for a retry.
3. Treat `200` with `"duplicate": true` as success, not as an error.

---

## 7. Attachments

Send files as `attachment[]` in the multipart body. TS forwards every file to its antivirus scanner
before anything is stored.

- Allowed types: PDF, DOCX, DOC, JPG, JPEG, PNG
- Limits are configured on the TS side; typically 15 MB per file and 5 files per request
- If **any** file is flagged, the whole push is rejected with `422 ATTACHMENT_REJECTED` and **no
  ticket is created**. Retry with a clean file, reusing the same `prs_request_id`.

Do not retry an `ATTACHMENT_REJECTED` response with the same file — it will be rejected again.

---

## 8. Errors

All errors share one shape:

```json
{ "status": "error", "code": "EMPLOYEE_NOT_FOUND",
  "message": "No staff account exists for juan@example.test. The requester must be an active employee." }
```

Branch on `code`, show `message` to your users or logs.

| Status | `code` | Meaning | Retry? |
|---|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or wrong `X-Internal-Secret` | No — fix config |
| `422` | `VALIDATION_FAILED` | Missing/malformed fields; see the `errors` object | No — fix the request |
| `422` | `EMPLOYEE_NOT_FOUND` | No staff account for that email | No — correct the email |
| `422` | `EMPLOYEE_INACTIVE` | The staff account is deactivated | No |
| `422` | `UNKNOWN_CATEGORY` | Category not recognised; `valid_categories` lists the options | No |
| `422` | `UNKNOWN_PRIORITY` | Priority not recognised; `valid_priorities` lists the options | No |
| `422` | `UNKNOWN_BRANCH` | Branch not recognised; `valid_branches` lists the slugs | No |
| `422` | `ATTACHMENT_REJECTED` | A file was flagged by the virus scanner; no ticket created | Only with a clean file |
| `422` | `MAX_OPEN_TICKETS_REACHED` | The staff member is at their open-ticket limit | No — surface to the user |
| `404` | `TICKET_NOT_FOUND` | That `ticket_id` was not raised by PRS | No |
| `502` | `ATTACHMENT_SERVICE_UNAVAILABLE` | TS storage is temporarily down | **Yes**, same `prs_request_id` |
| `503` | `UNDER_MAINTENANCE` | TS is in scheduled maintenance | **Yes**, same `prs_request_id` |
| `500` | `INTERNAL_ERROR` | Unexpected TS failure | **Yes**, same `prs_request_id` |

Retry policy: exponential backoff (e.g. 5s, 30s, 2m, 10m), a handful of attempts, always with the
original `prs_request_id`. Never retry a `4xx` other than as noted above.

---

## 9. Implementation checklist for the PRS side

- [ ] Add `TS_API_URL` and `TS_INTERNAL_SECRET` to configuration. Never commit the secret.
- [ ] Add a `ts_ticket_id`, `ts_ticket_number` and `prs_request_id` field to the equipment-request
      record (or a join table), persisting `prs_request_id` **before** the first call.
- [ ] Build the create call as `multipart/form-data` with the `X-Internal-Secret` header.
- [ ] Handle `201` (created) and `200 duplicate:true` (already created) as the same success path.
- [ ] Branch on the `code` field for errors; show `message` to the user for the `422` cases.
- [ ] Implement retry with backoff for `502`, `503`, `500` and network failures, reusing
      `prs_request_id`.
- [ ] Fetch branch slugs and categories from the reference endpoints; cache briefly, do not hardcode.
- [ ] Add a scheduled job polling the status endpoint for open tickets; stop polling once
      `closed_at` is set.
- [ ] Surface `ticket_number` and `sla_due_at` on the equipment record, and link `ticket_url`.
- [ ] Log every request and response with `prs_request_id` so a dropped call can be traced.

## 10. What TS needs from PRS

1. **A callback URL and a secret of yours**, so TS can push status changes instead of you polling.
   TS will send `X-Internal-Secret: <your secret>` to that URL.
2. **A test staff email** that exists as an active account, for the first end-to-end call.
3. **Where PRS runs.** If PRS runs on the same host as TS, the tunnel can be skipped entirely and
   PRS can call TS directly over the internal network.

---

## 11. Notes for whoever maintains the TS side

Implemented in `services/ticket-service`:

| Concern | File |
|---|---|
| Secret guard (`internal.prs`) | `app/Http/Middleware/VerifyPrsInternalAccess.php` |
| Validation & response shaping | `app/Http/Controllers/InternalPrsController.php` |
| Identity, mapping, attachments, ledger | `app/Services/PrsTicketService.php` |
| Idempotency ledger | `database/migrations/2026_11_22_000001_create_prs_ticket_requests_table.php` |
| Routes | `routes/api.php` (`/internal/prs/*`) |
| Tests | `tests/Feature/PrsInternalTicketIntakeTest.php` |

The ticket write itself goes through `TicketService::createInternalTicket()`, so PRS tickets inherit
ticket numbering, SLA assignment, audit logging, notifications, the Reverb broadcast and cache
invalidation unchanged. PRS tickets are marked `origin = 'prs'` and `is_internal = true`, with
`requested_by` set to the resolved employee and `machine_ID` left null — equipment is named as free
text on `tickets.equipment_name`, and the PRS serial/brand/model live on `prs_ticket_requests`.

Required environment variables: `PRS_INTERNAL_SECRET`, `PRS_TICKET_URL_BASE`.

No gateway change is needed: `/internal/prs/*` falls under the existing `/api/ticket/` proxy rule in
`nginx.conf` and `nginx.prod.conf`.
