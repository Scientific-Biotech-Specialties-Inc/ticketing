# 0047. Customer asset based ticket intake: rationale

## Context

Customers create tickets from a form or through the AI chat. Today the form has an optional equipment dropdown (already limited to the customer's own machines on the server) and a separate Problem Category, which the AI now suggests from the description. The AI chat copies whatever equipment name the customer types into a free text `suggested_machine` and can offer a ticket with no equipment at all, so a customer can describe equipment they do not own and CS receives tickets that point at nothing.

There is no software data. The only item list is `machines`, one row per customer owned machine (`client_ID`), with a required unique `serial_number` and a required machine category. Software tickets therefore carry no item, and one Open ticket (TKT-0008, an LIS transmission problem) shows the gap. An external equipment system will later send every customer's equipment and software with branches, but not yet.

The repo forbids one service reading another's tables (AGENTS.md invariant 3), forbids a local model fallback for the AI (invariant 2: degrade to manual ticket creation), and requires thin controllers with logic in service classes. ticket-service owns machines and tickets; AI-service owns the chat.

The engineer decided: seed a few common software items per customer until real software arrives (LIS, Equipment Control Software, HIS; not the customer portal); no customer may have an empty list; equipment always means Service and software always means Software, with no sub categories; fix the existing ticket that has no item.

## Options considered

### Option 1: Asset type on `machines`, server derived category, AI gated on an owned item

Add `asset_type` to `machines`, seed software rows there, derive the category on the server, and have AI-service fetch the list from ticket-service and escalate only on a validated `asset_id`.

**Pros**:
- The ownership check, `tickets.machine_ID`, the branch rule and every screen that shows the machine keep working.
- The coming import maps straight in.

**Cons**:
- Software sits in a table named `machines`.
- Seeded rows need synthetic serial codes in a column meant for real serials.

### Option 2: Separate `customer_software` table and `tickets.software_ID`

A dedicated table for software with its own link on tickets.

**Pros**:
- Clean names and no synthetic serials.

**Cons**:
- Every reader of `machine_ID` (form, ownership check, CS queue, branch rule, reports, AI handoff) needs a second path, and a ticket could end up with both or neither.

### Option 3: Keep the current shape, only tighten the AI

Leave the form as it is and only stop the AI from escalating without a recognised machine.

**Pros**:
- Smallest change.

**Cons**:
- Software still has nothing to link to, the category stays a guess, and the form can still create tickets with no item, so the core problem remains.

## Rationale

Option 1 is the only one that meets all four engineer decisions with one item list. Because `machines` already carries ownership, branch and the ticket link, adding a type column reuses every existing path instead of duplicating them (Option 2's main cost), and the default of `equipment` makes the migration safe on a live table. Synthetic `SW-` serials are an accepted cost; they keep the unique and required rules intact instead of loosening a column the CMS sync depends on.

Deriving the category on the server removes a whole class of wrong categories and makes the AI category suggestion unnecessary on this form. The AI must see the customer's real list to tell owned from unowned items, and invariant 3 means it gets that list from ticket-service over REST with the internal token, keyed by the verified customer id, never from the browser. Gating `escalate` on a validated `asset_id` enforces "the AI must get the item first"; the Gemini outage fallback still lands on the form, which enforces the same rule, so invariant 2 holds.

Lazy seeding inside ticket-service covers customers created later (including by the CMS sync) without customer-service writing to ticket-service's tables; the one time command covers today's customers and the TKT-0008 fix, as a dry run by default because the dev database is shared.

## Update 2026-11-27: every machine has a branch

**Context**: after a database rebuild, the dev database had no `machines.branch_id` column (its migration lived only on unmerged CRMS sync branches) and had lost the "Software" machine category. Seeding then did nothing, a customer's item list came back empty, and the AI asked them to "choose one below" with nothing to choose. The engineer decided that every machine must have a branch.

**Options considered**:
- *Keep `branch_id` optional and let `TicketBranchResolver` fall back to the default branch* (the original AC-16). Cheap, but an item's branch stays implicit, and rows with no branch or a bad branch go unnoticed.
- *Make `branch_id` required and store the default branch on seeded software* (chosen). The branch becomes a fact the database enforces. The cost: every machine insert must name a branch, and deleting a branch with machines is blocked.

**Why**: the engineer wants branch ownership to be explicit for every item. Storing the same default the resolver already used changes no ticket routing today. The fill in runs before any schema change, because MySQL cannot roll back a half finished ALTER. Seeding skips (with a warning) rather than inventing a branch when the default is missing, so a misconfiguration shows up in the logs instead of as rows the database would reject. An empty item list is treated like an unreadable one, so the AI falls back to the manual form instead of a dead end prompt.
