# 0046. PRS Equipment Ticket Intake: Rationale

## Context

The Productivity Report System (PRS) is one of the four SBSI subsystems (with CMS/CRMS, SERMS, and the Ticketing System). Only internal SBSI employees use it, and the equipment they report problems with is SBSI's own equipment (office machines, laptops, tools), not customer machines. Today an employee who spots an equipment problem in the PRS has to open the ticketing system and retype the equipment and the issue. Retyping slows reporting, invites typos in serial numbers, and leaves no link between the report and the ticket.

The PRS runs separately from the ticketing system and reaches it only through port forwarding (a tunnel such as trycloudflare), the same way the CMS is reached for equipment sync. Tunnel URLs change when the tunnel restarts, connections can drop, and requests can time out, so any design has to tolerate retries and avoid long or large requests.

The ticketing side already has most of the building blocks: internal tickets for employees (`storeInternalTicket` and `TicketService::createInternalTicket`), an `origin` column on tickets, an attachment pipeline that scans every file with ClamAV, and an internal route group protected by `X-Internal-Secret`. The architectural invariants in `AGENTS.md` still apply: no direct database coupling between services, mandatory antivirus scanning, and branch protection. Several facts in the code shape the design. `tickets.problem_category_ID` is NOT NULL. `machines.client_ID` is required, so the `machines` table can only hold customer equipment. Tickets store no department column: the department only sets the SLA rule and otherwise follows assignment. attachment-service `/upload` requires a signed in user's token, and `/bind` has no authentication at all. The employee portal has no single ticket route, and the login lives in the separate Auth Module, which cannot send a user back to the page they started on.

If nothing is built, PRS users keep retyping tickets, equipment details get lost or mistyped, and CS cannot tell which tickets came from the PRS.

## Options considered

### Option 1: Server to server push into a dedicated PRS intake endpoint, then redirect

The PRS server POSTs the ticket, a snapshot of the equipment, and the reported issue type to a new `/internal/prs/tickets` route in `ticket-service`, authenticated by a dedicated shared key. `ticket-service` finds the employee by email, creates the internal ticket, and returns a `ticket_url`. The PRS redirects the employee there. Photos follow in separate per file calls through a new internal attachment route. The PRS can poll a status route.

**Pros**:
- The ticket exists as soon as the PRS gets a 201, whether or not the employee ever opens the link.
- Small JSON requests over the tunnel, plus idempotency on `prs_reference` and `Idempotency-Key`, make retries safe.
- Reuses the internal ticket path and the ClamAV pipeline.
- The ticketing system never calls into the PRS.

**Cons**:
- The PRS key can act for any employee, so key handling matters.
- A new route group in ticket-service and a new internal route in attachment-service to maintain.

### Option 2: Redirect the employee to a prefilled TS form with a handoff token

The PRS asks TS for a short lived handoff token holding the draft (machine, title, description) and redirects the employee to the TS internal ticket form, prefilled. The employee reviews and submits in TS.

**Pros**:
- The employee confirms everything in TS before anything is created.
- Attachments use the existing form upload with no server to server file transfer.

**Cons**:
- Nothing is created if the employee closes the tab, so the PRS cannot rely on a ticket existing.
- A new token type to issue, store, expire, and secure.
- The PRS gets no ticket number back unless another callback is added.

### Option 3: TS pulls PRS ticket requests on a schedule

Like `cms:sync`, a scheduled command in `ticket-scheduler` reads pending ticket requests from a PRS endpoint and creates the tickets.

**Pros**:
- Matches the existing CMS sync pattern, and the PRS needs no TS key.
- TS controls the pace.

**Cons**:
- Tickets appear minutes late, and the redirect has nothing to point to at the moment the employee clicks.
- TS depends on the PRS tunnel staying up.
- The PRS must store and expose a queue of pending requests.

### Option 4: Reuse the existing `/tickets/internal` endpoint with an impersonation token

The PRS obtains a token that represents the employee (through central auth) and calls the existing `POST /tickets/internal` route directly.

**Pros**:
- No new ticket creation endpoint at all.
- Authorization is the employee's own.

**Cons**:
- The central Auth Module would need to issue impersonation or delegated tokens to another subsystem, which is a much larger security change.
- The existing route has Service tickets require a TS `machine_ID`, which SBSI equipment never has.
- No idempotency, no PRS marking, and no PRS specific status read.

## Rationale

Option 1 fits the forces best. The tunnel is the weakest link, so the design keeps every request small, makes both the create call and each upload idempotent, and never has TS depend on the PRS being reachable. That rules out Option 3. The engineer wants the ticket to go "automatically" into the internal queue and then redirect the employee to it, and only Option 1 guarantees the ticket exists before the redirect. Option 2 makes creation depend on the employee finishing a second form. Option 4 would push a delegated token design into the central Auth Module for little gain.

**Equipment.** The PRS reports SBSI's own equipment, while `machines` can only hold customer equipment (every row needs a `client_ID`). Registering SBSI items as fake customer machines would pollute CMS and CRMS data, so the ticket keeps a JSON `equipment_snapshot` instead and `machine_ID` stays null. The snapshot is structured rather than appended to the description, so CS sees a clear equipment card and a later internal asset table can be filled from it. For PRS tickets, a hardware issue requires the equipment name and serial in place of the TS machine rule.

**Routing.** The engineer chose to let CS decide the department, with the PRS modal only recording whether the employee saw it as a Service (hardware) or Software issue. That hint is stored as `reported_issue_type` and shown to CS. Because tickets store no department column, creating the ticket with no requested department matches the existing internal ticket behavior (SLA timing starts from the requester's department) and needs no schema change. Missing or unknown categories go to a seeded `For CS Triage` category instead of making `problem_category_ID` nullable, which would ripple through SLA rules, dashboards, and reports. Priority always uses the TS default.

**Requester and rules.** Employees are matched by work email, which matches central auth and the `employees` table. Two active matches are rejected rather than guessed. The same rules as the TS internal form apply, so a PRS ticket never bypasses a limit the form enforces. Those checks live in the controller today, so the build pulls them into a small shared guard instead of copying them. A dedicated key, with no fallback to the CRMS or internal secrets, keeps the integrations independently revocable.

**Attachments.** Over a tunnel, one multipart create call couples ticket creation to the slowest file and makes retries resend everything. Having TS download from PRS URLs opens a server side request forgery risk. Uploading only in TS after the redirect is the simplest, but makes the employee attach photos the PRS already has. A separate call per file, after the ticket exists, keeps each request small and retryable. The cross check showed that `/upload` requires a user token and `/bind` is unauthenticated, so neither can serve a server side caller. A new attachment-service route protected by `X-Internal-Token` reuses the same ClamAV code path, takes the uploader explicitly (the requester), links the file in the same call, owns the per ticket count (it owns the rows), and returns error codes. The runner up, minting a short lived JWT for the requester, would add a token issuing path for a single use.

**Redirect.** The employee portal splits My Tickets by role and has no single ticket route, and the Auth Module login cannot return a user to a deep link. Pointing `ticket_url` at `/employee/my-tickets?ticket=<number>` needs only a query parameter in `EmployeeMyTickets`, since PRS users are employees. Returning to the exact ticket after login was left out because it needs a change in the separate Auth Module.

**Audit.** The creation entry keeps `actor_type = employee`, because reports group on it. The PRS source goes into the details and the timeline label instead. The runner up, a new `integration` actor type, would make attribution clearer but would ripple into every report that groups on actor type.

**Tunnel.** The staff gateway does not block `/internal/`, so a whole gateway tunnel would expose every staff API to the internet. A path limited tunnel is therefore a go live requirement, not a follow-up.

A small decision made during writing: titles are trimmed and their first letter capitalized instead of being rejected by the TS proper casing rule. A system to system call should not fail on capitalization the employee cannot fix from the PRS. The runner up was rejecting with 422, which matches the form exactly but would surface as confusing PRS errors.

## Cross check

An independent review (a different model, read only) checked the first draft against the code. It found that the draft wrongly assumed `/upload` and `/bind` could serve a server side caller, that `createInternalTicket` already saved `origin`, that return after login existed, and that the staff gateway blocked `/internal/`. It also found about a dozen undecided details. The engineer answered each one, and this version reflects those answers, including the change from customer machines to SBSI equipment snapshots.
