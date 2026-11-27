# Scope

This scope tracks features in flight. It was started by `/architect` for spec 0046. Run `/scope` to fill in the rest of the product and set the project workflow tier and build approach.

## At a glance

| Feature | Status | Spec |
|---|---|---|
| PRS equipment ticket intake | in-progress | [0046](../specs/0046-prs-equipment-integration/index.md) |
| Customer asset ticket intake | in-progress | [0047](../specs/0047-customer-asset-ticket-intake/index.md) |
| Department ticket routing | in-progress | [0051](../specs/0051-department-ticket-routing.md) |

## Features

### PRS equipment ticket intake · in-progress

The PRS server raises internal tickets for SBSI employees about SBSI's own equipment through the port forwarded tunnel. The employee is then redirected to the ticket, and photos follow one per call through ClamAV.

Done when: a PRS employee can raise a Service or Software ticket with equipment details and photos from the PRS, lands on it in the employee portal, and CS sees it marked `PRS` and can triage it.

Spec: [0046](../specs/0046-prs-equipment-integration/index.md)

- [x] Design it (spec)
- [ ] Build it: /develop PRS equipment ticket intake
  - [ ] Ticket intake API: key check, payload rules, snapshot, category fallback, idempotency, requester and limit checks (AC-1 to AC-8, AC-13)
  - [ ] Status read endpoint (AC-11)
  - [ ] Photo uploads: attachment-service internal route plus the ticket-service PRS upload endpoint (AC-9, AC-10)
  - [ ] Employee portal: `?ticket=` deep link, `PRS` badge, Equipment card, Origin filter (AC-12, AC-14)
  - [ ] Go live: path limited tunnel, customer edge check, API contract and tunnel docs (AC-15)
- [ ] Verify it: /check verify PRS equipment ticket intake
- [ ] Test it: /test PRS equipment ticket intake

### Customer asset ticket intake · in-progress

Customers report every problem against one of their own items, equipment or software. The item sets the category (equipment is Service, software is Software), customers can only pick or mention their own items, and the AI must identify one before it offers a ticket. Every customer gets three starter software items until the equipment system sends real software.

Done when: a customer can only create a ticket (from the form or the AI chat) about one of their own items, the category follows the item, no customer has an empty list, and TKT-0008 is linked to its LIS item.

Spec: [0047](../specs/0047-customer-asset-ticket-intake/index.md) · code in `services/ticket-service/app/Services/CustomerAssetService.php`, `services/AI-service/app/Services/AssetIntakeGate.php`, `frontend/web/src/pages/TicketCreation.jsx`

- [x] Design it (spec)
- [x] Build it: /develop Customer asset ticket intake
  - [x] Item model and seeding: `asset_type` migration, Software machine category, `CustomerAssetService`, seed list config (AC-1, AC-2, AC-14, AC-16)
  - [x] Ticket rules and form: form options list, owned item required on create and edit, server set category, one Equipment / Software picker with a read only category (AC-3 to AC-6, AC-11, AC-15)
  - [x] AI chat gating: internal assets endpoint, AI-service fetches the list, validated `asset_id`, not owned and ambiguous replies, safety path, chat buttons and handoff (AC-7 to AC-12)
  - [x] Data fix: seed command (dry run by default) and the TKT-0008 link, run only with approval (AC-2, AC-13)
- [ ] Verify it: /check verify Customer asset ticket intake
- [ ] Test it: /test Customer asset ticket intake

### Department ticket routing · in-progress

CS can route a ticket to a whole department instead of named people. The department manager then accepts it, assigns it to people in the department, or returns it to CS with a reason. A superadmin chooses which departments accept routed tickets.

Done when: CS can route to an enabled department, its managers see it in a Department queue, the first manager to act accepts, delegates or returns it, and direct member assignment still works as before.

Spec: [0051](../specs/0051-department-ticket-routing.md) · code in `services/employee-service/app/Services/DepartmentRoutingService.php`, `services/employee-service/app/Services/DepartmentManagerResolver.php`, `frontend/web/src/components/DepartmentQueueTab.jsx`, `frontend/web/src/components/DepartmentRoutePicker.jsx`

- [x] Design it (spec)
- [ ] Build it: /develop Department ticket routing
  - [ ] Schema and CS routing: migrations, manager resolver, assignable departments, route endpoint, CS modal toggle, notifications and email template (AC-2 to AC-5, AC-13)
  - [x] Manager triage: Department queue tab, claim, delegate and return with the first to act lock (AC-6 to AC-10)
  - [x] Superadmin switch and manager scope: `accepts_tickets` in the department form, scope driven by the switch (AC-1, AC-11)
  - [x] Reroute, timeline and metrics: CS reroute, timeline labels, "Waiting on" label, leave out closed manager rows from metrics (AC-12, AC-14 to AC-16)
- [ ] Verify it: /check verify Department ticket routing
- [ ] Test it: /test Department ticket routing

## Deferred

- Return to the exact ticket after login (needs an Auth Module change), from spec 0046
- Model SBSI internal assets in TS for equipment history, from spec 0046
- Add authentication to attachment-service `/bind`, from spec 0046
- Map imported software to `asset_type = software` and decide whether to retire seeded items, from spec 0047
- Make sure the CMS / equipment sync never updates or deletes `SW-` serial rows, from spec 0047
- Remove or keep the unused `classify-category` endpoint and `useCategoryPreview` hook, from spec 0047
- Link employees to departments by id instead of by name, from spec 0051
- Alert the superadmin when an enabled department has no active manager, from spec 0051
