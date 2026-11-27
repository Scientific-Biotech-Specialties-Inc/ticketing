# 0052. Superadmin customer account creation with hospitals and live branches

**Date**: 2026-11-27
**Status**: In Progress

## Summary

The Super Admin Customers page (`/ticketing/superadmin/customers`) runs entirely on fake browser data today. This spec makes it real: the list loads from the database, the Create User modal saves through the backend, and the SBSI Branch field shows the live branches from the auth module. A new hospitals table lets one hospital have many login emails, so Customer Name becomes a searchable dropdown. Before saving, the modal checks for an existing email (offer to add the item to that account) or an existing hospital (warn, then allow another account). A new Service or Software dropdown decides what kind of item is created.

## Requirements

**User stories**:
- As a Super Admin, I want the SBSI Branch dropdown to show the real branches from the auth module so that items land on a branch that actually exists.
- As a Super Admin, I want to pick a hospital from a searchable list (or add a new one) so that the same hospital is never typed two different ways.
- As a Super Admin, I want to be told when an email already has an account so that I add the new item to that account instead of creating a duplicate.
- As a Super Admin, I want a warning when a hospital already has accounts so that I only create a second login for it on purpose.
- As a Super Admin, I want to choose Service or Software so that the item gets the right type and the right ticket category later.
- As a Super Admin, I want the customer list to show real data so that what I create shows up right away.

**Acceptance criteria**:
- **AC-1**: The Create User **SBSI Branch** dropdown lists exactly the active branches from `BranchContext` (the auth module branches served by `GET /superadmin/branches`, spec 0009), showing the branch name and submitting the branch slug. When a specific branch is selected in the superadmin header, it is preselected; under All Branches the field starts empty. The field is required.
- **AC-2**: Create User has a required **Type** dropdown with `Service` (default) and `Software`. Service shows Equipment Name, Brand and Model, and Serial Number, all required, and creates a `machines` row with `asset_type = 'equipment'`. Software shows Software Name (required) and Vendor / Version (optional), hides Serial Number, and creates a row with `asset_type = 'software'`, the `Software` machine category, and a generated serial `SW-<client_ID>-<8 random uppercase letters or digits>`.
- **AC-3**: **Customer Name** is a searchable combobox over hospitals. Typing searches the server (debounced 300 ms, up to 20 results), matching on the normalized name (lowercase, punctuation and extra spaces ignored, so `St Lukes` finds `St. Luke's`). The admin either picks an existing hospital or, when nothing matches exactly, picks `Add new hospital: <typed name>`.
- **AC-4**: On submit, if the email (trimmed, lowercased) already belongs to a customer account, an **Existing Account** modal opens: title `This is an existing account`, body `Should we add this <Service item | Software> to <account hospital name> (<email>)?`, showing the account's hospital, email and an `Inactive` badge when the account is disabled. **Add to this account** attaches the new item to that existing account: no new account, no welcome email, and the typed hospital name is ignored in favor of the account's. **Cancel** returns to the form with input kept.
- **AC-5**: On submit, if the email is new and the chosen or typed hospital (normalized) already has one or more accounts, a **warning** modal opens listing that hospital's existing emails: `This hospital already has N account(s). Create another account for it?` **Continue** creates a new account linked to the same hospital. **Go back** returns to the form with input kept.
- **AC-6**: If the email is new and the hospital is new or has no accounts, submit creates (in order) the hospital if new, the customer account with the customer-service welcome email and temporary password, and the item. No extra modal.
- **AC-7**: When both conditions hold (email exists and the hospital has accounts), only the Existing Account modal (AC-4) is shown.
- **AC-8**: The server enforces AC-4 and AC-5 even if the client skips the check. `POST /superadmin/customers` with `mode = new` for an email that already exists answers `409` with `code = email_exists` and the account; with `mode = new` for a hospital that has accounts and without `confirm_same_hospital = true` answers `409` with `code = hospital_has_accounts` and its emails. The frontend reacts to these by opening the matching modal.
- **AC-9**: A Service serial number that already exists on any machine is rejected with `409`, `code = serial_taken`, and the owning hospital name, shown inline under Serial Number (`Serial <serial> is already registered to <hospital>`). No existing machine is moved, updated or overwritten by this modal.
- **AC-10**: The customer table loads from `GET /superadmin/customers`: one row per item, showing hospital, account email, type (`Service` or `Software`), serial (blank for Software), branch name, and contract status. Search (hospital, email, item name, serial) and pagination run on the server. Filters: Type and Contract Status. The list follows the superadmin header branch selector (All Branches shows everything). The detail modal shows the same real fields.
- **AC-11**: After a successful create or attach, the modal closes and resets, the list reloads, and a success toast names the hospital and whether an account was created or the item was added to an existing one.
- **AC-12**: The page no longer imports `@/data/cmsCustomerData`. Removed from the page: Fetch from CMS, Store and Store All Pending, Reset Demo Data, Integration Settings, the Store Status filter, the Service Tier filter (no backing column), and the page Branch filter (the header replaces it). Export JSON stays and exports the rows currently loaded.
- **AC-13**: A `customer_organizations` table exists and `clients.organization_id` links accounts to it. Existing clients are backfilled: one hospital per distinct normalized `client_name`, linked to every matching client. From then on, every call to `POST /api/customers/provision` (this page, the CRMS machine sync, the CMS equipment sync) links the new client to a hospital, creating it by normalized name when missing.
- **AC-14**: Every new ticket-service route answers `403` to any user whose role is not superadmin and `401` without a valid token. The new customer-service routes accept only a valid `X-Internal-Secret`.
- **AC-15**: If customer-service is unreachable or fails, create answers `502` with `Customer service is unavailable, please try again.`, no `machines` row is written, the modal stays open with input kept, and an error toast shows. If the item insert fails after a new account was provisioned, the account stays (it is reusable: a retry finds the email and attaches) and the response says so.
- **AC-16**: Loading states follow the design rules: skeleton rows while the list loads, a `Loader2` spinner on the submit button while saving and checking, and a `Searching…` row inside the combobox while hospital search runs.

## Decision

**Chosen option**: Option 2: a real hospitals table in customer-service, with ticket-service fronting a new superadmin customers API that reuses the existing provisioning path.

ticket-service owns the page's API and the `machines` writes; customer-service owns hospitals and accounts and is reached only through internal REST calls; the SPA talks only to ticket-service.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `api-testing` (`.claude/skills/api-testing/`)

## Feature design

**Data model sketch** (target):

| Table | Owner | Column | Type | Rules |
|---|---|---|---|---|
| `customer_organizations` (new) | customer-service | `id` | bigint PK | |
| | | `name` | varchar(255) | required, display name as first entered |
| | | `normalized_name` | varchar(255) | required, UNIQUE |
| | | `created_at`, `updated_at` | timestamps | |
| `clients` (existing) | customer-service | `organization_id` (new) | unsigned bigint | nullable, indexed, FK `customer_organizations.id` ON DELETE SET NULL |
| | | `email` | varchar | stays UNIQUE (one login per email) |
| | | `client_name` | varchar | unchanged; set to the hospital `name` on create (ticket-service reads it in many places) |
| `machines` (existing) | ticket-service | no schema change | | `asset_type` `equipment` or `software`; `category_ID`; `client_ID`; `branch_id` (auth branch slug, required); `serial_number` UNIQUE; `brand`; `model` |

Relationships: hospital 1:N accounts (`clients`), account 1:N items (`machines`), branch 1:N items.

**Normalization rule** (one helper, used for the unique key, search and matching): lowercase, replace every run of characters that are not letters or digits with a single space, trim. `St. Luke's  Medical` becomes `st luke s medical`. The same rule lives in customer-service only; ticket-service never normalizes on its own.

**Field mapping from the modal to `machines`**:

| Modal field | Service | Software |
|---|---|---|
| Equipment Name / Software Name | `machine_name` | `machine_name` |
| Brand and Model / Vendor / Version | `brand` (whole text) | `brand` (whole text, nullable) |
| Serial Number | `serial_number` (trimmed) | generated `SW-<client_ID>-<8 chars>` |
| (fixed) | `asset_type = equipment`, `category_ID` = `Uncategorized` (`CrmsMachineSyncService::DEFAULT_CATEGORY`, same as synced equipment) | `asset_type = software`, `category_ID` = `Software` category (`CustomerAssetService` lookup) |
| SBSI Branch | `branch_id` = slug | `branch_id` = slug |
| `status` | `Active` | `Active` |

**API surface** (ticket-service routes sit inside the existing `auth.subsystem` group; gateway prefix `/api/ticketing/ticket`):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/superadmin/customers` | GET | `search`?, `type`? (`service`/`software`), `contract_status`? (`active`/`expired`/`none`), `branch_id`? (slug), `page`, `per_page` (max 100) | `data`: rows (`machine_id`, `item_name`, `type`, `serial_number`, `brand`, `branch_id`, `branch_name`, `client_id`, `email`, `hospital_id`, `hospital_name`, `contract_code`, `contract_end_date`, `contract_status`, `created_at`); `meta`: `total`, `page`, `per_page` | bearer, superadmin | 401, 403, 422 |
| `/superadmin/customers/organizations` | GET | `search` (min 1 char), `limit`? (max 20) | `data`: `id`, `name`, `account_count` | bearer, superadmin | 401, 403, 502 |
| `/superadmin/customers/check` | POST | `email` (req), `organization_id`? or `organization_name`? | `email_match`: `client_id`, `client_name`, `email`, `status`, `organization_id` or null; `organization`: `id`, `name` or null; `organization_accounts`: list of `client_id`, `email` | bearer, superadmin | 401, 403, 422, 502 |
| `/superadmin/customers` | POST | `asset_type` (`equipment`/`software`, req), `item_name` (req), `brand`?, `serial_number` (req when equipment, ignored when software), `branch_id` (req, active slug), `email` (req), `organization_id`? or `organization_name`? (one req when `mode = new`), `mode` (`new`/`attach`, req), `attach_client_id` (req when attach), `confirm_same_hospital`? (bool) | 201: `item` (same shape as a list row), `account_status` (`created`/`attached`), `welcome_email_sent` | bearer, superadmin | 401, 403, 409 `email_exists` / `hospital_has_accounts` / `serial_taken` / `attach_mismatch`, 422, 502 |
| customer-service `/api/internal/organizations` (new) | GET | `search`, `limit` | `data`: `id`, `name`, `account_count` | `X-Internal-Secret` | 401, 422 |
| customer-service `/api/internal/customers/lookup` (new) | GET | `email`, `organization_id`? or `organization_name`? | same body as `check` above | `X-Internal-Secret` | 401, 422 |
| customer-service `/api/internal/customers/by-ids` (new) | GET | `ids` (comma list, max 100) | `data`: `client_id`, `email`, `client_name`, `organization_id`, `organization_name` | `X-Internal-Secret` | 401, 422 |
| customer-service `/api/customers/provision` (extended) | POST | existing body plus `organization_id`? | existing body plus `organization_id` | `X-Internal-Secret` | unchanged; 422 for an unknown `organization_id` |

Note on the list read: the list joins `machines` with `branches` in ticket-service, then resolves account email and hospital for the page's client ids through `/api/internal/customers/by-ids` (one call per page). Search on hospital or email first asks customer-service for matching client ids (the `lookup` style search, extended with a `search` param on `by-ids`: `GET /api/internal/customers/by-ids?search=<text>` returns up to 500 matching ids) and filters `machines` by them, combined with a direct `machine_name` / `serial_number` match. This keeps ticket-service out of `clients` and `customer_organizations` for the new code.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Branch dropdown | options, labels, slugs | `BranchContext.branches` (auth module via `GET /superadmin/branches`) |
| Branch dropdown | preselected value | `BranchContext.selectedBranchId` when not null / `all` |
| Hospital search | result list, `account_count` | `customer_organizations` + count of `clients` by `organization_id` (customer-service) |
| Check | `email_match` | `clients` by lowercased `email` (customer-service) |
| Check | `organization_accounts` | `clients` where `organization_id` = picked id, or the org whose `normalized_name` matches the typed name |
| Existing Account modal | hospital name, email, Inactive badge | `email_match.client_name`, `.email`, `.status` |
| Warning modal | N and the email list | `organization_accounts` |
| Create (new) | `client_ID` | `id` returned by `POST /api/customers/provision` |
| Create (new) | hospital link | `organization_id` input, else customer-service `firstOrCreate` on `normalized_name` from `organization_name` |
| Create (attach) | `client_ID` | `attach_client_id`, verified by ticket-service against a fresh `lookup` of `email` (mismatch → 409 `attach_mismatch`) |
| Create | `machine_name`, `brand`, `serial_number`, `asset_type`, `category_ID`, `branch_id` | modal fields and fixed values per the field mapping table |
| Create (software) | serial | generated in ticket-service: `SW-` + `client_ID` + `-` + 8 chars from `Str::upper(Str::random(8))` filtered to `A-Z0-9`, retried up to 3 times on a unique clash |
| Create | `welcome_email_sent` | provision response (`status = created` means sent through customer-service's normal path) |
| List | `branch_name` | `branches.name` joined on `machines.branch_id = branches.slug` |
| List | `contract_status` | derived: `active` when `cms_contract_active = 1` and (`contract_end_date` null or today or later); `expired` when `cms_contract_active = 0` or `contract_end_date` before today; `none` when both are null. "Today" is the app timezone (`config('app.timezone')`) |
| List | `email`, `hospital_name`, `hospital_id` | `/api/internal/customers/by-ids` |
| List | branch scope | `branch_id` query param from the header selector (`BranchContext.selectedBranchId`), absent for All Branches |
| Success toast | hospital name, created vs attached | response `item.hospital_name`, `account_status` |

**Key invariants**:
- One login per email: `clients.email` stays unique; this feature never creates a second account for an existing email.
- One hospital per normalized name: `customer_organizations.normalized_name` is unique; creation uses `firstOrCreate` inside a transaction and on a unique clash rereads the row (two admins adding the same new hospital at once end up on one row).
- This modal never updates or moves an existing `machines` row. It only inserts.
- `machines.branch_id` is always an active branch slug at write time (validated against `branches` where `is_active = 1`).
- ticket-service writes only `machines`; it never writes `clients` or `customer_organizations` (invariant 3 in `AGENTS.md`).
- `SW-` serials from this modal never collide with spec 0047 starter codes because the 8 random characters are not one of the configured starter codes (check against `config('assets')` codes before insert).

**Security model**:
- All four ticket-service routes: superadmin only, enforced in the controller the same way `SuperAdminDashboardController` does (normalize role, compare to `superadmin`). Any other role gets 403.
- customer-service internal routes: `internal.secret` middleware only, never exposed on the gateway (no new nginx location; ticket-service calls `services.customer.url` directly as `CrmsMachineSyncService` already does).
- PII: customer emails cross the internal network between services; no new public exposure. The check and organization endpoints return emails only to superadmins.
- Rate limit: `throttle:30,1` on `POST /superadmin/customers` and `POST /superadmin/customers/check`; `throttle:120,1` on organization search.
- Audit: each create writes one `Log::info` line in ticket-service (`superadmin customer item created`, actor id, client id, machine id, `account_status`). No new audit table.

**Configuration required**: none new. Reuses `services.customer.url`, `services.customer.timeout`, `services.internal.secret` in ticket-service and `INTERNAL_SERVICE_SECRET` in customer-service.

**Frontend shape**:
- New `frontend/web/src/components/ui/combobox.jsx`: input plus listbox with `role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="option"`; arrow keys, Enter, Escape; `onSearch` (debounced by the caller), `options`, `loading`, `onSelect`, and an optional `createLabel` row. Built on the existing `Input` and Tailwind tokens, no new package.
- New `frontend/web/src/services/superadminCustomerService.js` on `ticketClient`: `listCustomers`, `searchOrganizations`, `checkCustomer`, `createCustomerItem`.
- Two small modals on the existing `confirmation-modal.jsx`: Existing Account and Same Hospital warning.
- `SuperAdminCMSIntegration.jsx` drops the localStorage flows (AC-12) and loads from `listCustomers`, refetching when `selectedBranchId`, search, filters or page change.

**Submit flow** (frontend):
1. Validate fields. 2. `checkCustomer`. 3. If `email_match` → Existing Account modal → on Add, `createCustomerItem({mode: 'attach', attach_client_id})`. 4. Else if `organization_accounts` not empty → warning → on Continue, `createCustomerItem({mode: 'new', confirm_same_hospital: true})`. 5. Else `createCustomerItem({mode: 'new'})`. 6. A 409 `email_exists` or `hospital_has_accounts` from step 3 to 5 (a race) opens the matching modal with the returned data. 7. A 409 `serial_taken` sets the inline error.

**Critical test scenarios**:
- Happy path, new hospital and new email, Service item: hospital, account (welcome email requested), machine created with branch slug and `asset_type = equipment`, verifies **AC-2**, **AC-6**, **AC-11**
- Existing email: check returns the match, attach creates only a machine under that `client_ID`, provision is not called, verifies **AC-4**, **AC-7**
- Existing hospital, new email: warning lists emails, Continue creates a second client with the same `organization_id`, verifies **AC-5**
- Server guard: `mode = new` with an existing email returns 409 `email_exists`; without `confirm_same_hospital` on a hospital with accounts returns 409 `hospital_has_accounts`, verifies **AC-8**
- Duplicate serial returns 409 `serial_taken` and the existing machine is unchanged, verifies **AC-9**
- Software item gets `SW-<client_ID>-XXXXXXXX`, the Software category, and no serial input is required, verifies **AC-2**
- Normalized search: `st lukes` finds `St. Luke's Medical Center`; creating `ST. LUKE'S medical center` reuses the same hospital, verifies **AC-3**, **AC-13**
- Backfill: two clients with `client_name` `Makati Med` and `makati med.` end up on one hospital, verifies **AC-13**
- CRMS sync provision call links a new client to a hospital, verifies **AC-13**
- Branch: dropdown options equal `BranchContext.branches`; header branch preselected; inactive or unknown slug returns 422, verifies **AC-1**
- List: header branch filters rows, search by email finds the account's items, contract status derivation, verifies **AC-10**
- Auth: an admin role gets 403 on every new route; missing token 401; internal route without secret 401, verifies **AC-14**
- customer-service down: 502, no machine row, modal input kept, verifies **AC-15**
- Page no longer imports `cmsCustomerData` and the removed controls are absent; skeleton and spinner states render, verifies **AC-12**, **AC-16**
- Test database isolation: every backend suite runs against an isolated test database, never the shared `ticketing_system` dev database.

## Build plan

Build approach: none recorded in `AGENTS.md` or the scope, so this assumes Tracer Bullet (one thin end to end thread first, then thicken).

1. customer-service migration: create `customer_organizations`, add nullable `clients.organization_id` with FK and index, backfill from distinct normalized `client_name` (timestamped migration, reversible: down drops the FK, column and table), satisfies **AC-13**
2. customer-service: `CustomerOrganization` model, the normalization helper, extend `ProvisionController` to accept `organization_id` and otherwise `firstOrCreate` by normalized `client_name`; add the three internal routes (`organizations`, `customers/lookup`, `customers/by-ids` with `search`) behind `internal.secret`, with feature tests, satisfies **AC-3**, **AC-13**, **AC-14**
3. ticket-service thread: `SuperAdminCustomerService` (in `app/Services/`, thin controller `SuperAdminCustomerController`) with `POST /superadmin/customers` for the simplest path (`mode = new`, Service item, new hospital), calling provision and inserting the machine; superadmin guard and throttles; feature tests with customer-service faked via `Http::fake`, satisfies **AC-2**, **AC-6**, **AC-14**, **AC-15**
4. Frontend thread: `superadminCustomerService.js`; Create User modal posts to the backend with the live branch dropdown from `BranchContext` (preselect rule) and the Type dropdown (Service fields only for now); success toast; error toast on 502, satisfies **AC-1**, **AC-11**, **AC-15**
5. Thicken backend: `check` endpoint, `attach` mode with `attach_mismatch` verification, `hospital_has_accounts` and `email_exists` guards, `serial_taken`, Software path with SW serial generation and category, satisfies **AC-2**, **AC-4**, **AC-5**, **AC-7**, **AC-8**, **AC-9**
6. Thicken frontend: `ui/combobox.jsx` with tests (keyboard, ARIA, create row); hospital search; Existing Account and warning modals; the full submit flow including 409 race handling; Software relabeling; spinner and combobox loading row, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-7**, **AC-8**, **AC-9**, **AC-16**
7. Backend list: `GET /superadmin/customers` and `GET /superadmin/customers/organizations` (proxy), with branch scope, search, filters, contract status derivation and pagination, satisfies **AC-10**, **AC-14**
8. Frontend list: replace localStorage loading with `listCustomers`, skeleton rows, server pagination and filters, header branch scope, real detail modal; remove the mock controls and the `cmsCustomerData` import; keep Export JSON on loaded rows, satisfies **AC-10**, **AC-12**, **AC-16**
9. Gateway check: confirm `/api/ticketing/ticket/superadmin/customers*` is already covered by the existing ticket-service location in `nginx.conf` and `nginx.prod.conf` (no new prefix expected); add nothing to the gateway for the internal customer-service routes, satisfies **AC-14**

## Migration plan

**Strategy**: additive, no feature flag needed (the page is mock today, so nothing live regresses).
**Phases**:
1. Deploy customer-service with the migration and backfill. `organization_id` is nullable, so existing code keeps working. Provision starts linking new clients.
2. Deploy ticket-service routes, then the frontend.
**Rollback**: revert the frontend and ticket-service commits; roll back the customer-service migration (drops the column and table; `client_name` was never changed, so no data is lost).
**Risks**: backfill merges two different hospitals that normalize to the same text (rare; they can be split later by editing `organization_id`). Backfill on a large `clients` table is a single pass in chunks of 500.

## Consequences

**Positive**:
- The Customers page shows and creates real data; created customers appear immediately.
- One hospital, many logins, with no typo duplicates going forward; every provisioning path (this page, CRMS sync, CMS sync) now groups accounts by hospital.
- Duplicate accounts and duplicate serials are blocked on the server, not just in the UI.
- A reusable accessible combobox joins the UI kit.

**Negative / tradeoffs**:
- The list needs a second call to customer-service per page, and hospital or email search goes through customer-service first; slightly slower than a direct join and one more failure point (a customer-service outage blanks the hospital and email columns: the list shows the rows with `Unavailable` in those cells rather than failing).
- `client_name` and the hospital `name` can drift if someone renames one later; this spec does not add a rename flow.
- The removed mock controls (CMS fetch, store, settings) disappear from demos until the real CMS sync is wired into this page.
- The backfill may wrongly merge two hospitals with the same normalized name; there is no split UI yet.

**Neutral**:
- New migration in customer-service; no schema change in ticket-service.
- The Service Tier column and filter go away because no table stores a tier.

## Follow-up

- [ ] Wire the real CMS sync (`POST /integrations/cms/sync`) into this page if the team wants the Fetch button back.
- [ ] Hospital management (rename, merge, split) for Super Admin, if backfill merges or typos need fixing.
- [ ] Consider moving ticket-service's direct `clients.client_name` reads to the hospital name over time (out of scope here).
- [ ] `AGENTS.md` mentions `DESIGN.md`, Vue, shadcn-vue and Tailwind 3.4 for `web-interface/`, which does not match this React 19 and Tailwind v4 repo (and `DESIGN.md` is absent); /sync or /audit should reconcile it. This spec followed the ONE UI tokens and loading rules stated in `AGENTS.md`.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
