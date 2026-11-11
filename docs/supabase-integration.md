# Hosted integration checklist

Status on 11 Nov 2026: **nothing has been applied to any hosted service.** Everything below was inspected read-only through the connected MCP servers. Each step marked *needs approval* changes a cloud resource and waits for the project owner.

## What is connected

| Service | Connection | What was found |
| --- | --- | --- |
| Supabase | Working | One project, "subodhsai's Project" (ref `lykxxiccgwyohyzdmpvg`, Postgres 17, region ap-northeast-2), status **INACTIVE** (paused). It is not a dedicated RationSync project. |
| Render | Working | Workspace "Sai Subodh", **no services**. |
| Vercel | Not usable yet | Listing projects returns 403: the connection's default scope is a team named "aryandalla" that this account is not authorised for. Re-authorise the Vercel connector for your own account or team before any Vercel step. |

## Recommended setup

1. **Create a separate development project** named `rationsync-dev` in region `ap-south-1` (Mumbai, nearest to Karnataka) on the free plan. *Needs approval.* Do not reuse the paused project: it may hold unrelated data, and a clean project makes advisor output meaningful. (The free plan allows two active projects.)
2. Keep production as a later, separate project. Never run `seed.sql` on it.

## Migrations, in order

| File | Depends on | Notes |
| --- | --- | --- |
| `20261110000000_initial_schema.sql` | `auth.users` | Creates the `on_auth_user_created` trigger on `auth.users` (standard Supabase pattern; runs as the `postgres` migration role). |
| `20261111000000_shops_inventory_alerts.sql` | Storage schema | Inserts the private `shop-documents` bucket and two policies on `storage.objects`; uses `storage.foldername`. |
| `20261112000000_warehouse_supply_chain.sql` | earlier tables | Additive only. Uses `trim_scale` (Postgres 13+; the project runs 17). |
| `20261113000000_booking_status_no_show.sql` | `booking_status` enum | Only `alter type ... add value`. Kept in its own file because Postgres cannot use a new enum value in the transaction that adds it. |
| `20261113000100_bookings_queue.sql` | the previous file | Additive: new tables, new columns with defaults, a generated column on `bookings`, replaced function bodies with unchanged signatures. |
| `seed.sql` (development only) | all migrations | Fictional data only (see below). |

Apply with the Supabase MCP `apply_migration`, one file at a time in this order, or `supabase db push` from a linked CLI. *Needs approval.*

### Risks reviewed

- **No destructive statements.** No `drop table`, `drop column` or data rewrites. `create or replace function` replaces bodies of functions this project owns.
- **Default grants.** Supabase grants new tables to `anon` and `authenticated` by default. Every migration revokes those grants for its own tables and revokes `execute` on all functions in `public`, then re-grants the single function the Storage read policy needs. Any future migration must do the same.
- **RLS.** Enabled on every table. Only three browser-readable policies exist (own profile, own notifications, commodity list) plus the two Storage policies. The advisor will report "RLS enabled, no policy" for the other tables; that is intended, because browsers never query them.
- **API connection bypasses RLS.** The Render API connects with `DATABASE_URL` as a privileged role, so RLS does not protect API queries; the API's role and scope checks and the database functions' own scope checks do. Keep `DATABASE_URL` server-side only.
- **Pooling.** Use the Supavisor *session* pooler connection string (IPv4, port 5432) for Render. The transaction pooler has not been tested with this code.
- **Clock.** Booking, check-in windows and the queue day use `Asia/Kolkata` explicitly in SQL, so the server's UTC clock does not shift them.

### Seed data

`seed.sql` contains only invented records: warehouses and shops named "Demo …" with `DEMO-` codes and FPS IDs, phone numbers `+91 90000 00xxx`, ration cards `DEMO-000101` to `DEMO-000140` with heads of family "Demo household N", and invented stock quantities. No real person, card, Aadhaar number or shop is included. Seeded shops have no owner; demo users are created through sign-up, and warehouse administrators through `provision_warehouse_admin`.

## Environment variables

| Where | Variable | Value |
| --- | --- | --- |
| Render (API) | `NODE_ENV` | `production` |
| | `SUPABASE_URL` | Project URL |
| | `DATABASE_URL` | Session pooler connection string, with the database password. Secret. |
| | `CORS_ALLOWED_ORIGINS` | The Vercel production origin, plus the preview origin if used |
| | `SUPABASE_JWT_SECRET` | Only if the project still signs sessions with the legacy HS256 secret; new projects use JWKS signing keys and need nothing |
| | `PORT` | Set by Render |
| Vercel (web) | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (safe for browsers) |
| | `NEXT_PUBLIC_API_URL` | The Render service's HTTPS URL |

No `service_role` or secret key is used by either app.

## Auth settings

- Site URL: the Vercel origin. Redirect URLs: `<origin>/auth/confirm` for each origin, plus `http://localhost:3000/auth/confirm`.
- Email confirmation stays on. Supabase's built-in email sender is rate-limited and meant for testing; configure custom SMTP before inviting more than a few testers.

## After approval: verification plan

1. Create the dev project and apply the five migrations, then the seed.
2. Run the security and performance advisors and record the results here.
3. Sign up a household, a shop administrator and a warehouse user; provision the warehouse user with `provision_warehouse_admin`.
4. Point a local API at the dev project and run the smoke flow: application, approval, stock, request, shipment, card link, booking, check-in, queue.
5. Add a concurrency test that opens separate Postgres connections and books the last places in a slot at the same time. PGlite, used by the current tests, runs one connection and cannot show real row locking.
6. Only then create the Render service (root `apps/api`) and the Vercel project (root `apps/web`). *Needs approval.*
