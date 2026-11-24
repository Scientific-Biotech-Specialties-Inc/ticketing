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
| 6 | Same data in two tables | `internal_notes` (5 rows) and `ticket_remarks` (5 rows) have identical columns |
| 7 | Three SLA configuration tables | `slas` (2 rows, still read by SLAService, TicketService, AssignmentPeriodRecorder, SuperAdminConfigController), `sla_rules`, `branch_sla_policies` |
| 8 | Overlapping analytics tables | `recurring_issue_analytics` and `branch_recurring_issue_trends`; `employee_performance_analytics` and `daily_employee_performance` |
| 9 | `tickets` overcrowded | About 15 SLA timing and alert columns, 3 SLA foreign keys (`sla_ID`, `sla_rule_id`, `branch_sla_policy_id`), 32 indexes |
| 10 | `users` is empty but not dead | 0 rows, but `machines.client_ID` has a foreign key to `users` |

## Notifications

`notifications` lives in the shared database. Its schema history is in ticket-service
migrations (`2026_05_28_000030`, `2026_06_08_000003`, `2026_06_11_000001`,
`2026_11_24_000001`), so new schema changes for it go in ticket-service.
Notification-service does not own the schema because:

- the table has a foreign key to `tickets`, so it must be created after ticket-service migrates;
- the local `notification-service` container does not run `php artisan migrate`.

Writers (all insert directly into the shared table):

| Service | Where |
|---|---|
| ticket-service | `TicketNotificationService::notifyRecipient`, `TicketReminderController`, `TicketNotificationController` |
| employee-service | `TicketNotificationService::notifyRecipient` |
| messaging-service | `MessageController` (new chat message) |
| attachment-service | `AttachmentController` (malware detected) |
| notification-service | `SystemAlertController` (system alerts to Super Admin) |

Reader: ticket-service `GET /api/notifications` (plus the two mark-read routes).

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Backup, read-only inventory | Inventory done (above) |
| 1 | Notifications: `type` column, indexes, retention purge, remove broken legacy route | Done on `chore/db-cleanup-notifications` |
| 2 | One owning service per table; delete duplicate migration files from non-owners (keep their `migrations` rows) | Not started |
| 3 | Drop dead tables (finding 5): rename to `_deprecated_<name>` for one sprint, then drop | Not started |
| 4 | Merge duplicates (findings 6, 7, 8) with data-copy migrations and a tested `down()` | Not started |
| 5 | Move SLA timing and alert columns from `tickets` into `ticket_sla_states` (1:1); keep one SLA foreign key | Not started |

### Phase 1 changes

| Change | Detail |
|---|---|
| `notifications.type` | Stored generated column from `data->type`, indexed with `created_at`. No insert had to change |
| Typed inserts | `notifyRecipient` in ticket-service and employee-service stores the alert key as `data.type` when the caller gives no specific type. Before this, 208 of 373 local rows had no type |
| Indexes | `idx_notifications_recipient_created` (listing, newest first), `idx_notifications_read_created` (purge) |
| Retention | `php artisan notifications:purge` (daily 03:00) deletes read notifications older than `NOTIFICATION_RETENTION_DAYS` (default 90, minimum 7) in batches of 1000. Unread rows are kept. Supports `--dry-run` and `--days` |
| Removed route | `GET /api/security-incidents/{id}` queried a non-existent `notification_ID` column. Replaced long ago by `GET /api/superadmin/security-incidents/{incidentId}` |

### Safety rules for every phase

- Take a `mysqldump` of `ticketing_system` and confirm it restores before running a destructive migration.
- Run tests only against `ticketing_system_test`; the ticket-service `TestCase` refuses `ticketing_system`.
- Confirm row counts on the target environment before dropping a table; zero code references does not mean zero rows.
