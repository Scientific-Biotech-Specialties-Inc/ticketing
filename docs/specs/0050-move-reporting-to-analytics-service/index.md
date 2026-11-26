# 0050. Move Reporting and Forecasts From ticket-service to analytics-service

**Date**: 2026-11-26
**Status**: In Progress

## Summary

ticket-service holds about 6,000 lines of reporting code (admin reports, exports, employee and department performance, forecasts, predictive insights, the ETL sync), while analytics-service, built for exactly this, only handles feedback. This spec moves that reporting code into analytics-service in three slices (forecasts, then performance, then reports), each one switching the frontend to new `/api/ticketing/analytics/...` paths and deleting the old ticket-service code in the same pull request. analytics-service reads ticket tables directly but never writes them (read only, as spec 0026 already allows), the JSON responses stay identical, and live work queues (CS, manager, employee, customer dashboards) stay in ticket-service. Nothing in the database schema changes.

## Rationale

Reasoning, options, and the code inventory behind this decision: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a developer, I want reporting code to live in analytics-service, so that ticket-service only handles the ticket lifecycle and a report change can't break ticket handling.
- As an Admin or SuperAdmin, I want reports, exports, performance and forecasts to keep working exactly as today, so that the move is invisible to me.
- As an Admin, I want the rest of my dashboard to keep loading even if analytics-service is down, so that I can still see my live queue numbers.

**Acceptance criteria**:

*Slice 1: forecasts, predictive insights, ETL sync*
- **AC-1**: The models `BranchTicketForecast`, `BranchRecurringIssueTrend`, `ForecastJobRun`, the `TicketForecastService`, and the `CalculateTicketForecastsCommand` live in analytics-service. None of them remain in ticket-service.
- **AC-2**: A new `analytics-scheduler` container (in both `docker-compose.yml` and `docker-compose.prod.yml`) runs the analytics-service scheduler. It runs `tickets:calculate-forecasts --horizon=30` daily at 02:00 (`onOneServer`, `runInBackground`). ticket-service's `Kernel` no longer schedules it. The command keeps the name `tickets:calculate-forecasts`, so `forecast_job_runs.job_name` history stays continuous. Deploy order: ticket-service (schedule entry removed) is redeployed first, and `analytics-scheduler` starts after it, so the job never runs in both places. Do not rely on `onOneServer` for the handoff.
- **AC-3**: `GET /api/ticketing/analytics/insights/predictive` returns JSON identical to today's `GET /api/ticketing/ticket/admin-reports/predictive-insights` for the same user and query parameters.
- **AC-4**: `POST /api/ticketing/analytics/etl/sync` applies the same branch rules as today's `etl/trigger`: SuperAdmin with `full_sync=true`, an empty `branch_id`, or `branch_id=all` recalculates every branch; anyone else recalculates their resolved branch. Horizon is 7 days. It returns the same shape (`status`, `message`, `records_processed`, `duration_ms`, `timestamp`) and clears only analytics-service report caches.
- **AC-5**: After a successful ETL sync, the frontend reloads the Admin dashboard with its existing force refresh option, so the dashboard shows fresh numbers without any service to service call.

*Slice 2: employee and department performance*
- **AC-6**: `GET /api/ticketing/analytics/performance/employees` and `GET /api/ticketing/analytics/performance/departments` return JSON identical to today's `admin-reports/employees` and `admin-reports/departments`.
- **AC-7**: `GET /api/ticketing/analytics/performance/dashboard` returns `{ employee_performance, departments, workload }`, identical to those three keys in today's `admin-dashboard` payload for the same filters. All three depend on the per employee SLA rate from `AdminPerformanceService` (`workload.details[].sla_compliance_rate`, `TicketDashboardService.php:1609`), so they move together. ticket-service's `admin-dashboard` payload no longer contains those three keys. Every other key is unchanged, including `kpis.active_employees_count`, which ticket-service keeps computing through the shared `getBranchEmployees`.
- **AC-8**: `AdminDashboard.jsx` loads `performance/dashboard` as a separate request (5 second timeout) and merges the result into its dashboard state, so `reportExportUtils.js`, `DepartmentPerformanceView.jsx` and the charts read the same `employee_performance`, `departments` and `workload` fields as today. If that request fails, only the employee performance, department performance and workload sections show an error state with a Retry button. The rest of the dashboard renders normally.
- **AC-9**: Inside analytics-service, CSAT for performance and reports comes from a local query on `customer_feedback`, with no HTTP call, reproducing today's `csat-stats` behavior: filter on `customer_feedback.created_at` within `[date_from, date_to]`, then on ticket IDs; per ticket average `round(avg, 2)`; every ticket ID in scope is rated, queried in batches of 500 IDs (one `whereIn` per batch, results merged), with no cap. This deliberately drops today's cutoff, where `CsatSnapshotService` sorts the IDs and keeps only the lowest 500 (a limit that existed only because the IDs travelled in a GET URL). For scopes of 500 tickets or fewer the result is identical to today; `ticket_ratings` keyed by ticket ID as a string. `available` is `true` unless the query throws, in which case it is `false` with a null score (same shape as today's unavailable case). ticket-service keeps `CsatSnapshotService` (and its HTTP call) for the dashboard CSAT KPI cards.

*Slice 3: reports preview and export*
- **AC-10**: `GET /api/ticketing/analytics/reports` returns JSON identical to today's `admin-reports` for all six report types (`ticket_volume`, `sla_compliance`, `department_performance`, `equipment_maintenance`, `csat_satisfaction`, `predictive_risk`).
- **AC-11**: `POST /api/ticketing/analytics/reports/export` returns byte identical CSV and the same XLSX and PDF content, content types and file names as today's export for the same snapshot. It keeps the `throttle:30,1` limit.

*Every slice*
- **AC-12**: Access is unchanged per endpoint, as listed in the *Access per endpoint* table under Security model: the same allowed roles, the same branch rule, and the same 403 messages as today. A request with no valid token gets 401; the 401 body becomes analytics' `Unauthenticated.` (from `auth.subsystem`), which is acceptable because the frontend only checks the status code (confirm in slice 0, task 3).
- **AC-13**: A new shared package `packages/ticketing-reporting` (namespace `Ticketing\Reporting`) provides branch scope resolution and filtering (`BranchScope`), `getBranchEmployees` (`BranchEmployees`), `SlaOutcomeService`, `TechnicalDepartments`, `TicketStatusBuckets` and `ReportPeriod`. Both services use it. No copy of those classes remains in either service.
- **AC-14**: The pull request that switches a slice's frontend calls also deletes that slice's old ticket-service routes (both alias forms), controllers, services, models and tests. Old URLs return 404 after it ships.
- **AC-15**: analytics-service code never writes to a table it does not own. A guard test fails if any file under `analytics-service/app` (a) calls `insert`, `update`, `upsert`, `delete`, `truncate`, `increment` or `decrement` on `DB::table(...)` for a non owned table, (b) runs `DB::statement`, `DB::unprepared`, `DB::insert`, `DB::update` or `DB::delete` with a non owned table name in the SQL, or (c) defines an Eloquent model whose `$table` is a non owned table without marking it read only (a model `saving`/`deleting` hook that throws). Non owned tables are listed in *Key invariants*.
- **AC-16**: Each slice ships with parity tests: a shared fixture is loaded, the old ticket-service endpoint's response is captured as a golden file on the commit **before** that slice's removals, and the analytics test asserts the new endpoint returns the same JSON (and the same CSV bytes). Both capture and comparison freeze time with `Carbon::setTestNow('2026-11-20 10:00:00')` and sort ties by ID. Tests run only on isolated test databases, never on `ticketing_system`; each suite aborts before migrating if the connected database name does not end in `_test`.

## Decision

**Chosen option**: Option 2: Strangler move to analytics-service in three slices, with read only database access.

Reporting code moves to analytics-service one slice at a time; analytics-service reads ticket tables directly but writes only the tables it owns; shared rules move to a small shared package.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `docker-runbook` (`.claude/skills/docker-runbook/`) · `api-testing` (`.claude/skills/api-testing/`)

## Feature design

**Data model sketch** (no schema change; ownership after the move):

| Table | Writer (owner) | analytics-service access | Change |
|---|---|---|---|
| `branch_ticket_forecasts` | analytics-service | read, write | Model moves in from ticket-service (migration already in analytics) |
| `branch_recurring_issue_trends` | analytics-service | read, write | Same |
| `forecast_job_runs` | analytics-service | read, write | Same |
| `customer_feedback` | analytics-service | read, write | None |
| `tickets`, `ticket_statuses`, `ticket_priorities`, `ticket_assignments`, `ticket_assignment_periods` | ticket-service | read only | None |
| `reassignment_requests`, `employees` | employee-service | read only | None |
| `branches`, `machines`, `problem_categories`, `clients` | current owners | read only | None |

**State transitions**: none.

**API surface** (all on analytics-service, reached through the gateway at `/api/ticketing/analytics/...`, which `nginx.conf`, `nginx.prod.conf` and `nginx.gateway.conf.template` already route to `analytics-service:8000/api/...`; no gateway change):

| Endpoint (gateway path) | Laravel route | Method | Key inputs | Key outputs | Auth | Key errors | Replaces (ticket-service) |
|---|---|---|---|---|---|---|---|
| `/api/ticketing/analytics/insights/predictive` | `insights/predictive` | GET | `branch_id` / `branch`, `horizon_days` (default 7, same bounds as today), `forceRefresh` / `force_refresh` | same JSON as today | `auth.subsystem`, `no-cache` | 401, 403 | `admin-reports/predictive-insights`, `admin/reports/predictive-insights` |
| `/api/ticketing/analytics/etl/sync` | `etl/sync` | POST | `branch_id` (accepts `all`, `current`, `assigned` as today), `full_sync` | `status`, `message`, `records_processed`, `duration_ms`, `timestamp` | `auth.subsystem`, `no-cache` | 401, 403 | `etl/trigger`, `admin/etl/trigger` |
| `/api/ticketing/analytics/performance/employees` | `performance/employees` | GET | `branch_id` / `branch`, `preset` (aliases `filter`, `period`, `date_range`), `date_from`, `date_to`, `department`, `employee_id`, `forceRefresh` / `force_refresh` | same JSON as today | `auth.subsystem`, `no-cache` | 401, 403 | `admin-reports/employees`, `admin/reports/employees` |
| `/api/ticketing/analytics/performance/departments` | `performance/departments` | GET | same as employees minus `department`, `employee_id`; plus `sort_by` (default `total_tickets`), `sort_dir` (default `desc`) | same JSON as today | `auth.subsystem`, `no-cache` | 401, 403 | `admin-reports/departments`, `admin/reports/departments` |
| `/api/ticketing/analytics/performance/dashboard` | `performance/dashboard` | GET | `branch_id` / `branch`, `preset` (and aliases), `date_from`, `date_to`, `forceRefresh` / `force_refresh` | `employee_performance`, `departments`, `workload` | `auth.subsystem`, `no-cache` | 401, 403 | the three keys removed from `admin-dashboard` |
| `/api/ticketing/analytics/reports` | `reports` | GET | `report_type` (required, one of `REPORT_TYPES`), `branch_id` / `branch`, `preset` (and aliases), `date_from`, `date_to`, `forceRefresh` / `force_refresh`, plus the per type filters the current `getAdminReports` reads | `headers`, `rows`, `summary`, `count` (same as today) | `auth.subsystem`, `no-cache` | 401, 403, 422 (missing or invalid `report_type`; today an empty type falls through to the dashboard, which no longer applies) | `admin-reports`, `admin/reports` |
| `/api/ticketing/analytics/reports/export` | `reports/export` | POST | `format` (`csv`, `xlsx`, `pdf`), same inputs as `reports` | file download, same content type and file name as today | `auth.subsystem`, `no-cache`, `throttle:30,1` | 401, 403, 422, 429 | `admin/reports/export`, `admin-reports/export` |

Register each route once (no alias forms) inside analytics-service's existing `auth.subsystem` group. The input lists above are the known set; before moving each endpoint, diff it against every `$request->input(...)` / `$filters[...]` read in the current controller and service, and carry over any parameter not listed so the accepted inputs do not change.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Every endpoint | Caller role, branch | Verified token via `auth.subsystem` (`$request->user()->role`, `branch_id`, `branch`) |
| Every endpoint | Effective branch scope | `Ticketing\Reporting` branch scope resolver: token role and branch plus the `branch_id` param, looked up in `branches` (moved unchanged from `TicketDashboardService::resolveBranchScope`) |
| Every endpoint | Date window | `preset` (and aliases), `date_from`, `date_to` params via `ReportPeriod::resolve` (shared package; ticket-service's `getAdminDashboard` uses it too) |
| Performance dashboard, Admin dashboard | Branch employee list, `active_employees_count` | `BranchEmployees` (shared package, moved from `TicketDashboardService::getBranchEmployees`) over `employees` |
| Performance, reports | Technical department list | `TechnicalDepartments` (shared package), reading `config('ticketing.technical_departments')` from env `TICKETING_TECHNICAL_DEPARTMENTS` (new `config/ticketing.php` in analytics with the same key) |
| Performance, reports | SLA met or breached | `SlaOutcomeService` (shared package) over `tickets` columns |
| Performance | Per person assignment stretches, response SLA | `ticket_assignment_periods` via `AssignmentPeriodMetrics` (moves to analytics) |
| Performance | Reassignment rate | `reassignment_requests` (read only) |
| Performance, reports | Employee names and roles | `employees` (read only; kept fresh by ticket-service's `employees:sync-directory`, which stays) |
| Performance, reports | CSAT averages | Local query on `customer_feedback` with the exact `csat-stats` rules in AC-9, replacing the HTTP call |
| Predictive insights, reports | Forecast rows, trends | `branch_ticket_forecasts`, `branch_recurring_issue_trends` |
| ETL sync | `records_processed` | Sum of `records_processed` returned by `TicketForecastService` per branch |
| ETL sync | `duration_ms`, `timestamp` | Measured in the controller, as today |
| Forecast job | Horizon | Command option `--horizon=30` (schedule) or fixed 7 (ETL sync), as today |
| Admin dashboard | Fresh numbers after sync | Frontend calls `admin-dashboard` with its existing force refresh param after `etl/sync` resolves |

**Key invariants**:
- analytics-service writes only `branch_ticket_forecasts`, `branch_recurring_issue_trends`, `forecast_job_runs`, `customer_feedback` and its other own tables. It only reads `tickets`, `ticket_statuses`, `ticket_priorities`, `ticket_assignments`, `ticket_assignment_periods`, `reassignment_requests`, `employees`, `branches`, `machines`, `problem_categories`, `clients` (enforced by the AC-15 test).
- No new migrations in analytics-service touch a table it does not own (spec 0026 matrix).
- Response JSON for every moved endpoint is identical to the old one (AC-3, AC-6, AC-7, AC-10, AC-11). Shape cleanups are out of scope.
- One SLA rule and one branch scope rule exist in the codebase, in `packages/ticketing-reporting` (AC-13).
- Both services share the Redis cache prefix (`APP_NAME=Laravel`), so moved cache keys get a new version: `admin_emp_perf_v3_` → `analytics_emp_perf_v4_`, `admin_dept_perf_v2_` → `analytics_dept_perf_v3_`, `admin_operational_report_v2_` → `analytics_operational_report_v3_`, the predictive insights keys get the `analytics_` prefix plus a version bump, and `performance/dashboard` caches under `analytics_perf_dashboard_v1_` for 120 s. Other TTLs stay as they are (120 s for performance).
- A new analytics `ReportCacheService::clearReportCaches()` clears `*analytics_*` keys with Redis `SCAN` chunking, never `KEYS` (AGENTS.md invariant 6). ETL sync calls it. In the slice that removes them, ticket-service's `TicketCacheService::clearTicketCaches()` drops its now dead `admin_emp_perf_*`, `admin_dept_perf_*` and report patterns.
- Live queues and their services stay in ticket-service: `getCustomerDashboard`, `getCsDashboard`, `getCsIncoming`, `getAdminDashboard` (minus the two moved keys), `ManagerDashboardService`, `EmployeeDashboardService`, `CsDashboardSummaryService`, `SuperAdminDashboardService`, `TicketLimitService`.

**Security model**:
- Role checks and 403 messages are copied verbatim from the current controllers, not rewritten. *Access per endpoint* (confirm each role list and message against the source while moving):

| Endpoint | Allowed roles (normalized lowercase) | Branch rule | Source to copy |
|---|---|---|---|
| `insights/predictive`, `performance/*`, `reports`, `reports/export` | `superadmin`, `super admin`, `admin`, `branch admin`, `branchadmin`, `branch_admin`, `systemadministrator`, `itadmin`, `it admin` | SuperAdmin: any branch or All; others locked to own branch, 403 on another `branch_id` (`validateBranchAccess`) | `AdminReportController`, `TicketDashboardController::adminReports`, `ReportExportController` |
| `etl/sync` | `admin`, `superadmin`, `super admin` | SuperAdmin: any or all; Admin: own branch only (`current` / `assigned` aliases accepted), 403 otherwise | `TicketDashboardController::triggerEtl` |
| `performance/dashboard` | same as `TicketDashboardController::adminDashboard` today | same as `adminDashboard` | `TicketDashboardController::adminDashboard` |

- Tokens are verified by analytics-service's existing `auth.subsystem`, which matches ticket-service's except for an `optional` guest mode these routes don't use. Slice 0 confirms that `$request->user()` in analytics exposes `role`, `branch_id` and `branch` the same way ticket-service's does (both resolve through `Ticketing\Auth`); if a property is missing, fix it in the shared auth package, not in a controller.
- No new PII is exposed. The data and fields returned are the same as today.
- analytics-service still connects to MySQL as `root` (as every service does). Read only access to ticket tables is enforced by the AC-15 test, not by database grants.

**Configuration required**:
- `TICKETING_TECHNICAL_DEPARTMENTS`: add to analytics-service's environment (compose dev and prod, `.env.example`) with the same value ticket-service uses.
- `analytics-scheduler` container: same image, volumes and env as `analytics-service` (including `CACHE_DRIVER=redis`, `REDIS_HOST`, and the same `.env` with its `APP_KEY`), command `php artisan schedule:work`, no port. Add to both compose files.
- Both `ticket-service` and `analytics-service` (and `analytics-scheduler`) mount `./packages/ticketing-reporting:/var/www/packages/ticketing-reporting`, and both `composer.json` files autoload `Ticketing\\Reporting\\` from `packages/ticketing-reporting/src/` and `../../packages/ticketing-reporting/src/` (the same pattern as `ticketing-auth`). Test fixtures and golden files live in `packages/ticketing-reporting/tests/`, which the prod image build excludes (add to `.dockerignore` or copy only `src/`).
- analytics-service `composer.json`: add `barryvdh/laravel-dompdf` `^3.1` (slice 3). The `zip` PHP extension XLSX needs is already in its Dockerfile. Make sure `storage/fonts` exists and is writable in analytics, as dompdf needs it.
- analytics-service `phpunit.xml`: `DB_CONNECTION=mysql`, `DB_DATABASE=analytics_service_test` (forced, both `env` and `server`, as ticket-service does), replacing SQLite in memory, because the moved queries use MySQL functions (`CONCAT`, `DATE()`). Nothing creates test databases today, so add `scripts/create-test-databases.sh` running `CREATE DATABASE IF NOT EXISTS analytics_service_test` (and `ticketing_system_test`) inside the compose `db` container (`docker compose exec db mysql ...`), and note it in the `docker-runbook` skill.
- Frontend: a new `analyticsClient` axios instance in `services/ticketService.js` with `baseURL: '/api/ticketing/analytics'` and the same request and response interceptors (token, refresh, error handling) as `ticketClient`. Every moved call uses it.
- No new secrets.

**Critical test scenarios**:
- Happy path: for each moved endpoint, load the parity fixture, call the analytics endpoint as SuperAdmin with All Branches and as a branch Admin, and assert the JSON equals the golden file captured from ticket-service. Verifies **AC-3**, **AC-6**, **AC-7**, **AC-10**, **AC-16**.
- Export parity: CSV bytes equal the golden file; XLSX opens with the same rows; PDF renders with the same headers and row count. Verifies **AC-11**.
- ETL: SuperAdmin with `full_sync=true` processes every branch; a branch Admin processes only theirs; the response shape matches. Verifies **AC-4**.
- Scheduler: `php artisan schedule:list` in analytics shows `tickets:calculate-forecasts` daily at 02:00, and ticket-service's no longer does. Verifies **AC-2**.
- Auth: an Admin passing another branch's `branch_id` gets 403; an Employee, Manager or customer token gets 403; no token gets 401. Verifies **AC-12**.
- Failure: with analytics-service stopped, the Admin dashboard renders KPIs, status, SLA and trends, and the performance and workload sections show an error with Retry. Verifies **AC-8**.
- CSAT batching: seed 1,201 tickets in scope, each with one feedback row, and call `CsatQuery` (and a performance endpoint over that scope): every ticket gets a rating, including the newest IDs that today's lowest 500 cutoff would drop, and the query runs in 3 batches. With 500 or fewer tickets the ratings equal today's `csat-stats` output. Verifies **AC-9**.
- Read only guard: a deliberate `DB::table('tickets')->update(...)` in analytics app code makes the guard test fail. Verifies **AC-15**.
- Removal: each old ticket-service URL returns 404 after its slice. Verifies **AC-14**.

## Build plan

Build approach: none recorded in `AGENTS.md` or the scope header, so this follows end to end slices (Tracer Bullet style): slice 0 lays the shared ground, then each slice moves backend, frontend and deletion together so it ships and can be reverted as one pull request.

*Slice 0: shared ground (one PR, no behavior change)*
1. Create `packages/ticketing-reporting` with `composer.json` and `src/`: move `resolveBranchScope` and `applyBranchTicketFilter` out of `TicketDashboardService` into a `BranchScope` class and `getBranchEmployees` into `BranchEmployees`; move `SlaOutcomeService`, `TechnicalDepartments`, `TicketStatusBuckets` and `ReportPeriod` in unchanged apart from namespace. Satisfies **AC-13**.
2. Wire the package into ticket-service (composer autoload, compose volume in dev and prod), point every caller at it, and delete the originals. Known callers: `TicketDashboardService`, `AdminPerformanceService`, `TicketForecastService`, `CsDashboardSummaryService`, `ManagerDashboardService` (`TechnicalDepartments`, `SlaOutcomeService`), `SuperAdminDashboardService` (`TicketStatusBuckets`), `SuperAdminConfigController`, and `tests/Unit/ReportPeriodTest.php` (moves into the package's tests). Grep for each class name to catch any others. Run ticket-service's test suite on `ticketing_system_test`. Satisfies **AC-13**.
3. Wire the package into analytics-service; add `config/ticketing.php` and `TICKETING_TECHNICAL_DEPARTMENTS`; register the `no-cache` middleware alias (copy `NoCache`). Confirm `$request->user()` exposes `role`, `branch_id` and `branch`, and that the frontend only checks the 401 status code, not its body. Satisfies **AC-12**, **AC-13**.
4. Add `scripts/create-test-databases.sh`; switch analytics-service `phpunit.xml` to MySQL `analytics_service_test`; add the `_test` database name guard to both services' base `TestCase`; add a parity fixture under `packages/ticketing-reporting/tests/fixtures/` (`schema.sql` for the read only tables, dumped with no data from `ticketing_system_test` and loaded by the analytics test base before analytics' own migrations run, and `parity_seed.sql` with branches, employees, tickets across statuses, priorities and departments, assignment periods, reassignments, feedback); add the read only guard test. Satisfies **AC-15**, **AC-16**.
5. Add the parity helper: a ticket-service test, gated by `PARITY_CAPTURE=1`, that freezes time, loads the fixture and writes each old endpoint's response to `packages/ticketing-reporting/tests/golden/<endpoint>.json` (and `.csv`). Run it with `docker compose exec -e PARITY_CAPTURE=1 ticket-service php artisan test --filter=ParityCapture` on the commit before each slice's removals. Satisfies **AC-16**.

*Slice 1: forecasts, predictive insights, ETL sync (one PR)*
6. Capture golden files for `predictive-insights` with the helper. Satisfies **AC-16**.
7. Move `BranchTicketForecast`, `BranchRecurringIssueTrend`, `ForecastJobRun`, `TicketForecastService` and `CalculateTicketForecastsCommand` to analytics-service; schedule the command in analytics `Kernel` (02:00, `onOneServer`, `runInBackground`, name unchanged); remove it from ticket-service `Kernel`. Satisfies **AC-1**, **AC-2**.
8. Add the `analytics-scheduler` container to both compose files; validate with `docker compose -f docker-compose.prod.yml config`. Document the deploy order (ticket-service first, then `analytics-scheduler`) in the PR description. Satisfies **AC-2**.
9. Add `ReportCacheService` (SCAN based) to analytics. Add `insights/predictive` and `etl/sync` controllers (role checks and messages copied from `AdminReportController::predictiveInsights` and `TicketDashboardController::triggerEtl`); ETL calls `ReportCacheService::clearReportCaches()`. Satisfies **AC-3**, **AC-4**, **AC-12**.
10. Frontend: add `analyticsClient`; point the predictive insights and ETL calls in `ticketService.js` and `reportExportUtils.js` at it; after ETL succeeds, reload the Admin dashboard with `forceRefresh`. Satisfies **AC-3**, **AC-5**.
11. Delete the old ticket-service routes, controller methods and forecast related tests for this slice; add analytics parity and auth tests. Satisfies **AC-14**, **AC-16**, **AC-12**.

*Slice 2: performance (one PR)*
12. Capture golden files for `admin-reports/employees`, `admin-reports/departments`, and the `employee_performance`, `departments` and `workload` keys of `admin-dashboard`. Satisfies **AC-16**.
13. Move `AdminPerformanceService`, `AssignmentPeriodMetrics` and `computeEmployeeWorkloads` (from `TicketDashboardService`) to analytics; add a local `CsatQuery` that follows AC-9 exactly (every ticket ID, batched 500 per `whereIn`, no cap); drop the unused `SLAService` dependency; apply the new cache key names. Satisfies **AC-6**, **AC-7**, **AC-9**.
14. Add `performance/employees`, `performance/departments`, `performance/dashboard` controllers (`performance/dashboard` cached 120 s under `analytics_perf_dashboard_v1_`). Satisfies **AC-6**, **AC-7**, **AC-12**.
15. Remove `employee_performance`, `departments` and `workload` from ticket-service's `getAdminDashboard` payload, and the `AdminPerformanceService` call that fed them; keep `active_employees_count` via `BranchEmployees`, and keep `CsatSnapshotService` for the KPI cards. Prune the dead perf patterns from `TicketCacheService::clearTicketCaches()`. Satisfies **AC-7**, **AC-9**.
16. Frontend: `AdminDashboard.jsx` fetches `performance/dashboard` through `analyticsClient` (5 s timeout) in parallel with `admin-dashboard`, merges the three keys into state, shows a skeleton while loading and an error state with Retry in only the performance and workload sections on failure (per `DESIGN.md`); check `DepartmentPerformanceView.jsx` and `reportExportUtils.js` still read the merged keys; grep the frontend for any other reader of these keys; point `ticketService.js` and `dashboardAnalyticsService.js` performance calls at `analyticsClient`. Satisfies **AC-6**, **AC-8**.
17. Delete the old routes and `AdminReportController` performance methods. Retarget or move tests: `AdminMetricsAccuracyTest`, `DynamicAdminDepartmentsTest` and `EmployeeAssignmentPeriodsTest` (performance assertions move to analytics, any dashboard assertions stay and drop the removed keys); performance parts of `AdminReportsTest`. Add parity and auth tests. Satisfies **AC-14**, **AC-16**, **AC-12**.

*Slice 3: reports preview and export (one PR)*
18. Capture golden files for every `report_type` of `admin-reports` and for CSV export. Satisfies **AC-16**.
19. Add `barryvdh/laravel-dompdf` to analytics; move `getAdminReports` (and its private helpers) out of `TicketDashboardService` into an analytics `AdminReportService`, move `ReportExportService`, using the local CSAT query. Satisfies **AC-10**, **AC-11**, **AC-9**.
20. Add `reports` and `reports/export` controllers (export keeps `throttle:30,1`; a missing or invalid `report_type` returns 422). Check whether export file names or CSV headers include `now()`; the frozen test time keeps parity stable. Satisfies **AC-10**, **AC-11**, **AC-12**.
21. Frontend: point the report preview and export calls in `ticketService.js` at `analyticsClient`. Satisfies **AC-10**, **AC-11**.
22. Delete the old routes, `ReportExportController`, `AdminReportController` (now empty), `getAdminReports`, the `barryvdh/laravel-dompdf` dependency in ticket-service if nothing else uses it, and the old tests (`AdminReportsTest`, `ReportExportControllerTest`, `tests/Unit/ReportExportServiceTest.php`, which moves to analytics); prune the dead report pattern from `clearTicketCaches()`; add parity and auth tests. Satisfies **AC-14**, **AC-16**, **AC-12**.

## Migration plan

**Strategy**: strangler, one slice per pull request. Each slice adds the analytics endpoint, switches the frontend, and deletes the old code together.

**Phases**:
1. Slice 0: shared package and test ground. No behavior change; ticket-service tests must pass unchanged.
2. Slice 1: forecasts. The schedule moves in the same PR. Deploy ticket-service (and `ticket-scheduler`) first so the old entry is gone, then start `analytics-scheduler`. Don't count on the `onOneServer` lock for the handoff, because its mutex key isn't guaranteed to match across the two apps.
3. Slice 2: performance, including the Admin dashboard split (`employee_performance`, `departments`, `workload`).
4. Slice 3: reports and export.

**Rollback**: revert the slice's pull request. Backend, frontend and deletion are in one commit range, and no data or schema changed, so a revert fully restores the previous behavior. For slice 1, the revert also restores the schedule in ticket-service.

**Risks**:
- Hidden coupling inside the 2,460 line `TicketDashboardService`: a private helper used by both a moving and a staying method. Mitigation: move by call graph, and if a helper is needed on both sides, put it in the shared package rather than copying it.
- The ticket schema changes later and breaks analytics queries silently. Mitigation: the parity fixture's `schema.sql` is dumped from ticket-service migrations, and any ticket-service migration touching a read only table should refresh it (see Follow-up).
- Prod and Azure need the new `analytics-scheduler` container and package mount; until they have them, forecasts stop refreshing in that environment.

## Consequences

**Positive**:
- ticket-service loses about 6,000 lines and 12 routes (6 endpoints, each with two aliases), and stops making the CSAT HTTP call on report paths.
- analytics-service gets a real job, owns the forecast code that matches the forecast tables 0026 already gave it, and computes CSAT locally.
- One SLA rule and one branch scope rule, in one package.

**Negative / tradeoffs**:
- analytics-service is now tied to ticket-service's table layout. A ticket schema change can break reports, and only the parity tests catch it.
- A new container (`analytics-scheduler`) to run in dev, prod and Azure.
- The Admin dashboard now makes two requests, and its performance and workload sections have their own loading and error states.
- Old URLs return 404 right after each deploy, so an open browser tab with the old bundle shows errors until the page is reloaded.
- The 401 response body on moved endpoints changes from `Unauthorized` to `Unauthenticated.` (status code unchanged).
- Read only access is enforced by a test, not by database permissions.
- analytics-service tests move from SQLite in memory to MySQL, so they need the database container to run.
- For scopes over 500 tickets (for example SuperAdmin, All Branches, Last 90 Days), performance and report CSAT now cover every ticket instead of only the oldest 500, so those numbers change after slice 2 and slice 3 ship. This is a correction, not a regression. Until the follow-up below lands, the Admin dashboard CSAT KPI card (still in ticket-service, still capped) can disagree with the performance and report CSAT for such scopes.

**Neutral**:
- No schema change. The unused analytics tables and the `predictive-metrics` route stay as they are.
- The old `/api/ticketing/ticket/admin-reports...` and `etl/trigger` URLs stop working; only the frontend calls them today.

## Follow-up

- [ ] Update the Azure deployment in `capstone-azure-infra` with the `analytics-scheduler` container, the `ticketing-reporting` package mount, and `TICKETING_TECHNICAL_DEPARTMENTS` for analytics-service. That repo is edited locally only, never pushed from here.
- [ ] Decide what to do with the unused analytics-service code: the `predictive-metrics` route and its 6 tables (`employee_performance_analytics`, `equipment_risk_analytics`, `escalation_risk_snapshots`, `recurring_issue_analytics`, `root_cause_analytics`, `ticket_volume_snapshots`), plus 4 tables nothing references (`analytics_employee_performances`, `analytics_equipment_reports`, `analytics_sla_metrics`, `daily_employee_performance`).
- [ ] **Before `/develop` starts:** `AGENTS.md` invariant 3 ("do not query another microservice's database tables directly") conflicts with the read only access spec 0026 allows and this spec uses. Reword it to "never write another service's tables; read only aggregate reads are allowed where the ownership matrix says so" (owned by `/sync`).
- [ ] `.claude/rules/70-commits-pull-requests.md` names `.github/workflows/laravel.yml` as a required check, but CI (`ci.yml`) runs no PHP tests. Parity tests therefore run locally in Docker until a PHP test job exists.
- [ ] Add a note to the `laravel-microservice` skill or ticket-service `AGENTS.md`: a migration that changes a table analytics reads should refresh `packages/ticketing-reporting/tests/fixtures/schema.sql`.
- [ ] Lift the same 500 ID cutoff from ticket-service's `CsatSnapshotService` (the Admin dashboard CSAT KPI card), for example by sending ticket IDs in a POST body or batching within its 500 ms budget, so the KPI card and the performance and report CSAT agree for scopes over 500 tickets. Needs its own small decision (`/architect`), since the budget and caching rules change.
- [ ] No scope row tracks this work. Consider enrolling it in `docs/scope/` with `/scope` if you want it tracked there.
