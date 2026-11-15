# 0044. Rationale: customer portal on its own URL, sealed off from the central auth module

## Context

Employees reach ticketing through the central auth module's front door (`auth-proxy`), which serves `/ticketing/` from `ticketing-web` and forwards all of `/api/ticketing/` to `ticketing-gateway`. Customers must have a different address, and must never sign in through the central auth module.

Forces found while reading the code and `capstone-azure-infra`:
- **The central domain already exposes customer login.** Because `auth-proxy` forwards every `/api/ticketing/` path, `POST /api/ticketing/customer/login` works on the central auth domain today. A frontend only fix leaves that door open.
- **There is no customer portal in Azure.** `ticketing.bicep` defines only `ticketing-web` (employee build) and `ticketing-gateway`. The frontend already has a customer mode, and the local Compose setup already serves it on a separate `support.*` host.
- **Customer tokens would fail across services.** customer-service regenerates its Passport keys on each start (Dockerfile `passport:keys` when the file is missing, with no persisted file in Azure), and no other service has its public key. All services share the `ticketing_prod` database, so only the key is missing.
- **Both sides must keep sharing work.** Tickets, chat, attachments and feedback are owned by ticket, messaging, attachment and analytics services, and both customers and staff call them. `AuthenticateSubsystem` already accepts a central JWT (staff) or a Passport token (customer).
- **Hosting limits.** Ticketing runs in its own Azure for Students subscription (environment `bravecoast-9e1fd851`), apart from the central auth environment. Quotas are tight (about 15 to 30 apps per environment), and apps should scale to zero. The org level CI secrets belong to the central maintainer, so the OIDC login fails for this repo.
- **`customers/provision` is public.** It creates customer accounts with no authentication, though `docs/api-contracts.md` lists it as "Admin, Internal".

## Options considered

### Option 1: Customer edge in the customer web container, plus a gateway block
The customer web nginx proxies an allowlist straight to the internal services. `ticketing-gateway` returns 404 for customer credential routes.

**Pros**: Enforced on the server. No new container. Customer traffic never touches the gateway the central domain uses.
**Cons**: Two route lists to keep in step. Routing now lives in the frontend image.

### Option 2: Secret header on the shared gateway
The customer web nginx adds a secret header, and the gateway allows customer credential routes only when that header is present.

**Pros**: One gateway, one route list.
**Cons**: Security rests on a shared secret in nginx config. A leak reopens the central domain, and everything still flows through the gateway the central domain uses.

### Option 3: Separate customer gateway app
A dedicated `customer-gateway` container with only customer routes.

**Pros**: Cleanest separation, and the frontend image stays static only.
**Cons**: Another container against a tight student quota, plus one more thing to deploy, rotate and monitor.

### Option 4: Frontend only guard
Rely on the customer build never calling central auth.

**Pros**: No infrastructure change.
**Cons**: The login API stays reachable on the central domain, so it does not meet the requirement.

**Smaller choices settled in the conversation**:
- Infra home: inside `ticketing.bicep` (it references the internal service FQDNs directly), not a separate module (that would need 6 FQDN outputs wired through `apps.bicep`).
- Token keys: Container App secrets, not an Azure Files volume (the volume would add wiring to 7 apps).
- Wrong door: redirect customers to `CUSTOMER_PORTAL_URL`, rather than showing only an access denied screen.
- Provision: locked down in this spec with the existing internal secret.
- CI: a managed identity in the ticketing subscription with repo level secrets (the infra guide §8.3 allows repo secrets to override the org ones), not a request to the central maintainer.
- Domain: `support.sbsi.tech`, starting on the Azure default address.

## Rationale

Option 1 is the only choice that meets "customers never go to the central auth module" on the server side without spending scarce quota. The gateway block closes the door the central front door opens. The customer edge means customer traffic never needs that gateway, so blocking credential routes there costs customers nothing. Option 2 enforces the same rule, but trades a structural boundary for a secret that can leak. Option 3 is cleaner, but the student quota makes an extra always billable container the wrong trade while one nginx can do the job. Option 4 fails the requirement outright.

The shared Passport keypair is what keeps both sides talking. Without it, the new address works for login and then fails on the first ticket request. Container App secrets match how `ticketing.bicep` already ships `auth-public-key` and `jwt-secret`, and Passport v12 reads the env vars without code changes.

The strangler order (open the new door, prove interop, then close the old one) means no customer is locked out between deploys.

## Revisions after the cross check (2026-11-15)

An independent read found load bearing gaps, and the engineer accepted all the fixes:
- A customer token could still be used on the central domain after login was blocked, so a staff traffic mark (`X-Ticketing-Edge`) plus `TICKETING_EDGE_ENFORCE` was added (AC-13). The switch keeps localhost unchanged, because one local gateway carries both portals.
- The gateway denylist became an allowlist of the customer-service routes staff use (from the employee build's calls), so future customer routes stay closed by default (AC-3).
- Staff password screens that called customer-service routes are hidden in the employee build (AC-14).
- messaging-service issues no tokens in practice, so only customer-service holds the private key.
- Bicep wiring was corrected: `deploy.ps1` never reads `parameters.prod.json`, every app needs registry wiring, the image tag is shared, and outputs need to flow back to `deploy.ps1`.
- Edge details were added: template selection in the Dockerfile, URL defaults so nginx starts, 30M bodies, verbatim location copies, a cookie allowlist, and `/internal/` blocked.

## Evidence: infrastructure facts used

| Fact | Source |
|---|---|
| `auth-proxy` routes `/ticketing/` to `ticketing-web` and `/api/ticketing/`, `/storage/` to `ticketing-gateway` | `capstone-azure-infra/docs/SUBGROUP_DEVELOPER_GUIDE.md` §1, `infra/modules/auth.bicep` (`TICKETING_WEB_URL`, `TICKETING_GATEWAY_URL`) |
| Ticketing apps: `ticketing-web` (5005, external), `ticketing-gateway` (80, external), 9 services (8000, internal) | `infra/modules/ticketing.bicep` |
| Common secrets already shipped: `db-password`, `jwt-secret`, `auth-public-key`, `internal-encryption-key` (also `INTERNAL_SERVICE_SECRET`) | `ticketing.bicep` `commonSecrets`, `commonEnv` |
| Sizing rule for web apps: 0.25 vCPU, 0.5Gi, `minReplicas: 0` | `capstone-azure-infra/AGENTS.md` directive 3 |
| Bicep verification gate: `az bicep build` with 0 errors and 0 diagnostics | `capstone-azure-infra/AGENTS.md` directive 5 |
| Repo secrets override org `AZURE_*` secrets for a team deploying to its own subscription | `SUBGROUP_DEVELOPER_GUIDE.md` §8.3 |
| CI OIDC failure: `AADSTS700213`, subject `repo:Scientific-Biotech-Specialties-Inc@351859334/ticketing@1235299146:ref:refs/heads/main` | deploy run 42581028571 log |
| Passport v12.4.3 in all 7 services, reads `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY` | service `composer.lock` files, vendor `config/passport.php` |
| Token issuers: customer-service, messaging-service (`createToken`) | `*/app/Services/AuthService.php` |
| Customer screens use customer, ticket, attachment, messaging, ai, configuration, analytics prefixes. Employee-service calls are staff work (assign, worklogs, reassignment) | `frontend/web/src/services/ticketService.js`, `config/api.config.js` |
