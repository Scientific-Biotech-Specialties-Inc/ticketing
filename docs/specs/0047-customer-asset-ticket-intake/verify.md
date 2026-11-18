# Verify: Customer asset ticket intake · spec 0047 · updated 2026-11-18
_Steps derived from spec 0047 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Sign in as a customer with equipment → open `/customer-ticketing/create-ticket` → the "Equipment / Software" picker lists only your own items, grouped Equipment then Software → AC-3
- [ ] In the picker, software items show the name only (no `SW-` code); equipment shows name and serial → AC-3
- [ ] Pick an equipment item → Problem Category shows "Service" (read only); pick LIS → it shows "Software" → AC-4
- [ ] Type a description: no AI "detecting the category" message appears and the category does not change on its own → AC-4
- [ ] Submit without choosing an item → the form stops with "Please choose the equipment or software that has the problem." → AC-5
- [ ] Submit with an equipment item → the ticket detail shows that equipment and category Service → AC-5
- [ ] My Tickets → edit an Open, unassigned ticket → switch the item from equipment to LIS → save → category shows Software → AC-6
- [ ] AI chat: describe a problem with one of your own analyzers by name until it offers a ticket → no item buttons; "Create ticket" opens the form with that item preselected → AC-8, AC-11
- [ ] AI chat: name an analyzer that is not on your account → reply says it is "not registered to your account", shows your items as buttons, mentions Customer Service, and offers no ticket → AC-9
- [ ] AI chat: describe a problem that matches two of your items → reply asks which one and shows just those two buttons; tap one → the ticket offer appears with that item → AC-8
- [ ] AI chat: describe a dangerous high voltage repair → the safety warning shows, followed by "which of your equipment or software" and the item buttons; no ticket until you tap one → AC-10
- [ ] AI chat with Gemini unavailable (e.g. wrong `GEMINI_API_KEY`, then `config:cache`) → the "temporarily unavailable" message offers the ticket form, and the form still requires an item → AC-12
- [ ] Open the ticket form as a customer whose item status is `retired` → that item is not in the picker → AC-14
- [ ] Employee portal: create an internal ticket → equipment rules work as before (no Equipment / Software picker change) → AC-15

## Commands
- [ ] `docker exec ticket-service php artisan tinker --execute="echo json_encode(DB::select(\"SHOW COLUMNS FROM machines LIKE 'asset_type'\"));"` → one row, default `equipment` → AC-1
- [ ] `docker exec ticket-service php artisan assets:seed-customer-software` → prints "Dry run" and the items it would add; database unchanged → AC-2, AC-13
- [ ] After approval: `docker exec ticket-service php artisan assets:seed-customer-software --apply --link-ticket=8:LIS` → every customer has `SW-<id>-LIS/ECS/HIS`; TKT-0008 `machine_ID` is customer 4's `SW-4-LIS` row → AC-2, AC-13
- [ ] Run the seed command with `--apply` a second time → "Software items added: 0" → AC-2
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/ticketing/ticket/internal/customers/4/assets` (no token) → refused (403; checked live 2026-11-18) → AC-7
- [ ] From the ai-service container, the same path with `X-Internal-Token` → 200 with customer 4's items only → AC-7
- [ ] POST `/api/tickets` as customer A with customer B's `machine_ID` → 422 `errors.machine_ID` → AC-5
- [ ] POST `/api/tickets` with an equipment `machine_ID` and `problem_category_ID` of Software → saved category is Service → AC-5
- [ ] POST `/api/chat` with `selected_asset_id` of an item that is not yours → 422 → AC-8
- [ ] New customer ticket on a seeded software item → `tickets.branch_id` = `sbsi-makati-branch` → AC-16

## Value sourcing checks
- [ ] Form options: compare the picker with `SELECT machine_ID FROM machines WHERE client_ID = <you> AND (status IS NULL OR status = '' OR LOWER(status) = 'active')` → same set → AC-1, AC-14
- [ ] Group label: change one machine's `asset_type` to `software` → it moves to the Software group → AC-3
- [ ] Category id: rename nothing, but check the saved `problem_category_ID` equals the active, branch neutral "Service" or "Software" row → AC-5
- [ ] Ownership source: a token for customer A can never return customer B's items (form options or chat buttons) → AC-5, AC-7
- [ ] Seed list source: edit `config/assets.php` names in a scratch copy and run the dry run → the printed names follow the config → AC-2
- [ ] Serial code: seeded rows match `SW-<client_ID>-<CODE>` exactly → AC-2
- [ ] AI customer id: send `/api/chat` with a `user_id` for another customer using your own token → the buttons still show your own items → AC-7
- [ ] AI list cache: change an item name, chat within 60 seconds (old name), then after 60 seconds (new name) → AC-7
- [ ] Handoff: after a matched chat, `GET /api/escalate-handoff/<conversation>` returns that `machine_ID` → AC-11
- [ ] Branch: a seeded software ticket uses the default branch; an equipment item with a branch uses that branch → AC-16

## Acceptance-criteria coverage
- AC-1 command 1, value check 1 · AC-2 commands 2 to 4, value checks 5, 6 · AC-3 UI 1, 2, value check 2 · AC-4 UI 3, 4 · AC-5 UI 5, 6, commands 7, 8, value checks 3, 4 · AC-6 UI 7 · AC-7 commands 5, 6, value checks 4, 7, 8 · AC-8 UI 8, 10, command 9 · AC-9 UI 9 · AC-10 UI 11 · AC-11 UI 8, value check 9 · AC-12 UI 12 · AC-13 commands 2, 3 · AC-14 UI 13, value check 1 · AC-15 UI 14 · AC-16 command 10, value check 10
