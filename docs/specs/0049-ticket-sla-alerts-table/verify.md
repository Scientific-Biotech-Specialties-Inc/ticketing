# Verify: SLA alert bookkeeping table · spec 0049 · updated 2026-11-26
_Steps derived from spec 0049 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Run everything against `ticketing_system_test` unless a step says otherwise. Nothing here should touch the shared `ticketing_system` DB, except the read only checks marked "dev DB".

## Commands
- [x] `docker exec ticket-service php artisan test tests/Feature/TicketSlaAlertsMigrationTest.php` → 4 passed → AC-1, AC-7, AC-8
- [x] `docker exec ticket-service php artisan test tests/Feature/SlaBreachAlertMonitoringTest.php` → the 7 spec 0049 scenarios pass (cadence, at risk once, old column counts, no row is new, the three carry over cases). Note: 3 older tests in this file fail with duplicate `TKT-1003`/`TKT-1004` while leftover rows from 2026-11-20 sit in the test DB; that is test data, not this change → AC-2 to AC-6, AC-10
- [x] `php artisan migrate:status` in ticket-service (dev DB, read only) → `2026_11_24_000004_create_ticket_sla_alerts_table` is `Ran` → AC-1
- [x] Dev DB, read only: `SELECT COUNT(*) FROM ticket_sla_alerts` equals `SELECT COUNT(*) FROM tickets WHERE sla_risk_notified_at IS NOT NULL OR sla_breach_notified_at IS NOT NULL OR last_sla_breach_alert_at IS NOT NULL` as of the migration (2 = 2 on 2026-11-26) → AC-1

## Behavior (test DB)
- [x] Copy: tickets with mixed null and set alert columns; run the release 1 `up()` twice → one row per ticket with any value set, values equal, no extra rows → AC-1 (value source: `tickets` columns of the same name, `created_at`/`updated_at` = migration time)
- [x] At Risk ticket, checker run twice → one risk alert; `ticket_sla_alerts.sla_risk_notified_at` set; `tickets.sla_risk_notified_at` stays null → AC-2, AC-5 (value source: `$now`)
- [x] Overdue ticket: first run alerts, escalates once, writes both breach columns; a run inside the realert interval sends nothing; after the interval a run sends again and changes only `last_sla_breach_alert_at` → AC-3 (value sources: `$now`, `getSlaBreachRealertInterval()`)
- [x] Change the realert interval config (for example 30 vs 240 minutes) and confirm the repeat alert follows it → AC-3 (value source: realert interval)
- [x] In each branch (first breach, repeat, breached no alert, first risk, risk already alerted, on track) `tickets.sla_status` and `tickets.updated_at` match the write sets table in the spec → AC-4
- [x] Search: `grep -rn "first_cs_response_at" services/*/app services/*/database/seeders` → no writes; `grep -n "sla_.*notified_at\|last_sla_breach_alert_at" services/ticket-service/app/Services/SLAService.php` → no `tickets` update writes them → AC-5
- [x] No alert row and `tickets.sla_breach_notified_at` set a minute ago → no alert, no row created; no row and empty old columns → alerted as new → AC-6 (value source: `COALESCE(a.col, t.col)` read)
- [x] Delete a ticket that has an alert row → the row is gone → AC-7
- [x] Release 1 `down()`: row values set → copied onto `tickets`; row column null while `tickets` has a value → `tickets` value kept; then the table is dropped → AC-8 (value source: `COALESCE(row, tickets)`)
- [x] No row, `tickets.sla_breach_notified_at` set, last alert older than the interval → repeat alert; new row holds the old first breach time plus a fresh `last_sla_breach_alert_at`; no escalation → AC-3, AC-10 (value source: carried loaded value on insert)
- [x] No row, `tickets.sla_risk_notified_at` set → first breach alert creates a row that keeps the risk time → AC-10
- [x] Row has `sla_breach_notified_at` X, `tickets` holds a different Y → after a repeat alert the row still holds X → AC-10 (value source: row value if not null on update)

## Release 2 (not built yet, build plan tasks 6 and 7)
- [x] Release 2 `up()`: a ticket with old values and no row, plus a row with a null column the old column fills → both values end up in `ticket_sla_alerts`, then the four columns are gone; `down()` adds them back nullable and copies alert values back, `first_cs_response_at` empty → AC-9

## Acceptance-criteria coverage
- AC-1: migration test (copy, rerun), dev DB count check
- AC-2: at risk once scenario
- AC-3: cadence scenario, interval config step, repeat carry over scenario
- AC-4: write sets step (partly covered by existing assertions on `sla_status`)
- AC-5: at risk scenario, repeat carry over scenario, grep step
- AC-6: old column counts scenario, no row is new scenario
- AC-7: cascade delete test
- AC-8: both `down()` tests
- AC-9: release 2 step (pending)
- AC-10: the three carry over scenarios
