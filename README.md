# RationSync

Educational prototype for Karnataka's public distribution system: Fair Price Shop inventory, warehouse approval of shops, replenishment, and optional collection appointments. **Not an official government service.** All seeded records are fictional.

| Path | What | Hosting |
| --- | --- | --- |
| `apps/web` | Next.js 16 App Router, Tailwind 4, shadcn/ui | Vercel |
| `apps/api` | Express 5 REST API under `/api/v1`, Zod, pino | Render |
| `packages/shared` | Types, Zod schemas and API contracts used by both apps | — |
| `supabase/` | Postgres migrations and fictional seed data | Supabase |

## Run locally

Requires Node 22.12 or later.

```bash
npm install

# Terminal 1: API on http://localhost:4000
npm run dev:api

# Terminal 2: web app on http://localhost:3000
npm run dev:web
```

Without any environment variables the web app runs in **preview mode**: sign-in is off and each role can be explored with fictional fixtures under a "Demo data" banner. The API starts, serves `GET /health`, and answers every `/api/v1` route with `503 auth_not_configured` (it fails closed).

Checks, all from the repository root:

```bash
npm run typecheck
npm run lint
npm test          # shared + API, including database tests against the real migration in PGlite
npm run build
```

## Connect a hosted Supabase project

1. Create a project at supabase.com.
2. **Apply the schema.** Run the migrations in filename order, then the seed (SQL editor, or `supabase link` + `supabase db push` with the CLI):
   1. `supabase/migrations/20261110000000_initial_schema.sql`: profiles and roles, warehouses, shops, commodities, inventory and the stock ledger, demo ration cards, appointment slots and bookings, notifications, audit log.
   2. `supabase/migrations/20261111000000_shops_inventory_alerts.sql`: application fields (PIN code, email), `shop_reviews` decision history, `shop_documents`, `stock_alerts`, and the functions `submit_shop_registration`, `review_shop`, `set_low_stock_threshold` and `refresh_stock_alert`. It also creates the private Storage bucket `shop-documents` (5 MB, PDF/JPEG/PNG) with its access policies.
   3. `supabase/migrations/20261112000000_warehouse_supply_chain.sql`: warehouse stock (`warehouse_inventory`, append-only `warehouse_stock_movements`), `replenishment_requests`, `shipments` with an explicit status-transition trigger, `shipment_items`, `delivery_discrepancies`, a `target_stock` column on shop inventory, and the functions `create_replenishment_request`, `decide_replenishment_request`, `create_shipment`, `dispatch_shipment`, `receive_shipment`, `resolve_discrepancy` and friends. Additive only: no table or column is dropped.
   4. `supabase/migrations/20261113000000_booking_status_no_show.sql`: adds the `no_show` booking status, alone because a new enum value cannot be used in the same transaction.
   5. `supabase/migrations/20261113000100_bookings_queue.sql`: demo card linking with attempt limits, weekly booking schedules, slot pause and close, walk-in places per slot, booking check codes, reschedule, the `queue_entries` table with its transition trigger, check-in, walk-ins, reminders. Additive only.
   6. `supabase/seed.sql`: fictional warehouses, shops, stock history, open alerts, warehouse opening balances, demo cards, booking schedules and slots.

   See [docs/supabase-integration.md](docs/supabase-integration.md) for the full checklist, risks and what the connected Supabase, Render and Vercel accounts currently contain.
3. **Auth settings.** Authentication > URL Configuration: set Site URL to your web origin (`http://localhost:3000` locally) and add `http://localhost:3000/auth/confirm` (and your Vercel URL equivalent) to Redirect URLs.
4. **API env** — create `apps/api/.env` from `apps/api/.env.example`:
   - `SUPABASE_URL`: Project Settings > API > Project URL
   - `DATABASE_URL`: Connect > Session pooler connection string, with your database password
   - `CORS_ALLOWED_ORIGINS`: `http://localhost:3000` locally, your Vercel origin in production
   - `SUPABASE_JWT_SECRET`: only if the project still signs sessions with the legacy HS256 secret
5. **Web env** — create `apps/web/.env.local` from `apps/web/.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`: same Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Project Settings > API Keys > Publishable key
   - `NEXT_PUBLIC_API_URL`: `http://localhost:4000` locally
6. **Warehouse administrators** are never self-registered. Create the user under Authentication > Users, then in the SQL editor:
   ```sql
   select public.provision_warehouse_admin('person@example.com', 'DEMO-WH-MYS');
   ```
   This is recorded in `audit_log`.

No secret key or `service_role` key is used by either app. The API connects to Postgres with `DATABASE_URL`, which must stay server-side.

## Deploy (not done yet; needs owner approval)

- **Render (API):** Root directory `apps/api`. Build command `cd ../.. && npm ci && npm run build -w @rationsync/api`. Start command `npm start`. Health check path `/health`. Set `NODE_ENV=production` plus the API variables above; the service refuses to start if `SUPABASE_URL`, `DATABASE_URL` or `CORS_ALLOWED_ORIGINS` are missing.
- **Vercel (web):** Root directory `apps/web`, framework Next.js. Vercel installs from the workspace root; the `prebuild` script compiles `packages/shared` first. Set the three `NEXT_PUBLIC_` variables, with `NEXT_PUBLIC_API_URL` pointing at the Render HTTPS URL.

Measure Render cold-start latency on the chosen plan before relying on it for live booking.

## API

All routes are under `/api/v1`, need `Authorization: Bearer <Supabase access token>`, and answer errors as `{ "error": { "code", "message", "details?" } }`.

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /me` | any signed-in user | Role, shop and warehouse assignments, from the database |
| `GET /registration`, `POST /registration` | shop admin | Read, submit, or resubmit after rejection, the account's application |
| `GET /registration/warehouses` | shop admin | Warehouses to choose from |
| `POST /registration/documents` | shop admin | Record a file already uploaded to the caller's Storage folder |
| `GET /shop/inventory`, `GET /shop/commodities` | approved shop admin | Stock on hand; commodity list |
| `POST /shop/movements` | approved shop admin | Opening balance, distribution or adjustment. Requires an `Idempotency-Key` header |
| `GET /shop/movements?commodity&before&limit` | approved shop admin | Ledger, newest first, cursor-paginated |
| `PATCH /shop/inventory/:code/threshold` | approved shop admin | Change a low-stock threshold (audited, re-checks alerts) |
| `GET /shop/alerts?status=open|resolved|all` | approved shop admin | The shop's alerts |
| `GET /warehouse/shop-registrations?status&district&warehouseId` | warehouse admin | Applications and directory, scoped to assigned warehouses |
| `GET /warehouse/warehouses` | warehouse admin | The caller's warehouses |
| `GET /warehouse/shops/:id` | warehouse admin | Full application, documents, decisions, stock and alerts (404 outside scope) |
| `POST /warehouse/shops/:id/review` | warehouse admin | Approve or reject with a reason; exactly once per application |
| `GET /warehouse/alerts`, `GET /warehouse/reviews` | warehouse admin | Low-stock monitoring and decision history, scoped |
| `GET /shop/requests?status=open|closed|all`, `GET /shop/requests/:id` | approved shop admin | The shop's replenishment requests |
| `POST /shop/requests` | approved shop admin | New request. Requires `Idempotency-Key`; one open request per commodity |
| `POST /shop/requests/:id/cancel` | approved shop admin | Cancel while pending |
| `GET /shop/suggestions` | approved shop admin | Per-commodity suggested quantity, recommended priority and coverage estimate |
| `GET /shop/shipments?status=incoming|received|all`, `GET /shop/shipments/:id` | approved shop admin | Dispatched shipments to the shop |
| `POST /shop/shipments/:id/receive` | approved shop admin | Confirm good and damaged quantities per item; once only |
| `POST /shop/shipments/:id/dispute` | approved shop admin | Report a shipment that has not arrived or is wrong |
| `GET /warehouse/overview` | warehouse admin | Counts, requests to decide, shipments awaiting receipt |
| `GET /warehouse/inventory`, `GET /warehouse/commodities` | warehouse admin | On hand, reserved, available and in transit per commodity; commodity list |
| `GET /warehouse/movements?warehouseId&commodity&page`, `POST /warehouse/movements` | warehouse admin | Warehouse ledger; record an opening balance, receipt or adjustment (`Idempotency-Key`) |
| `PATCH /warehouse/inventory/:warehouseId/:code/threshold` | warehouse admin | Warehouse low-stock threshold (audited) |
| `GET /warehouse/requests?status&priority&commodity&district&shopId&q&sort&page`, `GET /warehouse/requests/:id` | warehouse admin | Requests from shops in scope, with stock check and recommended priority |
| `POST /warehouse/requests/:id/decision` | warehouse admin | Approve (fully or partly, reserving stock) or reject, with a reason; once only |
| `GET /warehouse/shipments?status&shopId&page`, `GET /warehouse/shipments/:id` | warehouse admin | Shipments and delivery history |
| `POST /warehouse/shipments` | warehouse admin | Prepare a shipment from approved requests for one shop (`Idempotency-Key`) |
| `POST /warehouse/shipments/:id/dispatch`, `/in-transit`, `/cancel` | warehouse admin | Status changes allowed by the transition table |
| `POST /warehouse/discrepancies/:id/resolve` | warehouse admin | Record how a shortage or damage was settled (moves no stock) |
| `GET /warehouse/reconciliation?status`, `GET /warehouse/analytics` | warehouse admin | Requested, approved, dispatched and received per request; regional stock and usage |
| `GET /notifications`, `POST /notifications/read` | any signed-in user | The caller's in-app notifications |
| `GET /beneficiary/overview` | beneficiary | Linked shop, availability, next booking with queue position, unread count; adds due in-app reminders |
| `GET /beneficiary/profile`, `PATCH /beneficiary/profile` | beneficiary | Name and language (the role is never writable) |
| `POST /beneficiary/card-link` | beneficiary | Link a fictional `DEMO-` card by number and head of family; 5 failed attempts per hour, the same answer for every failure |
| `GET /beneficiary/slots` | beneficiary | Open and paused slots at the linked shop for the next 7 days, with bookable places left |
| `GET /beneficiary/bookings?scope=upcoming|past&page`, `GET /beneficiary/bookings/:id` | beneficiary | Own bookings; the QR token only on the owner's active booking |
| `POST /beneficiary/bookings`, `/:id/cancel`, `/:id/reschedule` | beneficiary | Book (repeat-safe), cancel, move in one transaction |
| `GET /shop/booking-schedule`, `POST /shop/booking-schedule`, `POST /shop/slots/publish` | approved shop admin | Weekly windows (capacity, walk-in places) and slot generation |
| `GET /shop/slots?from&days`, `POST /shop/slots/:id/status` | approved shop admin | Calendar; pause, resume, or close with a reason (cancels and notifies bookings) |
| `GET /shop/appointments?date` or `?scope=history&page`, `POST /shop/bookings/:id/no-show` | approved shop admin | Day list and history; mark a started booking not attended |
| `POST /shop/check-ins` | approved shop admin | Check in by QR token or typed code, only at the booking's shop and within its window; a repeat returns the same queue entry |
| `GET /shop/queue`, `POST /shop/queue/walk-ins`, `/call-next`, `/:id/finish` | approved shop admin | Today's queue, walk-ins, calling and finishing visits |
| `GET /shop/attendance` | approved shop admin | Last 30 days of bookings, attendance, walk-ins and counter time, from records |

## Security model

- The browser uses Supabase only for Auth. It sends the access token as `Authorization: Bearer` to the API.
- The API verifies the token against the project's JWKS (asymmetric keys; HS256 only if the legacy secret is configured), checks issuer and audience, then loads the role, shop and warehouse assignments **from the database**. Token metadata is never trusted for roles.
- Shop tools require `shop_admin` **and** an approved shop. Warehouse queries are scoped to the administrator's assigned warehouses.
- Postgres enforces what must hold no matter who calls: unique upper-case FPS IDs, non-negative stock, idempotent stock movements, slot capacity, one active booking per beneficiary, append-only `stock_movements` and `audit_log`, and the rule that sign-up can never produce `warehouse_admin`.
- Shop applications are decided by `review_shop`, which locks the row, re-checks that the reviewer administers the shop's warehouse, refuses anything not pending, and writes `shop_reviews`, `audit_log` and a notification in the same transaction. Ownership of a shop can never move to another account.
- Stock changes go through `apply_stock_movement` only (approved shops, idempotency key per shop, non-negative balance), which also opens or resolves the low-stock alert in the same transaction. Shops cannot record warehouse receipts; those arrive only through confirmed shipments.
- Supply chain rules live in Postgres functions, each one transaction with row locks and an `audit_log` entry, and each re-checks the caller's warehouse or shop scope itself:
  - Approving a request **reserves** warehouse stock; the check `quantity_reserved <= quantity_on_hand` makes over-allocation impossible even when approvals race. Nothing is added to the shop.
  - Dispatch moves the reserved quantity out of warehouse stock (one ledger entry per item, keyed by the item, so it cannot happen twice). It is then counted as in transit.
  - The shop confirms good and damaged quantities per item. Only good quantities are credited (`receipt` movement keyed by the item); shortages and damage become `delivery_discrepancies`. A second confirmation is refused.
  - Shipment status can only follow the transition table in `enforce_shipment_transition` (mirrored as `SHIPMENT_TRANSITIONS` in `packages/shared`). Cancellation is possible only before dispatch.
  - A shop administrator cannot decide requests (role check in the API, warehouse-assignment check in the database).
- Booking and queue rules are in Postgres too. A slot's bookable places are capacity minus the places kept for walk-ins, and the conditional update cannot overfill it; one active booking per household (partial unique index); rescheduling releases and takes places in one transaction; check-in is accepted only at the booking's own shop, from an hour before to an hour after the slot, once (a repeat returns the same queue entry); queue numbers are allocated under a shop row lock; one visitor at the counter at a time; queue statuses follow a transition trigger. Check-in and "served" are attendance only: they create no distribution record and change no stock.
- QR codes carry only the booking's random token (no personal data). The 10-character booking code typed as a fallback matches only within the checking shop's own bookings. Card linking accepts only `DEMO-` numbers, limits failures per account in the database, and gives every failure the same answer so taken cards cannot be discovered.
- Automation is plain arithmetic in `packages/shared`, tested and shown on screen with its basis: suggested quantity = target (default twice the threshold) − on hand − approved stock on its way, only at or below the threshold and never while a request is open; recommended priority from stock against threshold and days of cover; coverage = stock ÷ average daily distribution over the last 30 days, refused with fewer than 3 distributions or 7 days of history. Suggestions never submit or approve anything.
- Supporting documents live in a private bucket. Browsers upload with their own session into a folder named after their user id (Storage policy); the API records a file only after finding it there and takes size and type from Storage. Only the owner and administrators of the shop's warehouse can read it, through short-lived signed URLs.
- Role layouts in the web app authorise on the server before rendering any role-specific navigation, and the proxy sends signed-out visitors to sign-in using the verified session. The API remains the authority for every operation.
- RLS is enabled on every table. The `anon` and `authenticated` roles have no write access and no access to privileged functions; signed-in users can read only their own profile and notifications, plus the commodity list.

## Status

Phases 1 to 4 are in place: foundation; shop registration and review, inventory and low-stock alerts; warehouse stock, replenishment, shipments and reconciliation; and the household experience (demo card linking, profile, slot booking with reschedule and cancel, QR and code check-in, a virtual queue with walk-ins, in-app notifications and reminders, attendance summary). Not built yet: Kannada screens (household wording is centralised in `apps/web/src/lib/messages.ts`, awaiting a reviewed translation), PWA, email or SMS delivery, a scheduler for reminders (they appear when the household opens the app), and camera scanning on browsers without the BarcodeDetector API, such as Safari, which use the typed code instead.

Verified against PGlite (Postgres compiled to WebAssembly) with the real migrations and seed. PGlite runs one connection, so the concurrency tests prove the capacity and decide-once rules but not Postgres row locking under real parallel load. Nothing has yet been run against a hosted Supabase project; see [docs/supabase-integration.md](docs/supabase-integration.md).

In preview mode (no Supabase), forms validate with the same schemas as the API and answer as the API would, but save nothing; document upload is turned off.
