# RationSync | Project instructions for Claude Code

## Project mission
Build RationSync, a trustworthy, accessible, mobile-first web prototype for Karnataka's public distribution ecosystem. The system connects three application roles: ration beneficiary, Fair Price Shop (FPS) administrator, and warehouse administrator. Its core workflows are shop self-registration and approval, inventory tracking, low-stock alerts, replenishment requests, appointment booking, and a transparent audit trail.

This is an independent educational prototype, not an official Karnataka government service. Never present sample data, mock ration-card checks, permissions, or inventory as official or live government records. Never claim government affiliation, compliance, or integrations unless actually established and verified.

## Final stack and hosting architecture (owner-confirmed)
**Do not substitute a single-platform/full-stack Next.js deployment for this three-service architecture.**

- **Frontend, hosted on Vercel:** Next.js App Router + strict TypeScript + Tailwind CSS + shadcn/ui, customized into a coherent, accessible RationSync design system. Use Zod for client-facing form validation and Lucide for icons. Prefer Server Components for read-only presentation where useful, but do not implement the primary inventory, booking, approval, or shipment business APIs in Next.js route handlers.
- **Dedicated backend API, hosted on Render:** Node.js + Express + strict TypeScript, REST endpoints under `/api/v1`, Zod request validation, structured logging, centralized error handling, role/jurisdiction authorization, and transactions for critical writes. Implement background/scheduled tasks only when necessary, with explicit hosting and reliability checks.
- **Database and identity, hosted on Supabase:** PostgreSQL, Supabase Auth, RLS, optional Realtime, and Supabase Storage for approved document uploads. Use migrations in version control and seeded **fictional** demo data. Supabase is not the application REST backend for privileged workflows.
- **Development:** VS Code + Claude Code; mandatory design-skills workflow below (UI UX PRO MAX, APPLE DESIGN, UNSLOP).
- **Monorepo:** Prefer `apps/web` for the Vercel Next.js frontend; `apps/api` for the Render Express service; `packages/shared` for shared types, validation schemas, and API contracts; `supabase/migrations` and `supabase/seed.sql` for the database.
- **Repository deployment:** Configure Vercel root directory to `apps/web` and Render service root directory to `apps/api` (accounting for workspace build scripts). The Vercel frontend must call the Render API over HTTPS.
- Preserve the owner's choice of Vercel + Render + Supabase unless the owner explicitly approves a change. Do not silently move the API into Vercel functions or host the frontend on Render.
- Build responsive web first; evaluate PWA capabilities after core workflows work. Do not add infrastructure or dependencies without explaining the reason.

### Boundaries and request flow
1. Beneficiaries, shop admins, and warehouse admins use the Vercel-hosted web app.
2. Users sign in through Supabase Auth. The web app sends the authenticated user's access token in an Authorization Bearer header when calling the Render API. Avoid exposing long-lived credentials or storing sensitive tokens insecurely.
3. The Render API **verifies** the Supabase access token using supported Supabase authentication middleware or a secure JWT verification method, and enforces roles, shop membership, and warehouse jurisdiction on EVERY relevant request.
4. All authoritative business actions (shop approval, stock changes, replenishment, dispatch, appointment reservations/check-ins) run through the Render API and persist in Supabase Postgres. Ensure RLS aligns with the chosen backend access pattern; never rely on frontend button visibility as authorization.
5. Service-role/secret API keys must stay server-side and be used only for narrowly authorized operations with traceable audit logs. Service-role connections can bypass RLS; do not assume RLS protects operations using elevated credentials.
6. Upload supporting shop documents only to restricted Supabase Storage buckets with appropriate policies, access controls, and short-lived signed URLs where required.
7. Configure explicit CORS to allow only intended Vercel origins and local development, support preflight requests, and never use wildcard origins with credentials.

### Environment and deployment contract
- **Vercel / apps/web:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; public-prefixed values must never contain secrets.
- **Render / apps/api:** `PORT` (provided by host), `SUPABASE_URL`, the appropriate **server-only** Supabase credentials or `DATABASE_URL` as designed, `CORS_ALLOWED_ORIGINS`, plus any other secrets used by approved integrations.
- Render must listen on `0.0.0.0` and `process.env.PORT`, expose `/health`, and fail safely when required variables are absent.
- Maintain separate local `.env.example` files with placeholder names only. Never commit real `.env` files, service-role keys, database passwords, or private tokens.
- Keep local, preview, and production configuration separate; verify both frontend and backend builds and test authenticated API calls before launch. Verify Render instance behavior and response latency for selected plan before promising reliable real-time booking or scheduled alerts.

## Mandatory use of existing design skills
The following skills are already installed according to the project owner: **UI UX PRO MAX**, **APPLE DESIGN**, **UNSLOP**.

For every new page, important UI modification, or design review:
1. Discover the actual installed names and instructions, rather than guessing commands or filenames. Consult **UI UX PRO MAX** before choosing layouts, colors, typography, interaction patterns, or data visualization.
2. Consult **APPLE DESIGN** for clarity, visual hierarchy, spacing, accessibility, direct feedback, and restrained motion. Take design *principles*, not Apple trademarks, clone-like interfaces, or mandatory glass effects.
3. Use **UNSLOP** to audit the screen after implementation, identify generic AI-generated design patterns, and refine them. Review the actual running UI, not only source code, where browser/screenshot tooling is available.
4. If any skill is not accessible in the current Claude Code session, say which one and do not pretend it ran. Ask for no installation unless explicitly requested.
5. When skill advice conflicts with these project requirements, follow these project requirements. Avoid mechanically combining incompatible design languages.

## Visual direction: restrained civic-tech product
The interface must feel trustworthy, practical, calm, contemporary, and genuinely designed for Karnataka's ration ecosystem. It must not look like a synthetic startup landing-page template.

Suggested starting design tokens (adjust only after assessing contrast and real screens):
- Canvas: `#F7F8F6`; surfaces: `#FFFFFF`; primary text: `#182620`.
- Primary/action green: `#215B45`; secondary/muted text: `#506158`.
- Borders: `#DDE5DF`; warning: `#94601A`; destructive: `#A43E3E`.
- Border radius: 6-10px for most controls and panels. No pill-shaped primary buttons.
- Typography: Inter (or similarly legible sans-serif) for English; Noto Sans Kannada for Kannada. Use a defined type scale and consistent spacing tokens.
- Icons: one coherent Lucide icon family, labeled when meaning could be ambiguous. Never use emojis as interface icons.
- Dark mode is optional; prioritize a high-quality light mode first.

These are starting values, not proof of accessible contrast. Test all text, icons, focus indicators, and state colors against their actual backgrounds.

### Anti-AI-slop rules
NEVER use:
- Purple gradients, glowing blobs, random gradients, neon halos, or decorative mesh backgrounds.
- Oversized, vague hero messaging such as “Revolutionizing the Future of Distribution.”
- Empty marketing slogans, exaggerated claims, invented partnerships, fake reviews, or fake beneficiary counts.
- Fake live metrics, fabricated analytics, misleading charts, or invented success percentages.
- Generic AI-looking illustrations, synthetic photos of people, decorative robots, or meaningless stock photos.
- Emoji icons, excessive glassmorphism, gratuitous shadows, giant rounded cards, or repeated card grids for every piece of content.
- Cursor followers, parallax for decoration, elaborate scroll reveals, auto-playing animation, or confetti for routine tasks.
- Default boilerplate copy (“Empowering seamless solutions”, “Unlock your potential”), random em dashes in marketing prose, or verbose labels.
- Overcrowded sidebars, arbitrary chart widgets, excessive badges, or decorative controls without a purpose.

ALWAYS prefer:
- Clear, literal, concise interface copy based on actual user tasks.
- Purposeful layouts with hierarchy: tables for inventory, lists for requests, calendars/slots for booking, maps only when geography helps.
- A small consistent set of components with sensible empty, loading, success, error, and disabled states.
- Subtle hover/focus/press feedback and modest durations; respect `prefers-reduced-motion`.
- Distinct, consistent status labels (pending, approved, rejected, low stock, dispatched, received), never color alone.
- Useful detail: commodity units, shop IDs, request reference numbers, timestamps, capacity, and stock-change reasons.
- Authentic brand identity for **RationSync**, not a clone of Apple, a government site, or generic SaaS templates.

## Design each role for its actual tasks
### Beneficiary
- Clear onboarding and **fictional demo ration-card verification**; never imply official verification.
- View linked shop, available commodities (where accurately represented), opening/service information, and appointment availability.
- Book, view, cancel, or reschedule collection appointments; see QR booking token and accessible text alternative.
- Display plain-language receipt or booking confirmation, Kannada/English switch, and useful error guidance.
- Slot booking is an **optional crowd-management convenience**, not a condition for receiving legally entitled foodgrains. Provide walk-in or assisted alternatives.

### Shop administrator
- Self-register shop with unique FPS identifier, contact and jurisdiction; submission enters pending review.
- Display approval status without exposing admin features before approval.
- View inventory by commodity and unit, stock movement history, shortage thresholds, pending requests, incoming shipments, and bookings.
- Generate stock replenishment requests, record delivery acceptance, manage booking capacity, and check in bookings.
- Never silently alter official transaction records. A booking check-in is not the same as government e-POS distribution/authentication.

### Warehouse administrator
- Provision warehouse admin accounts through a controlled method, NOT public self-registration.
- Review shops and approve/reject with recorded reason and audit trail, restricted to authorized jurisdiction.
- View assigned shop stock alerts, replenishment requests, shipments, and regional summaries.
- Prioritize genuinely urgent shortages. Show the formula/threshold behind alerts and forecasts; do not label simple heuristics “AI” or “machine learning.”

## Security, correctness, and data rules
- Enforce authentication, authorization, tenant/jurisdiction boundaries, and record-level access on the server and with Supabase RLS. Never rely on hidden UI alone.
- A user must never be able to self-assign the `warehouse_admin` role. Prevent privilege escalation through profile edits, API requests, and metadata.
- Use actual database constraints, transactions, and idempotent operations to prevent duplicate FPS IDs, double booking, oversold capacity, negative inventory, and repeated stock receipts. Implement these validations in the Render API and/or PostgreSQL; never depend on client-side checks.
- Keep an append-only or properly controlled audit trail for stock adjustments, approvals, dispatches, cancellations, and check-ins. Record actor, time, entity, action, and reason where relevant.
- Never hard-code service-role secrets or expose them to the browser. Keep `.env.local` out of version control. Provide a safe `.env.example` without values.
- Never log or show actual ration-card numbers, Aadhaar numbers, biometric information, or credentials. Seed with fictional data only. Protect any personally identifiable information in future integrations.
- Do not imply direct integration with AHARA, UIDAI, e-POS, or government databases without authorized access and working verification.
- Never generate real-time statistics by hand. Display values derived from the database; label fixtures as `Demo data` prominently.
- Validate all input with Zod/server-side rules. Handle permission errors and network failures gracefully.
- All administrative actions should be traceable. For high-impact actions, show clear confirmation and consequences.

## Interaction and accessibility standards
- Build mobile-first, but support desktop workflows well (shop and warehouse dashboards particularly).
- Target WCAG 2.2 AA; use semantic HTML, keyboard navigation, visible focus states, useful labels, accessible dialogs, form errors, and suitable contrast.
- Aim for generous touch targets (approximately 44px where practical).
- Never force users to rely only on color, icon shape, animation, or sound for meaning.
- Show realistic skeleton/loading states only where necessary; do not fake successful saves.
- Provide clear feedback for every meaningful action and a route to recover from errors.
- Design localization-ready components; use English initially with Kannada support planned and tested for font rendering and longer text.
- Prefer readable tables with responsive alternatives over horizontally clipped critical data.

## MVP workflow and delivery discipline
1. Inspect existing repository, scripts, skills, routes, and database before changing anything.
2. Summarize the task in one paragraph and list affected files; for significant work provide a short implementation plan.
3. Build one complete vertical slice at a time: auth/role routing → shop registration/approval → stock movements/alerts → requests/shipments → appointments/check-in → analytics/polish.
4. Before UI implementation, consult the design skills and define page hierarchy, layout, content, responsive behavior, empty state, and interaction states.
5. Implement functional code, not mock buttons. If a flow is explicitly demo-only, label it as such and ensure it behaves consistently.
6. Run typecheck, lint, unit/integration tests, and build when configured. Add focused tests for security/authorization, booking capacity, stock quantities, and approval flows.
7. Inspect the running pages at mobile and desktop sizes where screenshot/browser tools are available. Run the Unslop pass and fix substantive problems.
8. At completion, report exactly what changed, what was tested, what passed/failed, and what is still simulated or unimplemented. Do not claim “pixel-perfect”, “bug-free”, or “no mistakes” without evidence.
9. Avoid destructive migrations, mass database changes, deployment, paid API calls, or other externally consequential actions without explicit authorization.
10. Keep components small and reusable; do not introduce abstractions, libraries, or elaborate architecture without a real need.

## Page quality gate
Do not call a page finished unless:
- The page has a specific, understandable primary task and a clear visual hierarchy.
- No prohibited AI-slop patterns are present.
- Real database data or clearly labeled fictional demo data is used, never invented “live” numbers.
- Primary actions work and failures are handled.
- Mobile/tablet/desktop and keyboard interactions have been checked where tooling permits.
- Text, spacing, colors, icons, controls, empty states, loading states, and errors are consistent.
- Security boundaries for that screen have been verified where applicable.
- The Unslop review has been performed where available, and findings addressed or documented.

## Launch gate
A **public launch** is not approved until:
- An appropriate custom domain, favicon, page titles, metadata, and brand identity are configured.
- Privacy policy and terms pages accurately reflect real data practices and deployment responsibilities; do not fabricate legal assurances.
- Any starter-template badges or “Made with AI” attribution are removed **only if license/terms permit**; preserve legally required attribution and notices.
- Authentication, RLS, API authorization, CORS, rate limiting, error monitoring, backups, accessibility, and critical workflows across Vercel, Render, and Supabase have been reviewed.
- An appropriate production privacy/security/legal review and government integration authorization have been completed if processing real beneficiaries or official data.
- No untested government integrations or production-grade verification claims are published.

For classroom/demo presentations before launch, using a temporary preview URL and fictional sample data is fine, provided the app is clearly marked **Prototype / Demo**, no real personal data is collected, and access controls are appropriate.

## How to communicate
- Be honest, direct, specific, and concise. Prefer concrete recommendations over empty praise.
- Tell the project owner when requirements conflict, when an assumption is being made, or when something cannot be verified.
- Ask before making substantial product scope changes. For routine implementation details, choose sensible defaults consistent with this file.
- Prioritize a correct, accessible, coherent product over visual spectacle or a large feature count.
