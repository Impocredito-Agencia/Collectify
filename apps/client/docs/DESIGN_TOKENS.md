# Design Tokens

Extracted from the Figma **"Design System"** file (`88muDL6Toh6RC9PnwNtzpk`), library page, frame **node `30:2`** ("Colors / Typography / Spacing & Layout / Components"). Applied in [`src/index.css`](../src/index.css) via Tailwind v4's `@theme`.

Update this file and `index.css` together if the library changes — don't let them drift.

## Colors

The dark neutral palette is custom (not a Tailwind default scale) — defined as theme tokens, used as `bg-background`, `text-muted`, `border-border`, etc.

| Token | Hex | Figma name | Use |
|---|---|---|---|
| `background` | `#08090A` | Background | Page canvas |
| `surface` | `#0F1011` | Surface | Cards / panels |
| `input` | `#16171A` | Input | Form field background |
| `border` | `rgba(255,255,255,0.08)` | Border | Borders / separators / `bg-border` chip fills |
| `mid` | `#4A4E54` | Mid | Placeholders / icons |
| `subtle` | `#62666D` | Subtle | Very secondary text |
| `muted` | `#8A8F98` | Text Secondary | Subtitles / labels |
| `white` (override) | `#F7F8F8` | Text Primary | Overrides Tailwind's built-in `white` — every existing `text-white` picks this up automatically |

**Font stack copied 1:1 (style cleanup, 2026-09-02, third pass):** the
client inspected Linear's actual product sidebar with their own browser
devtools (not the marketing site this time — their live app) and sent the
exact computed `font-family` string:
`"Inter Variable", "SF Pro Display", -apple-system, BlinkMacSystemFont,
"Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica
Neue", sans-serif`. Copied into `--font-sans` in `index.css`, with one
addition: `'Inter'` inserted right after `'Inter Variable'`. Linear's first
name resolves for them because they self-host a font file actually
registered as "Inter Variable" — we still load Google Fonts' "Inter" (see
`index.html`), which is a different registered name, so without the
fallback the whole first name would silently miss and every browser here
would fall through to system fonts instead of our webfont. Same devtools
comparison also showed Linear's real sidebar group-label color is
`#62666D` (our `subtle` token) — dimmer than the `muted` token this app's
section labels used at the time. Client confirmed to apply it: every
`text-section-label` usage app-wide (Sidebar, Dashboard, ClientDetailPage,
LoanDetailPage — LoginPage's already used `subtle`) now pairs with
`text-subtle` instead of `text-muted`, overriding the marketing-site-based
guess from the previous pass with this more direct product evidence.

**Sentence case, not all-caps (style cleanup, 2026-09-02, fourth pass):**
every `text-section-label` string in the app was hardcoded ALL CAPS
("MENÚ", "KPIS", "REFERENCIAS", "HISTORIAL DE PAGOS", etc.) — the client
said this read badly and asked for sentence case (first letter capital,
rest lowercase) instead. Changed all of them, plus removed
`item.groupLabel.toUpperCase()` in `Sidebar.tsx` (the source strings
'Catálogos'/'Administración' were already in the requested casing — the
`.toUpperCase()` call was actively undoing that). One deliberate literal
follow of the instruction worth flagging: Dashboard's "KPIS" became "Kpis"
rather than "KPIs" — technically an odd rendering of a well-known acronym,
kept as asked rather than silently overridden; easy one-line revert if the
client wants "KPIs" preserved instead.

**Sidebar footer: two real rows instead of one shared row (style cleanup,
2026-09-02, tenth→eleventh pass):** first attempt pinned Salir with
`absolute bottom-3 right-3.5` against a `relative` row so it would sit
next to the role line without eating into the name's width — worked for
width, but the client caught the icon sitting 1-2px off from the role
text's actual line (an absolute offset tuned by eye can't precisely match
another element's real line box), and the name still wasn't reaching the
full row width. Replaced with a structural fix instead of a better guess:
name (with the avatar) and role (with Salir) are now two genuinely
separate flex rows (`flex-col` on the outer wrapper), each sized and
aligned independently.
- Name's row has nothing else in it, so it takes the row's full width —
  no more shared budget with Salir at all.
- Role's row has Salir as a true flex sibling with `items-center`, so
  they're vertically centered against each other exactly, the same
  mechanism every nav item already uses for its own icon+label — nothing
  to manually offset or get slightly wrong.
- The role row gets `pl-[34px]` (avatar's 26px + the row's 8px gap) so
  the role text still lines up visually under the name, matching the
  original layout.
- Role is now plain text, not a second link to `/perfil` — the name row
  above already covers navigating to the profile page; duplicating that
  as a second link on the role row would've been redundant.

**Sidebar footer height trimmed (style cleanup, 2026-09-02, twelfth
pass):** the two-row split above fixed alignment but made the block
visibly taller — the 26px avatar used to be centered against the combined
2-line name+role block (~36px, taller than the avatar, so it added no
extra height on its own), but now sits alone in the name row and directly
sets that row's height, plus there's a real gap between the two rows that
didn't exist as added height before. `py-3` → `py-2` on the outer wrapper
brings total height back down close to the original ~60px.

**Sidebar footer: avatar re-centered against both lines, lines pulled
tighter (style cleanup, 2026-09-02, thirteenth pass):** `py-2` alone
wasn't enough — the client wanted the avatar back to visually centering
between the name and role lines (as it did originally) and the two lines
themselves closer together. The two-row split from the eleventh pass had
made the avatar center against the name line alone (looked squashed to
the top) since it was nested inside that row specifically. Restructured
so the avatar is a sibling of a name+role column instead of being nested
inside the name's own link — `items-center` on the outer row now centers
it against the column's full 2-line height again, and the column's
internal gap dropped to `gap-0`. Only the name text itself is a `NavLink`
now (not the avatar, which is purely decorative) — Salir still can't
nest inside any `<a>`, so this was the minimal restructure that restores
the original centering without reintroducing that problem. One real
behavior change: clicking the avatar no longer navigates to `/perfil`,
only the name text does — flagged, not hidden; the name is still a large
target right beside it.

**Sidebar footer: fourteenth pass was wrong, reverted (style cleanup,
2026-09-02):** tried `leading-none` on the name/role lines to fix the
avatar's apparent low position, reasoning it was a line-height/visual-vs-
geometric-center mismatch. The client caught it immediately: the avatar
didn't move at all, and the name/role lines lost their normal spacing and
looked broken/cramped. Reverted both `leading-none` additions in full.

**Sidebar wordmark: faceted-diamond mark replaces the plain "C" (style
cleanup, 2026-09-02, sixteenth pass):** client wanted the sidebar's
letter-in-a-box mark replaced with something more original, with "más
trasfondo" — pointed to Linear's mark (layered shapes at different
opacities reading as one form with real depth) as the reference, not
another flat line icon. Landed on a faceted diamond after showing several
concepts (magnet, check-tag, bar chart, cycle, linked rings, stacked
cards, then a second, more abstract round: pinwheel, diamond chip, signal
rings, tilted stack) — the diamond read as the best fit for a shop selling
phones/computers/printers/invoicing software: gem-cutting facets doubling
as a chip/circuit motif for the tech side of the business. `CollectifyMark`
in Sidebar.tsx: 4 triangular facets of the same white, each a different
`fill-opacity` (0.22/0.95/0.55/0.75), which is what creates the layered
depth instead of a flat single-tone icon. Sized `size-6` inside the
existing `size-7` tile (barely any margin) per the client's ask to use the
whole card, not a small icon centered with a lot of empty space around it.
Tile background changed from flat `bg-white` to `bg-input` (#16171a) —
reusing the existing "next surface up" token instead of introducing a new
one-off hex, and it reads better against the dark sidebar than a stark
white square did.

**Wordmark: shared across Sidebar and LoginPage, Sidebar header enlarged
(style cleanup, 2026-09-02, seventeenth pass):** two follow-ups once the
diamond mark was confirmed. First, `CollectifyMark` moved out of
Sidebar.tsx into `components/ui/CollectifyMark.tsx` (same pattern as
`CloseButton.tsx` — a small shared UI component with a `className` prop
for sizing) so LoginPage.tsx could use the same mark instead of keeping
its own separate "C" tile; LoginPage's tile also switched from `bg-white`
to `bg-input` for the same reason as the Sidebar's. Second, the client
compared the Sidebar header against a screenshot and pointed out how much
of the card's own width/height sat empty around a small logo + name.
Sidebar's tile went `size-7` → `size-9`, its `CollectifyMark` → `size-7`,
and "Collectify" → `text-[19px]` (was `text-[15px]`), `gap-2.5` →
`gap-3` — row padding (`p-5`) untouched.

**Sidebar header: sized up again (style cleanup, 2026-09-02, eighteenth
pass):** client asked for another size increase after the seventeenth
pass. Tile `size-9` → `size-10`, `CollectifyMark` → `size-8`, "Collectify"
`text-[19px]` → `text-[22px]`. Same row padding/gap as the seventeenth
pass, untouched.

**Sidebar header: row height brought back down (style cleanup,
2026-09-02, nineteenth pass):** the row's height is just its content plus
padding, so growing the logo/text across the seventeenth/eighteenth passes
grew the row's own height along with it. Client wants the row shorter
without shrinking the logo/text back down — so only the vertical padding
came down: `p-5` → `px-5 py-3`. Horizontal padding and the divider right
below the row are untouched. Tile stays `size-10`, `CollectifyMark`
`size-8`, "Collectify" `text-[22px]`.

**Sidebar header: logo+wordmark centered in the row (style cleanup,
2026-09-02, twentieth pass):** at this size the logo+wordmark no longer
come close to filling the row's 220px width, so left-aligning them (the
flex row's default, since it's the only thing in the row) read as
lopsided — all the leftover space sitting on the right, pulling the whole
lockup visually toward the left edge. Added `justify-center` to the row.

**Sidebar header: dropped the tile around the mark (style cleanup,
2026-09-02, twenty-first pass):** after centering, the client felt the
lockup now leaned right instead. The `bg-input` tile (`size-10`) was
bigger than the mark itself (`size-8`), so it added a bit of padding-driven
weight on the icon side that the wordmark side didn't have — enough to
throw off the centering by eye even though the row itself was genuinely
centered. Removed the tile div; `CollectifyMark` now sits directly in the
row at the same `size-8`, no background/container. The mark's white fill
still reads fine straight against the sidebar's own dark background.

**Sidebar header: centering reverted (style cleanup, 2026-09-02,
twenty-second pass):** client compared the centered header against a
screenshot of the full sidebar and didn't like it against every nav item
below it, which are all left-aligned — a centered header over a
left-aligned list read as more "off" than a header that simply isn't
full-width. Removed `justify-center`, back to the row's default left
alignment. The twenty-first pass's tile-less mark is unaffected and stays.
LoginPage's own lockup was left
at its original `size-7`/`text-body` scale — that card's visual scale is
set by the Figma-matched heading below it (frame 16:2), not this logo row,
and the client's size complaint was specifically about the Sidebar.

**Cross-app centralization: tables and KPI/stat cards (style cleanup,
2026-09-02):** client's ask this round wasn't a single screen — noticed
Linear's consistency came partly from reusing the same few text
size/color combinations everywhere, and asked to find every *repeated UI
pattern* across the app (tables, KPI cards) and bring each one to a single
typography recipe, using judgment rather than being handed a list of
screens.

Audited every `<table>` in the app (13 files) and every "label + big
number" card. Two shared components came out of it:

- `components/ui/Table.tsx` — `Th`/`Td`, matching the majority pattern
  already shared byte-for-byte between `ClientRow.tsx` and `LoanRow.tsx`
  (`Th`: `h-[38px] px-3.5 text-left text-label font-normal
  tracking-normal text-muted`; `Td`: `h-11 px-3.5 text-small`, either
  `font-medium text-white` by default or `text-muted` with a `muted`
  prop for the row's secondary columns).
- `components/ui/StatCard.tsx` — the "label + big number" card
  (`text-small text-muted` label, `text-kpi font-light text-white`
  value), already byte-identical between DashboardPage's and
  ClientDetailPage's local copies.

The audit found real drift, not just duplication — 8 separate local
`Th`/`Td` pairs (`ClientsListPage`/`ClientRow`, `LoansListPage`/`LoanRow`,
`UsersListPage`/`UserRow`, `AuditLogsPage`, `MessageLogsPage`,
`LoanDetailPage`, `LoanQuotePage`) plus `ClientDetailPage`'s tables using
no component at all (repeated inline `<td className="...">`), and
`DashboardPage`'s second table doing the same. Once compared side by
side:

- `LoanQuotePage` used `h-11 px-4`/`h-12 px-4` — visibly taller,
  wider-padded rows than every other table's `h-[38px] px-3.5`/`h-11
  px-3.5`.
- `UsuryRatesPage` had no size/color tokens at all — plain `px-5 py-3`,
  default text color, no `bg-input` table header.
- `LoanDetailPage`'s muted `Td` used `text-mid`, one shade darker than
  every other table's `text-muted` for the same "secondary column" role.
- `UsersListPage`'s `Td` had no `muted` prop — muted was the default and
  the one white/bold column was reached with a className override, the
  opposite API from `ClientRow`/`LoanRow`.
- `AuditLogsPage`/`MessageLogsPage`'s `Td` had no `muted` prop either —
  secondary columns got `className="text-muted"` layered on top of the
  default `font-medium`, so those cells were bold-and-muted instead of
  the regular-weight-and-muted every other table uses for that role.
- `LoanDetailPage` also had its own third copy of the KPI card
  (`KpiCard`, `p-4`/`text-label`/`gap-1.5`) — close to but not the same
  as `StatCard`'s `p-5`/`text-small`/`mt-1`.

Every table/card above now imports the shared component; the local
copies are gone. Three compact installment-preview tables inside modals
(`PayoffDialog`, `LoanForm`, `RefinanceLoanForm` — `text-meta`, `py-0.5`
rows, no header background) were left as they are: they're already
byte-identical to each other, and deliberately denser/smaller than a
primary list table since they're a quick schedule preview inside a
dialog, not a browsable table — a genuinely different pattern, not
drift.

**FilterTab: centralized + background matched to Linear's inspected value
(style cleanup, 2026-09-02):** client pasted 7 devtools captures from
Linear (a date-group label, a card title, a body paragraph, a relative
timestamp, the "Popular" filter tab, an issue-row title, and an activity-
feed line) asking for our own modules to be brought in line with them.
Went looking for real matches rather than guessing at all seven at once.
The clearest, concretely evidenced one: `ClientsListPage`'s and
`UsersListPage`'s "Todos/Activos/Inactivos" tabs (byte-identical local
`FilterTab` in both files) already matched Linear's "Popular" tab almost
exactly — same 12px/`text-muted` at rest — except the background:
Linear's inspected resting background is `#FFFFFF08` (~3% white wash),
ours was a flat opaque `bg-input` (#16171a). Centralized into
`components/ui/FilterTab.tsx` and switched the inactive background to
`bg-white/[0.03]`, matching the inspected value; the active tab's
`bg-border` (rgba(255,255,255,0.08)) already used the same "translucent
wash" idea, just stronger, so it was left alone.

The other six captures don't have an equally direct match in this app yet
(a date-group divider, a 15px descriptive paragraph, a relative
timestamp, an issue-row title, an activity-feed line — none of these UI
shapes exist verbatim in Collectify's current screens), so nothing was
force-fit to them. Flagged for the client rather than guessed at.

**Table column headers: font size matched to a devtools-inspected Linear
header (style cleanup, 2026-09-02):** client is now going module by
module, comparing real devtools captures against our screens one element
at a time, starting with Dashboard's table. Inspected a real Linear
column header directly: 12px, `#8A8F98`. Our shared `Th`
(`components/ui/Table.tsx`) already used that exact hex for color
(`text-muted`) — only the size was off, `text-label` (11px) instead of
`text-small` (12px). Changed once in the shared component, which is what
propagates it to all 13 tables across the app that import it — this is
the concrete payoff of the table-centralization pass earlier today: a
column-header fix is now a one-line edit instead of a per-table sweep.
Left the three compact modal preview tables (`PayoffDialog`, `LoanForm`,
`RefinanceLoanForm`) untouched — they don't use the shared `Th`, by
design (see the table-centralization entry above): they're a smaller,
denser pattern for a quick installment-schedule preview inside a dialog,
not a browsable list table.

**Table cell content: default color matched to a devtools-inspected
Linear cell (style cleanup, 2026-09-02):** same module-by-module pass,
next capture — a real Linear table cell inspected directly: 12px (already
matched, `text-small`), color `#D0D6E0`. That's the existing `strong`
token, not pure white — so even Linear's "primary" cell content isn't
full white. Changed the shared `Td`'s default (non-`muted`) branch from
`text-white` to `text-strong` in `components/ui/Table.tsx`; propagates to
all 13 tables. `muted` branch (`text-muted`, #8A8F98) untouched — this
capture was about the cell that *isn't* the secondary/muted one.

**Dashboard overdue-clients table: "Cuotas vencidas" un-muted (style
cleanup, 2026-09-02):** client compared the live table against the
previous change and pointed out "Cuotas vencidas" still looked visually
set apart from "Cliente"/"Monto total en mora" — it had `muted` set,
those didn't. Not a design decision, just a pre-existing per-column
choice on this one table that predates today's pass. Removed `muted` on
that cell so all three columns render the same `text-strong` cell color.
"Días de mora" (badge) and "Acciones" (button) are unaffected — they're
not plain `Td` text, they have their own explicit colors.

**Clientes table: name column stuck on white (style cleanup,
2026-09-02):** client noticed the "Nombre" column in the Clientes table
still looked different from the rest after the `Td` default color change
above. Cause: `ClientRow.tsx` had a leftover
`className="font-medium text-white"` on that one cell, from before
`Td`'s own default was white — a redundant override at the time, but
once `Td`'s default became `text-strong` it silently pinned this one
column back to white while every other default cell in the app moved to
`text-strong`. Removed the override; swept the rest of the app for the
same leftover pattern (`grep` for `text-white` on a `Td` className) and
found no other occurrences — this was the only one.

**Full table sweep for anything else fighting the shared tokens (style
cleanup, 2026-09-02):** client asked to check every table in the app at
once for the same class of problem, rather than one-by-one. Checked
three things across all 13 tables:

1. Any `Td`/`Th` `className` override reintroducing `text-white` /
   `text-muted` / `text-strong` / `font-medium` on top of the shared
   defaults — none found beyond the Clientes name column already fixed
   above.
2. Whether each table's `muted` choices are internally consistent with
   tables of the same shape. Found one: `UsersListPage` — "Correo" and
   "Rol" were `muted`, while the two structurally equivalent "management
   list" tables (`ClientsListPage`: Documento/Teléfono, `LoansListPage`:
   Pagaré/Cliente/montos) render their equivalent detail columns at full
   `text-strong`, not muted — only the "#" row-number column is muted in
   either. This wasn't something introduced during today's centralization;
   `UsersListPage`'s columns were already muted-by-default before, and
   the earlier pass preserved that existing look rather than judging it.
   Un-muted "Correo"/"Rol" in `UserRow.tsx` to match the other two
   management-list tables. (`AuditLogsPage`/`MessageLogsPage` are a
   different table shape — one clear identifier column plus several
   metadata columns — and keep their own muted metadata columns; that's
   internally consistent within that family and wasn't touched.)
3. Any remaining raw `<th className>`/`<td className>` outside the three
   compact modal preview tables — none found; all 13 primary tables now
   go through the shared `Th`/`Td`.

**Select: closed trigger had no hover state at all (style cleanup,
2026-09-02):** client compared Dashboard's "Ordenar por" and
month/year dropdowns against Linear's — ours didn't light up at all on
hover, box or text. Linear's does both: text goes `#8A8F98` → `#D0D6E0`
(muted → strong, not all the way to white), and the box itself lights up
too. `components/ui/Select.tsx`'s trigger `<button>` had zero `hover:`
classes — only the *open* option list had one (`hover:bg-border
hover:text-white`). Added `hover:bg-border hover:text-strong` to the
trigger, reusing the same `bg-border` wash the option list's own hover
already uses rather than inventing a new box color, plus `group`/
`group-hover` so the chevron icon lights up together with the label. This
is a single shared component (`LoansListPage`, `MessageLogsPage`,
`ClientForm`, `LoanForm`, Dashboard's sort/month/year — every dropdown in
the app), so the fix applies everywhere at once.

**Row action buttons ("Ver", "Editar", "Reintentar"...): same hover gap
as Select, same fix, plus new `RowActionButton` component (style cleanup,
2026-09-02):** client compared the same Dashboard screenshot's "Ver"
buttons against the Select fix above — hover lit up the text
(`hover:text-white`) but never the surrounding box, same class of bug.
This pattern (`rounded-[3px] border border-border bg-input px-1.75 py-1
text-meta ...`) wasn't a shared component yet, though — it was 3 near-
identical local `RowAction` components (`ClientRow.tsx`, `UserRow.tsx`,
`LoanRow.tsx`) plus the same className string typed inline 6 more times
(`DashboardPage`, `ClientDetailPage`, `LoanDetailPage`, `MessageLogsPage`,
`AuditLogsPage`). Extracted `src/components/ui/RowActionButton.tsx`
(`to`/`onClick` polymorphic — renders a `<Link>` or `<button>`; `tone:
"muted" | "subtle"`; `disabled`/`title` for the one button that needs
them, LoanDetailPage's order-locked "Pagar") and migrated all 9 call
sites onto it, deleting the 3 local components. Added `hover:bg-border`
to both tones — same wash `Select`'s trigger and option list already use
— so the box and text light up together everywhere this component is
used.

Two things deliberately left alone during the sweep, not migrated:
`MessageLogsPage`'s "Reintentado" badge (a static `<span>`, same base
classes but no hover at all — it's a completed-state label, not a
clickable action) and `LoanRow.tsx`'s disabled "Pago" placeholder (a
`<span>` with `cursor-not-allowed`, shown when a loan has no pending
installments — never interactive, so there's no hover state to fix).
Both are visually similar to the real buttons on purpose (same pill
shape) but aren't "buttons of this type" in the sense the client meant.

**Same hover gap, two more repeated patterns: FilterTab and DatePicker's
trigger (style cleanup, 2026-09-02):** client asked to check the rest of
the app for the same "text lights up, box doesn't" bug found in
RowActionButton/Select, specifically calling out the Activos/Inactivos/
Todos tabs used everywhere and a dropdown on "Proyector rápido" that had
no hover at all.

- **`FilterTab.tsx`** had zero hover classes on its inactive branch. Fixed
  the same way as `Select.tsx`'s option-list items — which this component
  already mirrors exactly, active/selected vs. inactive — by adding
  `hover:bg-border hover:text-white` to the inactive tab only; the active
  tab is left alone, same reasoning as Select never re-highlighting the
  option that's already chosen. Also found (not just fixed cosmetically)
  a second, undetected copy of this exact component: `InterestConceptTypesPage.tsx`'s
  "Activos"/"Desactivados" toggle was a hand-rolled duplicate with
  slightly different padding (`py-1.5` vs `py-[7px]`) and a different
  resting background (`bg-border`/nothing vs. `FilterTab`'s
  inspected `bg-white/[0.03]`) — migrated it onto the shared `FilterTab`
  instead of hover-patching the local copy, so it can't drift again.
- **"Proyector rápido"'s "Periodicidad" field** (`LoanQuotePage.tsx`) was
  a raw native `<select>` — the original gap the shared `Select.tsx` was
  built to close (Phase 4-era), missed here because this screen (Phase 14)
  was built after that component existed but this one field slipped
  through. Replaced with `<Select>` (already imported in this file for
  the "Cargos adicionales" row) so it inherits the same hover, and every
  future fix to `Select.tsx` automatically. Flagged `RefinanceLoanForm.tsx`,
  `LoanForm.tsx`, and `MessageTemplatesPage.tsx` as having the same raw
  `<select>` gap, left unchanged this round since the client had only
  pointed at this one screen.

  **Follow-up, same day:** client caught the exact byte-identical
  "Periodicidad de cuotas" field in `LoanForm.tsx` (loan creation) missing
  hover too — same field, same label, same code, just not yet migrated.
  Fixed that one and its twin in `RefinanceLoanForm.tsx` (both plain
  `installmentFrequency` Monthly/Biweekly selects, already importing
  `Select`). `MessageTemplatesPage.tsx`'s three raw `<select>`s are left
  as the one remaining gap — they're a different shape from the others
  (periodicity/day-of-week/day-of-month, chained conditionally, sitting in
  a dense `h-9` row next to a native `<input type="time">`), not a
  straightforward drop-in like the rest: `Select.tsx`'s trigger has a
  fixed `h-[38px]`, so swapping just the `<select>`s in that row would
  make them 2px taller than the time input and buttons beside them.
  Worth doing, but as its own pass rather than folded into this one.

**Date fields: same trigger-hover treatment as Select, once evaluated —
then corrected (style cleanup, 2026-09-02):** client asked, as an open
question rather than a firm instruction, whether `DatePicker.tsx`'s
trigger (the box you click to open the calendar) should light up on
hover too. Compared it against `Select.tsx` directly: functionally it's
the same shape — a closed box that opens a popover on click —
DatePicker's own popover (calendar days, month/year buttons) already has
hover on every cell, same as Select's open option list did before its
trigger was fixed; only the closed trigger itself had nothing. Concluded
yes, for the same reason Select's trigger got fixed.

First attempt copied Select's `hover:bg-border hover:text-strong` onto
the trigger verbatim. Wrong: Select's own resting text is `text-muted`
(#8A8F98), so `hover:text-strong` (#D0D6E0) brightens it — but every
DatePicker call site's `className` sets the filled-in value's resting
color to `text-white` (`inputClassName`/`formStyles.ts`), which is
already brighter than `text-strong`. On hover the date text visibly
*darkened* — the opposite of the intended effect, and the client caught
it immediately. Fixed by dropping `hover:text-strong` from the trigger
`<button>` itself, keeping only `hover:bg-border` for the box. The
calendar icon keeps `group-hover:text-strong` — unlike the value text,
its resting color is always the dimmer `text-mid` regardless of call
site, so brightening it on hover is safe everywhere. Net effect: the box
and the icon light up on hover; the value/placeholder text doesn't
change color, since assuming a single "correct" hover direction for text
whose resting color varies per call site (`text-white` in form fields,
`text-muted` in the Desde/Hasta filter chips) isn't safe to bake into
the shared component the way `hover:bg-border` is.

**Filter tabs and Select's option list: hover was a 2-state binary,
should be a real 3-tier off/hover/selected progression (style cleanup,
2026-09-02):** client had watched Linear's own filter tabs (Activo/
Inactivo/Todos' counterpart there) directly and reported back the exact
computed values: resting text `#8A8F98`, hover text `#D0D6E0`, selected
text `#F7F8F8` — three distinct steps, each brighter than the last, and
the same three-step idea for the tab's background. Checked our own
tokens against those values first: all three already exist verbatim —
`muted` (#8a8f98), `strong` (#d0d6e0), `white` (#f7f8f8) — this was a
wiring problem, not a missing-token problem.

Both `FilterTab.tsx` and `Select.tsx`'s hover fixes from earlier today
had the same bug: hover jumped straight to the *selected* look (`text-
white`/`bg-border`) instead of stopping at a middle tier, so a hovered-
but-not-selected tab/option was visually indistinguishable from an
actually-selected one — exactly backwards from Linear's "closer you get,
brighter it gets" logic. Fixed both: hover now targets `text-strong` +
`bg-white/[0.05]` (a real middle value between the 3% resting wash and
the 8% `bg-border` selected wash, not reusing either endpoint), reserving
`text-white`/`bg-border` exclusively for the tab/option that's actually
active. The selected item itself still has no hover rule — it's already
at the top tier, nothing brighter to transition to on hover, same as
before.

Deliberately scoped to just these two components, not every
`hover:text-white` in the app (there are dozens, e.g. `RowActionButton`,
breadcrumb links, `Button.tsx`, `CloseButton.tsx`): this 3-tier
progression is specifically for elements that persist in an "on" state
after being clicked — a filter tab, a selected dropdown option. A plain
one-shot action button ("Ver", "Editar", a breadcrumb link) never reaches
a persistent third state, so its simple 2-state muted→white hover isn't
the same bug wearing a different outfit — it's a different, valid
pattern for a different interaction shape. Also checked Sidebar's own nav
items, which look superficially similar (inactive/hover/active): left
untouched, since that component's resting color was already deliberately
set to `strong` (not `muted`) in an earlier, separately devtools-matched
pass — a different, already-intentional design, not this same bug.

**Select's month dropdown pushed the page into showing a native scrollbar
(style cleanup, 2026-09-02):** client screenshotted the "Septiembre"
sort-by-month dropdown before/after opening it — closed, everything looked
right; opened, a plain light-gray browser scrollbar appeared down the
right edge of the whole app. Two compounding causes:

1. `Select.tsx`'s option-list popover had no height cap at all
   (`overflow-hidden` on a `position: absolute` box just clips, it doesn't
   scroll) — with 12 months at `py-2` each, the open panel got tall enough
   to extend past `AppLayout.tsx`'s `<main>` (the app's real scrolling
   container, `overflow-y-auto`), forcing that container to grow a
   scrollbar of its own to reach the panel's own last few rows.
2. That scrollbar — and every other `overflow-y-auto` container's, they
   all shared the same problem — had never been themed, so it rendered as
   the browser's stock light-gray scrollbar, jarring against the dark UI.

Fixed both. `Select.tsx`'s popover now has `max-h-[264px] overflow-y-auto`
of its own (~6.5 rows), so a long list scrolls inside its own small box
instead of growing the page. Scrollbars themed globally in `index.css`
(`scrollbar-width`/`scrollbar-color` for Firefox, `::-webkit-scrollbar`
rules for Chrome/Edge/Safari) rather than per-container, since the same
unstyled-scrollbar problem was latent in every other `overflow-y-auto`
spot in the app (`<main>` itself, all 15 Modal/drawer components,
LoanForm/RefinanceLoanForm's concept-row lists, the WhatsApp inbox
message list...) even though only this one had actually been tall enough
to trigger it yet. Thumb uses `mid` (resting) / `subtle` (hover) over a
transparent track — the same two dim tones already used for icons and
placeholder text, so an idle scrollbar reads as a faint sliver rather than
a boxed-in control, matching Linear's own thin, low-contrast bars.

**Keyboard focus ring: orange only on buttons that are themselves orange
(style cleanup, 2026-09-02):** every button/link's `:focus-visible` ring
was unconditionally `accent` orange (see "Buttons and links never got an
explicit focus style" above, 2026-09-01). Client was Tab-ing through
ClientForm's Cédula → Tipo de documento and found the jump jarring: the
Cédula input focuses with a subtle gray border (`focus:border-subtle`,
every text input's own convention), then Tab lands on the Tipo de
documento `Select` — a `<button>` under the hood standing in for a form
field — and the ring snaps to a saturated orange, even though nothing
about what the element *is* changed from the user's point of view.

Talked through three options before touching anything (soften the
transition with a CSS `transition`, dim the orange ring everywhere, or
split the treatment by element role) and asked the client's preference
rather than picking one. Client's own rule, simpler than "field vs.
action" and what's actually implemented: default every button/link's
ring to the same `subtle` gray text inputs already use, and reserve the
orange ring for whichever buttons are *themselves* orange —
`bg-accent` in the resting state, currently just `Button`'s `primary`
variant and LoginPage's own "Entrar" (the only two `bg-accent` buttons in
the app; grepped to confirm). Implemented as a second, more specific
plain-CSS rule in `index.css`: `button.bg-accent:focus-visible` overrides
the outline color back to `accent`, keying off the class Tailwind already
emits for `bg-accent` — no JSX changes needed in `Button.tsx` or anywhere
else. Sidebar's active-nav tint (`bg-accent/15`) is a different literal
class name, so it isn't caught by this selector, correctly — it's a link
tint, not an orange button.

**Same-day follow-up — checkboxes and file inputs never got the rule at
all:** client filled out ClientForm's Documentos section as a real
end-to-end test and found a second gap: the consent checkbox and the ID-
photo `<input type="file">` fields still popped the browser's own default
focus ring — a stark solid white/blue box — since the rule above only
ever targeted `button`/`a`, and these are raw native `<input>` elements,
neither buttons nor text inputs (which already handle their own focus via
`focus:border-*` + `focus:outline-none` per component). Asked to check
the rest of the app rather than just this one screen: grepped for every
`type="checkbox"` and `type="file"` and found the same gap on all of
them — `ModuleChecklist.tsx`, the co-debtor checkbox in
`LoanForm.tsx`/`RefinanceLoanForm.tsx`, `LoanDetailPage.tsx`'s
installment-select checkboxes, and the file inputs in
`RegisterPaymentDialog.tsx`, `BulkRegisterPaymentDialog.tsx`, and
`ImportClientsDialog.tsx`. Added `input[type='checkbox']`,
`input[type='radio']` (none exist yet, included preemptively since it's
the same category), and `input[type='file']` to both the `outline: none`
reset and the `:focus-visible` rule in `index.css` — one shared rule again
rather than a per-file patch.

**Sidebar nav items: focus ring overlapped the active item's pill (style
cleanup, 2026-09-02):** client screenshotted three states — Dashboard
focused sitting above the active Clientes, and Clientes active sitting
above a focused Préstamos — and noticed the focus box overlapped the
active item's tinted pill differently depending on which was on top: in
one direction a sliver of the active item's `bg-accent/15` bled into the
bottom of the ring; in the other, nothing bled through, but the ring
still visibly cut into the neighbor's pill. Correctly read this as one
underlying bug producing two different-looking symptoms, not two bugs.

Root cause: `Sidebar.tsx`'s nav items sit only `gap-0.5` (2px) apart, but
the app's now-standard focus ring draws 2px outside the element
(`outline-offset: 2px`) at 2px thick — 4px of total reach, twice the
available gap, so it always oversteps into whichever neighbor happens to
be on the other side. Which direction the color "bleeds" differs because
outlines paint in DOM order: a focused item earlier in the list has its
ring painted *before* the active item's own background below it (so that
background paints over the ring, reading as bleed-through); a focused
item later in the list paints its ring *after* the active item above it
(fully covering that sliver instead of blending with it). Not something
fixable by nudging the gap or offset by a pixel — an outward-facing ring
and a sub-4px gap are fundamentally incompatible.

Fixed by switching just Sidebar's nav links to an *inset* ring
(`box-shadow: inset 0 0 0 2px var(--color-subtle)`) instead of the
`outline` every other focusable element uses — inset box-shadows draw
entirely inside the element's own border box, so they can't overlap a
sibling no matter how tight the gap is, unlike an outline which always
needs clearance beyond the box. Added via a new `.sidebar-nav-link`
marker class (on `Sidebar.tsx`'s `NavLink`) rather than a Tailwind
`focus-visible:` utility class, because Tailwind's utilities live in
`@layer utilities`, which CSS's cascade-layer rules always rank below
plain, unlayered CSS regardless of selector specificity or source order
— the existing `a:focus-visible` rule in `index.css` is unlayered, so a
Tailwind class could never have out-ranked it. The override had to be
more plain CSS with higher specificity instead, same technique as the
earlier `button.bg-accent:focus-visible` override.

**Sidebar footer: avatar re-centered by shrinking Salir's padding (style
cleanup, 2026-09-02, fifteenth pass):** re-diagnosed after the revert. The
real cause wasn't the text's line-height at all — it was the Salir
button's own padding. The role row is `<role text><Salir button>` in a
flex row; the button (`p-1` padding around a 14px icon ≈ 22px tall) was
taller than a plain 12px text line (~15-17px), so it — not the text —
was what made the role row, and so the whole 2-line column, taller than
it visually looked. `items-center` on the outer row centers the avatar
against that inflated height, which is what made it look low. This is
also *why* `leading-none` on the text changed nothing last pass — it
never touched the actual tallest element in that row. Fixed by shrinking
the button's own padding: `p-1` → `p-0.5`.

**Sidebar footer typography unified with nav items (style cleanup,
2026-09-02, ninth pass):** after the redesign above, the client said the
name/role text still felt like a different typographic system from the
module list right above it — "el diseño se rompe." Root cause: the name
was still on `text-label` (11px) while the nav items sit at
`text-nav-item` (13px), and the role was on its own one-off `text-meta`
(10px)/`text-muted` combo shared with nothing else in the sidebar. Fixed
by reusing the sidebar's own established tokens instead of these
leftovers: the name now uses `text-nav-item font-medium text-white` —
identical to an active nav item's treatment — and the role uses
`text-nav-group-label font-normal tracking-normal text-subtle` — identical
to "Menú"/"Catálogos"/"Administración". No new tokens needed; this was
purely about not letting old pre-cleanup classes linger next to the new
system.

**Sidebar footer (user block) redesigned (style cleanup, 2026-09-02, eighth
pass):** the client's own full name ("Juan Miguel Rincón H...") was
getting cut off mid-character by a plain CSS `truncate` in a ~120px-wide
column. Proposed three angles before touching code (per the client's
request): trim the avatar circle, reformat the name, or reclaim space from
the "Salir" button — client confirmed keeping the avatar (a self-contained
initials pattern, not a commitment to profile-photo upload) and chose
icon-only "Salir" over moving or removing it. Shipped:
- `Sidebar.tsx`'s "Salir" button lost its text, now a small door icon
  (`LogoutIcon`, `aria-label`/`title="Salir"` for accessibility) —
  reclaims the width the word was taking without changing the row layout.
- New `formatSidebarName()` in `lib/format.ts`: abbreviates only the last
  word once a name is long enough to likely overflow ("Juan Miguel Rincón
  Hernández" → "Juan Miguel Rincón H."), leaves short names untouched.
  Threshold is a character-count approximation, not a measured pixel fit;
  `truncate` stays as a safety net regardless.
- Role label now reads `USER_ROLE_LABELS[user.role]` ("Admin"/"Cobrador")
  instead of `.toUpperCase()` producing "ADMIN" — reuses the same label
  map `UserForm.tsx`'s role dropdown already has, matching the sentence-case
  rule from earlier in this pass instead of adding a second label set.

**Sidebar module spacing tightened (style cleanup, 2026-09-02, seventh
pass):** client compared the spacing between consecutive nav items
(Dashboard/Clientes/Préstamos/...) against Linear's own (Pulse/Inbox/My
issues/Reviews) and asked for ours closer together — explicitly *not*
touching the gap between a group title ("Menú"/"Catálogos") and its first
item, which was already right. The two gaps share an input
(`NavLink`'s own vertical padding contributes to both), so shrinking one
without the other took two coordinated edits: `NavLink`'s `py-2.5` → `py-1.5`
(effective item-to-item whitespace 10+2+10=22px → 6+2+6=14px), and the
group label's `mb-1` → `mb-2` to add back exactly what the padding cut
lost, keeping title→first-item spacing at its original 14px. Math, not a
guess — both numbers were computed from the actual Tailwind spacing scale
before editing.

**Sidebar nav item labels split out too (style cleanup, 2026-09-02, sixth
pass):** same request as the nav-group-label split above, one level down —
the client compared our active "Dashboard" nav link against Linear's
equivalent item via devtools on both sides and asked that this be treated
as its own thing too, not sharing `text-small` with whatever else in the
app happens to also be 12px. Two new tokens: `--text-nav-item` (13px,
Linear's real value — was `text-small`, 12px) and `--color-strong`
(`#D0D6E0`, a new rung between `muted` and `white` — Linear's real nav-item
text color) applied only to `Sidebar.tsx`'s `NavLink`. Judgment call worth
flagging: the client's comparison paired our *active* Dashboard link
(white text, accent background) against what looks like one of Linear's
*inactive* items (no highlight, plain text) — so the font-family/size
delta is solid evidence either way, but the color evidence really only
speaks to the inactive state. Applied `strong` to the inactive state only;
left the active state's `white` alone, since Linear's own selected item
also reads brighter than its neighbors in the screenshots seen earlier in
this pass. Flag if that read is wrong.

**Nav-group labels split from section labels (style cleanup, 2026-09-02,
fifth pass):** the client pushed back on treating these as the same thing.
`text-section-label` (12px, `subtle`, `font-normal`, `tracking-normal`) was
being reused for two conceptually different roles: the Sidebar's 3
module-group titles ("Menú", "Catálogos", "Administración") and every
in-page section header (Dashboard's "Kpis", ClientDetailPage's
"Referencias", LoanDetailPage's "Cuotas", etc.). The client's plan is for
the in-page section headers to get a different format later — so sharing
one token would mean that future change either drags the Sidebar along
with it or requires manually re-splitting them at that point. Split now,
while the values are still identical, into two independent tokens:
`--text-section-label` (unchanged, for in-page section headers) and
`--text-nav-group-label` (new, Sidebar only — currently the same 12px
value). Only `Sidebar.tsx`'s 3 labels moved to the new token; every other
`text-section-label` usage is untouched. Don't merge these back — that's
the whole point of the split.

**1:1 typography pass (style cleanup, 2026-09-02, second pass):** the first
pass (size/color fixes above) didn't fully convince the client — they asked
for a literal copy of Linear's text, not an approximation, and specifically
said they wanted this inspected via a real browser, not judged off a
screenshot. So: opened linear.app in an actual browser and sampled
`getComputedStyle` over ~35 real text elements on the page (their own
interactive product demo, coincidentally the same one in the client's
screenshot — "DRV-8852", "Faster app launch", etc. are literally that
widget), recording font-size, weight, letter-spacing, and color for each,
labeled by role (headings, nav, timestamps, code, uppercase eyebrow text).

The one finding that mattered most: **not a single sample used positive
letter-spacing.** Every value was either `normal` or negative (headings get
slightly negative tracking, e.g. -0.24px at 20px; small UI text is mostly
`normal`). Our app did the opposite everywhere — every section
label/table-header/field-label pattern added *positive* tracking
(`tracking-[0.36px]`, `[0.4px]`, `[0.55px]`, `[0.64px]`) on top of an
already-small uppercase size, which is what was making them read as
sparse/"flaco". Swept every one of those ~40 occurrences to
`tracking-normal`, and switched the paired `font-medium` to `font-normal`
to match Linear's one directly comparable uppercase-label sample (their
"POWERING THE COMPANIES BUILDING THE FUTURE" eyebrow: 12px, weight 400,
`letter-spacing: normal`). **Rule going forward: never add positive
letter-spacing.** If a label needs more visual separation, that's a
weight, size, or color decision — not tracking.

**Type scale floor, re-tuned (style cleanup, 2026-09-02):** the client
pointed at specific text as hard to read — the Sidebar's "MENÚ"/section
labels and Dashboard's "KPIS" — describing sizes as inconsistent and some
text as too thin. Checked Linear's real smallest rendered text directly
(same DOM inspection as the palette above, sampled every element under
14px): nothing on their page goes below 10px. `--text-section-label` was
9px, and the Sidebar had its own hardcoded `text-[8px]` for "MENÚ" and the
nav group labels plus the role tag — both under even Linear's floor, and
the Sidebar's version also used `text-mid` (our dimmest gray) instead of
`text-muted`, compounding the contrast problem. Fixed: bumped
`text-section-label` to 11px (propagates to every section label
app-wide — Dashboard's KPIS, ClientDetailPage's section headers,
LoanDetailPage's, all through the one token); Sidebar's three hardcoded
8px spans now use `text-section-label`/`text-meta` and `text-muted`
instead of a one-off smaller, dimmer style. Font *weight* wasn't the
actual issue — Linear's small text samples were mostly regular/medium
(400-510), same as ours — the "flaco"/thin feeling was the undersized
text plus the pre-antialiasing rendering (see font-smoothing above)
combining to make already-small glyphs look sparse.

**Re-tuned to match Linear's dark theme (style cleanup, 2026-09-02):** the
client said Linear's blacks/grays looked nicer and text read more clearly
there, unsure whether it was font weight, typeface, or tone. Rather than
guess, inspected `linear.app`'s live DOM directly (`getComputedStyle` over
its actual elements) and pulled the real values — the palette above is
Linear's own, not an approximation, except `mid`, which is interpolated
since Linear's sampled DOM only exposed two distinct gray text tones (no
third "dimmest" tier to copy). The single biggest factor in "text reads
more clearly": Linear's body text isn't pure `#FFFFFF`, it's the softer
`#F7F8F8` off-white, combined with `-webkit-font-smoothing: antialiased`
(added to `index.css`, was previously unset) — pure white on near-black
has harsh contrast that "vibrates" at small sizes; off-white + antialiasing
is most of the actual fix, not weight or a different typeface. `border`
switched from a flat hex to translucent white — Linear's actual technique,
so it reads correctly layered over either `background` or `surface`
instead of one fixed gray. This also means every `bg-border` chip/pill/badge
fill (32 call sites) now renders as a soft overlay instead of a flat gray
panel — a visual change worth a look; if anything reads too faint, the fix
is one line (`index.css`'s `--color-border` alpha value), not a per-file
edit, same as any other token.

**Status/severity colors, updated (style cleanup, 2026-09-01):** the row
above ("Tailwind's own defaults — no custom tokens needed") was the original
Phase-5 decision, but by this point it had produced ~35 files each picking
their own literal color for the same handful of meanings — some as raw hex
(`bg-[#22c55e]`), some as Tailwind's default `red-400`/`red-500` (two
slightly different reds for the same "error" meaning, depending on which
file you were in). Grepped the whole `src` tree and replaced every one of
them with the semantic tokens below, added to `index.css`'s `@theme`
alongside the neutral palette. Same rule as the neutral tokens: reach for
one of these by name (`text-danger`, `bg-success-bg`, etc.) for anything
that means "this succeeded/failed/is overdue" — never a raw hex or a bare
Tailwind color class, so a future palette change is a one-line edit in
`index.css` instead of another grep-and-replace across the app.

| Token | Hex | Meaning | Also generates |
|---|---|---|---|
| `success` | `#22C55E` | Sin mora / al día / activo / enviado / confirmado | `text-success`, `bg-success`, `border-success` |
| `success-bg` | `#051E0E` | Background behind `success` text in a badge | `bg-success-bg` |
| `warning` | `#EAB308` | Mora baja (1–30 días) / avisos no destructivos | `text-warning`, `bg-warning`, `border-warning` |
| `mora-mid` | `#F97316` | Mora media (31–60 días) — this specific tier only, no other use in the app | `text-mora-mid`, `bg-mora-mid` |
| `danger` | `#EF4444` | Mora crítica (+60 días) / fallido / error / bloqueado / destructivo | `text-danger`, `bg-danger`, `border-danger` |
| `danger-bg` | `#240A0A` | Background behind `danger` text in a badge/banner | `bg-danger-bg` |
| `whatsapp-bg` | `#0A240A` | WhatsApp message-bubble preview background only (`MessageLogDrawer`) — a close but deliberately separate dark green from `success-bg`; don't merge them, they mean different things | `bg-whatsapp-bg` |

Two shared components consume these instead of every page rolling its own
markup, since the exact same badge/legend JSX had been copy-pasted
verbatim into 3–5 files each:

- **`src/components/ui/StatusBadge.tsx`** — the small pill used for
  Enviado/Fallido, Autorización firmada/Sin autorización, Bloqueado por
  mora, etc. Takes `tone: 'success' | 'danger' | 'neutral'`.
- **`src/components/ui/Legend.tsx`** — the small dot + label used for the
  mora-severity key under the Préstamos/Clientes tables and the "X
  Fallidos" count on Mensajes. Takes `tone: 'success' | 'warning' |
  'mora-mid' | 'danger'` instead of a raw color string.

**Deliberately left as plain Tailwind `amber-*` classes, not migrated to a
token:** `StaleUsuryRateBanner.tsx`, the stale-rate notice in
`UsuryRatesPage.tsx`, and the confirmation warning in `PayoffDialog.tsx`.
These are a visually distinct "soft banner" treatment (multiple amber
shades at low opacity, tuned together) for a different kind of notice than
the `warning` token's mora-severity yellow — judgment call made during the
2026-09-01 cleanup rather than forcing a visual change nobody asked to
review. Flagged here so it reads as a deliberate choice, not a spot the
audit missed.

**Brand accent & visual polish (2026-09-02):** the client described the
original theme as "lúgubre" (gloomy). Rather than chase a generic
inspiration palette, the accent color was derived from the client's own
"Publi Mark" brand logo (shared as reference images, not exact brand
guidelines) — orange as the primary accent, blue held in reserve as a
secondary. If official brand hex codes surface later, only these four
`index.css` lines need to change; nothing else in the app references a raw
hex for these colors.

| Token | Hex | Meaning | Also generates |
|---|---|---|---|
| `accent` | `#F26522` | Primary buttons, active nav item, focus ring — approximated from the Publi Mark logo's orange | `bg-accent`, `text-accent`, `border-accent` |
| `accent-hover` | `#D9591C` | Hover/active state for `accent` (~15% darker) | `bg-accent-hover` |
| `accent-secondary` | `#3F7FD1` | Reserved for links/secondary emphasis — approximated from the Publi Mark logo's blue, not yet applied anywhere | `bg-accent-secondary`, `text-accent-secondary` |
| `shadow-card` | `0 4px 14px rgba(0,0,0,0.35)` | Soft elevation shadow on modal/dialog cards, replacing flat borderless surfaces | `shadow-card` |

Applied app-wide as part of the same pass: every primary CTA button
(previously `bg-white`/`text-background`, e.g. "Entrar", "Guardar
cliente", "Crear préstamo") recolored to `bg-accent`/`text-white` with
`hover:bg-accent-hover`; the active sidebar nav item uses `bg-accent/15`
instead of a flat `bg-border`; the `:focus-visible` outline uses `accent`
instead of `subtle`; every modal/dialog card (`rounded-lg border
border-border bg-surface`, 15 files) gained `shadow-card`; page-level card
and table containers that were still the plain 4px `rounded` were bumped
to `rounded-lg` (modals were already `rounded-lg`/8px — a stale claim in
this doc's own Spacing section said otherwise, corrected below).

## Component-based centralization (style cleanup, 2026-09-02)

The "Brand accent" pass above centralized *tokens* (CSS variables in
`index.css`) but not *markup* — each button/modal/field was still its own
copy-pasted Tailwind className string, so the accent-color sweep missed a
couple of buttons whose className had drifted slightly from the others.
The client caught this and asked for the design to be centralized properly:
not just shared color variables, but shared components, so a future change
is a one-line edit in one file instead of a grep-and-replace across dozens.

Three shared pieces now exist. Use them instead of hand-rolling the
underlying `className` string — that's the whole point:

- **`src/components/ui/Button.tsx`** — `<Button variant="primary" |
  "secondary" | "neutral" | "danger" | "dangerSolid">`. Covers every button
  in the app: primary CTAs, "Cancelar" buttons, neutral chips, destructive
  actions (outline `danger` and solid `dangerSolid`). A `className` prop
  remains as an escape hatch for one-off sizing/spacing only (e.g. `h-[42px]
  shrink-0`) — never for color or shape, those live in the variant.
- **`src/components/ui/Modal.tsx`** — `<Modal maxWidth="max-w-[440px]"
  scroll? maxHeight?>`. Wraps the fixed backdrop + centered card markup
  shared by all 15 modal/dialog components. A dialog that renders a sibling
  conditional (e.g. `LoanForm.tsx`, `RefinanceLoanForm.tsx`) wraps its JSX
  in a Fragment around `<Modal>` rather than duplicating the backdrop.
- **`src/components/ui/Field.tsx`** — `<Field label error? layout="row" |
  "stack">` plus `<FormSection title>`. `row` (the default, `flex flex-1
  flex-col`) matches most forms' side-by-side field groups; `stack` (no
  `flex-1`) is for forms that lay fields out in a single full-width column.
- **`src/lib/formStyles.ts`** — `inputClassName(hasError: boolean)`. Kept
  as a plain function rather than a wrapped `<TextInput>` component, since
  every input call site (`<input className={inputClassName(x)} ...>`)
  stays otherwise unchanged — lower migration risk for the same result.
- **`src/components/ui/RowActionButton.tsx`** — `<RowActionButton to? |
  onClick? tone="muted" | "subtle" disabled? title?>`. The small pill-style
  action button in every table's last column ("Ver", "Ver detalle",
  "Editar", "Desactivar", "Reactivar"...). Added later (see the "Row
  action buttons" entry under Typography below) once it turned out to be
  the same copy-pasted-component problem as `Button`/`Modal`/`Field`.

**Deliberately left local, not migrated to the shared `Field`:**
`UserForm.tsx`, `ChangePasswordDialog.tsx`, and `EditLoanDialog.tsx` each
still declare their own `Field`. Their layout is `flex flex-col gap-1.5`
(no `flex-1`) — the `stack` variant — and rather than touch every call site
in those specific forms to add `layout="stack"`, the smaller/lower-risk
call was to leave them local. Each has a comment pointing back to this
section. If one of these forms needs another edit anyway, migrating it to
`layout="stack"` at that point is the natural cleanup.

**The rule going forward:** if you need a button, a modal wrapper, a form
field, or an input's base styling, import the shared component/function
above. Don't copy an existing file's className string into a new one —
that's exactly the drift that caused the original bug (two buttons quietly
missed the accent-color rollout because they were slightly different
copies of "a button").

## Typography

All type sizes below are custom tokens (`--text-*` in `index.css`) since none match Tailwind's default type scale. Font is Inter throughout (loaded via Tailwind's default sans stack — confirm a webfont import is added if Inter isn't already available system-wide).

| Token | Size | Figma name | Weight used | Example |
|---|---|---|---|---|
| `h1` | 28px | H1 | Light | "Inicia sesión" |
| `kpi` | 24px | KPI Value | Light | "$84,320" |
| `page-title` | 22px | Page Title | Light | "Dashboard" |
| `card-title` | 15px | Card Title | Medium | "Ana Gómez" |
| `body` | 13px | Body / Nav, Body Medium | Regular or Medium | "Accede a tu panel de cobranza" |
| `small` | 12px | Small | Regular | "¿Olvidaste tu contraseña?" |
| `label` | 11px | Label, Caption | Medium (label, often tracked+uppercase) or Regular (caption) | "CORREO ELECTRÓNICO" |
| `meta` | 10px | Meta / Subtitle | Regular | "+ 12 este mes" |
| `section-label` | 9px | Section Label, Badge / Tag | Medium, tracked, uppercase | "ESTADO DEL SISTEMA — SOLO ADMIN" |
| `control` | 14px | *(not a named library row — used inline on every input/button in the Login component)* | Regular / Semibold | Input values, button labels |

## Spacing

The entire spacing scale in the library (4/8/12/16/20/24/32/40/64px) is exactly Tailwind's default 4px-based scale (`1`=4px ... `16`=64px). **No custom spacing tokens — just use standard Tailwind spacing utilities.**

| px | Tailwind | Figma label |
|---|---|---|
| 4 | `1` | Gap mínimo |
| 8 | `2` | Gap items |
| 12 | `3` | Gap secciones |
| 16 | `4` | Padding card |
| 20 | `5` | Padding card + |
| 24 | `6` | Entre secciones |
| 32 | `8` | Padding main |
| 40 | `10` | Padding main (variant) |
| 64 | `16` | Padding canvas |

**Updated (style cleanup, 2026-09-02):** border radius is no longer
uniformly 4px. Modal/dialog cards and page-level card/table containers now
use `rounded-lg` (8px) as part of the visual-polish pass described above —
modals already were `rounded-lg` even before this pass (this doc's earlier
"4px throughout" claim was stale and didn't match the code). Smaller
inline elements (inputs, small chips, table cells) remain the default
`rounded` (4px) — only the two categories above were bumped.

## Components catalogued in the library (not all built yet)

Seen on frame `30:2` but not needed until a later phase — noted here so we don't have to re-fetch the screenshot each time:

- **Buttons**: primary (white bg / `background`-colored text, e.g. "Entrar"), secondary/dark (e.g. "Cancelar", "Pausar", "Activar", "Exportar"), outline (e.g. "Ver detalle")
- **Nav item**: active = white bg + `background` text; inactive = `muted` text, `surface` hover — already applied in `Sidebar.tsx`
- **KPI card**: `surface` bg, big number (`kpi` token) + `meta`-sized delta line
- **Role badge**: small pill, `ADMIN` / `COBRADOR`, uppercase `section-label`
- **Avatar**: circular, initials centered (e.g. "AG", "AC")
- **CronJob indicator**: status dot + label + Pausar/Activar button (used for the WhatsApp cron controls — Phase 5/9)
- **Status badges** (client/loan state): `Activo`, `En mora`, `Pagado`, `Congelado` — colored per the severity table above
- **Data table**: `Nombre / Estado / Acciones` columns, pagination
- **Confirm dialog**: modal card, e.g. "Desactivar cliente" with Cancelar/Confirmar
- **File upload dropzone**: dashed border, "Arrastra tu .xlsx aquí" — Excel import, Phase 8
- **Form panel**: e.g. "Nuevo cliente" — Phase 3
- **WhatsApp message preview bubble** — Phase 5/9
- **Message status badges**: `Entregado`, `Leído`, `Pendiente`, `Fallido` — Phase 5

## Screens reviewed so far

| Phase | Figma node | Status |
|---|---|---|
| 2 — Login (desktop) | `16:2` | Built — `features/auth/LoginPage.tsx` |
| 2 — Login (tablet/mobile) | *(not reviewed yet)* | Pending |
| 3 — F-10 Clientes (desktop 1440) | `40:3` | Built — `features/clients/ClientsListPage.tsx` |
| 3 — F-11 Nuevo cliente (modal) | `40:282` | Built — `features/clients/ClientForm.tsx` |
| 3 — F-12 Editar cliente (modal) | `40:383` | Built — `features/clients/ClientForm.tsx` (shared with F-11) |
| 3 — F-13 Desactivar (dialog) | `40:484` | Built — `features/clients/DeactivateClientDialog.tsx` |
| 3 — F-14 Detalle cliente (desktop 1440) | `40:554` | Built (partial — see gaps below); loans table wired up post-Phase-5 (see the resolved gap below) — `features/clients/ClientDetailPage.tsx` |
| 4 — F-16/17 Préstamos (desktop 1440) | `52:95` | Built — `features/loans/LoansListPage.tsx` |
| 4 — F-18 Nuevo préstamo (modal) | `52:415` | Built — `features/loans/LoanForm.tsx` |
| 4 — F-19 Detalle préstamo (desktop 1440) | `52:537` | Built (partial — see gaps below) — `features/loans/LoanDetailPage.tsx` |
| 4 — F-20 Registrar pago (modal) | `52:765` | Built, matches exactly — `features/installments/RegisterPaymentDialog.tsx` |
| 4 — F-22 Cambiar estado (dialog) | `52:945` | Removed (2026-08-31) — the manual "mark as paid without a payment trail" override was judged unnecessary; every loan closure now goes through a real, calculated flow (`Liquidar anticipadamente`) or a normal payment. See `docs/phases/PHASE_16_EARLY_PAYOFF.md`. |
| 4 — F-21 Mensaje manual de WhatsApp | *(not reviewed — client flagged it as likely a later phase)* | Deferred to Phase 5/9 |
| 5 — F-23 Mensajes (desktop 1440) | `58:149` | Built (partial — see gaps below) — `features/messageLogs/MessageLogsPage.tsx`. Reviewed from a screenshot the client pasted directly (Figma MCP rate limit) |
| 5 — F-24 Mensajes — Drawer lateral | `58:388` | Built (partial — see gaps below) — `features/messageLogs/MessageLogDrawer.tsx`. Reviewed from a pasted screenshot |
| 5 — F-25 Plantillas (desktop 1440) | `60:1006` | Built (partial — see gaps below) — `features/messageTemplates/MessageTemplatesPage.tsx`. Reviewed from a pasted screenshot |
| 5 — F-26/29 Nueva plantilla (modal) | `60:1144` | Built (partial — see gaps below) — `features/messageTemplates/MessageTemplateForm.tsx`. Reviewed from a pasted screenshot |
| 5 — F-27 Editar plantilla (modal) | `60:1263` | Built — `features/messageTemplates/MessageTemplateForm.tsx` (shared with F-26/29). Reviewed from a pasted screenshot |
| 5 — F-28 Activar plantilla (dialog) | `60:1383` | Built, matches closely — `features/messageTemplates/ActivateTemplateDialog.tsx`. Reviewed from a pasted screenshot |
| (post-review) Mi perfil (desktop) | *(not a Figma node — pasted screenshot)* | Built, matches closely — `features/auth/ProfilePage.tsx`. Reviewed from a pasted screenshot; see the gaps entry above for the two open questions resolved |
| ~~(post-review) Control de acceso / Dashboard (admin + cobrador)~~ (RESOLVED, Fase 7) | *(not a Figma node — pasted screenshots, no longer available when Fase 7 started)* | Dashboard built from scratch against the real contract, not from these screenshots — see the Phase 7 gaps section below. The Cobrador-specific KPIs these screenshots showed were confirmed unbacked by the data model and dropped. "Control de acceso" is still Configuración, Phase 8, untouched |
| 6 — Refinanciar préstamo (modal) | *(no Figma frame — built from scratch, client's explicit request)* | Built — `features/loans/RefinanceLoanForm.tsx` |
| 7 — Dashboard | *(no Figma frame — built from scratch, client's explicit request)* | Built — `features/dashboard/DashboardPage.tsx` |

## Note on brand text

The Figma frames display "CobranzaApp", but confirmed with the client: the product name is **Collectify**. `LoginPage` and `Sidebar` use "Collectify" instead of matching the Figma text literally — everything else (colors, spacing, type, layout) still follows the design exactly.

## Known design/backend gaps

Standing rule from the client: build against the *real, implemented* backend contract, not the mockup. Where Figma shows something the backend doesn't support, drop it. Where the backend requires something Figma doesn't show, add it. Logged here every time it comes up, phase by phase.

**Phase 3 — Clientes**

| Figma shows | Backend reality | What we built |
|---|---|---|
| "Nombre completo" single field | `Client` entity has separate `firstName` / `lastName` columns | Two fields: Nombre + Apellido |
| No cédula field on the client form | `documentNumber` is a required column on `Client` | Added a Cédula field (required) — client explicitly asked for this: *"en el caso de la cédula, agrégalo"* |
| Correo electrónico field | No email column on `Client` | Dropped |
| Dirección field | No address column on `Client` | Dropped |
| Estado dropdown on the create/edit form | Status isn't settable via `POST`/`PATCH /clients` — it's derived from `deletedAt` (soft delete only, via `DELETE /clients/:id`) | Dropped from the form; status is shown as a read-only badge, changed only via the Desactivar action |
| "Préstamos" and "Última actividad" columns in the clients table | No loans endpoint exists yet (Phase 4) | Dropped both columns |
| "#" row-number column | Not a backend field | Added — purely a display sequence computed from `meta.page`/`meta.limit`, client-side only |
| Celular shown unformatted (`+573205704455`) | Stored/validated as-is by the backend | Added `lib/format.ts#formatPhoneNumber` — display-only, e.g. `+57 320 570 4455` |
| Figma doesn't show sort order explicitly | `ClientsService.findAll` defaulted to `client.createdAt DESC` (newest client first) | **Backend change (added later, after Phase 4 shipped), client request:** changed the default order to alphabetical, ascending, by `firstName` then `lastName`. Two issues found and fixed along the way, both confirmed empirically by the client testing real names: (1) case — Postgres text order is case-sensitive by default, so an inconsistently-capitalized "andrés" landed after "Zapata" — fixed with `LOWER()`. (2) accents/ñ — this Postgres instance compares text by raw UTF-8 byte value (no locale-aware collation configured), and accented characters are multi-byte, so they always sort after every plain ASCII letter — "José" landed after everything, and "Ñoño" sorted after all the O's instead of near the N's. Fixed with `TRANSLATE()`, folding accented characters to their plain equivalent for sort purposes only (doesn't touch the stored/displayed name). Same `addSelect`-with-alias approach as the Préstamos numeric sort fix, for the same reason (TypeORM's orderBy chokes on raw expressions containing a dot). |
| ~~"Todos" filter tab~~ (RESOLVED) | `GET /clients`'s `isActive` was a strict boolean (default `true`), no "both" mode | Initially dropped, but the client pushed back — without "Todos" the Estado column reads as redundant (every row in a filtered tab shows the same badge). Fixed at the source instead of working around it: `QueryClientsDto.isActive` now also accepts the literal string `'all'`, and `ClientsService.findAll` skips the `deletedAt` filter entirely when it sees that value. Fully backward compatible — omitted still defaults to `true` (active only), existing tests untouched. New unit test added in `clients.service.spec.ts`. |
| "Importar Excel" button | Excel import is explicitly Phase 8 scope | Dropped for now, revisit in Phase 8 |
| Sidebar/header show the user's full name | `GET /auth/me` returns only `{id, email, role}` — no `fullName`, even though the `User` entity has one | Sidebar shows email instead |
| ~~Detail/edit page reachable for any client row~~ (RESOLVED, Phase 10) | `ClientsService.findOne()` calls `findOneBy({id})` without `withDeleted: true`, so `GET/PATCH /clients/:id` 404 for soft-deleted clients. There was also no reactivate/restore endpoint anywhere in the API | Inactive rows still can't be viewed/edited (that part of the gap is real — soft-deleted clients stay minimal by design), but they're no longer a dead end: `ClientsService.reactivate()` + `PATCH /clients/:id/reactivate` (admin only) restores one, and `ClientRow.tsx` now shows a "Reactivar" action instead of "Sin acciones disponibles" for inactive rows. See Phase 10 section below. |
| ~~F-14 detail page: KPI stats grid (Préstamos totales, Monto prestado, En mora, Mensajes enviados)~~ (RESOLVED, post-Phase-5) | Originally assumed this needed a dedicated Phase 7 dashboard-aggregates endpoint. Turned out not to — client pasted a screenshot asking for exactly this row of 4 cards, and by then `ClientDetailPage.tsx` already fetched everything needed: `useLoans({ clientId })` (for count + per-loan `principalAmount`/`outstandingBalance`/`overdueDays`) and `useMessageLogs({ clientId })` (for count) | **Frontend-only fix, no new backend endpoint:** added a `StatCard` row computed client-side — Préstamos totales = `loans.meta.total`; Monto prestado = sum of `principalAmount`; En mora = sum of `overdueBalance` (see the resolved gap directly below — originally shipped using `outstandingBalance`, which was wrong); Mensajes enviados = `messages.meta.total`. Bumped the loans query to `limit: 100` so the sums cover this client's actual loans, not just the first page shown in the table (still capped at 10 rows for display) — undercounts only if a single client somehow has 100+ loans, an accepted edge case at this business's real scale |
| (post-review, same day) "En mora" stat card showed the loan's whole remaining balance (e.g. $903.000) instead of what was actually overdue (client expected ~$3.000 of interest on the one late installment) | The stat used `outstandingBalance`, which sums EVERY still-pending installment on a loan — overdue and not-yet-due alike. A loan with 8 pending installments and only 1 overdue was showing all 8 summed together | **Backend change (announced, applied):** added `overdueBalance` to `LoanSummary` (`loans.service.ts` `summarize()`) — same aggregation pattern as `outstandingBalance`/`overdueDays`/`nextInstallmentDueDate`, just filtered to `status === Pending && overdueDays > 0`. `outstandingBalance` is unchanged (still "how much is left on the whole loan") and still used elsewhere (e.g. the loans table's "Saldo" column) — `overdueBalance` is specifically "how much is actually late right now". New unit tests added contrasting the two on the same mixed overdue/upcoming loan |
| ~~F-14 "Préstamos del cliente" table~~ (RESOLVED, post-Phase-5) | Phase 4 built the loans feature everywhere else (`loansApi`, `useLoans`, `LoansListPage`, `LoanDetailPage`) but never came back to wire it up on this specific page — left as a placeholder ("Los préstamos de este cliente se mostrarán aquí a partir de la Fase 4") that outlived its own phase. Caught when the client asked why it was still there. `GET /loans` already accepted a `clientId` filter, so no backend change was needed | **Frontend-only fix:** added a loans table to `ClientDetailPage.tsx` via `useLoans({ clientId })`, reusing `LoanRow.tsx`'s exact column/badge treatment (`loanStatusDisplay.ts`) minus the "Cliente" and "#" columns (redundant on this page). Shows up to 10 loans with a "Ver los N en Préstamos" link when there are more (plain link, not pre-filtered — `LoansListPage`'s search box doesn't read from the URL) |
| (post-review) Client asked for a "próxima cuota" column on the new loans table — not in Figma at all, a new request | `LoanSummary` had no due-date field of any kind. Also a genuine design question: a loan can have overdue AND not-yet-due installments pending simultaneously (payments aren't required in order — `InstallmentsService.registerPayment` accepts any installment id directly), so "next cuota" is ambiguous if taken to mean only "the next upcoming one" | **Backend change (announced, applied):** added `nextInstallmentDueDate` to `LoanSummary` (`loans.service.ts` `summarize()`) — the due date of the oldest still-pending installment, whichever kind (overdue or upcoming), null if none pending. One field instead of two ("última vencida"/"próxima por vencer") since it's always unambiguous: read together with the existing `overdueDays` column to know which case it is. New unit tests added. Scoped to the client's loans table only — `LoansListPage`/`LoanRow.tsx` weren't touched, so the main Préstamos list doesn't show this column (yet) |

**Phase 4 — Préstamos / Cuotas**

Every backend change below was announced to the client before being made, per their standing instruction for this phase.

| Figma shows | Backend reality | What we built |
|---|---|---|
| "Nombre" column in the Préstamos table | `GET /loans` returned bare `Loan` rows — no client name, only `clientId` | **Backend change (announced, applied):** `LoansService.findAll` now `leftJoinAndSelect`s `client` and returns a new `LoanSummary` shape (`clientFullName`, plus the three fields below) instead of raw `Loan[]`. Additive only — `Loan`'s own shape is untouched, `LoanDetail` (single-loan fetch) deliberately does *not* carry `clientFullName` since that page always already knows the client. |
| "Saldo" (outstanding balance), "Cuotas" (paid/total), "Días mora" columns | None of these were computed anywhere — only per-installment `overdueDays`/`interest`/`totalDue` existed, and only on read | **Backend change (announced, applied):** `LoansService.findAll` now aggregates each loan's installments (via the existing `enrichInstallment` helper — no formula duplicated) into `outstandingBalance`, `installmentsPaid`, and `overdueDays` (max across the loan's pending installments). Still calculated on every read, never stored. |
| Búsqueda / search box | `GET /loans` had no `search` param | **Backend change (announced, applied):** added `search` to `QueryLoansDto`, matched via `ILIKE` against `client.firstName`/`client.lastName`/`loan.promissoryNoteNumber` in `LoansService.findAll`. |
| Figma doesn't show sort order explicitly | `LoansService.findAll` defaulted to `loan.createdAt DESC` (newest loan first) | **Backend change (announced, applied), client request:** changed the default order to match how physical pagarés are already filed — by `promissoryNoteNumber`, ascending. No interactive column sorting added — client explicitly scoped this to just the default order for now. Since `promissoryNoteNumber` is free text (allows values like `"#743"`), a plain text order compared it character-by-character and put `"101"` before `"2"`; fixed by stripping non-digits and ordering by the numeric value instead (`NULLIF(regexp_replace(...), '')::bigint`, `NULLS LAST`), with the plain text order kept as a secondary tiebreaker. |
| "Rango de fechas" filter | No date-range param on `GET /loans`, and it wasn't clear which date (disbursed? due?) it meant | Dropped — not backed, and ambiguous even if it were |
| Top-right "ADMIN" role pill on the Préstamos page | Redundant with the sidebar's own role badge | Dropped |
| "Enviar mensaje" quick action per row | WhatsApp messaging is Phase 5/9 scope | Dropped for now |
| F-18 "Nuevo préstamo": no N° de pagaré or Tasa de interés fields shown | Both are required, non-nullable columns on `Loan` (`promissoryNoteNumber`, `interestRate`) | Added both fields — the form can't submit without them |
| F-18: single "Fecha de vencimiento" field | `POST /loans` doesn't accept a due date at all — it derives every installment's due date from `disbursedAt` + `installmentFrequency` server-side | **Updated per client request:** initially dropped in favor of "Fecha de inicio" (`disbursedAt`), the literal field the API takes. The client pushed back — the physical pagaré already has each installment's due date written on it, so typing "fecha de inicio" means reverse-computing a disbursement date from what's on the paper. Repurposed the field instead: the form now asks for the *first installment's* due date, and derives `disbursedAt` client-side (one period earlier — `features/loans/dueDateMath.ts`, mirroring the backend's own month/day arithmetic) before submitting. `POST /loans`'s contract is unchanged; only what the form asks the admin to type changed. |
| F-18: no per-installment amount breakdown | `installmentAmounts: number[]` is required and must sum to `principalAmount` exactly (±0.01) — the API does **not** auto-split | Added a dynamic amount-per-installment breakdown with an auto-split helper ("Repartir en partes iguales") and live sum validation, so the common case (equal installments) is a single click, and uneven schedules are still possible |
| Client asked to edit a loan's total amount and payment schedule after creation | `PATCH /loans/:id` only allows `interestRate`/`description` — changing the principal or schedule would leave already-generated installments inconsistent, and the existing Refinance flow (closes the old loan, opens a new linked one) already covers "the debt changed") | **Deferred, by the client's own choice** (`AskUserQuestion`: "Dejarlo para más adelante") — raised as a real conflict rather than silently loosening the PATCH validation; revisit as its own phase, likely alongside Refinance |
| F-19 detail page: only shows "Historial de pagos" + WhatsApp log | Phase 4's own scope explicitly requires showing each installment's `overdueDays`/`interest`/`totalDue` "exactly as returned by GET /loans/:id" | Added a "Cuotas" table above Historial de pagos, with a per-row "Pagar" action — not in Figma, but there's no other place in this design to show it |
| F-19: "Log de mensajes WhatsApp" section | Phase 5/9 scope; also, once built, turned out messages aren't per-loan at all (see Fase 5 gaps below) | **Updated in Fase 5:** replaced the placeholder with a link to the client's own detail page, where their message history actually lives |
| F-19: "Historial de pagos" | `GET /loans/:id/payments` didn't exist — only registering a payment did | **Backend change (announced, applied):** added `LoansService.getPayments` + `GET /loans/:id/payments` |
| F-20 "Registrar pago": simple header, no installment picker | `POST /installments/:id/payments` is per-installment — there's no loan-level "pay whatever's next" endpoint | No gap in the dialog itself (matches Figma exactly), but the *caller* has to pick an installment: the top "Registrar pago" button and the list page's quick "Pago" action both auto-target the oldest pending installment (matching Figma's simplicity); the new Cuotas table also offers a "Pagar" action per row for precision |
| F-22 "Cambiar estado": 4-way picker (Al día / Pagado / En mora / Congelado) | "Al día"/"En mora" aren't stored states at all — derived from `overdueDays` on every read (`docs/DATABASE.md`) — and "Congelado" doesn't exist anywhere on the backend | **Backend change (announced, applied):** added `LoansService.markAsPaid` + `POST /loans/:id/mark-as-paid` (admin-only), which closes the loan and marks its remaining pending installments paid, for the one real use case (client paid outside the system, e.g. cash). The dialog itself is a single confirmation instead of a 4-way picker — three of Figma's four options don't correspond to any real backend action. Raised via `AskUserQuestion`; client chose "build everything except Congelado," and this single-confirmation shape is how "Al día"/"En mora" being non-settable was resolved in the end |

**Phase 5 — Mensajes / Plantillas**

The backend already has all four WhatsApp message types fully built (`new_loan`, `upcoming_due`, `overdue`, `account_summary` — the planning doc's own "don't build until Phase 9" scope). Raised via `AskUserQuestion`; the client chose to keep this phase scoped to `overdue` only, as originally planned, even though the other three are real and available. Figma reviewed from screenshots pasted directly in chat (Figma MCP hit its rate limit again — see Phase 4's note on this same limitation).

Every backend change below was announced to the client before being made, per their standing instruction.

| Figma shows | Backend reality | What we built |
|---|---|---|
| F-23 Estado column: Leído / Entregado / Fallido / Pendiente (4 values), with a 4-way summary count | `MessageLog.status` only has two real values, `sent`/`failed` — there is no WhatsApp delivery/read-receipt webhook integration anywhere in the codebase; the backend only knows whether the initial send API call succeeded, synchronously, at send time | Collapsed to the two real states, labeled "Enviado"/"Fallido"; the summary count is two categories instead of four |
| F-23 "AD ADMIN" pill, top-right | Redundant with the sidebar's own role badge (same call made in Phase 4 for Préstamos) | Dropped |
| F-23 "Rango de fechas" as a single dropdown | `QueryMessageLogsDto` takes separate `dateFrom`/`dateTo` params, and it's unclear what preset ranges the dropdown was meant to offer | Built as two plain date inputs (Desde/Hasta) instead — maps directly to the two real params |
| F-23 "Buscar cliente…" search box | `GET /message-logs` only filtered by exact `clientId`, no free-text name search | **Backend change (announced, applied):** added `search` to `QueryMessageLogsDto`, matched via `ILIKE` against the joined client's first/last name in `MessageLogsService.findAll` — same pattern as Préstamos/Clientes search |
| F-23 "Cliente" column showing a name | `GET /message-logs` returned bare `MessageLog` rows — no client name, only `clientId` | **Backend change (announced, applied):** `MessageLogsService.findAll` now `leftJoinAndSelect`s `client` |
| No control shown anywhere for pausing/resuming the automatic weekly send | `POST /whatsapp/cron/pause` and `/resume` existed, but nothing in Figma shows where this control lives, and there was no way to even read the current paused/running state | **Backend change (announced, applied):** added `GET /whatsapp/cron/status`. Necessary plumbing, not a design choice — a pause/resume toggle can't render correctly without knowing current state. Placed the control on the Mensajes page itself (admin only), since there's no frame for it and this is the page about automatic sends |
| F-24 drawer "Estado: Leído — Entregado y leído el 15 ene 09:16" | Same status-granularity gap as F-23 | Shows only "Enviado"/"Fallido", no delivery/read timestamps |
| F-24 drawer "Enviado por: CronJob automático — 09:14" | Not recorded anywhere whether a send was triggered by the weekly cron job or a manual admin action | Dropped |
| F-24 drawer "Plantilla usada" + "Ver plantilla" button | `MessageLog` stores the fully-rendered `messageContent` text (correct — a historical snapshot, since templates can be edited later) but has no foreign key back to which template produced it | Dropped |
| F-24 drawer "Préstamo relacionado: #P-001 — 98 días en mora" (single loan) | An overdue reminder is consolidated **per client**, covering every overdue installment across *all* of their loans in one message — there's no single "related loan," and the per-installment data (`message_log_items`) had no endpoint to fetch it for a given message | **Backend change (announced, applied):** added `MessageLogsService.getItems` + `GET /message-logs/:id/items`, returning every installment (with its loan) included in that specific message. Replaced Figma's single line with a real list — more accurate to how the message actually works, not less |
| F-25 "Categoría" field/label (e.g. "Mora / Automático") on template cards and the create/edit form | No such column on `MessageTemplate` — only a fixed `type` enum, and this phase only ever creates `type=overdue` templates | Dropped |
| F-25 "Automático"/"Manual" badge on template cards | Not a property of the template — it describes *how* a send was triggered (cron vs. the manual button), which varies per send, not per template | Dropped |
| F-25 example cards "Pago próximo a vencer", "Pago recibido", "Mensaje manual" | "Pago próximo a vencer" maps to the real `upcoming_due` type (out of scope this phase); "Pago recibido" and "Mensaje manual" don't correspond to any of the four real message types at all — mockup flavor, not backed by the data model | Only `overdue`-type templates can ever appear on this page |
| F-26/29 "Nueva plantilla" variables: `{{nombre}}`, `{{dias}}`, `{{monto}}`, `{{fecha_venc}}` | **Significant mismatch, confirmed against `messageRenderer.ts`:** the overdue message's per-installment line ("1️⃣ La cuota No. X del pagaré #Y por $Z... venció hace N días.") is entirely fixed and **not** admin-editable — it implies a single-installment template, but this message type consolidates every overdue installment across every loan into one message. The admin only edits the outer wrapper (greeting + where the list/total go), using the three variables the renderer actually substitutes: `{{clientFullName}}`, `{{installmentsList}}`, `{{grandTotal}}` | Built the form around the three real variables, with inline help text explaining the installment list itself isn't editable |
| F-26/29 "Caracteres: 0 / 1024" hard limit | `content` is a Postgres `text` column with no length constraint, and `CreateMessageTemplateDto` has no `@MaxLength` validator — 1024 isn't enforced anywhere server-side | Kept a live character counter (useful feedback) but not a hard block at 1024, since it isn't a real rule |
| F-27 "Eliminar plantilla" button | No `DELETE` endpoint existed on `message-templates` | **Backend change (announced, applied):** added `MessageTemplatesService.remove` + `DELETE /message-templates/:id` (soft delete). Also added a safety rule not shown in Figma: rejects deleting the currently *active* template (400), since that's what a live send looks up — deactivate or replace it first. Also wrapped in a confirmation dialog first (Figma shows the button with no confirmation step), matching every other destructive action in this app (Desactivar cliente, Marcar préstamo como pagado) |
| (post-review) `{{grandTotal}}` rendered as a bare number (e.g. "158.000"), no `$` | Client caught this reviewing a draft template: `formatCurrency` never added the `$`, unlike the per-installment lines where it's baked in — inconsistent and easy to forget when writing a template | **Backend change (announced, applied):** `messageRenderer.ts` now substitutes `{{grandTotal}}` with the `$` already included (`renderOverdueReminderMessage` and `renderAccountSummaryMessage`). Updated the DTO Swagger example, spec fixtures, and `docs/DATABASE.md` to match — template authors should no longer type a `$` before this variable |
| (post-review) Preview box showed literal `*`/`_`/`~` instead of bold/italic/strikethrough | Client asked whether WhatsApp-style text formatting (`*bold*`, etc.) works in templates — confirmed it already does on send (`whatsapp.service.ts` sends plain text; WhatsApp's own client renders the markers), but the editor's preview didn't reflect it | **Frontend-only change:** `MessageTemplateForm.tsx` preview now parses `*bold*`, `_italic_`, `~strikethrough~` into real formatting, plus a hint line explaining these work automatically on send. No backend change needed |
| (post-review) F-25 template card had a visible `border-border` outline; F-26/29 edit modal had two extra `border-t` divider rules (below the header, above the footer buttons) not present in Figma | Client compared side-by-side screenshots — the real screens rely on background-color contrast (`surface` vs `background`) rather than strokes, and don't separate sections with rule lines | **Frontend-only change:** dropped the border from the `MessageTemplatesPage.tsx` cards and removed both `border-t` dividers from `MessageTemplateForm.tsx` (kept the modal's own outer border, which Figma does show). Scoped to these two components only — other screens weren't re-audited |
| (post-review) Modal/dialog backdrop read as flat gray instead of a clear overlay | Client felt `bg-black/60` looked washed out against the dark theme | **Frontend-only change, applied app-wide:** every dialog's backdrop (`ClientForm`, `DeactivateClientDialog`, `LoanForm`, `MarkAsPaidDialog`, `RegisterPaymentDialog`, `MessageTemplateForm`, `ActivateTemplateDialog`, `DeleteTemplateDialog`, `MessageLogDrawer`) changed from `bg-black/60` to `bg-black/40 backdrop-blur-sm` — a lighter, blurred glass effect instead of a flat gray veil |
| (post-review) App-wide palette audit — client asked for every color in the app to be checked against the 8-token neutral palette (`background`/`surface`/`input`/`border`/`mid`/`subtle`/`muted`/`white`), leaving semantic status colors (blue/green/red/yellow/orange) untouched | Grepped the whole `src` tree for raw Tailwind `gray-*`/`neutral-*`/`zinc-*`/`stone-*`/`slate-*` classes and any hardcoded hex outside the documented tokens. Found: `hover:bg-gray-200` on every primary white button (10 files), `text-gray-500` in `ProtectedRoute.tsx`'s loading state, and `#878787` hardcoded in `loanStatusDisplay.ts`'s "Pagado" badge — a near-duplicate of `muted` (`#888888`), not a real semantic color | **Frontend-only changes:** `hover:bg-gray-200` → `hover:bg-white/90` everywhere (derives the hover state from our own `white` token via opacity instead of an unrelated Tailwind gray); `text-gray-500` → `text-muted`; `loanStatusDisplay.ts`'s "Pagado" badge → `border-muted bg-surface text-muted`. All genuinely semantic colors (mora severity badges, WhatsApp green bubble, blue info banners, status dots) were left as-is per the client's explicit instruction |
| (post-review) F-10 Clientes: "#" row-number column looked washed out; table header labels felt too small | `ClientRow.tsx`'s `Td` component's `muted` prop applied `text-mid` (`#3D3D3D`) — a different, much darker token than the one the client meant (`muted`/Text Secondary, `#888888`); naming collision between the design-system token name and the local prop name | **Frontend-only changes:** `Td`'s `muted` branch → `text-muted`; `ClientsListPage.tsx`'s `Th` → bumped from `text-section-label` (9px) to `text-label` (11px); "+ Nuevo cliente" button → bumped from `text-small` (12px) to `text-body` (13px). Scoped to Clientes only at first |
| (post-review) Client asked for every table's header size to match Clientes' | Extends the Clientes-only fix above to the rest of the app | **Frontend-only change, applied app-wide:** every table's `Th` → `text-section-label` (9px) → `text-label` (11px) in `LoansListPage.tsx`, `LoanDetailPage.tsx` (installments table), `MessageLogsPage.tsx`, and `ClientDetailPage.tsx`'s new loans table. Section-title spans (e.g. "PRÉSTAMOS", "HISTORIAL DE PAGOS") weren't touched — those use the same CSS token but aren't table headers |
| (post-review) No way to close a modal/dialog/drawer with the Escape key | Client asked if this was worth adding — confirmed it's a standard, low-risk UX/accessibility improvement | **Frontend-only change, applied app-wide:** new shared `useEscapeKey` hook (`src/lib/useEscapeKey.ts`), wired into all 9 modal/dialog/drawer components (`ClientForm`, `DeactivateClientDialog`, `LoanForm`, `MarkAsPaidDialog`, `RegisterPaymentDialog`, `MessageTemplateForm`, `ActivateTemplateDialog`, `DeleteTemplateDialog`, `MessageLogDrawer`) |
| (post-review) F-16/17 Préstamos: same two issues as the Clientes row above, now on `LoanRow.tsx` — "ID" (pagaré) column looked washed out, and "#" used the wrong dark token | Same root cause: `LoanRow.tsx`'s `Td` `muted` prop also applied `text-mid` instead of `text-muted`, and the "ID" column was marked `muted` when it shouldn't have been (matches the other white/bold columns) | **Frontend-only changes, mirroring the Clientes fix and `ClientDetailPage.tsx`'s new loans table:** `Td`'s `muted` branch → `text-muted`; "ID" column → no longer `muted` (white, matches Monto/Saldo/Cuotas) |
| (post-review) "Todos los estados" dropdown's option list looked visually inconsistent with the rest of the app, in both Préstamos and Mensajes | It's a native `<select>` — the browser draws the open option list itself (OS chrome), which can't be restyled to match the app's dark theme consistently across browsers. Widening the box or adding padding only moved the text, not the browser's own dropdown arrow or option-list styling | **New shared component:** `src/components/ui/Select.tsx` — a button showing the selected label + a custom SVG chevron, toggling an app-styled option list (dark background, hover/selected states matching the rest of the app, closes on click-outside or Escape). Replaces the native `<select>` in `LoansListPage.tsx` and `MessageLogsPage.tsx`'s "Estado" filters; `LoanForm.tsx`'s "Periodicidad" select wasn't touched (not raised) but should use this component too if it comes up |
| (post-review) Same issue as above, but for every native `<input type="date">` — the browser's calendar popup (month grid, navigation) also can't be restyled | Client explicitly asked for a from-scratch build (no new dependency — every date field in this app is already hand-rolled math, e.g. `dueDateMath.ts`, matching the project's zero-UI-dependency approach so far) rather than installing and re-skinning a date-picker library | **New shared component:** `src/components/ui/DatePicker.tsx` — button (formatted via the existing `formatDateOnly` helper) opening a calendar popover: month/year header with prev/next navigation, a 6-week Monday-first grid built with `Date.UTC` arithmetic (same UTC-safe approach as `dueDateMath.ts`, so month-length/leap-year edge cases are handled by the JS `Date` engine itself, not hand-rolled), today/selected highlighting, a "Limpiar" button, closes on click-outside or Escape. Replaces the native date input in `MessageLogsPage.tsx` (Desde/Hasta), `RegisterPaymentDialog.tsx` (Fecha de pago), and `LoanForm.tsx` (Fecha de la primera cuota) — the only three date fields in the app |
| (post-review) LoanForm's "Descripción (opcional)" and RegisterPaymentDialog's "Observación (opcional)" `<textarea>`s had visually cramped/off-center placeholder text | Both reused a shared `inputClassName` helper meant for single-line `<input>`s — it hardcodes `h-[42px]` with no vertical padding, which fights a multi-line `<textarea rows={2 or 3}>`'s natural sizing. `MessageTemplateForm.tsx`'s textarea never had this bug — it already used its own `py-2.5`-based className instead of a fixed height | **Frontend-only fix:** both textareas now use their own className (border/bg/text styling kept identical, `h-[42px]` swapped for `py-2` so the box sizes itself from `rows` instead), matching the pattern `MessageTemplateForm.tsx` already used correctly |
| (post-review) Every modal's "×" close button looked off-center | The "×" (multiplication sign) text glyph isn't optically centered within a flex box at small sizes — font glyph metrics aren't symmetric the way a vector icon is, so `items-center justify-center` alone doesn't fix it | **New shared component:** `src/components/ui/CloseButton.tsx` — a small SVG X (centered by construction) replacing the "×" character. Replaces the duplicated close-button markup in `ClientForm.tsx`, `LoanForm.tsx`, `MessageTemplateForm.tsx`, and `MessageLogDrawer.tsx` |
| (post-review) Manually-typed peso amounts showed as bare digit strings (e.g. `1000000`) with no live formatting while typing | Client asked whether real-time `$1.000.000`-style formatting was feasible without adding server load — confirmed it's purely client-side string formatting (no network calls), same cost regardless of how often it runs | **New shared component:** `src/components/ui/CurrencyInput.tsx` — a `type="text"` input that strips non-digits on every keystroke, hands the plain number back via `onChange`, and displays it formatted as `$1.000.000` (`value.toLocaleString('es-CO')` with a manual `$` prefix — the same convention already used to bake the `$` into `{{grandTotal}}` in `messageRenderer.ts`, avoiding `Intl`'s currency-style space after `$`). Cursor is forced to the end after each change, matching how these fields are actually typed. Replaces every native `type="number"` field that holds a peso amount: `RegisterPaymentDialog.tsx`'s "Monto del pago", `LoanForm.tsx`'s "Monto" (principal), and `LoanForm.tsx`'s per-installment "Cuota N" amounts. `interestRate` (a percentage) and `totalInstallments` (a count) were left as native number inputs — not monetary |
| (post-review) `RegisterPaymentDialog`'s "Fecha de pago" defaulted to tomorrow instead of today, e.g. 21 jul showed 22 jul | `paidAt` defaulted via `new Date().toISOString().slice(0, 10)` — `.toISOString()` converts the current instant to UTC before formatting, which rolls the calendar date forward for any timezone behind UTC (America/Bogota is UTC-5: local times after ~7pm land on the *next* UTC day). Same bug family as the earlier `formatDateOnly`/`dueDateMath.ts` fix, opposite direction — those force UTC to stop a stored date rolling *back*; this needed the local calendar day to stop "today" rolling *forward* | **Frontend-only fix:** new local `todayDateString()` helper in `RegisterPaymentDialog.tsx` reads `getFullYear()`/`getMonth()`/`getDate()` (local time) directly instead of round-tripping through UTC |
| (post-review) Sidebar lost its active-item highlight one level deep — e.g. Clientes stopped looking selected once inside a client's detail page (`/clientes/:id`) | `Sidebar.tsx`'s `NavLink`s all used react-router's `end` prop, which restricts the active match to an exact path — correct for Dashboard (`/`, otherwise every route would match it) but wrong for every other item, since it hid the active state on nested routes like `/clientes/:id` and `/prestamos/:id` | **Frontend-only fix:** `end` is now only applied to the Dashboard item (`end={item.to === '/'}`) — Clientes/Préstamos/Mensajes/Plantillas stay highlighted one level into their own section |
| (post-review, full-project audit) No way to edit a loan's `interestRate`/`description` after creation, and both fields were never displayed again either | `PATCH /loans/:id` only allows these two fields (`principalAmount`/schedule aren't patchable — would cascade into already-generated installments), and it was explicit Phase 4 data-layer scope (`useUpdateLoan`, `loansApi.update`) — but nothing ever called the mutation. Same pattern as the earlier ClientDetailPage loans-table gap: the plumbing existed, nothing was wired to it | **New shared component:** `src/features/loans/EditLoanDialog.tsx` — a small form (just the two editable fields) opened via a new "Editar" button on `LoanDetailPage.tsx` (admin-only, next to "Cambiar estado"), calling the existing `useUpdateLoan`. Also added a 5th KPI card ("Tasa de interés") and a description line to the detail page, since neither was shown anywhere before this fix — an admin had no way to even see what they'd typed at creation, let alone correct it |
| (post-review, full-project audit) No way to change your own password anywhere in the app | `authApi.changePassword` (`POST /auth/change-password`) has existed since Phase 2 — it was literally part of that phase's own scope checklist — but no settings/profile screen was ever built, so it was dead code | **Superseded the same day, see below** — first shipped as a key-icon button in the Sidebar footer opening a modal, since no design existed yet for where this belonged |
| (post-review) Client shared the real Figma design for "Mi perfil" (account info + change password) and asked to replace the key-icon stopgap with it | New screen, not part of the original 5-phase scope — reachable by clicking the user block in the Sidebar footer (not a `MENÚ` item, matching the design). Two open questions raised via `AskUserQuestion`: (1) the design shows Nombre/"Desde" (member-since date), but `GET /auth/me` only returned `id`/`email`/`role` — client chose to add `fullName`/`createdAt` to it (**backend change, announced, applied**: `AuthenticatedUser` interface + `JwtStrategy.validate()`, both fields already existed on `User`, purely additive). (2) the design's password hints list "mínimo 8 caracteres", "al menos una mayúscula", "al menos un número", but `ChangePasswordDto` only validates `@MinLength(8)` — client chose to drop the two unenforced hints rather than add backend validation for them | **New:** `src/features/auth/ProfilePage.tsx` (route `/perfil`) — "Información de cuenta" card (avatar with real initials via new `lib/format.ts#getInitials`, Nombre/Correo/Rol/Desde) plus the existing password form, now embedded as `ChangePasswordCard` instead of a modal. `Sidebar.tsx`'s footer avatar/name now shows the real name (`getInitials`/`fullName`) instead of email initials, and links to `/perfil`; the key icon is gone. Note: `src/features/auth/ChangePasswordDialog.tsx` keeps its original filename despite no longer being a dialog — this tool session's workspace folder doesn't allow renaming/deleting files (same constraint already noted in `components/layout/Header.tsx`'s own comment) |
| **(backend teammate's refactor, main, PR #16)** `message_templates.isActive` and `POST`/`PATCH`/`POST .../activate`/`DELETE /message-templates/:id` all removed — templates are no longer admin-editable at all. WhatsApp only allows initiating a conversation through a Meta-approved template, so a freely-editable `content` column never matched reality; changing it here wouldn't change what Meta actually sends. `type` is now `UNIQUE` (exactly one template per `MessageType`), content changes are a migration going forward (`1784300000000-MakeMessageTemplatesStatic.ts`) — see `docs/DATABASE.md` "Changed after Phase 9" | The entire Phase 5 CRUD build (`MessageTemplateForm.tsx` create/edit form, `ActivateTemplateDialog.tsx`, `DeleteTemplateDialog.tsx`, and 4 of `messageTemplatesApi.ts`'s 5 methods + `useMessageTemplates.ts`'s 4 mutation hooks) was built against the old contract and broke outright once this merged to `main` | **Frontend-only fix (no backend change needed, this was reacting to one already made):** `messageTemplatesApi.ts` and `useMessageTemplates.ts` stripped to the one surviving `GET /message-templates` read. `MessageTemplatesPage.tsx` rewritten as a plain read-only list — no "+ Nueva plantilla" button, no Editar/Activar actions, no Activa/Inactiva badge (nothing to be active *among*, since there's exactly one per type), full `content` shown instead of a 2-line clamp (there's no "Editar" modal left to see the rest in). `MessageTemplateForm.tsx`/`ActivateTemplateDialog.tsx`/`DeleteTemplateDialog.tsx` emptied to a comment + `export {}` — not deleted (workspace can't rename/delete files), but no longer imported anywhere. Still filters to `type=overdue` only, same as before — that was the client's own scope choice, not something this fix should silently expand just because the screen is read-only now |

**Phase 6 — Refinanciación**

No Figma frame exists for this screen — confirmed with the client, who asked to build it from scratch matching the patterns already established in the rest of the app, rather than waiting on a design. The backend half of this phase (`POST /loans/:id/refinance`, the `refinancedFromLoanId`/`refinancedToLoanId` chain, `cancelled` installment status) was already fully built and tested ahead of this client session — same pattern already seen with the Phase 7 dashboard endpoints and the Phase 9 WhatsApp message types. The business question `docs/phases/PHASE_6_REFINANCING.md` explicitly flags ("what happens to a refinanced loan's remaining installments") was also already resolved in `docs/DATABASE.md`/`docs/GLOSSARY.md`: they're marked `cancelled`, kept as historical record, excluded from active mora/reminder/dashboard processing.

| What was needed | Reasoning | What was built |
|---|---|---|
| No client-side way to call `POST /loans/:id/refinance` | `loansApi.ts` already had `refinancedToLoanId` typed on `LoanDetail` (added ahead of time, "only relevant once Phase 6 ships") but no `refinance()` method or input type | Added `RefinanceLoanInput` (matches `refinanceLoan.dto.ts` exactly — same shape as `CreateLoanInput` minus `clientId`, since the new loan always belongs to the same client server-side) and `loansApi.refinance()` + `useRefinanceLoan()` |
| No UI to trigger a refinance | — | **New:** `src/features/loans/RefinanceLoanForm.tsx` — same fields/layout/validation as `LoanForm.tsx` (including the "first installment due date" UX that derives `disbursedAt` client-side, and the per-installment auto-split breakdown), minus the client selector. Shows the old loan's current outstanding balance as a *reference* only — `principalAmount` is explicitly not auto-calculated from it (the DTO's own doc comment: renegotiated amount is a business decision, not a formula), matching `RegisterPaymentDialog`'s pre-filled-but-editable pattern conceptually, except here the field starts empty rather than pre-filled, to avoid implying the balance figure is the "right" answer. Triggered via a new "Refinanciar" button on `LoanDetailPage.tsx` (admin only, disabled unless the loan is `active`). On success, navigates to the newly-created loan (not the now-refinanced old one) |
| Old loan → new loan and new loan → old loan weren't linked anywhere in the UI | `refinancedFromLoanId` was already shown nowhere; `refinancedToLoanId` existed on the type but nothing read it | `LoanDetailPage.tsx` now shows a banner linking to whichever side of the chain applies: refinanced loans link forward to the loan that replaced them, loans created by a refinance link back to the original. Both fetch the linked loan (`useLoan`) just to show its `promissoryNoteNumber` instead of a bare link |
| `cancelled` installments (the old loan's cancelled-on-refinance remainder) weren't visually distinguished from `paid`/`pending` ones in the Cuotas table | `docs/phasesClient/PHASE_6_REFINANCING.md` is explicit: shown distinctly, not hidden, since they're historical record | Cancelled rows get `opacity-50` and a muted "Cancelada" badge (`border-mid`/`text-mid`, matching the neutral-token convention used for "Pagado" elsewhere) instead of plain text, while staying fully visible in the table |
| (informational, no action needed) Refinancing also triggers an automatic "new loan" WhatsApp message | `LoansService.refinance()` calls the same `sendNewLoanMessageSafely()` as regular loan creation (Phase 9 scope, already wired in, fails safely without blocking the refinance) — `RefinanceLoanDto.description` doubles as that message's content if set | No frontend work needed — already fully automatic server-side. Noted here so it isn't mistaken for a bug when a refinance unexpectedly sends a message |
| (post-review) `LoanRow.tsx`'s "Pago" quick action (list page) was an unconditional link, even on loans with no pending installments left | Pre-existed for `paid` loans since Phase 4, but became more reachable once `refinanced` (also zero pending installments) became a real, common status this phase — clicking it landed on the detail page without opening the payment dialog (no `oldestPending` to target), a silent no-op rather than a crash | **Frontend-only fix:** `LoanRow.tsx` now checks `loan.status !== Paid && loan.status !== Refinanced`; when false, "Pago" renders as a disabled-looking span (same size/position, `text-mid`, `cursor-not-allowed`, tooltip "No hay cuotas pendientes por pagar") instead of a `Link` — kept visible rather than hidden so the row's action-column layout doesn't shift |

Client-side, this closes out `docs/phasesClient/PHASE_6_REFINANCING.md`'s full scope: refinance flow, both directions of the chain visible and correctly linked, cancelled installments visible and clearly marked.

**Phase 7 — Dashboard**

The client had earlier pasted admin/cobrador Dashboard screenshots (see the "(post-review) Control de acceso / Dashboard" gap above) and asked to hold off building them until this phase. By the time this phase started, those screenshots were no longer available in-session; asked the client whether to re-share them or build from scratch against the real `GET /dashboard/*` contract following the app's established patterns — client chose to build from scratch (`AskUserQuestion`).

The backend (`dashboard.controller.ts`/`dashboard.service.ts`) was already fully built and tested ahead of this phase, same pattern as Phase 6's refinance endpoint and the Phase 9 WhatsApp types.

| What was needed | Reasoning | What was built |
|---|---|---|
| A landing page after login | `docs/phasesClient/PHASE_7_DASHBOARD.md` explicitly calls for this to replace the Phase 1 placeholder (`HealthCheckPage`) as the index route, for both roles | `router.tsx`'s index route now renders `DashboardPage` instead of `HealthCheckPage`. `HealthCheckPage.tsx` itself wasn't deleted (workspace can't remove files) but is no longer routed anywhere |
| One dashboard, not an admin/cobrador variant | The earlier-seen cobrador screenshot showed KPIs ("Mis asignados", "Contactados", "Recaudado") implying a collector-assignment concept — confirmed against `dashboard.service.ts`: no such concept exists anywhere in the aggregation queries (no `collectorId`/assignment join at all). Those KPIs aren't backed by anything real | Single `DashboardPage.tsx` for both roles, built from the 3 real endpoints only — no role branching |
| KPI summary row | `GET /dashboard/summary` returns `totalActiveClients`, `totalOverdueInstallments`, `totalAmountOverdue`, `messagesSentThisWeek` | 4 `StatCard`s, same visual pattern as `ClientDetailPage.tsx`'s stats grid |
| Sortable, paginated overdue-clients list | `GET /dashboard/overdue-clients` supports `sortBy` (`totalOverdueAmount` \| `maxOverdueDays`) and standard `page`/`limit` pagination | Table + `Select` sort control + the same `PageButton` pagination pattern as `LoansListPage.tsx`. "Días de mora" badge reuses `moraBadgeClasses` from `loanStatusDisplay.ts`. Each row links to `/clientes/:id` |
| Monthly report with a month/year picker | `GET /dashboard/monthly-report?month=&year=` — no preset range hinted anywhere | Two `Select` dropdowns (month name, year — last 4 years including the current one, no future years since a report for one would always be empty) plus 3 `StatCard`s (préstamos nuevos, pagos recibidos, mensajes enviados). Defaults to the current month/year |

New: `features/dashboard/dashboardApi.ts`, `useDashboard.ts`, `DashboardPage.tsx`.

**Post-review changes**

| What was asked | What was done |
|---|---|
| "Clientes activos" card title was ambiguous — client saw 2 on the card despite having 10 clients created, since it counts clients with an active *loan*, not clients in general | Relabeled to "Clientes con préstamos activos" — same number, clearer title. No calculation change |
| Missing section label above the KPI row (the other two sections already had one: "CLIENTES EN MORA", "REPORTE MENSUAL") | Added a "KPIS" label above the stat-card grid, same `text-section-label`/tracking treatment used everywhere else in the app (e.g. the Sidebar's "MENÚ" label follows the same small-uppercase-label idea, though it's a different CSS token since it's nav chrome, not a page section) |
| Client shared a Figma screenshot of the CronJob status card (bigger card, status dot, title, description line, button) — the live version was a thin compact pill, much smaller than the mockup | Restyled `MessageLogsPage.tsx`'s cron control into a proper card (bigger dot, bold title line, subtitle line, larger button), matching the app's card conventions. **Not copied 1:1:** the Figma card also showed "Cada 30 min" and "Última ejecución: hace 12 min" — neither exists in `GET /whatsapp/cron/status` (`{ running: boolean }` only, no frequency or last-run tracking), and the real frequency isn't every 30 min anyway. Flagged instead of fabricated; client chose not to add backend tracking for "última ejecución" for now |
| **(Backend change, confirmed, applied)** Client confirmed the overdue reminder should send Monday/Wednesday/Friday at 9am, not just Monday — `docs/phases/PHASE_5_WHATSAPP.md`'s original spec said "the weekly automated reminder" (once a week), which is what got built and is what `OVERDUE_REMINDER_CRON=0 9 * * 1` ran | `OVERDUE_REMINDER_CRON` changed to `0 9 * * 1,3,5` in `.env`/`.env.example`, documented in `docs/ENVIRONMENT_VARIABLES.md`. Purely a cron expression change — the job's grouping logic (one consolidated message per client) is unaffected, it just runs 3x/week instead of once. `overdueReminder.cron.ts`'s log message updated to not say "weekly" (the method name `runWeeklyReminder` was left alone — "weekly" there refers to the message's consolidation window, not the schedule, and renaming it would touch more files than this change warrants). `MessageLogsPage.tsx`'s cron card subtitle updated to state the real days |
| **Cobrador must not see money anywhere except the overdue-clients list** (client's explicit rule, after reviewing a Figma cobrador-dashboard screenshot showing "Recaudado" as a dollar figure) — confirmed this is a client-side display rule, not a new backend concept; the collector-assignment KPIs from that same screenshot ("Mis asignados", "Contactados") still aren't backed by anything real and still weren't built | `DashboardPage.tsx` now reads `useAuth()` and hides two `StatCard`s for non-admins: "Monto total en mora" (KPI row) and "Pagos recibidos" (reporte mensual). Grids shrink from 4→3 and 3→2 columns accordingly. The "Clientes en mora" table is **not** touched for either role — it keeps its "Monto total en mora" column even for cobradores, per the client's explicit exception (a collector needs to know how much to collect) |

**Phase 9 — Mensajes / Plantillas (tipos adicionales)**

The `api` side of this phase (three new message types, `MessageTemplate`/`MessageLog` gaining a `type` column, `Loan.description`) was already fully built and tested ahead of this round. Partway through, a teammate's separately-merged PR (main, PR #16) changed `message_templates` from admin-editable to read-only (see `docs/DATABASE.md` "Changed after Phase 9" and `docs/GLOSSARY.md`'s "Message template" entry) — WhatsApp only allows a business to *initiate* a conversation outside the 24h reply window through a Meta-approved template, so a freely-editable `content` column never reflected reality. That PR left `MessageTemplatesPage.tsx` already converted to read-only and `messageLogsApi.ts` already returning the nested `client`/`type` fields, so this round's actual scope was smaller than `docs/phasesClient/PHASE_9_MESSAGE_TYPES.md`'s original checklist (which still described an editable template form) — that doc was corrected first (see its own inline note) before building against it.

| What was needed | Reasoning | What was built |
|---|---|---|
| Show all four template types, not just `overdue` | `useMessageTemplates.ts` still client-side filtered to `overdue` only — a Phase 5 scoping choice that stopped making sense once the page became read-only (nothing left to accidentally let an admin edit) | Removed the filter; templates now sort into a fixed order (`MESSAGE_TYPE_ORDER`: Primera vez, Aviso, Recordatorio de mora, Estado de cuenta) instead of API order, each card labeled with its type |
| Filter/see message history by type | `messageLogsApi.ts`'s `getAll` hardcoded `type: MessageType.Overdue` on every request, not exposed as a filter | Removed the hardcoding, added `type` as an optional query param, added a "Tipo" column + filter dropdown to `MessageLogsPage.tsx`, and a "Tipo" column to `ClientDetailPage.tsx`'s message history table |
| Pause/resume + manually trigger the Aviso (upcoming-due) reminder | `POST /whatsapp/cron/upcoming-due/pause`\|`resume` and `POST /whatsapp/clients/:id/send-upcoming-due` already existed, but there was no `GET` to read the cron's current running state (the existing `GET /cron/status` was hardcoded to the overdue cron's job name only) | **Backend change (announced, applied):** added `GET /whatsapp/cron/upcoming-due/status`, mirroring the existing endpoint exactly. `MessageLogsPage.tsx`'s single cron-status widget was extracted into a reusable `CronStatusWidget` and rendered twice (mora + Aviso) side by side. Manual "Enviar aviso" button added next to `ClientDetailPage.tsx`'s existing "Enviar recordatorio de mora" |
| On-demand "send account summary" | `POST /whatsapp/clients/:id/send-account-summary` already existed, no cron/pause-resume needed for this one (on-demand only, per `docs/phases/PHASE_9_MESSAGE_TYPES.md`) | "Enviar resumen de cuenta" button added next to the other two manual-send buttons on `ClientDetailPage.tsx` |
| Surface whether the automatic new-loan ("Primera vez") message actually sent | It's sent synchronously at loan creation with no manual trigger — a failed/skipped send needs to be visible, not silent. `MessageLog` has no `loanId` (it's per-client, consolidated by design for the other types), so there's no direct query for "the message for this loan" | `LoanDetailPage.tsx` fetches the client's `new_loan`-type messages and matches by checking which one's `messageContent` contains this loan's `promissoryNoteNumber` — reliable because the canonical template always renders it inline ("tu pagaré #{{promissoryNoteNumber}}…", see the seed migration), and avoids an extra per-message items request. Shown as a status badge (Enviado/Fallido/No enviado) next to the existing Estado/mora badges in the page header |
| Clean up now-dead template-editing code | `MessageTemplateForm.tsx`, `DeleteTemplateDialog.tsx`, `ActivateTemplateDialog.tsx` were left behind by PR #16 — built against the old editable-templates contract, no longer imported anywhere | Confirmed unused (grepped the whole `apps/client/src`); need to be deleted manually — this workspace can't remove files (see `rm` command given to the client at the end of this round) |
| `docs/phasesClient/PHASE_9_MESSAGE_TYPES.md`'s "Message templates" scope described a `type` selector on an editable form and per-type "activate", contradicting the read-only reality above | The doc predated PR #16's change and was never updated | Corrected in place before building: the section now points at `docs/DATABASE.md` "Changed after Phase 9" and describes the read-only scope actually built |

**Phase 10 — Client Capacity (Cupo) and Reactivation**

No Figma frames exist for this phase — built from `docs/phases/PHASE_10_CLIENT_CAPACITY.md` and `docs/phasesClient/PHASE_10_CLIENT_CAPACITY.md` directly. Two business rules were explicitly flagged in the api-side doc as needing human confirmation before any code was written (not guessed): what counts toward "cupo usado", and whether the mora block is per-installment or client-aggregate. Both were confirmed with the client before this phase started — see `docs/GLOSSARY.md` "Resolved from Phase 10" and `docs/DATABASE.md` "Changed after Phase 10".

| What was needed | Reasoning | What was built |
|---|---|---|
| `Client.credit_limit` | No column existed for a per-client cupo | **Backend change (announced, applied):** nullable `DECIMAL(12,2)` column + migration, same "absence means unenforced" convention as `loans.description`. Added to `CreateClientDto`/`UpdateClientDto` (`@IsOptional() @IsPositive()`) |
| `creditUsed`/`creditAvailable`/`isMoraBlocked` on `GET /clients/:id` | Neither was computed anywhere | **Backend change (announced, applied):** `ClientsService.getCreditUsage`/`hasMoraBlock`/`findOneDetail`, computed on read from the client's active loans' installments (same `enrichInstallment` math as `LoansService.summarize()`), never stored. `GET /clients` (list) still returns plain `Client` rows without these — only the single-client fetch does, so `clientsApi.ts` now has a separate `ClientDetail` type for it |
| Loan creation blocked when over cupo or mora-blocked | No guard existed on `LoansService.create()` | **Backend change (announced, applied):** `assertClientCanTakeNewLoan()` checks mora-block first, then cupo, each with a distinct English message — matched by substring in `LoanForm.tsx`'s error handling (`/overdue/i` / `/cupo/i`) and translated to a Spanish, field-anchored error rather than shown raw. Only on `create()`, not `refinance()` — the phase brief scopes the guard to new-loan creation specifically; refinancing restructures existing exposure rather than adding new exposure, and isn't mentioned in the guard's scope. Worth confirming explicitly with the client if that's ever surprising in practice |
| Cupo field on the client form | No field existed | Added "Cupo (opcional)" to `ClientForm.tsx` using the existing `CurrencyInput` component, shown for both create and edit. `0`/empty means omitted (no cupo), same convention `CurrencyInput` already uses elsewhere |
| Cupo + mora-block visibility on `ClientDetailPage.tsx` | Nothing surfaced either | Added a "Bloqueado por mora" badge next to the existing "Activo" badge when `isMoraBlocked`, and a 5th stat card ("Cupo disponible") alongside the existing four — shows "Sin límite" when `creditLimit` is null rather than a dollar figure |
| Reactivating a soft-deleted client | No endpoint existed at all — inactive clients were a dead end (see the resolved gap above) | **Backend change (announced, applied):** `ClientsService.reactivate()` (mirrors `UsersService.reactivate()`'s pattern, adapted to `Client`'s actual TypeORM soft-delete via `restore()`) + `PATCH /clients/:id/reactivate` (admin only). Reactivating an already-active client is a clear `BadRequestException`, not a silent no-op — same choice `UsersService.deactivate()` makes for self-deactivation. `ClientRow.tsx`'s inactive-row action changed from "Sin acciones disponibles" to "Reactivar" |
| Cupo/mora-block visible before submitting a new loan | The admin would only find out after a rejected `POST /loans` | `LoanForm.tsx` fetches the picked client's full detail (`useClient`, not the search results) and shows an inline red warning if mora-blocked, or the cupo figure otherwise — purely informational, the backend still re-checks both at submit time regardless |

**Phase 11 — Audit Logging**

No Figma frames exist for this phase either — built from `docs/phases/PHASE_11_AUDIT_LOG.md` directly.

| What was needed | Reasoning | What was built |
|---|---|---|
| `AuditLog` entity + `audit_logs` table | No accountability trail existed for sensitive actions | **Backend change (announced, applied):** append-only table (same convention as `message_logs`), nullable `actor_user_id` FK with `onDelete: 'SET NULL'` so a deleted user's past actions stay in the trail. See `DATABASE.md`'s `audit_logs` section |
| Logging without hand-added calls in every service | The phase brief asks for this to not depend on remembering to log in each service method | `AuditLogInterceptor`, a global interceptor reading a `@Audit(action, entityType)` decorator via `Reflector` — write-on-success only (`tap()`), never blocks or fails the request if the audit write itself fails |
| `@Audit()` coverage on `loans.controller.ts` | Phase brief's literal minimum was create/refinance only | Extended to also cover `update()` and `markAsPaid()` — a technical judgment call (not a business-rule guess), flagged in the PR description per `CLAUDE.md`'s guidance |
| Actor captured on `registerPayment` | This endpoint previously captured no authenticated user at all | Added `@CurrentUser() _currentUser: AuthenticatedUser` (underscore-prefixed — the interceptor reads the actor off the raw request, not this param) per the phase brief's explicit instruction |
| `/auditoria` admin-only page | No frontend existed | `AuditLogsPage.tsx` + `AuditLogDrawer.tsx`, mirroring `MessageLogsPage.tsx`/`MessageLogDrawer.tsx`'s layout. Drawer shows the raw `metadata` JSON rather than a bespoke per-action breakdown, since metadata shape varies by action. Added to `Sidebar.tsx` NAV_ITEMS and `router.tsx`, same admin-only `RequireRole` treatment as Plantillas |
| "Actor" filter on `AuditLogsPage.tsx` | No dropdown of users exists to pick from | **Known gap, not built around:** a frontend Users management feature was expected to exist (an earlier phase's task list marked it "completed") but no `apps/client/src/features/users/*` code was found anywhere in the repo — apparently parked on an unmerged branch. Used a plain text input for `actorUserId` instead of a dropdown; flagged inline in the component for whenever that feature actually lands |

**Phase 12 — Payment Attachments**

No Figma frames exist for this phase either — built from `docs/phasesClient/PHASE_12_PAYMENT_ATTACHMENTS.md` directly.

| What was needed | Reasoning | What was built |
|---|---|---|
| Discrepancy in the phase brief itself | `PHASE_12_PAYMENT_ATTACHMENTS.md` states the payment's `observation` field "is never rendered anywhere in the client" — but `LoanDetailPage.tsx`'s payment history table already renders it (added back in Phase 4). **Not rebuilt** — verified the existing column works correctly and left it as-is. This phase's actual net-new scope was the image only. |
| `payments.image_url` | No column existed for the receipt photo | **Backend change (announced, applied):** nullable `VARCHAR` column + migration, same "absence means not provided" convention as `observation`. `CreatePaymentDto.imageUrl` validated with `@IsUrl()` |
| Image hosting provider | The api never touches image bytes per this phase's scope decision | Went with **Cloudinary**, the phase doc's explicit recommendation (over ImageKit/Cloudflare Images) — reversible later, only affects where new uploads go. Cloudinary account/upload preset were not provided during this session; `VITE_CLOUDINARY_CLOUD_NAME`/`VITE_CLOUDINARY_UPLOAD_PRESET` are documented as pending in `ENVIRONMENT_VARIABLES.md`, same treatment as the still-pending Meta WhatsApp credentials |
| `lib/imageUpload.ts` | No client-side upload wrapper existed | Thin wrapper around Cloudinary's **unsigned** upload endpoint (a signed upload would need an api key/secret that can't live in client code). Throws a typed `ImageUploadError` rather than failing silently — an upload failure must block payment submission, not let it go through without the photo, per the phase brief's explicit requirement |
| Photo capture on `RegisterPaymentDialog.tsx` | No file input existed | Added a file input + preview thumbnail. Upload happens on submit, before `onConfirm` fires, with its own `isUploadingImage` state distinct from `isSubmitting` — the submit button reflects both ("Subiendo foto…" vs. "Registrando…") |
| Photo visible in payment history | Not rendered anywhere, even though the field is new | `LoanDetailPage.tsx`'s payment history table gained a "Comprobante" column: a small thumbnail that opens a click-to-enlarge `ImageLightbox` (new local component, same `useEscapeKey`-per-mounted-dialog pattern as every other modal in the app) |

**Post-launch — Message logs scoped to failed-only (confirmed with the client's colleague)**

No Figma frame change — a behavioral change to an already-built screen, confirmed directly with the client's team, not tied to any roadmap phase number.

| Before | After | What was built |
|---|---|---|
| `MessageLogsPage.tsx` had a Todos/Enviados/Fallidos filter, defaulting to Todos (full sent+failed audit log) | Confirmed: this page should only ever surface messages that need attention — i.e. failed/unsent sends | Removed the status filter entirely; `useMessageLogs` is now always called with `status: MessageLogStatus.Failed`. The Enviados/Fallidos legend counts above the table are kept as read-only context (separate `limit: 1` queries, unaffected by the main table's filter) |
| `ClientDetailPage.tsx`'s "Historial de mensajes" tab showed all of a client's messages (sent + failed), same as the global page used to | Confirmed: same change applies here | Split into two queries: the existing `messages` query (unfiltered) still feeds the "Mensajes enviados" KPI card, since that count must reflect the true total, not just failures. A new `failedMessages` query (`status: Failed`) feeds the history list itself. Empty-state copy updated to reflect the new scope on both screens |
