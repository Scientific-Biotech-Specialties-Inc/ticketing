# 0049. Move SLA alert bookkeeping out of tickets into ticket_sla_alerts

**Date**: 2026-11-24
**Status**: In Progress

Decision history (context, options considered, rationale): [rationale.md](rationale.md). Verify steps: [verify.md](verify.md).

## Summary

The SLA checker records when it sent "at risk" and "breached" alerts in three columns on `tickets`. This spec moves those three timestamps into a small table of their own, `ticket_sla_alerts`, and drops one column nobody reads (`first_cs_response_at`). It ships in two releases: first the new table and the code switch, later the column drop, so no running container ever hits a missing column. Behavior stays exactly the same.

While old and new code run side by side, an alert time can end up only in the old `tickets` column. So the new table must never hold less than the old columns: every alert write carries over old values, the release 1 rollback keeps an old value when the table has none, and release 2 copies any leftover old values into the table before it drops the columns (amended 2026-11-26, after `/check verify` saw a first breach time lost on rollback).

## Requirements

**User stories**:
- As a developer, I want SLA alert bookkeeping kept apart from the ticket record so that `tickets` holds ticket data, not checker state.
- As an operator, I want the change rolled out without errors while services restart one by one.

**Acceptance criteria**:
- **AC-1**: The release 1 migration creates `ticket_sla_alerts` and copies the three alert timestamps of every ticket that has at least one of them set. The new row count equals the number of such tickets, and every copied value equals the source value.
- **AC-2**: An "at risk" alert is sent at most once per ticket. The first checker run that finds a ticket At Risk sends the alert and stores `sla_risk_notified_at` in `ticket_sla_alerts`; later runs do not send it again.
- **AC-3**: On the first breach, the checker sends the breach alert, records the escalation managers, and stores both `sla_breach_notified_at` and `last_sla_breach_alert_at`. A repeat alert is sent only after the configured realert interval and sets a new `last_sla_breach_alert_at`. It never changes an `sla_breach_notified_at` or `sla_risk_notified_at` the ticket already has (in either place); see AC-10. The escalation is not recorded again.
- **AC-4**: `tickets.sla_status` and `tickets.updated_at` are written in exactly the same cases and with the same values as before this change.
- **AC-5**: After release 1, no code writes the three alert columns on `tickets`, and no code or seeder writes `tickets.first_cs_response_at`.
- **AC-6**: A ticket with no `ticket_sla_alerts` row is treated as never alerted.
- **AC-7**: Deleting a ticket deletes its `ticket_sla_alerts` row.
- **AC-8**: Rolling back the release 1 migration copies the current alert timestamps from `ticket_sla_alerts` back onto `tickets` (including alerts recorded after the deploy), then drops the table. For each column the table's value wins when it is set; when the table's value is null, the existing `tickets` value is kept. No alert timestamp that was set before the rollback is null after it.
- **AC-9**: The release 2 migration first copies every alert timestamp still present only on `tickets` into `ticket_sla_alerts` (it creates the missing rows, and fills a null column from the old column), then drops `sla_risk_notified_at`, `sla_breach_notified_at`, `last_sla_breach_alert_at` and `first_cs_response_at` from `tickets`. No alert timestamp is lost by the drop. Rolling it back adds the columns back as nullable, copies the alert timestamps back from `ticket_sla_alerts`, and leaves `first_cs_response_at` empty.
- **AC-10**: Whenever the checker writes a `ticket_sla_alerts` row, each alert column the branch does not set keeps the row's value when it has one; otherwise it takes the value the checker loaded for that ticket (the old `tickets` column during release 1). So after any checker write, the row holds every alert timestamp the ticket had in either place.

## Decision

**Chosen option**: Option 2: Move only the alert bookkeeping.

Create `ticket_sla_alerts` (one row per alerted ticket, same column names), switch `SLAService` to it, stop writing `first_cs_response_at`, and drop the four old columns in a later release.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`)

## Feature design

**Data model sketch**:

| Table | Column | Type | Rules |
|---|---|---|---|
| `ticket_sla_alerts` | `ticket_id` | `unsignedBigInteger` | Primary key; foreign key to `tickets.ticket_ID` (a `bigIncrements` column), `ON DELETE CASCADE` |
| | `sla_risk_notified_at` | `dateTime` | Nullable (same type as the `tickets` column it replaces, so the copy is exact) |
| | `sla_breach_notified_at` | `dateTime` | Nullable |
| | `last_sla_breach_alert_at` | `dateTime` | Nullable |
| | `created_at`, `updated_at` | `timestamps()` | Nullable (Laravel timestamps) |

Relationship: `tickets` 1 to 0..1 `ticket_sla_alerts`. A row exists only once a ticket has been alerted. No Eloquent model: all access uses `DB::table`, like the rest of `SLAService`.

**API surface**: no endpoint changes. The three alert columns are not used by the frontend. After release 2 they disappear from any `t.*` payload; nothing consumes them.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Release 1 migration (copy) | the three timestamps per ticket | `tickets` columns of the same name, rows where any is not null |
| Release 1 migration (copy) | `created_at`, `updated_at` of copied rows | the migration time, `now()` |
| Checker run (read), release 1 | `$ticket->sla_risk_notified_at`, `->sla_breach_notified_at`, `->last_sla_breach_alert_at` | `COALESCE(a.<column>, t.<column>)` from `leftJoin('ticket_sla_alerts as a', 'a.ticket_id', '=', 't.ticket_ID')`, selected under alias names and assigned onto the ticket object under the original names |
| Checker run (read), release 2 | same three properties | `a.<column>` only (the old columns are gone) |
| Checker run (write) | new timestamp | `$now` from `checkAndNotifySlaAlerts` |
| Checker run (write) | alert columns the branch does not set (carried over) | on insert: the loaded `$ticket-><column>` (the `COALESCE` read); on update: the row's current value if not null, else the loaded `$ticket-><column>` |
| Checker run (write) | realert interval | `getSlaBreachRealertInterval()` (unchanged) |
| Release 1 rollback | values copied back to `tickets` | for tickets that have a row, per column `COALESCE(ticket_sla_alerts.<column>, tickets.<column>)`: the table wins when set, else the old value stays |
| Release 2 migration (backfill, before the drop) | missing rows | `tickets` rows with any of the three columns not null and no `ticket_sla_alerts` row; `created_at`, `updated_at` = `now()` |
| Release 2 migration (backfill, before the drop) | null columns on existing rows | per column `COALESCE(ticket_sla_alerts.<column>, tickets.<column>)` |
| Release 2 rollback | values copied back to `tickets` | `ticket_sla_alerts`; `first_cs_response_at` stays null (its data is not kept) |

**Write sets per branch** (each is one `upsert` into `ticket_sla_alerts` keyed by `ticket_id`. The columns named below are set to the value shown. The other alert columns are carried over per AC-10: inserted as the loaded value, and on update set to "row value if not null, else the loaded value". `updated_at` is always updated; `created_at` is set only in the inserted values. Laravel 10's `upsert` accepts a raw expression per update column, which is enough to express the carry over rule):

| Branch | Columns written to `ticket_sla_alerts` | Written to `tickets` (unchanged from today) |
|---|---|---|
| First breach alert | `sla_breach_notified_at` = existing value, else `$now`; `last_sla_breach_alert_at` = `$now` | `sla_status` = `Breached`, `updated_at` = `$now` |
| Repeat breach alert (interval passed) | `last_sla_breach_alert_at` = `$now` | `sla_status` = `Breached`, `updated_at` = `$now` |
| Breached, no alert due | nothing | `sla_status` = `Breached`, `updated_at`, only when `sla_status` was not already `Breached` |
| First at risk alert | `sla_risk_notified_at` = `$now` | `sla_status` = `At Risk`, `updated_at` = `$now` |
| At risk, already alerted | nothing | `sla_status` = `At Risk`, `updated_at`, only when it changed |
| On track, paused, no SLA | nothing | `sla_status`, `updated_at`, only when it changed |

Two update lists are wrong. A plain three column list overwrites columns the branch did not set (for example it clears `sla_risk_notified_at` when a breach is recorded). A list of only the named columns never carries an old column's value into the row, so the value is lost on rollback and at release 2 (seen in `/check verify`). Use the carry over rule above.

**Key invariants**:
- At most one `ticket_sla_alerts` row per ticket (primary key on `ticket_id`), so overlapping checker runs cannot create duplicates.
- In each alerting branch, the `tickets` update and the alert upsert run in one `DB::transaction`. The alert is dispatched before the transaction, as today; if the transaction fails, the next run alerts again (same as today).
- Only ticket-service writes `ticket_sla_alerts`.
- The table never holds less than the old columns: no step (checker write, release 1 rollback, release 2 drop) turns a set alert timestamp into null. This relies on nothing ever clearing an alert timestamp, which is true today (see Follow-up). If a later decision adds clearing, these three rules must be revisited with it.

**Security model**: no change. Internal bookkeeping, not exposed through any API.

**Configuration required**: none.

**Critical test scenarios** (ticket-service tests run on MySQL, `ticketing_system_test`):
- Copy: tickets with mixed null and set alert columns; after migrate, one row per ticket with any value set, values equal; running the copy again adds nothing. Verifies **AC-1**.
- At risk once: run the checker twice on an At Risk ticket; one alert, `sla_risk_notified_at` set in `ticket_sla_alerts`, the old `tickets` column untouched. Verifies **AC-2**, **AC-5**.
- Breach cadence: first run alerts, escalates and writes both breach columns; a run inside the interval does nothing; a run after it alerts again and changes only `last_sla_breach_alert_at`; no second escalation; an earlier `sla_risk_notified_at` survives. Verifies **AC-3**.
- `sla_status` and `updated_at` on `tickets` match the table above in every branch. Verifies **AC-4**.
- Overlap: a ticket with no alert row but `tickets.sla_breach_notified_at` set (written by an old container) is treated as already alerted. Verifies **AC-6**.
- A ticket with no alert row and empty old columns is alerted as new. Verifies **AC-6**.
- Delete a ticket with an alert row; the row is gone. Verifies **AC-7**.
- Rollback of each migration on the test database restores the values as described. Verifies **AC-8**, **AC-9**.
- Carry over on a repeat breach: no alert row, `tickets.sla_breach_notified_at` set and `last_sla_breach_alert_at` older than the interval; one run sends the repeat alert, and the new row holds the old first breach time plus the new `last_sla_breach_alert_at`. No escalation. Verifies **AC-3**, **AC-10**.
- Carry over on a first alert: no alert row, `tickets.sla_risk_notified_at` set; the first breach alert creates a row that keeps that risk time. Verifies **AC-10**.
- Carry over never overwrites: a row that already has `sla_breach_notified_at` keeps it when the old column holds a different value. Verifies **AC-10**.
- Rollback keeps an old value: a row with null `sla_breach_notified_at` and the same column set on `tickets`; after release 1 `down()`, the `tickets` value is unchanged. Verifies **AC-8**.
- Release 2 backfill: one ticket with old values and no row, one row with a null column the old column fills; after release 2 `up()` both values are in `ticket_sla_alerts` and the columns are gone. Verifies **AC-9**.

## Build plan

Ordered as one end to end slice per release (no build approach is recorded in `AGENTS.md` or the scope; this assumes Tracer Bullet).

**Release 1 (this PR)**
1. ticket-service migration `2026_11_24_000004_create_ticket_sla_alerts_table` (sorts after the existing `2026_11_24_000003`): create the table per the data model; copy with `insertOrIgnore` from a select of `tickets` where any of the three columns is not null, `created_at` and `updated_at` = `now()`. `down()`: for tickets that have a row, set each of the three `tickets` columns to `COALESCE(row value, tickets value)`, then drop the table. Satisfies **AC-1**, **AC-7**, **AC-8**.
2. `SLAService::checkAndNotifySlaAlerts`: add the `leftJoin` and the three `COALESCE` aliased selects to the active tickets query; assign them onto each ticket object under the original property names before the branch logic. Satisfies **AC-6**.
3. Same method: in each branch, replace the alert columns in the `tickets` update with the upsert from the write sets table, including the carry over of the columns the branch does not set; keep `sla_status` and `updated_at` on `tickets` exactly as listed; wrap each alerting pair in `DB::transaction`. `dispatchSlaBreachAlert` keeps reading `$ticket->sla_breach_notified_at` from the loaded object. Satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-10**.
4. employee-service `EmployeeAssignmentService` (around line 297): remove the `first_cs_response_at` update. Remove `first_cs_response_at` from `CustomerTicketSeeder` and `FullPlatformMockDataSeeder` (ticket-service). Satisfies **AC-5**.
5. `SlaBreachAlertMonitoringTest`: make its schema setup create `ticket_sla_alerts` when missing (alongside its existing `tickets` shim); move the assertions at lines 340 and 341 and the seeding at lines 579 and 580 to `ticket_sla_alerts`; add the scenarios above. Satisfies **AC-1** to **AC-8**, **AC-10**.

> Amended 2026-11-26: the first build of tasks 1, 3 and 5 (on `chore/db-cleanup-notifications`, not yet merged) predates AC-10 and the new AC-8 rule. Task 1's `down()` needs the `COALESCE`, task 3's `upsertSlaAlert` needs the carry over, and task 5 needs the four new release 1 scenarios. Nothing else in release 1 changes.

**Release 2 (a later PR, only after the go/no go checklist below passes)**
6. ticket-service migration `drop_sla_alert_and_first_cs_columns_from_tickets`: first backfill (insert the missing rows with `insertOrIgnore`, then fill null columns with `COALESCE(row value, tickets value)`), then drop the four columns, each guarded by `hasColumn`. `down()`: add them back as nullable `dateTime`, copy the alert values back from `ticket_sla_alerts`. Add the release 2 backfill scenario to the tests. Satisfies **AC-9**.
7. Remove the `COALESCE` from the checker read (select `a.<column>` only). The carry over in the upsert stays and becomes a no op (the loaded value is then the row's own value). Update `docs/database-schema.md` and `docs/database-cleanup-plan.md`. Satisfies **AC-9**.

## Migration plan

**Strategy**: expand and contract (strangler) over two releases.
**Phases**:
1. Release 1: table created and backfilled; code reads (with a fallback to the old columns) and writes the new table; old columns stay.
2. Release 2: old columns dropped.

**Release 2 go/no go checklist** (nothing in the repo enforces this, because merging deploys):
- [ ] ticket-service runs release 1 code in every environment (local, Azure), including its scheduler (`ticket-service-queue` / `queue-worker`).
- [ ] employee-service runs release 1 code in every environment. This one matters most: an old employee-service writing `first_cs_response_at` after the drop fails with MySQL error 1054 inside the assignment transaction and rolls back the assignment.
- [ ] `SELECT COUNT(*) FROM tickets WHERE first_cs_response_at > <release 1 deploy time>` returns 0 (proves nothing still writes it).

**Rollback**: release 1, run its `down()` (alert state copied back, including alerts recorded after the deploy; an old value is kept where the table has none) and redeploy the previous code. Release 2, run its `down()`; alert state comes back from `ticket_sla_alerts`, `first_cs_response_at` comes back empty.
**Risks**: during the release 1 rollout an old checker may still write the old columns; the `COALESCE` read stops a double alert, the carry over moves the value into the table on the next write, and the release 2 backfill moves any value no write picked up. Shipping release 2 before the checklist passes brings back the missing column errors this plan avoids.

## Consequences

**Positive**:
- `tickets` drops from 45 to 41 columns, and the SLA checker no longer stores its bookkeeping on the ticket record.
- The dead `first_cs_response_at` write goes away.

**Negative / tradeoffs**:
- One extra join in the checker query (every minute).
- Each alert upsert carries a raw "fill if empty" expression for two columns, so the write is a little harder to read than a plain column list.
- The carry over, rollback and backfill rules assume alert timestamps are never cleared. Whoever decides the first Follow-up item (clearing alerts when an SLA is recalculated) must revisit them.
- Two releases plus a manual checklist; between them `tickets` carries four stale columns.
- `first_cs_response_at` values are lost at release 2 (nothing reads them).

**Neutral**:
- The 11 other SLA columns stay on `tickets` on purpose (see Options considered).
- Specs 0007 and 0017 mention `t.sla_breach_notified_at` in `getEmployeeTickets`; that code no longer exists, so those mentions are stale, not a reader.

## Follow-up

- [ ] Alert timestamps are never cleared when a ticket's SLA is recalculated (resumed from hold, reprioritised, reopened), so a ticket that breaches a second time gets no fresh first breach alert or escalation. This predates the change and needs its own decision. That decision must also revisit the "never holds less than the old columns" rules in this spec (AC-8, AC-9, AC-10), which assume timestamps are never cleared.
- [ ] `tickets:check-sla-alerts` runs every minute without `withoutOverlapping()`; overlapping runs can send duplicate alerts. This predates the change.
- [ ] Release 2 (build plan tasks 6 and 7) after release 1 is deployed to every environment.
