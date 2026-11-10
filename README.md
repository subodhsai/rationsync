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
2. **Apply the schema.** In the SQL editor, run `supabase/migrations/20261110000000_initial_schema.sql`, then `supabase/seed.sql`. (Or with the Supabase CLI: `supabase link` then `supabase db push`, and run the seed separately.)
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

## Security model

- The browser uses Supabase only for Auth. It sends the access token as `Authorization: Bearer` to the API.
- The API verifies the token against the project's JWKS (asymmetric keys; HS256 only if the legacy secret is configured), checks issuer and audience, then loads the role, shop and warehouse assignments **from the database**. Token metadata is never trusted for roles.
- Shop tools require `shop_admin` **and** an approved shop. Warehouse queries are scoped to the administrator's assigned warehouses.
- Postgres enforces what must hold no matter who calls: unique upper-case FPS IDs, non-negative stock, idempotent stock movements, slot capacity, one active booking per beneficiary, append-only `stock_movements` and `audit_log`, and the rule that sign-up can never produce `warehouse_admin`.
- RLS is enabled on every table. The `anon` and `authenticated` roles have no write access and no access to privileged functions; signed-in users can read only their own profile and notifications, plus the commodity list.

## Status

Phase 1 (foundation) is in place. Not built yet: shop registration form, approval actions, stock movement entry, replenishment and shipments, card linking, booking and QR check-in, notifications, Kannada interface, PWA.
