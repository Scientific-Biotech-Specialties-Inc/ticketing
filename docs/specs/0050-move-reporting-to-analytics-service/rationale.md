# 0050. Rationale: Move Reporting and Forecasts to analytics-service

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: this move changes who owns the reporting *code*, not who the reports depend on at runtime. Because analytics-service will read ticket tables directly, it stays tied to ticket-service's schema; a ticket migration can still break a report. The real wins are a smaller ticket-service, a single owner for metric rules, and forecast code living next to the forecast tables. If the goal were independent deploys or independent databases, this would be the wrong decision, but you have intentionally kept one shared database (spec 0026), so code ownership is the right goal.

The platform runs nine Laravel services on one shared MySQL database, governed by spec 0026's table ownership matrix. ticket-service has grown into the system's center of gravity: about 28,700 lines of app code, 167 routes, 26 controllers, 70 migrations. About 6,000 of those lines are reporting: admin reports and exports, employee and department performance, predictive insights, forecasts, and the ETL sync. analytics-service, created for reporting, has 12 routes covering feedback CRUD and one CSAT stats call.

The split causes concrete problems:
- **Ownership drift.** Spec 0026 assigns `branch_ticket_forecasts` to analytics-service, and analytics-service's migration creates it and `forecast_job_runs` and `branch_recurring_issue_trends`. Yet ticket-service holds the models, the service and the scheduled command that write them.
- **Cross service calls on the request path.** ticket-service calls analytics-service over HTTP for CSAT on every report and dashboard load. Specs 0025 and 0031 both had to fix timeouts on that call.
- **Blast radius.** A change to a report lives in the same 2,460 line `TicketDashboardService` as the customer and CS queues, so report work risks breaking live ticket handling.

Constraints: the shared database stays (intentional, spec 0026); the gateway already routes `/api/ticketing/analytics/*` to analytics-service in every Nginx config; analytics-service runs `artisan serve` with 4 workers and has no scheduler or queue container; CI runs no PHP tests. The Admin dashboard, which stays in ticket-service, embeds performance data computed by code that is moving.

## Options considered

### Option 1: Fix in place

Leave reporting in ticket-service; split `TicketDashboardService` into smaller classes and fix the forecast ownership by moving the migrations to ticket-service instead.

**Pros**:
- No cross service changes, no frontend changes, no new container.

**Cons**:
- ticket-service stays the largest service by far, and analytics-service stays nearly empty, so the nine service split keeps a service with no real job.
- Contradicts 0026's matrix, which gives forecasts to analytics.
- The CSAT HTTP call stays on every report path.

### Option 2: Strangler move to analytics-service with read only DB access (chosen)

Move reporting code to analytics-service in three slices; analytics-service reads ticket tables directly but never writes them; shared rules go into a small package.

**Pros**:
- Each slice is small, verifiable by parity tests, and revertable in one PR.
- Reads stay as fast as today (same SQL, same database).
- CSAT becomes a local query; the forecast code joins its tables.

**Cons**:
- analytics-service is coupled to the ticket schema.
- Needs a new scheduler container and a second shared package.

### Option 3: Move with REST calls for ticket data

analytics-service fetches ticket data from ticket-service over HTTP instead of querying tables.

**Pros**:
- Strict boundary; analytics never sees ticket tables.

**Cons**:
- Reports and exports over thousands of tickets become slow and still load ticket-service, which defeats much of the point.
- ticket-service needs new bulk internal endpoints, adding code to the service being shrunk.

### Option 4: Move with an event fed read model

ticket-service broadcasts ticket changes; analytics keeps its own denormalized copy.

**Pros**:
- Full runtime independence; analytics schema can be shaped for reporting.

**Cons**:
- Much more work: event contract, consumer, backfill, replay for missed events.
- Data becomes eventually consistent, which conflicts with the live "Sync ETL" and fast date filter expectations from specs 0023 and 0025.

## Rationale

Option 2 fits the forces. The shared database is intentional, and spec 0026 already allows analytics to read `tickets`, so direct reads add no new kind of coupling, while keeping today's query performance. Options 3 and 4 buy runtime independence you have chosen not to need, at a cost (slow bulk HTTP, or an event pipeline) far above the benefit. Option 1 keeps the problem: an overloaded ticket-service and an analytics-service with no real job.

Slicing (strangler pattern) matters because `TicketDashboardService` is large and its helpers are shared between moving and staying code. Slices let each move be proven by parity tests against golden output before the old code is deleted. Deleting in the same PR keeps one copy of each rule at all times, the failure 0026 found with drifting middleware copies. For the same reason, rules both services need (branch scope, SLA outcome, technical departments) go in a shared package instead of being copied.

Smaller calls made during design, with the runner up:
- **Admin dashboard performance via a frontend call** (runner up: ticket-service calls analytics). Keeps one owner for the metric logic and no internal call on the request path.
- **New `analytics-scheduler` container** (runner up: scheduler process inside the app container). Matches the existing `ticket-scheduler` pattern; one process per container.
- **Clean single path names** (runner up: mirror old names). Drops the doubled alias routes, and the frontend has to change anyway.
- **Identical responses** (runner up: clean up shapes while moving). Keeps every slice a pure move, so a parity failure means a move bug.
- **Golden file parity through a shared fixture** (runner up: port existing tests). The two services can't be called from one PHPUnit run, so ticket-service captures golden output from a shared fixture before deletion and analytics compares against it.
- **analytics tests on MySQL `analytics_service_test`** (runner up: keep SQLite). The moved queries use MySQL functions; a separate test database keeps it clear of `ticketing_system` and of ticket-service's `ticketing_system_test`.
- **Cache key version bump** (runner up: separate cache prefix per service). Both services share the `laravel_cache_` prefix; bumping moved keys avoids stale reads without changing a prefix that `TechnicalDepartments` and throttling also rely on.
- **Local CSAT rates every ticket, batched 500 IDs per query** (runner up: keep today's cutoff). Decided 2026-11-26, after the slice 0 build found that `CsatSnapshotService` does not chunk: it sorts the IDs and keeps only the lowest 500, so in a scope over 500 tickets the newest ones silently lose their CSAT. The cap existed only because the IDs travel in a GET URL to `csat-stats`; a local query has no such limit, and batching keeps each `whereIn` small. Keeping the cutoff would have preserved byte identical output for every scope, but it copies a silent data loss into new code. The parity fixture has 12 tickets, so the golden files are the same either way; a dedicated test covers the over 500 case. The dashboard KPI card keeps the cap for now (a follow-up), so the two can disagree for very large scopes until then.

## Evidence: code inventory (2026-11-26)

| Moving to analytics-service | Lines | Slice |
|---|---|---|
| `TicketForecastService` + `CalculateTicketForecastsCommand` + 3 models | 667 | 1 |
| `AdminPerformanceService` | 590 | 2 |
| `AssignmentPeriodMetrics` | 308 | 2 |
| `computeEmployeeWorkloads` (from `TicketDashboardService`; feeds `employee_performance` and `workload`) | part of 2,460 | 2 |
| `getAdminReports` and helpers (from `TicketDashboardService`, lines 1849 to end) | about 600 | 3 |
| `ReportExportService` + `ReportExportController` | 304 | 3 |
| `AdminReportController` | 180 | 2, 3 |

| Moving to `packages/ticketing-reporting` | Lines |
|---|---|
| `resolveBranchScope`, `applyBranchTicketFilter` (from `TicketDashboardService`) | about 125 |
| `SlaOutcomeService` | 207 |
| `TechnicalDepartments` | 191 |
| `TicketStatusBuckets` (also used by `SuperAdminDashboardService`) | 27 |
| `ReportPeriod` (also used by the staying `getAdminDashboard`) | 71 |
| `getBranchEmployees` (from `TicketDashboardService`; feeds the staying `active_employees_count`) | small |

Cross check note (2026-11-26): an independent read on another model found that `workload`, `ReportPeriod` and `getBranchEmployees` were also used by code that stays in ticket-service. It also found missing parameter, role, CSAT, cache and test details. All were folded into `index.md`. Two suggestions were declined: keeping old routes as proxies for one release (it brings back the double proxy pattern 0026 removed), and a read only MySQL user (the engineer chose a guard test, which was widened instead).

Staying in ticket-service: `CsatSnapshotService` (dashboard KPI), customer, CS, manager, employee, SuperAdmin system dashboards, `TicketLimitService`, `SLAService` (injected into `AdminPerformanceService` but never called there).

Frontend callers to repoint: `services/ticketService.js` (report preview, export, employees, departments, predictive insights, ETL), `services/dashboardAnalyticsService.js` (departments), `utils/reportExportUtils.js` (predictive insights), `pages/AdminDashboard.jsx` (performance keys).
