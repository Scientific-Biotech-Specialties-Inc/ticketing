# 0049. Move SLA alert bookkeeping out of tickets into ticket_sla_alerts · rationale

Decision record for [spec 0049](index.md).

## Context

`tickets` has 45 columns (phase 5 of `docs/database-cleanup-plan.md`). About 15 are SLA related. Most of them (`sla_status`, `resolution_due_at`, `response_due_at`, `last_reminder_sent_at`) are read in 16+ backend files across ticket-service and employee-service and in 13 frontend files, and dashboard filters depend on their indexes on `tickets`. Moving those would touch about 360 references for no measurable gain.

Three columns are different: `sla_risk_notified_at`, `sla_breach_notified_at`, `last_sla_breach_alert_at`. They are pure bookkeeping (a record of which alerts were already sent), read and written only in `SLAService` (ticket-service), and never sent to the frontend. A fourth, `first_cs_response_at`, is written once in employee-service (`EmployeeAssignmentService`, when CS first responds) and read nowhere.

Constraints:
- One shared MySQL database (`ticketing_system`), by design. `tickets` is owned by ticket-service; employee-service also writes it.
- On Azure (`.github/workflows/deploy.yml`) each service deploys and runs `php artisan migrate` on boot independently, so an old container can run for a while against a newer schema. `deploy-prod.sh` (Docker) rebuilds all services before migrating.
- The SLA checker (`tickets:check-sla-alerts`) runs every minute and is the only writer of the three alert columns.

## Options considered

### Option 1: Keep everything on tickets
Change nothing except dropping the dead `first_cs_response_at`.

**Pros**: no risk, no code change in the SLA checker.
**Cons**: checker state stays mixed into the ticket record; `tickets` keeps 44 columns.

### Option 2: Move only the alert bookkeeping (chosen)
New 1:1 table for the three alert timestamps; drop `first_cs_response_at`; two releases.

**Pros**: one file reads and writes the moved columns; no frontend or employee-service read path changes; removes 4 columns.
**Cons**: an extra join in the checker query; two releases to finish.

### Option 3: Move all SLA columns into ticket_sla_states
The original phase 5 plan.

**Pros**: `tickets` loses about 15 columns.
**Cons**: about 360 references across two services and the frontend; every dashboard query gains a join; dashboard indexes must be rebuilt on the new table; a coordinated deploy. High risk for a cosmetic gain.

## Rationale

The engineer weighed all three options and picked the small split. It removes the columns whose footprint is one file, so the risk is close to zero, while the columns with a wide footprint stay where the dashboards and their indexes need them. Two releases follow the safe migration sequence (add, switch, then remove) that the independent Azure deploys require: an old container keeps working because nothing it touches disappears until release 2.

Same column names (the engineer's pick) keep `$ticket->sla_breach_notified_at` and friends unchanged for `dispatchSlaBreachAlert` and the tests. The checker reads them with one `leftJoin` and aliased select expressions, so the old `tickets` columns of the same name never clash with the new ones. During release 1 each alias is `COALESCE(new column, old column)`: if an old ticket-service container (still running during an Azure rollout) records an alert in the old column after the backfill, the new code still sees it and does not alert twice. Runner up: a second query keyed by ticket id, which needs chunking for large ticket counts and gains nothing over the join.

**Amendment (2026-11-26): the table must never hold less than the old columns.** The `COALESCE` read covers alerts an old container writes after the backfill, but the first design only fixed the read side. `/check verify` showed the write side losing them: a ticket whose first breach time sat only in `tickets.sla_breach_notified_at` got a repeat alert from the new code, which created a row holding only `last_sla_breach_alert_at`; rolling back then set the first breach time to null, and the old code would have sent a fresh "first" alert and escalated again. Release 2 would have lost the same value for good. Three rules close the gap, one per place data crosses between the two homes:
- **Writes carry over (AC-10).** Every alert upsert also fills the columns the branch does not set: keep the row's value if it has one, else take the value the checker loaded. This is per column "fill if empty", so it never overwrites a value another run wrote. It replaces "update only the named columns", which was right about not clearing values but did not carry old ones forward. Runner up: write the full loaded state on every upsert (simpler, but an overlapping run could write back a stale null over a value another run had just recorded).
- **Rollback prefers a set value (AC-8).** The release 1 `down()` copies `COALESCE(table, tickets)` per column instead of "the table wins, even when null". A null in the table only ever means "not recorded here", because nothing in the system clears an alert timestamp (see Follow-up). This also covers tickets the new checker never wrote again after an old container's write (for example a ticket that closed).
- **Release 2 backfills before it drops (AC-9).** Tickets the checker never touches again (closed tickets, or tickets an old container alerted just before it stopped) keep values only in the old columns. The drop migration copies them first: insert the missing rows, fill null columns, then drop. Runner up: rely on the go/no go checklist alone; rejected, because the checklist proves nothing writes the old columns anymore, not that their earlier values were moved.
