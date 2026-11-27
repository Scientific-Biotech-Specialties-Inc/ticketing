# Build prompt — PRS → Ticketing System integration

Paste everything below into your coding assistant. It is self-contained; you do not need access to
the Ticketing System's source code.

---

## Task

Implement an integration in **PRS** that raises a repair ticket in the **Ticketing System (TS)** when
a staff member requests service on a piece of equipment, then tracks that ticket's status.

PRS is the **client**. TS is the server. Everything below is already live and tested — build against
it as specified.

## Goal flow

```
Staff member in PRS clicks "Request Repair" on an equipment record
   │
   ├─ 1. PRS server-side: POST the equipment + problem details to TS
   │     TS creates an internal ticket attributed to that staff member
   │
   ├─ 2. TS responds with ticket_id, ticket_number, ticket_url, sla_due_at
   │     PRS stores these against the equipment request record
   │
   └─ 3. PRS shows the staff member the ticket number and SLA date,
         and links to ticket_url
```

The staff member must already exist as an **active account in the shared auth module**. PRS does not
create accounts; TS rejects an unknown email.

## Configuration

Add these to PRS configuration / environment. **Do not hardcode them in source.**

```env
TS_API_URL=<current TS tunnel hostname - supplied separately>
TS_INTERNAL_SECRET=<the 64-hex secret you generated - supplied separately>
```

The same secret is used in both directions: you send it to TS as `X-Internal-Secret`, and TS
sends it to your callback as `X-Internal-Secret`. There is only one value to manage.

`TS_API_URL` is a temporary development tunnel and **changes whenever it is restarted**. It must be
readable from config at request time, never compiled in. The path below never changes.

## Step 0 — verify connectivity before writing anything else

This endpoint needs no secret. If it returns JSON, the link works.

```bash
curl "$TS_API_URL/api/ticketing/ticket/branches"
```

```json
{"branches":[{"id":"sbsi-makati-branch","name":"SBSI Makati Branch","code":"MKT","region":"NCR","is_active":1}],"count":7}
```

The `id` field is the **branch slug**. That is what you send as `branch`.

## Step 1 — create a ticket

```
POST {TS_API_URL}/api/ticketing/ticket/internal/prs/tickets
X-Internal-Secret: {TS_INTERNAL_SECRET}
Content-Type: multipart/form-data
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `prs_request_id` | string ≤100 | yes | **Your** unique id for this request. Idempotency key — see Step 3. |
| `prs_equipment_id` | string ≤100 | yes | Your equipment record id. Echoed back. |
| `equipment_name` | string ≤150 | yes | e.g. `Microplate Reader` |
| `serial_number` | string ≤150 | no | Stored and echoed back |
| `brand` | string ≤150 | no | e.g. `BioTek` |
| `model` | string ≤150 | no | e.g. `Epoch 2` |
| `email` | email | yes | Requesting staff member; must be an **active** account |
| `branch` | string ≤150 | no | Branch slug, name or code. Omit to inherit the requester's own branch. |
| `title` | string ≤255 | yes | Short problem summary |
| `category` | string ≤100 | yes | `Service` for equipment repair, `Software` for IT issues |
| `description` | string ≤5000 | no | Free text |
| `priority` | string ≤50 | no | `Low` / `Medium` / `High` / `Critical`. Omit and TS applies its default. |
| `attachment[]` | file[] | no | Photos/documents. Every file is virus-scanned. |

`brand`, `model` and `serial_number` are folded into the ticket's equipment label, so the service
desk sees `Microplate Reader (BioTek Epoch 2, SN: SN-MP-55)`.

### Working example

```bash
curl -X POST "$TS_API_URL/api/ticketing/ticket/internal/prs/tickets" \
  -H "X-Internal-Secret: $TS_INTERNAL_SECRET" \
  -H "Accept: application/json" \
  --form-string "prs_request_id=PRS-REQ-5512" \
  --form-string "prs_equipment_id=PRS-EQ-0200" \
  --form-string "equipment_name=Microplate Reader" \
  --form-string "serial_number=SN-MP-55" \
  --form-string "brand=BioTek" \
  --form-string "model=Epoch 2" \
  --form-string "email=sales.employee1@sbsi.com" \
  --form-string "title=Reader lamp failing intermittently" \
  --form-string "category=Service" \
  --form-string "description=Lamp cuts out mid-run." \
  --form-string "priority=High"
```

### Response — `201 Created`

```json
{
  "status": "success",
  "duplicate": false,
  "data": {
    "ticket_id": 26,
    "ticket_number": "TKT-0024",
    "ticket_url": "https://.../ticketing/tickets/26",
    "ticket_status": "Open",
    "priority": "High",
    "category": "Service",
    "branch": "sbsi-makati-branch",
    "title": "Reader lamp failing intermittently",
    "equipment_name": "Microplate Reader (BioTek Epoch 2, SN: SN-MP-55)",
    "created_at": "2026-11-22T07:30:11+00:00",
    "sla_due_at": "2026-11-25T14:00:00+00:00",
    "resolved_at": null,
    "closed_at": null,
    "prs_request_id": "PRS-REQ-5512",
    "prs_equipment_id": "PRS-EQ-0200",
    "serial_number": "SN-MP-55",
    "brand": "BioTek",
    "model": "Epoch 2",
    "requested_by_email": "sales.employee1@sbsi.com"
  }
}
```

Persist at minimum: **`ticket_id`**, `ticket_number`, `prs_request_id`, `ticket_url`, `sla_due_at`.

Surface `ticket_number` and `sla_due_at` to the staff member, and link `ticket_url`.

## Step 2 — read status

```
GET {TS_API_URL}/api/ticketing/ticket/internal/prs/tickets/{ticket_id}
X-Internal-Secret: {TS_INTERNAL_SECRET}
```

Returns `{"status":"success","data":{...}}` with the **same `data` shape** as the create response —
write one parser and use it for both.

Watch `ticket_status`, `resolved_at`, `closed_at`. Possible statuses:

`Open`, `In Progress`, `Pending`, `Pending Evaluation`, `On Hold`, `Escalated`, `Resolved`,
`Reopened`, `Closed`, `Discarded`

Only tickets PRS raised are visible here; any other `ticket_id` returns `404`.

Poll open tickets on a schedule, no more than once every few minutes each. Stop polling once
`closed_at` is set.

## Step 3 — idempotency (implement this before retries)

The connection is a port-forwarded tunnel and **will** drop requests mid-flight. A request may
succeed on the TS side even when you never receive the response.

`prs_request_id` makes retrying safe:

- **First** call with a given `prs_request_id` → `201`, `"duplicate": false`, ticket created.
- **Any later** call with the same `prs_request_id` → `200`, `"duplicate": true`, and the **same**
  `ticket_id`. No second ticket is created.

Rules:

1. Generate `prs_request_id` **once**, when the staff member submits, and **persist it before the
   first call**.
2. On retry, resend the **same** `prs_request_id`. Never generate a new one for a retry.
3. Treat `200` with `"duplicate": true` as success.

## Step 4 — errors

All errors share one shape. Branch on `code`, show `message`.

```json
{"status":"error","code":"EMPLOYEE_NOT_FOUND","message":"No staff account exists for x@y.z. The requester must be an active employee."}
```

| Status | `code` | Meaning | Retry? |
|---|---|---|---|
| `401` | `UNAUTHORIZED` | Missing/wrong `X-Internal-Secret` | No — fix config |
| `422` | `VALIDATION_FAILED` | Missing/malformed fields; see the `errors` object | No |
| `422` | `EMPLOYEE_NOT_FOUND` | No staff account for that email | No — correct the email |
| `422` | `EMPLOYEE_INACTIVE` | Account is deactivated | No |
| `422` | `UNKNOWN_CATEGORY` | `valid_categories` lists the options | No |
| `422` | `UNKNOWN_PRIORITY` | `valid_priorities` lists the options | No |
| `422` | `UNKNOWN_BRANCH` | `valid_branches` lists the slugs | No |
| `422` | `ATTACHMENT_REJECTED` | A file was flagged by the virus scanner; **no ticket created** | Only with a clean file |
| `422` | `MAX_OPEN_TICKETS_REACHED` | Requester is at their open-ticket limit | No — show the user |
| `404` | `TICKET_NOT_FOUND` | That `ticket_id` was not raised by PRS | No |
| `502` | `ATTACHMENT_SERVICE_UNAVAILABLE` | TS storage temporarily down | **Yes** |
| `503` | `UNDER_MAINTENANCE` | TS in scheduled maintenance | **Yes** |
| `500` | `INTERNAL_ERROR` | Unexpected TS failure | **Yes** |

Retry policy: exponential backoff (5s, 30s, 2m, 10m), a handful of attempts, **always with the
original `prs_request_id`**. Never retry a `4xx` except `ATTACHMENT_REJECTED` with a different file.

## Step 5 — reference data: fetch, don't hardcode

Categories and branches are administrator-editable in TS and will drift.

| Data | Endpoint | Use |
|---|---|---|
| Branches | `GET {TS_API_URL}/api/ticketing/ticket/branches` | `branches[].id` (slug) |
| Categories & priorities | `GET {TS_API_URL}/api/ticketing/ticket/ticket-form-options` | names |

Cache for a few minutes, then refresh. Current values for orientation only — **Category:** `Service`,
`Software`. **Priority:** `Low`, `Medium`, `High`, `Critical`.

## Step 6 — expose a status callback (so you don't have to poll)

TS will POST to a URL you provide whenever a PRS-raised ticket changes state, with
`X-Internal-Secret` set to **your** secret:

```json
{
  "ticket_id": 26,
  "ticket_number": "TKT-0024",
  "prs_request_id": "PRS-REQ-5512",
  "prs_equipment_id": "PRS-EQ-0200",
  "ticket_status": "Resolved",
  "priority": "High",
  "sla_due_at": "2026-11-25T14:00:00+00:00",
  "resolved_at": "2026-11-24T09:12:00+00:00",
  "closed_at": null,
  "updated_at": "2026-11-24T09:12:00+00:00"
}
```

Requirements:

- Respond `2xx` to acknowledge. TS treats a `4xx` as a permanent rejection and stops; unreachable or
  `5xx` is retried four times over roughly ten minutes.
- Verify the `X-Internal-Secret` header before trusting the body.
- Be idempotent: the same state may arrive more than once.

**Status: working.** The callback is deployed at `POST /api/internal/ts/tickets/status`, TS is
configured to call it, and an authenticated end-to-end call returned `200`. An unknown
`prs_request_id` is acknowledged with `200` and `"matched": false`, which is correct. The only
ongoing task is telling the TS team the new hostname each time the tunnel restarts; the path is
stable and needs no further change.

## Implementation checklist

- [ ] `TS_API_URL` and `TS_INTERNAL_SECRET` in config, not in source. Secret not committed.
- [ ] Persist `prs_request_id`, `ts_ticket_id`, `ts_ticket_number` on the equipment request record,
      writing `prs_request_id` **before** the first call.
- [ ] Build the create call as `multipart/form-data` with the `X-Internal-Secret` header.
- [ ] Treat `201` and `200 duplicate:true` as the same success path.
- [ ] Branch on the `code` field; show `message` for the `422` cases.
- [ ] Retry with backoff on `502`/`503`/`500`/network errors, reusing `prs_request_id`.
- [ ] Fetch branch slugs and categories from the reference endpoints; cache briefly.
- [ ] Scheduled poller for open tickets; stop once `closed_at` is set.
- [ ] Display `ticket_number` and `sla_due_at`; link `ticket_url`.
- [ ] Log every request/response keyed by `prs_request_id`.
- [ ] Expose the Step 6 callback endpoint and send its path to the TS team.

## Constraints

- Do not call any TS endpoint other than those listed here.
- Do not write to the TS database directly; this integration is HTTP only.
- Do not create staff accounts — an unknown `email` is an error to surface, not to work around.
- Do not send a new `prs_request_id` on a retry.
- Do not hardcode the tunnel hostname, branch slugs or category names.

## Working test account

`sales.employee1@sbsi.com` — an active Sales & Marketing staff member in the shared auth module.
Use it for your first end-to-end call.
