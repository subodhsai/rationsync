# RationSync design system

Tokens live in `apps/web/src/app/globals.css`. This file records why they are what they are.

## Direction

- **Product:** stock, shop approvals and collection visits for Karnataka's Fair Price Shops, their wholesale points and the households they serve.
- **Character:** steady, exact, plainspoken.
- **World:** the shop's stock register: ruled ledgers, weights in kilograms, printed token slips, stamped approvals.
- **Moments:** the inventory ledger (quantity against a visible threshold tick); later, the QR collection slip.
- **Signature:** official identifiers (FPS IDs, references, tokens) and units set in Atkinson Hyperlegible Mono, like entries in a register.

Inputs: UI UX Pro Max recommended Swiss-style minimalism and Atkinson Hyperlegible for government and accessibility-critical products; both were adopted. Its navy palette was not, because CLAUDE.md specifies the green civic palette. Its scroll-reveal motion was dropped, as CLAUDE.md rules out decorative scroll animation. Apple Design guided hierarchy, press feedback, symmetric sheet motion and reduced-motion handling. Unslop was run against the running UI (findings below).

## Colour

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `background` | `#F7F8F6` | Page canvas | — |
| `card` | `#FFFFFF` | Panels, tables, header | — |
| `foreground` | `#182620` | Body text | 14.7:1 on canvas |
| `muted-foreground` | `#506158` | Secondary text | 6.2:1 on canvas |
| `primary` | `#215B45` | Primary action, selection, focus ring | 7.9:1 with white text |
| `warning` | `#94601A` | Low stock, demo notice | 5.3:1 on white, 4.8:1 on its tint |
| `destructive` | `#A43E3E` | Out of stock, rejection, errors | 6.3:1 on white |
| `border` | `#DDE5DF` | Dividers (decorative) | — |
| `input` | `#7A8B82` | Form control borders | 3.6:1 on white (needs 3:1) |

One accent (green). Status colours appear only as tinted labels that always carry a word and an icon.

## Type

Atkinson Hyperlegible Next for the interface, Atkinson Hyperlegible Mono for identifiers and units, Noto Sans Kannada for Kannada (browsers fall back to it per glyph). Body 16px / 1.5; Kannada gets 1.7 line height. Weights 400, 500, 600. Negative tracking only on headings of 24px and up.

## Shape, spacing, motion

Radius 8px for controls and panels (CLAUDE.md asks for 6–10px); no pill buttons. Spacing on a 4px grid. Buttons are 40px by default and 44px for primary page actions; inputs 40px with 16px text. Transitions name their properties, last 150ms, and use one curve (`--ease-standard`). `prefers-reduced-motion` collapses all motion.

## Unslop review (Phase 1)

Audit of the running pages at 1440px and 390px. Findings fixed:

1. Sidebar account line truncated the FPS ID; the redundant role label for shop admins was removed.
2. The global prototype strip plus a full-height sidebar made every console page scroll by 32px; the notice moved inside each shell.
3. Sheet overlay used a backdrop blur; replaced with a plain dim.
4. Sheet close button was 28px; now 40px.
5. Registrations table repeated the selected filter in a Status column on every row; removed.
6. Generated components used `transition-all`, pill badges and a 50%-opacity focus ring (about 2.4:1); replaced with named transitions, 6px-radius labels and a solid 2px outline.
7. Unused generated components (dropdown, tabs, card, separator, toast) were deleted.

Checked and kept: no gradients, glows, emoji, invented metrics or stock imagery; one accent; every status pairs text and icon; no horizontal scroll at 390px; tables become lists on phones.

## Unslop review (Phase 2)

Audit of the running registration, commodity, review and alert screens at 1280px and 390px. Findings fixed:

1. Preview mode accepted a distribution larger than the stock on hand. Preview now gives the same answers as the API (insufficient stock, opening balance already recorded), with the same messages.
2. A "Preview mode" note repeated under every form on top of the page banner; replaced by one sentence in the banner.
3. Invalid inputs drew a pink glow ring; the red border alone marks them now.
4. "Shop directory" was highlighted while reviewing a pending application; shop detail pages highlight no nav item and rely on their back link.
5. "Decision" appeared as both the panel title and the field legend; the legend is screen-reader only.
6. A preview message used a hyphen as a minus sign; quantities use a true minus.

Decisions taken from the skills: review decisions use a two-step confirmation stating the consequence (UI UX Pro Max: confirm irreversible actions; Apple Design: confirmation only where it cannot be undone). Forms keep what was typed after an error and move focus to an announced summary. Tables become lists on phones. Alerts are ordered by urgency and show the threshold behind them; nothing is labelled as a prediction.
