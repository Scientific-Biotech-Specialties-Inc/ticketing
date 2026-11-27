# Database Cleanup Plan

All services share one MySQL database, `ticketing_system` (chat messages live in MongoDB).
This is intentional: the cleanup reduces duplication and dead weight inside the shared
database. It does not split tables into per-service databases.

Inventory taken 2026-11-24 from the local `capstone-db` container (read-only
`information_schema` queries). Row counts are local dev data, not production.

## Inventory summary

| Metric | Value |
|---|---|
| Tables in `ticketing_system` | 75 (including `migrations`) |
| Tables with 0 rows (InnoDB estimate) | 30 |
| Widest table | `tickets`: 45 columns, 32 indexes |
| `Schema::create` calls for a table name that is created more than once | 50 |

## Findings

| # | Finding | Detail |
|---|---|---|
| 1 | Laravel boilerplate tables duplicated | `failed_jobs`, `password_reset_tokens`, `personal_access_tokens` are created by 7 services, `users` by 5 |
| 2 | Auth tables duplicated | `oauth_*`, `clients_credentials`, `refresh_tokens`, `password_reset_otps` created by both customer-service and messaging-service |
| 3 | Attachment tables duplicated | `proof_of_completion`, `ticket_attachments` created by both ticket-service and attachment-service |
| 4 | One shared `migrations` table | When two services ship a migration with the same file name, only the first service to migrate is recorded; the other file is skipped |
| 5 | Tables with no code references and 0 rows | `analytics_employee_performances`, `analytics_equipment_reports`, `analytics_sla_metrics`, `sla_trackings` |
| 6 | Same columns in two tables | `internal_notes` (5 rows) and `ticket_remarks` (5 rows) have identical columns, but different audiences (see Phase 4) |
| 7 | Three SLA configuration tables | `slas` (2 rows), `sla_rules`, `branch_sla_policies`: a precedence chain, not duplicates (see Phase 4) |
| 8 | Overlapping analytics tables | `recurring_issue_analytics` and `branch_recurring_issue_trends`; `employee_performance_analytics` and `daily_employee_performance` (the last one turned out dead) |
| 9 | `tickets` overcrowded | About 15 SLA timing and alert columns, 3 SLA foreign keys (`sla_ID`, `sla_rule_id`, `branch_sla_policy_id`), 32 indexes |
| 10 | `users` is empty but not dead | 0 rows, but `machines.client_ID` has a foreign key to `users` |

## Notifications

`notifications` lives in the shared database and is owned by **notification-service** (phase 1b).
New schema changes go in notification-service migrations. The table's earlier history is in
ticket-service (`2026_05_28_000030`, `2026_06_08_000003`, `2026_06_11_000001`, `2026_11_24_000001`);
those migrations now skip whatever already exists, so either service can migrate first on a
fresh database.

| Piece | Where |
|---|---|
| Schema | notification-service `2026_11_26_000002_take_ownership_of_notifications_table` |
| Read API | notification-service `GET /api/notifications`, `PATCH /api/notifications/read-all`, `PATCH /api/notifications/{id}/read` (gateway `/api/ticketing/notification/...`) |
| Retention purge | notification-service `php artisan notifications:purge`, daily 03:00 on `notification-scheduler` |

Writers (all still insert directly into the shared table):

| Service | Where |
|---|---|
| ticket-service | `TicketNotificationService::notifyRecipient`, `TicketReminderController` |
| employee-service | `TicketNotificationService::notifyRecipient` |
| messaging-service | `MessageController` (new chat message) |
| attachment-service | `AttachmentController` (malware detected) |
| notification-service | `SystemAlertController` (system alerts to Super Admin) |

Sending these writes through a notification-service REST endpoint instead is a possible later step.
It is not done: it would add a network call to every ticket action, and a notification-service
outage would then lose notifications.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Backup, read-only inventory | Inventory done (above) |
| 1 | Notifications: `type` column, indexes, retention purge, remove broken legacy route | Done on `chore/db-cleanup-notifications` |
| 1b | Move `notifications` ownership (schema, read API, purge) from ticket-service to notification-service | Done, uncommitted (see Phase 1b changes) |
| 2 | One owning service per table | Ownership recorded below; duplicate migration files kept on purpose (see Phase 2 notes) |
| 3 | Drop dead tables (finding 5, plus `daily_employee_performance`) | Done: 5 tables dropped (local dev 75 to 70 tables), uncommitted |
| 4 | Merge duplicates (findings 6, 7, 8) | Investigated: no merge is worth doing (see Phase 4 notes) |
| 5a | Drop unused `tickets` indexes | Done: 32 to 26 indexes, uncommitted |
| 5b | Move the 3 SLA alert timestamps from `tickets` into `ticket_sla_alerts`; drop unused `first_cs_response_at` (the full SLA split was rejected: about 360 references for no measurable gain) | Built, uncommitted ([spec 0049](specs/0049-ticket-sla-alerts-table/index.md)): release 1 (new table, checker switch) is applied on local dev; release 2 (backfill, then drop the 4 columns) is tested on the test DB only. Ship release 2 in its own PR after the spec's go/no go checklist passes |

### Phase 1 changes

| Change | Detail |
|---|---|
| `notifications.type` | Stored generated column from `data->type`, indexed with `created_at`. No insert had to change |
| Typed inserts | `notifyRecipient` in ticket-service and employee-service stores the alert key as `data.type` when the caller gives no specific type. Before this, 208 of 373 local rows had no type |
| Indexes | `idx_notifications_recipient_created` (listing, newest first), `idx_notifications_read_created` (purge) |
| Retention | `php artisan notifications:purge` (daily 03:00) deletes read notifications older than `NOTIFICATION_RETENTION_DAYS` (default 90, minimum 7) in batches of 1000. Unread rows are kept. Supports `--dry-run` and `--days` |
| Removed route | `GET /api/security-incidents/{id}` queried a non-existent `notification_ID` column. Replaced long ago by `GET /api/superadmin/security-incidents/{incidentId}` |

### Phase 1b changes

| Change | Detail |
|---|---|
| Ownership migration | notification-service `2026_11_26_000002`: creates the table in its final shape when missing; otherwise drops the foreign key to `tickets`. The key only cascaded hard ticket deletes, which only the seeders do, and they delete notifications first. Its index stays. `down()` is a no-op |
| ticket-service migrations | `2026_05_28_000030` creates `notifications` only if missing and no longer drops it on rollback; `2026_06_08_000003` and `2026_06_11_000001` skip the column and index if present |
| Read API | Moved from ticket-service `TicketNotificationController` (deleted, with its routes and the dead `TicketController` proxies) to notification-service `NotificationController` + `NotificationInboxService`. Same response shape. Mark-one-read no longer returns another user's notification. The `notifications_read` Reverb broadcast was dropped: the frontend never listened for it |
| Auth | notification-service gained `AuthenticateSubsystem` and the shared `VerifyEmployeeJwt` (staff SSO tokens) next to its existing Passport guard (customer tokens), plus the `auth` Redis connection for the JWT blacklist |
| Purge | `PurgeReadNotificationsCommand` moved; config is now `notifications.retention_days` (same `NOTIFICATION_RETENTION_DAYS` env). New `notification-scheduler` container in both compose files. Azure runs no scheduler for any service |
| Frontend | `getNotifications` / `markNotificationsRead` / `markNotificationRead` call `/api/ticketing/notification` (`VITE_NOTIFICATION_API_URL`); vite dev proxy entry added |
| Gateways | `nginx.prod.conf` (staff and customer servers) and `frontend/web/nginx.customer.template.conf` gained the notification route; `nginx.gateway.conf(.template)` already had it. Azure customer portal needs `NOTIFICATION_SERVICE_URL` (capstone-azure-infra `ticketing.bicep`, local edit) before an image using the customer template ships |

### Phase 2 notes: why the duplicate migration files stay

| Fact | Consequence |
|---|---|
| Duplicate copies have the same file name in every service | The shared `migrations` table records the name once, so a copy never creates a second table or runs twice |
| Seven services (AI, analytics, attachment, configuration, customer, messaging, notification) test on SQLite `:memory:` with `RefreshDatabase`, built only from their own migrations | Deleting a service's copy of `users`, `oauth_*` or `failed_jobs` breaks that service's tests |
| The three copies whose contents differ (`users`, `proof_of_completion`, `ticket_attachments`) end at the same schema | ticket-service creates them; attachment-service's `2026_07_09_000000_make_attachment_ids_nullable` makes the IDs nullable whichever service ran first |
| CI (`ci.yml`) runs no PHP tests | Nothing catches a broken per-service test database automatically |

Owner = the service whose migrations must change a table's schema from now on.

| Owner | Tables |
|---|---|
| customer-service | `clients`, `clients_credentials`, `refresh_tokens`, `password_reset_otps`, `password_reset_tokens`, `oauth_*` |
| employee-service | `employees`, `departments`, `reassignment_requests`, `work_logs`, `ticketing_handler_departments` |
| ticket-service | `tickets` and all `ticket_*` tables, `internal_notes`, `ticket_remarks`, SLA tables, `branches`, `branch_priority_overrides`, `branch_sla_policies`, `branch_categories`, `machines`, `machine_categories`, `problem_categories`, `workflow_statuses`, `escalation_rules`, `hold_requests`, `prs_ticket_requests`, `audit_*`, `users`, `failed_jobs` |
| attachment-service | `proof_of_completion`, `ticket_attachments` (originally created by ticket-service) |
| analytics-service | `customer_feedback`, `*_analytics`, `*_snapshots`, `forecast_job_runs`, `branch_ticket_forecasts`, `branch_recurring_issue_trends` |
| configuration-service | `email_configurations`, `email_templates`, `notification_channels`, `feedback_questions`, `feedback_form_settings`, `ticket_configurations`, `system_security_alerts` |
| AI-service | `ai_conversations`, `kb_*` |
| notification-service | `notifications` |

`personal_access_tokens` (Sanctum) is dead: Sanctum is in every service's `dont-discover` list and
`HasApiTokens` comes from Passport. Its create migration exists in 7 services, so removing it means
deleting all 7 copies together; left for a later pass.

### Phase 3 changes

| Change | Detail |
|---|---|
| analytics-service `2026_11_24_000001` | Drops `analytics_sla_metrics`, `analytics_employee_performances`, `analytics_equipment_reports` |
| ticket-service `2026_11_24_000002` | Drops `sla_trackings` |
| analytics-service `2026_11_24_000002` | Drops `daily_employee_performance` (never written; its only model, ticket-service `DailyEmployeePerformance`, was unused and is deleted) |
| `AnalyticsAndEmployeeSeeder` | No longer seeds the three analytics tables (it was their only writer) |
| Docs | `database-schema.md`, `business-rules.md`, `architecture.md` no longer describe `sla_trackings`; SLA timing lives on `tickets` |

`migrate:rollback` recreates the empty tables with their original schema (no rows; all five were empty
locally, and a backup was taken before the drop). Spec `0026` still lists `sla_trackings` under
ticket-service and needs an update through `/architect`.

### Phase 4 notes: why nothing is merged

| Candidate | Finding | Decision |
|---|---|---|
| `internal_notes` + `ticket_remarks` | Remarks are shown to customers; internal notes are staff only (`TicketService` loads notes only when the viewer is not a customer) | Keep separate. One table would need a visibility filter on every read, and one missed filter leaks staff notes to customers |
| `slas` + `sla_rules` + `branch_sla_policies` | `SLAService::SLA_SOURCE_COLUMNS` resolves branch policy, then branch priority override, then `sla_rules`, then `slas` as the global default; `slas` also backs the superadmin SLA screen | Keep. Merging is an SLA redesign, not a cleanup; route through `/architect` if wanted |
| `*_analytics` / `*_snapshots` vs `branch_*` trends | The six predictive tables back the live `/predictive-metrics` endpoint and `PredictiveAnalytics` page; the `branch_*` tables back `TicketForecastService` | Keep both sets. `daily_employee_performance` was dead and is dropped in Phase 3 |

### Phase 5a changes

ticket-service `2026_11_24_000003_drop_unused_ticket_indexes` drops six indexes. Usage counters
(`performance_schema`) were useless locally (1.6 h uptime, 30 rows, full scans), so each index was
checked against the code instead.

| Dropped index | Reason |
|---|---|
| `tickets_branch_id_index` | Redundant: `idx_tickets_branch_created_at` and `idx_tickets_branch_status` start with `branch_id`; no foreign key needs it |
| `tickets_origin_index` | No query filters or sorts on `origin` |
| `tickets_last_reminder_sent_at_index` | Column is selected and written only; the reminder cooldown compares it in PHP |
| `tickets_sla_risk_notified_at_index`, `tickets_sla_breach_notified_at_index`, `tickets_last_sla_breach_alert_at_index` | Written by the SLA checker every minute, never filtered; the checks run in PHP after loading the ticket |

The remaining 26 back a foreign key or a real filter (`is_internal` 14 uses, `resolution_due_at` 10,
`sla_status` 3, `in_progress_owner` 1). `migrate:rollback` recreates the six with their original names.

### Safety rules for every phase

- Take a `mysqldump` of `ticketing_system` and confirm it restores before running a destructive migration.
- Run tests only against `ticketing_system_test`; the ticket-service `TestCase` refuses `ticketing_system`.
- Confirm row counts on the target environment before dropping a table; zero code references does not mean zero rows.
