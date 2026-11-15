# 0044. Customer portal on its own URL, sealed off from the central auth module

**Date**: 2026-11-15
**Status**: In Progress
**Mode**: ENHANCEMENT
**Related**: 0033 (customer auth and token hardening), 0034 (verified identity across services), 0009 (central auth branch payload)

## Summary

Customers get their own web address, `support.sbsi.tech`, served by a new container app (`customer-ticketing-web`). Employees keep using the central auth front door at `/ticketing/`. Customers can never sign in or use a customer token through the central auth module: the shared ticketing gateway (the one the central front door forwards to) only lets through the few customer-service routes staff need, and every service refuses customer tokens on traffic that came through that gateway. Both sides still work on the same tickets, chats and files through the shared backend services, so a ticket a customer opens shows up in the employee queues.

## Requirements

**User stories**:
- As a customer, I want my own support address so that I sign in and manage my tickets without ever seeing the company login.
- As the security owner, I want customer credentials and customer tokens to work only on the customer address so that the central auth module and its domain never handle a customer.
- As a CS agent or engineer, I want customer tickets, replies and files to reach me in the employee portal so that my daily work does not change.
- As the ticketing team, I want the customer portal defined in our infrastructure code and deployed by CI so that an account rotation or redeploy brings it back without manual steps.

**Acceptance criteria** (the contract, each one is checkable on its own):
- **AC-1**: The customer portal is served by its own container app `customer-ticketing-web` at `https://support.sbsi.tech`. Until DNS is bound, it is served at its Azure default address `https://customer-ticketing-web.bravecoast-9e1fd851.eastasia.azurecontainerapps.io`. The employee portal stays at the central auth front door path `/ticketing/`. The customer portal is never added as a route on `auth-proxy`.
- **AC-2**: The customer build (`VITE_APP_MODE=customer`) never links to, redirects to, or sends a request to the central auth module (`auth-proxy`, `auth-web`, `auth-api`). Every browser request it makes goes to its own origin. `login()` always uses `mode=customer`, logout returns to the customer origin root, and the wrong portal screen shows no employee portal link. Realtime (Reverb) stays off on the customer origin, as it is in every cloud build today.
- **AC-3**: Through `ticketing-gateway` (and so through the central auth domain), customer-service is reachable only on this allowlist: `me`, `logout`, `heartbeat`, `employee-statuses`, `encryption-key`, `profile`, `notification-preferences`, `user`, `sanctum/csrf-cookie`, `customers/provision`. Every other path under `/api/ticketing/customer/` and `/api/customer/` (including `login`, `auth/refresh`, `forgot-password`, `reset-password`, `first-login/*`, `change-password`, and any route added later) returns 404. Matching is case insensitive and ignores a trailing slash.
- **AC-4**: On the customer origin, `/api/` forwards only an allowlist: `/api/ticketing/customer/`, `/api/ticketing/ticket/`, `/api/ticketing/attachment/`, `/api/ticketing/messaging/`, `/api/ticketing/ai/`, `/api/ticketing/configuration/`, `/api/ticketing/analytics/`, and `/storage/`. Anything else returns 404, including `/api/ticketing/employee/`, `/api/ticketing/notification/`, any path containing `/internal/`, and `/api/ticketing/customer/customers/provision`. Uploads up to 30M are accepted, matching the gateway.
- **AC-5**: Customers and employees still work on the same records. A ticket a customer creates on the customer origin appears in the CS incoming queue on the employee portal. A staff status change or reply is visible to that customer. Chat messages and attachments flow both ways.
- **AC-6**: A customer token issued by customer-service is accepted on the customer origin by customer, ticket, attachment, messaging, AI, analytics and configuration services. It stays valid after customer-service restarts, because every service verifies with one shared Passport public key. Staff central JWT verification is unchanged.
- **AC-7**: A user with a customer session who opens the employee portal is redirected to `CUSTOMER_PORTAL_URL`. A staff account on the customer origin sees "This account can't be used here" with a Log Out button that stays on the customer origin.
- **AC-8**: `POST /api/ticketing/customer/customers/provision` requires an `X-Internal-Secret` header that matches `INTERNAL_SERVICE_SECRET`, compared in constant time. A missing or wrong header returns 401. If the server secret is empty, the route refuses every request with 503 (fail closed).
- **AC-9**: The customer origin forwards no cookies upstream except `refresh_token` on the customer-service route, so central SSO cookies (`access_token`, `is_authenticated`) can never authenticate a request made through the customer portal.
- **AC-10**: `customer-ticketing-web` is declared in `capstone-azure-infra/infra/modules/ticketing.bicep` with: 0.25 vCPU, 0.5Gi, `minReplicas` from the module param, external ingress on 5005, the GHCR registry wiring, the 7 service URL env vars, a custom domain when a hostname param is set, and outputs `customerPortalFqdn` from the module and from `apps.bicep`. `deploy.ps1` prints and saves it. `az bicep build` passes for `main.bicep`, `apps.bicep` and `modules/ticketing.bicep` with 0 errors and 0 diagnostics.
- **AC-11**: A push to `main` builds and rolls every ticketing app, including `customer-ticketing-web`, using repo level OIDC with a managed identity in the ticketing subscription. The Azure login and roll steps fail the job when they fail (no `continue-on-error`).
- **AC-12**: Local development is unchanged. In Docker Compose, the customer portal runs on 5006 and the employee portal on 5005, customer login works locally, and the port fallback (5005 to 5006) works when `VITE_CUSTOMER_PORTAL_URL` is empty.
- **AC-13**: When `TICKETING_EDGE_ENFORCE=true`, every service's `AuthenticateSubsystem` refuses a customer (Passport) token on a request marked `X-Ticketing-Edge: staff` and returns 401. A staff central JWT on the same request still works. The gateway sets `staff` and the customer edge sets `customer` on every request they forward, overwriting any value a client sends. With the flag unset (local default), behavior is unchanged.
- **AC-14**: The employee build does not show customer password flows to staff: the Profile security card (change password) and the forced change password modal are hidden when `VITE_APP_MODE` is not `customer`, and session revalidation does not call `auth/refresh` outside customer mode.

## Decision

**Chosen option**: Option 1: Customer edge in the customer web container, plus an allowlist and a staff traffic mark on the shared gateway.

The customer web container's nginx becomes the customer edge (the only door customers use), proxying an allowlist straight to the internal services. The shared `ticketing-gateway`, which `auth-proxy` forwards to, exposes only the customer-service routes staff need and marks its traffic as staff, so services refuse customer tokens arriving that way. The app is defined in `ticketing.bicep`, customer tokens use one shared Passport keypair from Container App secrets, and CI logs in to the ticketing subscription with a managed identity.

**Implementation skills**: `react-frontend` (`.claude/skills/react-frontend/`) · `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `docker-runbook` (`.claude/skills/docker-runbook/`) · `api-testing` (`.claude/skills/api-testing/`) · `security-audit` (`.claude/skills/security-audit/`)

## Feature design

**Request flow** (who talks to whom after this change):

```
EMPLOYEE                                   CUSTOMER
browser                                    browser
  |                                          |
  v                                          v
auth-proxy  (central auth front door)      customer-ticketing-web  (support.sbsi.tech)
  |  /            -> auth-web / auth-api     |  /        -> customer SPA (VITE_APP_MODE=customer)
  |  /ticketing/  -> ticketing-web           |  /api/... -> ALLOWLIST ONLY
  |  /api/ticketing/ -> ticketing-gateway    |     sets X-Ticketing-Edge: customer
  v                                          |     forwards only the refresh_token cookie
ticketing-gateway                            |
  |  customer-service: staff allowlist only  |
  |  sets X-Ticketing-Edge: staff            |
  v                                          v
+------------------------------------------------------------------+
| internal services (external: false, same capstone-env)            |
| customer, ticket, attachment, messaging, ai, configuration,       |
| analytics, employee, notification   ->  shared ticketing_prod DB  |
| AuthenticateSubsystem: staff mark + Passport token -> 401         |
+------------------------------------------------------------------+
Staff identity: central JWT (AUTH_PUBLIC_KEY).  Customer identity: Passport token (shared PASSPORT_PUBLIC_KEY).
```

**Data model sketch**: no schema change. Customers stay in customer-service `clients` / `clients_credentials`. Passport tokens stay in the shared `oauth_access_tokens` table in `ticketing_prod`.

**State transitions**: none.

**API surface** (edge and gateway routing, no new application endpoints):

| Route (as the browser sees it) | Customer origin | ticketing-gateway (behind auth-proxy) | Auth |
|---|---|---|---|
| `/api/ticketing/customer/{login,auth/refresh,forgot-password,forgot-password/verify,reset-password,first-login/*,change-password}` | forward | **404** | as today |
| `/api/ticketing/customer/{me,logout,heartbeat,employee-statuses,encryption-key,profile,notification-preferences,user,sanctum/csrf-cookie}` | forward | forward | as today |
| `/api/ticketing/customer/customers/provision` | **404** | forward | `X-Internal-Secret` (401 / 503) |
| any other `/api/ticketing/customer/*` (today or future) | forward | **404** | as today |
| `/api/ticketing/{ticket,attachment,messaging,ai,configuration,analytics}/*`, `/storage/*` | forward (except `/internal/`) | forward | as today; customer token refused on gateway traffic when enforced |
| `/api/ticketing/{employee,notification}/*` | **404** | forward | as today |
| any path containing `/internal/` | **404** | as today | n/a |
| any other `/api/*` | **404** | as today | n/a |

**Value sourcing**:

| Action | Value produced / used | Source |
|---|---|---|
| Customer edge proxy | internal service base URLs | env `CUSTOMER_SERVICE_URL`, `TICKET_SERVICE_URL`, `ATTACHMENT_SERVICE_URL`, `MESSAGING_SERVICE_URL`, `AI_SERVICE_URL`, `CONFIGURATION_SERVICE_URL`, `ANALYTICS_SERVICE_URL`. Azure: set from Bicep `http://${<svc>.properties.configuration.ingress.fqdn}`. Default: Dockerfile `ENV` with the Compose names (`http://<svc>:8000`), so local Compose works and nginx never starts with an unsubstituted value |
| Customer edge routing table | which template nginx loads | Dockerfile stage 2 declares `ARG VITE_APP_MODE` again, copies both templates, and a `RUN` step places `nginx.customer.template.conf` in `/etc/nginx/templates/` when the value is `customer`, otherwise the existing `nginx.template.conf` |
| Customer edge proxy | `proxy_pass` target | literal env URL (no nginx variables), so the Docker only `resolver 127.0.0.11` is not needed and is not copied into the customer template |
| Traffic mark | `X-Ticketing-Edge` value | fixed per nginx: `staff` in every gateway location, `customer` in every customer edge location (`proxy_set_header` overwrites a client value) |
| Mark enforcement switch | `TICKETING_EDGE_ENFORCE` | Bicep `commonEnv` sets `true` in Azure; unset locally (default false) |
| Customer refresh cookie | cookie forwarded to customer-service | `proxy_set_header Cookie "refresh_token=$cookie_refresh_token"` on the customer location only; no Cookie header on other locations |
| Employee redirect to customer portal | `VITE_CUSTOMER_PORTAL_URL` | GitHub repo variable `CUSTOMER_PORTAL_URL` (set; switches to `https://support.sbsi.tech` after the bind) |
| Customer token signing | private key | `secrets.prod.json` → `apps.bicep` `@secure() param passportPrivateKey string = ''` → `ticketing.bicep` per app secret `passport-private-key` on customer-service only → env `PASSPORT_PRIVATE_KEY` |
| Customer token verification | public key | `apps.bicep` `@secure() param passportPublicKey string = ''` → `commonSecrets` `passport-public-key` → `commonEnv` `PASSPORT_PUBLIC_KEY` (all 9 services; the 7 Passport services use it, employee and notification ignore it) |
| Provision guard | expected secret | env `INTERNAL_SERVICE_SECRET` (secret `internal-encryption-key`, already in `commonEnv`), read through `config('services.internal.secret')` |
| Customer portal image | image reference | `apps.bicep`: `${imgPrefix}customer-ticketing-web:${ticketingImageTag}`. `ticketingImageTag` must be bumped to a commit SHA CI built with the customer job before the first deploy |
| Custom domain | hostname, certificate id | `config/deploy.config.json` `subgroups.ticketing.customerPortalHostname` / `customerPortalCertificateId` → new `$allParams` lines in `deploy.ps1` → `apps.bicep` params → `ticketing.bicep`. Certificate id format: `<managedEnvironmentId>/managedCertificates/<name>` from the first `az containerapp hostname bind` |
| Custom domain | DNS TXT value | the managed environment's `customDomainConfiguration.customDomainVerificationId` (`az containerapp env show`) |
| Customer portal address | FQDN after deploy | `apps.bicep` output `customerPortalFqdn`, which `deploy.ps1` prints and saves as `subgroups.ticketing.customerPortalUrl` |
| CI login | client, tenant, subscription ids | repo level secrets `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` for the managed identity (override the org secrets) |

**Key invariants**:
- The customer portal is never routed through `auth-proxy`, and `auth-proxy` never gains a route to `customer-ticketing-web`.
- Customer credential routes exist only on the customer origin. The gateway is an allowlist for customer-service, so a new customer route stays closed on the central domain by default.
- With enforcement on, a customer token is only ever accepted on traffic marked `customer`.
- Both nginx configs copy the gateway location blocks verbatim (headers, the configuration service `(?:api/)?` prefix, the analytics `Connection close` quirk, `client_max_body_size 30M`) and only add the mark, the allowlists and the cookie rule.
- Gateway customer-service rules are case insensitive (`~*`), accept an optional trailing slash, and sit before the general customer location (the first matching regex wins). nginx `merge_slashes` stays on.
- Only customer-service holds the Passport private key.
- No service reads another service's tables directly (invariant 3 in `AGENTS.md`).

**Security model**:
- Customers: authenticate only at customer-service through the customer origin, and use their token only there. Customer accounts exist only in `clients`. Central auth has no customer accounts, and its sync stays pull only for staff roles.
- Staff: authenticate only through central SSO. customer-service keeps rejecting `mode=employee`.
- Internal callers: `customers/provision` only with `X-Internal-Secret`. It is not exposed on the customer origin.
- Ingress: internal services stay `external: false`. Only `customer-ticketing-web`, `ticketing-web` and `ticketing-gateway` are public.

**Configuration required**:
- `PASSPORT_PRIVATE_KEY`: customer-service only (per app secret `passport-private-key`)
- `PASSPORT_PUBLIC_KEY`: all ticketing services via `commonEnv` (secret `passport-public-key`)
- `TICKETING_EDGE_ENFORCE`: `true` in Azure `commonEnv`; unset locally
- `CUSTOMER_SERVICE_URL`, `TICKET_SERVICE_URL`, `ATTACHMENT_SERVICE_URL`, `MESSAGING_SERVICE_URL`, `AI_SERVICE_URL`, `CONFIGURATION_SERVICE_URL`, `ANALYTICS_SERVICE_URL`: on `customer-ticketing-web`
- `apps.bicep` params: `passportPrivateKey` (secure), `passportPublicKey` (secure), `customerPortalHostname`, `customerPortalCertificateId`; matching keys in `secrets.example.json` (keys) and `deploy.config.json` (hostname, cert id)
- GitHub: repo variable `CUSTOMER_PORTAL_URL`; repo secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- `.env.example` in each Passport service: document `PASSPORT_PUBLIC_KEY` (customer-service also `PASSPORT_PRIVATE_KEY`, `INTERNAL_SERVICE_SECRET`) and `TICKETING_EDGE_ENFORCE`

**Critical test scenarios**:
- Happy path: a customer signs in on the customer origin, creates a ticket with an attachment, and chats. A CS agent sees it in the incoming queue on the employee portal and replies, and the customer sees the reply. Verifies **AC-1**, **AC-5**, **AC-6**.
- Central domain refusal: `POST https://<auth-proxy-host>/api/ticketing/customer/login` (also `/Login`, `/login/`, and the gateway FQDN directly) returns 404. `GET .../customer/me` with a staff JWT still works. Verifies **AC-3**.
- Token on the wrong door: a customer token sent to `https://<auth-proxy-host>/api/ticketing/ticket/...` returns 401, and a forged `X-Ticketing-Edge: customer` header changes nothing. Verifies **AC-13**.
- Edge allowlist: `GET <customer origin>/api/ticketing/employee/departments`, `POST .../customer/customers/provision` and `.../ticket/internal/...` return 404. A 20M attachment upload succeeds. Verifies **AC-4**.
- Restart survival: restart customer-service, then reuse the old customer token against ticket-service on the customer origin, which returns 200. Verifies **AC-6**.
- Provision guard: no header returns 401, wrong header returns 401, right header returns 201, empty server secret returns 503. Verifies **AC-8**.
- Cookie allowlist (crafted request, since a browser never sends a host scoped central cookie to another site): a request to the customer origin with a valid staff `access_token` cookie and no bearer token gets 401 on `/me`. A customer page reload restores the session through `refresh_token`. Verifies **AC-9**.
- Wrong door UI: a customer session on the employee portal redirects to `CUSTOMER_PORTAL_URL`. A staff session on the customer origin shows the screen with no employee link. Staff Profile shows no change password card. Verifies **AC-7**, **AC-2**, **AC-14**.
- Local: Compose customer login on 5006 and employee on 5005 both work with enforcement unset. Verifies **AC-12**.

## Build plan

Build approach: none recorded in `AGENTS.md`, so this plan uses end to end slices (Tracer Bullet). Slice 1 gets a real customer reaching staff through the new address. Slice 2 seals the central domain. Slice 3 adds the vanity domain and automatic deploys.

**Slice 1: customer portal live end to end on the Azure default address**
1. Land PR #126 (customer build job, `VITE_CUSTOMER_PORTAL_URL` build arg, login forced to customer mode, wrong portal screen without employee link, tests), satisfies **AC-2**, **AC-7**, **AC-12**
2. [x] Add `frontend/web/nginx.customer.template.conf`: allowlisted locations copied verbatim from `nginx.gateway.conf.template` with literal `${*_SERVICE_URL}` targets, `client_max_body_size 30M`, `X-Ticketing-Edge customer`, `/internal/` and everything else under `/api/` returning 404, and the SPA fallback for `/`. In `frontend/web/Dockerfile` stage 2, declare `ARG VITE_APP_MODE` again, copy both templates, select one with `RUN`, and add `ENV` defaults for the 7 service URLs, satisfies **AC-2**, **AC-4**, **AC-12**
3. [x] In the customer template, send `Cookie: refresh_token=$cookie_refresh_token` on the customer location and no Cookie header elsewhere, satisfies **AC-9**
4. [~] (Bicep, deploy.ps1 and config done on capstone-azure-infra branch feat/ticketing-customer-portal, not committed; PR not opened) In `capstone-azure-infra`: add the `customerPortal` resource to `ticketing.bicep` (sizing, ingress, `registries: registryConfig`, `secrets: registrySecret`, env, `customDomains: empty(hostname) ? [] : [{ name, certificateId, bindingType: empty(certId) ? 'Disabled' : 'SniEnabled' }]`) with params `customerPortalImage`, `customerPortalHostname`, `customerPortalCertificateId` and output `customerPortalFqdn`. In `apps.bicep`, pass the image (`${imgPrefix}customer-ticketing-web:${ticketingImageTag}`) and params, and output `customerPortalFqdn`. In `deploy.ps1`, feed hostname and cert id from `deploy.config.json` and print and save the FQDN. Run the `az bicep build` gate. Open the PR to `capstone-azure-infra`, satisfies **AC-1**, **AC-10**
5. [~] (Bicep done; keypair generation is the human step still open) Shared Passport keys: `apps.bicep` secure params `passportPrivateKey` / `passportPublicKey` passed into `ticketing.bicep`. Put `passport-public-key` in `commonSecrets` and `PASSPORT_PUBLIC_KEY` in `commonEnv`, and add a per app secret plus env `PASSPORT_PRIVATE_KEY` on customer-service only. Add both keys to `secrets.example.json`. The engineer generates the keypair and puts it in `secrets.prod.json` (a human step), satisfies **AC-6**
6. Deploy the ticketing module to the ticketing subscription (`scripts/deploy.ps1 -Module ticketing`, with `ticketingImageTag` bumped to a CI built SHA). Run the happy path and restart scenarios on the Azure default address, satisfies **AC-1**, **AC-5**, **AC-6**

**Slice 2: seal the central domain**
7. [x] In `nginx.gateway.conf.template` and the local `nginx.gateway.conf`: add `proxy_set_header X-Ticketing-Edge staff` to every location, and replace the single customer location with a `~*` staff allowlist location (optional trailing slash) placed first, plus a catch all that returns 404 for the rest of `customer/`. In `nginx.prod.conf`, apply the same allowlist and staff mark to the employee server block, and give the `support.*` block the customer edge allowlist (adding the missing `ticket/` and `configuration/` locations) with the customer mark, satisfies **AC-3**, **AC-12**, **AC-13**
8. [x] customer-service: add `VerifyInternalSecret` middleware (alias `internal.secret`, `hash_equals`, 401 on missing or wrong, 503 when `services.internal.secret` is empty). Apply it to `POST /customers/provision`. Add feature tests for the four cases, satisfies **AC-8**
9. [x] In each service's `AuthenticateSubsystem` (customer, ticket, attachment, messaging, AI, analytics, configuration, employee), skip the Passport fallback and return 401 when `config('services.edge.enforce')` is true and `X-Ticketing-Edge` is `staff`. Add `TICKETING_EDGE_ENFORCE` to `commonEnv` (`true`) and each `.env.example`. Add a feature test in ticket-service and customer-service, satisfies **AC-13**, **AC-12**
10. [x] Frontend: hide the Profile security card and the forced change password modal when not in customer mode, and skip `auth/refresh` in session revalidation outside customer mode. Add vitest coverage, satisfies **AC-14**
11. [x] Isolation smoke script `scripts/smoke/customer-isolation.sh` (a curl matrix of AC-3, AC-4, AC-8, AC-9 and AC-13 against the customer origin, `auth-proxy` and the gateway FQDN). It exits with a nonzero code on any mismatch, satisfies **AC-3**, **AC-4**, **AC-8**, **AC-9**, **AC-13**

**Slice 3: own domain and automatic deploys**
12. Human step: add DNS at get.tech, `CNAME support → <customerPortalFqdn>` and `TXT asuid.support → <customDomainVerificationId>`. Then run `az containerapp hostname add` and `hostname bind --validation-method CNAME` for `support.sbsi.tech`. Put the hostname and cert id in `deploy.config.json` so redeploys keep it. Set repo variable `CUSTOMER_PORTAL_URL=https://support.sbsi.tech` and redeploy `ticketing-web`, satisfies **AC-1**, **AC-7**
13. Human step: create a user assigned managed identity in the ticketing subscription with Contributor on `rg-capstone`, plus a federated credential for this repo's `main` branch (the subject GitHub actually sends, `repo:Scientific-Biotech-Specialties-Inc@351859334/ticketing@1235299146:ref:refs/heads/main`). Set the three repo level `AZURE_*` secrets, satisfies **AC-11**
14. In `.github/workflows/deploy.yml`, remove `continue-on-error` from every Azure login and roll step, and check that a push to `main` rolls all apps. This only happens after task 13, satisfies **AC-11**

## Migration plan

**Strategy**: strangler (the new door opens before the old one closes).
**Phases**:
1. Slice 1 goes live. Customers can use the new address, and nothing is closed yet.
2. Slice 2 ships the gateway allowlist and the staff mark, and sets `TICKETING_EDGE_ENFORCE=true`, only after AC-5 passes on the new address.
3. Slice 3 adds the vanity domain and CI. The Azure default address keeps working after the bind.
**Rollback**: Phase 1: delete or scale `customer-ticketing-web` to 0 replicas, with no other app affected. Phase 2: set `TICKETING_EDGE_ENFORCE=false` (an instant revision, no rebuild), or revert the gateway locations and roll `ticketing-gateway`. Then run the smoke script again. Phase 3: remove the hostname binding, set `CUSTOMER_PORTAL_URL` back to the Azure address, and roll `ticketing-web`.
**Risks**: Setting the Passport keys invalidates customer tokens issued before (they already break on every restart today). A staff screen that calls a customer-service route outside the staff allowlist starts getting 404 (the allowlist comes from the employee build's calls, and the smoke script and AC-14 cover it). An external caller of `provision` that doesn't send the secret starts failing (see Follow-up).

## Consequences

**Positive**:
- The central domain can no longer accept a customer login or a customer token, and this is enforced on the server, not only in the browser.
- New customer routes are closed on the central domain by default.
- Customers get a clean, separate address, and a ticketing outage page or redeploy never touches the central auth module.
- Customer tokens finally work across services and survive restarts.
- An account rotation recreates the customer portal from Bicep.

**Negative / tradeoffs**:
- Two allowlists (customer edge, gateway staff list) are kept by hand. A new staff need on customer-service means a gateway change.
- The traffic mark check is copied into 8 services' `AuthenticateSubsystem`.
- The customer web container now carries routing, so a routing fix needs a frontend image rebuild.
- One more public container app counts against the student subscription quota (0.25 vCPU at peak, scales to zero).
- Passport key rotation logs out every customer.
- Several steps need a human: DNS, hostname bind, the managed identity, and generating keys.

**Neutral**:
- `ticketing-gateway` stays the single door for staff traffic.
- The local Compose files gain the gateway allowlist, the staff mark and a complete `support.*` block. Enforcement stays off locally, so local login flows behave as today.

## Follow-up

- [ ] Ask the CMS (CRMS) team whether anything calls `customers/provision`. If so, it must send `X-Internal-Secret` before slice 2 ships.
- [ ] Tell @Zanti00: never add a route to `customer-ticketing-web` on `auth-proxy`, and keep central SSO cookies host scoped (no `Domain=.sbsi.tech`) if the central module moves under `sbsi.tech`.
- [ ] `analytics-service` runs `:latest` in Azure. Pin it to a commit SHA in the next roll.
- [ ] The gateway also exposes `/internal/` service routes and the unauthenticated `tickets/check-sla-alerts` today, and messaging compares its internal secret with `!==`. This isn't caused by this change, but it should be closed in a separate spec.

## Rationale

Reasoning, options and the infrastructure facts behind this decision: see [rationale.md](rationale.md).
