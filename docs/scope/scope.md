# Scope

This scope tracks features in flight. It was started by `/architect` for spec 0046. Run `/scope` to fill in the rest of the product and set the project workflow tier and build approach.

## At a glance

| Feature | Status | Spec |
|---|---|---|
| PRS equipment ticket intake | in-progress | [0046](../specs/0046-prs-equipment-integration/index.md) |

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

## Deferred

- Return to the exact ticket after login (needs an Auth Module change), from spec 0046
- Model SBSI internal assets in TS for equipment history, from spec 0046
- Add authentication to attachment-service `/bind`, from spec 0046
