# 0047. Customer asset based ticket intake

**Date**: 2026-11-18
**Status**: In Progress

## Summary

Customers now report every problem against one of their own items: a piece of equipment or a piece of software. The item decides the category on its own (equipment means Service, software means Software), so the customer only double checks it. Customers can only choose, or mention to the AI, items that belong to them, and the AI must pin down one of those items before it lets them create a ticket. Until the equipment system sends real software, every customer gets three starter software items so no list is ever empty.

## Requirements

**User stories**:
- As a customer, I want to pick the equipment or software that has the problem so that the right team gets the ticket without me guessing a category.
- As a customer chatting with the AI, I want it to recognise which of my items I mean so that the ticket it creates is about the right thing.
- As CS, I want every customer ticket linked to a real item the customer owns so that I never triage a ticket with no equipment or software.

**Acceptance criteria**:
- **AC-1**: `machines` has an `asset_type` column (`equipment` or `software`, default `equipment`). A customer's pickable items are their own `machines` rows (`client_ID` = the customer) whose `status` is `active` or empty.
- **AC-2**: Every customer has these three software items: "Laboratory Information System (LIS)", "Equipment Control Software", "Hospital Information System (HIS)". Seeding adds only the missing ones (never duplicates), runs from a one time command for existing customers, and runs automatically the first time ticket-service lists a customer's items and finds no software. Seeded rows use a hidden serial code `SW-<client_ID>-<CODE>` (codes `LIS`, `ECS`, `HIS`) and the "Software" machine category.
- **AC-3**: The create ticket form shows one required "Equipment / Software" picker listing only the customer's pickable items, grouped Equipment then Software. Equipment shows name and serial; software shows the name only (serial codes for software are never shown anywhere in the UI).
- **AC-4**: After an item is picked, the Problem Category field shows "Service" (equipment) or "Software" (software) as a read only value. The AI category suggestion (`useCategoryPreview`, `classify-category`) is no longer used on this form.
- **AC-5**: `POST /api/tickets` from a customer requires `machine_ID`. It must be one of that customer's pickable items, otherwise 422 with `errors.machine_ID`. `problem_category_ID` is set by the server from the item's `asset_type`; any value the browser sends is ignored.
- **AC-6**: When a customer edits an Open, unassigned ticket and changes `machine_ID`, the same ownership rule applies and the category is set again from the new item.
- **AC-7**: AI-service gets the customer's pickable items from a new ticket-service internal endpoint, using the customer id from the verified login and the internal token. It never takes the list from the browser and never reads ticket-service tables.
- **AC-8**: The AI chat sets `escalate: true` (offer a ticket) only when exactly one owned item is identified. Gemini must answer with an `asset_id` from the supplied list; AI-service checks the id is in that list. When the customer's words match more than one item, or none yet, the AI asks which one and returns `asset_options` so the chat can show them as tap to choose buttons. A tap sends `selected_asset_id` with the next message.
- **AC-9**: When the customer names equipment or software that is not on their account, the AI says it is not registered to their account, returns their items as `asset_options`, suggests contacting Customer Service if the item is missing, and does not escalate.
- **AC-10**: On the safety path (dangerous repair detected), the safety warning is shown in the same reply, and the AI still requires an owned item (with `asset_options`) before it escalates.
- **AC-11**: The escalation handoff includes the identified `machine_ID`. The create form opened from the AI chat preselects that item, and the category follows it (AC-4).
- **AC-12**: When Gemini is unavailable, the existing fallback (`escalate: true` straight to manual ticket creation, no local model) still applies; the manual form still requires the picker (AC-3, AC-5), so no ticket is ever created without an item.
- **AC-13**: The seed command also links TKT-0008 (customer 4, Software, no item) to that customer's seeded LIS item. The command is a dry run by default and changes the database only with `--apply`, run only after the engineer approves touching the dev database.
- **AC-14**: Items whose status is anything other than `active` or empty (for example retired) are left out of the picker, the AI list and the ownership check for new choices. Existing tickets that already point at such an item still display it.
- **AC-15**: Internal employee tickets and PRS tickets (spec 0046) keep their current rules.
- **AC-16**: Seeded software has no branch, so a ticket on it gets its branch from the existing default rule (`TicketBranchResolver`, SBSI Makati today).

## Decision

**Chosen option**: Option 1: Asset type on `machines`, server derived category, AI gated on an owned item.

Equipment and software share the `machines` table with a new `asset_type` column. ticket-service owns the item list, seeding, the ownership check and the category rule. AI-service reads the list over REST and may only offer a ticket once Gemini has picked an item from it.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

| Table | Change | Details |
|---|---|---|
| `machines` | add `asset_type` | `varchar(20)`, not null, default `equipment`. Values `equipment`, `software`. Composite index (`client_ID`, `asset_type`). |
| `machines` | existing `client_ID` | Owner. One customer has many items (1:N). |
| `machines` | existing `serial_number` | Still required and unique. Seeded software: `SW-<client_ID>-<CODE>`. |
| `machines` | existing `status` | Pickable when `active` or null. |
| `machines` | existing `category_ID` | Seeded software points to the new "Software" machine category. |
| `machine_categories` | new row | `category_name` "Software", description "Customer software, seeded or imported." Inserted by the migration if missing. |
| `tickets` | existing `machine_ID` | Required on customer tickets (validation, not a schema change; internal and PRS tickets unchanged). |
| `tickets` | existing `problem_category_ID` | Set by the server: equipment → the active system "Service" category, software → the active system "Software" category (looked up by name, branch neutral). |

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticket-form-options` (ticket-service, existing) | GET | none | adds `assets: [{machine_ID, name, asset_type, serial_number (null for software), category_name}]`; triggers seeding when the customer has no software | customer token | 401 |
| `/api/tickets` (ticket-service, existing) | POST | `machine_ID` (req for customers), title, description; `problem_category_ID` ignored | ticket with derived `problem_category_ID` | customer token | 422 `machine_ID` (missing, not owned, not pickable) |
| `/api/tickets/{id}` (ticket-service, existing) | PATCH | `machine_ID` | ticket with category set again | customer token, own Open unassigned ticket | 422, 403 |
| `/api/internal/customers/{clientId}/assets` (ticket-service, new) | GET | `clientId` path | `{data: [same shape as assets above]}`; triggers seeding | `internal.token` | 401, 404 unknown client |
| `/api/chat` (AI-service, existing) | POST | adds optional `selected_asset_id` | adds `asset: {machine_ID, name, asset_type} or null`, `asset_options: [...]`, `asset_status: matched / ambiguous / not_owned / missing`; `ticket_data.machine_ID` when escalating | customer token | 422 when `selected_asset_id` is not in the customer's list |
| `/api/escalate-handoff/{id}` (AI-service, existing) | GET | conversation id | adds `machine_ID` | customer token | 404 |
| `php artisan assets:seed-customer-software` (ticket-service, new) | CLI | `--apply`, `--link-ticket=8:LIS` (repeatable) | prints planned or applied inserts and ticket links | shell access | non zero exit if a linked ticket or code does not belong to the same customer |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Form options | the customer's items | `machines` where `client_ID` = authenticated `Client.id`, status active or null |
| Form options | item group (Equipment / Software) | `machines.asset_type` |
| Form | read only category label | derived from the picked item's `asset_type` (equipment → "Service", software → "Software") |
| Create / edit ticket | `problem_category_ID` | `problem_categories` row named "Service" or "Software", active, `branch_id` null, chosen by the item's `asset_type` |
| Create / edit ticket | ownership | `machines.client_ID` compared with the authenticated `Client.id` |
| Seeding | software names and codes | `config/assets.php` → `seed_software` list in ticket-service |
| Seeding | serial code | `SW-` + `client_ID` + `-` + item code |
| Seeding | machine category | `machine_categories` row named "Software" |
| AI chat | customer id for the list | the verified customer token in AI-service (`getAuthenticatedUser`), never a request field |
| AI chat | the customer's items | ticket-service internal endpoint, cached per conversation for 60 seconds |
| AI chat | identified item | Gemini `asset_id` checked against the fetched list, or `selected_asset_id` checked the same way |
| Handoff | `machine_ID` | the identified item stored on the conversation |
| Ticket branch | branch | `TicketBranchResolver` (item branch, else default) |

**Key invariants**:
- A customer ticket always has a `machine_ID` owned by that customer and pickable at the time it was chosen.
- The category of a customer ticket always matches its item's `asset_type`; the browser cannot override it.
- Every customer that lists items has at least the three seeded software items.
- AI-service never escalates with no identified owned item, except the Gemini unavailable fallback, which lands on the form that enforces the same rule.
- Seeding is idempotent: running it twice adds nothing the second time (match on `client_ID` + serial code).

**Security model**:
- Customers see and choose only their own items; enforced in ticket-service on read and on write.
- AI-service reads items only through the internal endpoint with `X-Internal-Token`; the customer id comes from the verified token, so a customer cannot ask for another customer's list.
- The internal endpoint is not routed through the customer facing gateway paths for browsers (internal token required).
- No new personal data; serial codes for software are internal only.

**Configuration required**:
- `TICKET_SERVICE_URL` (AI-service): base URL of ticket-service for the internal assets call, default `http://ticket-service:8000/api`, read through `config/services.php`.
- Seed list in ticket-service `config/assets.php` (no env var): the three items with name and code.
- Existing `INTERNAL_TOKEN` in both services (AI-service reads it through `services.internal.token`, already in place).
- After changing AI-service config, run `config:cache` again (config caching is on in the dev container).

**Critical test scenarios**:
- Happy path: customer picks their analyzer, category shows Service, ticket saved with that machine and the Service category; verifies **AC-3**, **AC-4**, **AC-5**.
- Software: customer picks LIS, ticket saved with the Software category and the default branch; verifies **AC-5**, **AC-16**.
- Tampering: customer posts another customer's `machine_ID`, or a retired item, gets 422; posting `problem_category_ID` for Software with an equipment item still saves Service; verifies **AC-5**, **AC-14**.
- Seeding: a customer with no software lists items and gets exactly three; listing again adds none; verifies **AC-2**.
- AI matched: "my BC-5390 is not printing" with that analyzer on the account escalates with its `machine_ID`; verifies **AC-8**, **AC-11**.
- AI not owned: naming an analyzer not on the account returns `not_owned`, `asset_options`, no escalate; verifies **AC-9**.
- AI ambiguous: two analyzers with similar names returns `ambiguous` and both as options; tapping one escalates; verifies **AC-8**.
- AI safety: hazard message returns the warning plus `asset_options`, no escalate until an item is chosen; verifies **AC-10**.
- Gemini down: chat falls back to manual creation, form still requires the picker; verifies **AC-12**.
- Edit: switching an Open ticket from equipment to LIS changes its category to Software; verifies **AC-6**.
- Data fix: dry run lists TKT-0008 → `SW-4-LIS` and changes nothing; `--apply` links it; verifies **AC-13**.

## Build plan

Build approach: none recorded in `AGENTS.md` or the scope, so this assumes Tracer Bullet (a thin end to end thread first, then thicken).

1. [x] Migration: add `machines.asset_type` (default `equipment`) with the (`client_ID`, `asset_type`) index, and insert the "Software" machine category if missing; satisfies **AC-1**.
2. [x] `config/assets.php` with the seed list, and `App\Services\CustomerAssetService` in ticket-service: `pickableFor(clientId)`, `ensureSeeded(clientId)` (idempotent), `categoryIdFor(machine)`; satisfies **AC-1**, **AC-2**, **AC-14**, **AC-16**.
3. [x] Thin thread: `ticket-form-options` returns `assets` (seeding on read); customer create requires an owned pickable `machine_ID` and derives `problem_category_ID`; satisfies **AC-2**, **AC-5**, **AC-14**, **AC-15**.
4. [x] Frontend form: one "Equipment / Software" picker (grouped, no software serials), read only category, remove `useCategoryPreview` and the blur category call from `TicketCreation.jsx`, preselect `machine_ID` from the AI handoff; satisfies **AC-3**, **AC-4**, **AC-11**.
5. [x] Customer edit (PATCH): same ownership rule, category set again from the new item; satisfies **AC-6**.
6. [x] Internal endpoint `GET /api/internal/customers/{clientId}/assets` behind `internal.token`; satisfies **AC-7**.
7. [x] AI-service: `TICKET_SERVICE_URL` config, an assets client (60 second cache per conversation), pass the list to Gemini with numbered ids, parse `asset_id`, check it against the list, compute `asset_status`, gate `escalate`, accept `selected_asset_id`, include `machine_ID` in `ticket_data` and the handoff; safety path keeps the warning and asks for the item; satisfies **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-12**.
8. [x] Frontend AI chat (`AISupportPage.jsx`): render `asset_options` as buttons, send `selected_asset_id`, pass `machine_ID` to the form on handoff; satisfies **AC-8**, **AC-9**, **AC-11**.
9. [x] Seed command `assets:seed-customer-software` with dry run default, `--apply`, and `--link-ticket`; satisfies **AC-2**, **AC-13**.
10. [x] Tests: ticket-service feature tests (form options, create, edit, seeding, command) on `ticketing_system_test` with `DatabaseTransactions`; AI-service unit tests with `Http::fake` for matched, ambiguous, not owned, safety and Gemini down; satisfies every AC above.
11. [x] After the engineer approves: run the command with `--apply --link-ticket=8:LIS` on the dev database; satisfies **AC-13**.

## Migration plan

**Strategy**: additive, no flag. The column has a default, so existing rows become `equipment` with no backfill.
**Phases**:
1. Deploy the migration and the ticket-service changes (steps 1 to 6). Existing machines read as equipment; seeding happens on the next list read.
2. Deploy AI-service and frontend changes (steps 7, 8).
3. Run the seed command for all customers, then link TKT-0008 (steps 9, 11), after approval.
**Rollback**: revert the code; roll back the migration (drops `asset_type`); delete seeded rows with `serial_number LIKE 'SW-%'` only after setting any ticket that points at them back to null.
**Risks**: a customer whose equipment has an unexpected `status` value loses it from the picker (AC-14); check `SELECT DISTINCT status FROM machines` before release (today only `active` and null).

## Consequences

**Positive**:
- Every customer ticket names a real item the customer owns, and its category can no longer be wrong.
- The equipment import can bring software in as `asset_type = software` rows with no further code change; the branch rule picks up its branch automatically.
- The AI can no longer create tickets about equipment the customer does not have.

**Negative / tradeoffs**:
- "Software" now lives in a table called `machines`; names in code and reports read oddly until a rename is worth it.
- Seeded software is a guess: some customers will see items they do not use, and serial codes like `SW-4-LIS` sit in a column the CMS sync treats as real serials (they must never collide with or be overwritten by imported serials).
- The AI chat makes one extra internal call per conversation and asks one more question when it cannot tell which item is meant.
- The AI category suggestion built earlier becomes unused on the customer form (kept only if finer categories come back).

**Neutral**:
- Internal and PRS tickets are untouched.
- One new env var in AI-service and one new internal route in ticket-service.

## Follow-up

- [ ] When the equipment system starts sending software, map it to `asset_type = software` and decide whether to retire the seeded items for that customer.
- [ ] Confirm the CMS / equipment sync never updates or deletes rows with `SW-` serials.
- [ ] Decide whether to delete the now unused `classify-category` endpoint and `useCategoryPreview` hook, or keep them for future sub categories.
