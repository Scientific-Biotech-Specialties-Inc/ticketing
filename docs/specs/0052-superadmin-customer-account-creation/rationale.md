# 0052. Rationale: Superadmin customer account creation with hospitals and live branches

## Context

The Super Admin Customers page (`frontend/web/src/pages/SuperAdminCMSIntegration.jsx`, route `/ticketing/superadmin/customers`) is a demo. Every list, fetch, store and create action reads and writes browser `localStorage` through `frontend/web/src/data/cmsCustomerData.js`. The SBSI Branch dropdown in Create User is a hardcoded list of five names. Nothing a Super Admin does here reaches the database, so a customer "created" on this page cannot log in, raise tickets or own equipment.

The real pieces already exist elsewhere. Auth module branches reach the frontend through `BranchContext` (spec 0009, `GET /superadmin/branches`, synced from the auth service). `machines` in ticket-service holds customer equipment and software, with a required `branch_id` slug and `asset_type` (spec 0047). customer-service owns `clients` (one login per unique email) and exposes `POST /api/customers/provision`, which `CrmsMachineSyncService` already calls to create accounts before inserting machines.

What does not exist is a notion of a hospital. `clients.client_name` is free text and not unique, so the database already allows several emails for one hospital, but nothing ties them together: `St. Luke's` and `St Lukes` are two unrelated strings. That blocks a searchable Customer Name dropdown and makes "this hospital already has accounts" impossible to answer reliably. The team also wants guard rails: an email that already has an account should get the new item added, not a duplicate account; a hospital that already has accounts should trigger a warning before another login is made.

Constraints: services must not write each other's tables (`AGENTS.md` invariant 3, spec 0026), all services share one database by design, superadmin routes are enforced server side, and backend tests must run on an isolated database.

## Options considered

### Option 1: Group by `client_name`, no new table

The dropdown searches distinct `client_name` values; "same hospital" means same text (case insensitive). No schema change.

**Pros**:
- Smallest change; no migration or backfill.
- Works with every existing read of `client_name`.

**Cons**:
- Typos and punctuation create separate hospitals forever (`St. Luke's` vs `St Lukes`), which is exactly what the dropdown is meant to stop.
- Nothing links accounts except matching text, so renaming one account silently splits a hospital.
- The warning in AC-5 becomes unreliable.

### Option 2: Hospitals table in customer-service, ticket-service fronts the API (chosen)

Add `customer_organizations` with a unique normalized name and a nullable `clients.organization_id`, backfilled. ticket-service exposes the superadmin endpoints and calls new customer-service internal routes for hospital search, duplicate lookup and provisioning; it writes only `machines`.

**Pros**:
- A real entity for the dropdown; normalization prevents new typo duplicates.
- Fits the ownership matrix: each service writes only its own tables.
- Reuses the provisioning path, so welcome emails, password setup and the CRMS sync behave the same, and the sync now groups accounts by hospital too.
- The SPA keeps one API client and the existing superadmin auth on ticket-service.

**Cons**:
- A migration with backfill in customer-service, and three new internal routes.
- The list needs a second call to resolve emails and hospital names.
- `client_name` stays as a copy of the hospital name and can drift.

### Option 3: SPA calls customer-service directly for search and checks

Same hospitals table, but the browser calls customer-service through the gateway for hospital search and duplicate checks, and ticket-service only for create and list.

**Pros**:
- No proxy hop for search.
- customer-service fully owns its own read API.

**Cons**:
- customer-service has no superadmin guard today; it needs one plus a new gateway location in both nginx configs.
- Two API clients and two auth paths on one page; the server side guard in create still has to call customer-service anyway.

### Option 4: Keep the mock list, only wire the modal

Connect Create User to the backend but leave the localStorage list.

**Pros**:
- Smaller slice.

**Cons**:
- A created customer never appears on the page, which looks like a failure and invites duplicate creation.

## Rationale

The point of the request is trustworthy customer data: one hospital, several logins, no accidental duplicates. Option 1 cannot deliver that because text matching is what produces the duplicates in the first place. A small hospitals table with a unique normalized name is the cheapest structure that makes the dropdown, the warning and future reporting reliable, and keeping `organization_id` nullable makes the migration safe on a running system.

Placing the table in customer-service and keeping ticket-service as the only API the page calls follows the boundary rule without adding a new public surface. ticket-service already talks to customer-service with the internal secret for provisioning, already has superadmin role enforcement, and already owns `machines`, so the new endpoints sit next to code that does the same job. Option 3 would buy a slightly faster search at the cost of a new auth guard and gateway route, which is not worth it for an admin page used by a handful of people.

The guard rails live on the server (AC-8, AC-9) because a modal can be skipped by a race or a second tab; the UI modals are the friendly face of rules the API already enforces. Loading the list from the backend (rejecting Option 4) is what makes the create flow believable, and removing the mock controls keeps the page honest rather than mixing fake and real rows.

Decisions settled during writing (picked, with the runner up):
- **Equipment machine category**: reuse `Uncategorized`, the same default the CRMS sync uses, because the ticket category already follows `asset_type` (spec 0047). Runner up: add a `Service` machine category, rejected as a second source of truth.
- **Software serial**: `SW-<client_ID>-<8 random chars>`, matching spec 0047's hidden code prefix so existing rules (the CMS sync never touches `SW-` rows) cover these items. Runner up: nullable serial, rejected because `serial_number` is unique and used as a key elsewhere.
- **Attach verification**: ticket-service rereads the email before attaching and rejects a mismatched `attach_client_id`, so a stale modal cannot attach to the wrong account. Runner up: trust the client id, rejected as unsafe.
- **Partial failure**: if the account is created but the item insert fails, keep the account; a retry finds the email and attaches. Runner up: a compensating delete call, rejected because it would also need to undo a sent welcome email.
- **List search across services**: customer-service returns matching client ids, ticket-service filters `machines` by them. Runner up: a read only join in ticket-service, rejected to keep new code out of another service's tables.
- **Contract status**: derived from the existing `cms_contract_active` and `contract_end_date` columns. Runner up: a stored status, rejected as duplicate state.
- **Combobox**: a small in house component, no new package, because the UI kit has no Radix popover or cmdk today. Runner up: shadcn Command on cmdk.
- **Audit**: a structured log line per create, no new table, since no audit table exists for customer data. Runner up: a new audit table, deferred.
