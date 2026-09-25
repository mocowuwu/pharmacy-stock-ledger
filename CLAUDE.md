@AGENTS.md

# Pharmacy Stock Ledger — working notes

Inventory and dispensing for a single clinic pharmacy in Indonesia. Intended for
live daily use, not a demo.

**Design:** https://claude.ai/code/artifact/33cae6a2-5954-4f39-93a0-d6e83284d249
**Plan:** `~/.claude/plans/indonesia-not-right-now-moonlit-adleman.md`

## Rules that are not negotiable

These each exist because of a specific way inventory systems fail. Do not
relax one without saying so explicitly.

- **Items never hold a quantity.** Stock lives on batches; on-hand is derived.
- **The ledger is append-only.** No UPDATE, no DELETE on `stock_movements`.
  Write the movement first, then move the batch, in one transaction.
- **Expired batches are refused at the till.** Refused, not warned about, and
  not overridable by any permission.
- **Nothing is deleted.** Items archive, sales void, users suspend, batches
  deplete or get disposed. There is no purge anywhere, including for the audit
  log — pharmacy records carry multi-year retention requirements.
- **Document numbers are allocated under `lockNumberSeries`** in
  `src/lib/stock/numbering.ts`. Every series -- sales, returns, disposals,
  counts -- reads the day's highest number and adds one, which two simultaneous
  transactions do identically; the unique index then refuses the loser, and the
  cashier sees an opaque database error instead of a receipt. The advisory lock
  makes that a queue. Take it as late as possible, immediately before the insert.
- **The name, description and timezone are the owner's, not the code's.** The
  sidebar, the sign-in screen and the receipt read `settings.businessName` and
  fall back to the i18n string only when it is blank. The timezone is any IANA
  zone, with the three Indonesian ones pinned.
- **The demo catalogue ships and stays until the owner clears it.** A system
  that opens on an empty screen teaches nobody the till. `resetDemoData` in
  `src/lib/dal/maintenance.ts` is the one destructive operation in the project,
  owner-only and behind a typed phrase; accounts, settings, tax rates and the
  audit log survive it. The installer loads it (`npm run db:demo`) only when
  that run created the owner, and `demo-data.ts --first-run` refuses any
  database holding items, sales or suppliers or whose audit log records a
  clear -- an update must never bring the samples back. Clearing empties the
  whole catalogue, so it comes *before* real items are entered, never after.
- **The SMTP password never reaches the browser.** The settings screen is told
  whether one is stored, never what it is, and a blank field means "keep it".
  It is stripped from the audit log too -- a log that records a secret is a
  second place the secret lives.
- **Money is `BIGINT`, in whole rupiah.** An `INT` column overflows around
  Rp 2.1 billion, which this business passes in under a year.
- **Every write carries a user id.** No system actions, no shared logins.
- **Critical alerts cannot be snoozed.** Expired stock stays on screen until it
  is off the shelf. `canSnooze` in `src/lib/alerts/rules.ts` is the gate.
- **An `expired` batch status is sticky.** Without that, any later movement
  would flip the batch back to `active` and put expired stock on sale again.
- **Sales go through `commitSale`** in `src/lib/stock/sale.ts`, which allocates
  every line before writing anything -- a shortfall on the last line must not
  leave earlier lines half-committed.
- **All stock changes go through `applyMovement`** in `src/lib/stock/ledger.ts`.
  Nothing else may write `batches.qty_remaining`. Receiving creates the batch
  holding nothing and fills it with a movement, so the ledger accounts for every
  unit a batch has ever held.
- **Returned medicine is quarantined, not restocked** — and never restocked at
  all for `keras`, `owa`, `psikotropika`, `narkotika`, enforced in code rather
  than by the settings toggle. It comes back as a *child batch* of the lot it
  went out on (`batches.parent_batch_id`), so the units stay counted and
  traceable without being sellable.
- **A sale that has been returned cannot be voided.** A void puts every unit
  back in its batch; on top of a return, the same medicine would be booked in
  twice. `reverseSale` refuses, and the sale screen stops offering the void.
- **A disposal is a loss; an adjustment is a correction.** They are separate
  tables and separate movement types because conflating them destroys the
  expiry-loss report, which is what tells the owner they are over-ordering.
- **A stock count posts the difference the counter found, not the number they
  wrote down.** If anything moved between the sheet and the post, applying the
  difference leaves that sale intact; writing the counted figure onto the batch
  would silently erase it. Stock is meant to be frozen during a count -- this is
  what happens when it wasn't.
- **Only terminal statuses can be forced** through `applyMovement`'s
  `setStatus` (`quarantined`, `expired`, `disposed`). Nothing may push a batch
  back to `active` that way; that is the hole the sticky-status rule closes.
- **Margin reads `sale_lines.unit_cost_snapshot`, never the batch.** That column
  is why last month's margin does not move when this month's delivery costs
  more. A report that joins `batches` for cost has undone it.
- **`reports.movements` is the fraud report and holds no money.** It reads the
  signed `stock_movements.qty_delta` -- positive in, negative out -- per item,
  and every row names the person and the document behind it. It sits on the
  `reports.sales` side of the split deliberately: the manager who should be
  checking that what left the shelf matches what was rung up works on the shop
  floor, and cost prices are not needed to do it.
- **`reports.sales` shows what sold; `reports.financial` shows what it cost.**
  The split is deliberate and off for managers by default, so cost prices and
  margins need not be visible on the shop floor. `REPORT_PERMISSION` in
  `src/lib/reports/catalogue.ts` is the map, and the CSV route re-checks it --
  a route handler is as exposed as a page.
- **A report day is a day in the pharmacy's timezone.** `localDate()` in
  `src/lib/reports/queries.ts`; casting a `timestamptz` to a date in UTC files
  an early-morning Jakarta sale under the previous day.
- **There is exactly one owner, and they cannot be suspended, demoted or
  stripped.** Nobody above them could rescue the account -- recovery is
  `scripts/reset-password.ts` on the machine the database runs on. Nobody may
  suspend themselves either. Both refusals live in `src/lib/accounts/rules.ts`.
- **The owner issues a temporary password and never learns the working one.**
  Shown once at creation or reset, never stored readably, never recoverable --
  only replaceable. That is what lets a sale be attributed to the cashier who
  rang it.
- **A module switch is a courtesy, never a control.** `src/lib/catalogue/modules.ts`
  hides menu entries and entry points; it never refuses a request, never hides
  data already recorded, and never gates a safety rule. Permissions are the
  control. A switched-off screen is still reachable by URL and still works.
- **Only the owner manages the owner.** `users.manage` can be granted to a
  manager; it must not reach the owner's account. Editing, resetting or
  signing out the owner is refused for anyone else (`refusalToManage` in
  `src/lib/accounts/rules.ts`) -- a reset would otherwise hand a manager the
  owner's temporary password and, with it, the one account nobody can suspend.
- **Account passwords are never shown, anywhere -- including the control
  panel.** The panel's "Kata sandi" section and `pharmacy passwords` show the
  database password (the installer's, the machine's) and list accounts; for an
  account they can only issue a new temporary password, through
  `scripts/account-reset.ts`, the same code `reset-password.ts` uses. The SMTP
  password stays off the panel too: it is a browser.
- **The Settings timezone is the one the process works in.** Reading or saving
  the settings row calls `adoptPharmacyTimezone`; `PHARMACY_TIMEZONE` in
  `.env.local` is only the fallback before the row is read. Without it the till
  and receipts ran on the installer's Asia/Jakarta while reports followed
  Settings.
- **The cloud backup's rclone config lives in the install folder**
  (`installer/cloud.mjs`), because on Windows the daily job runs as SYSTEM and
  would never see a config in the owner's profile. It is pointed at only when
  the destination is ours, so a hand-made remote is never shadowed.
- **An update is not done until the new version is on disk.** The updater
  unpacks releases under `<install>/downloads/`, and a copy filter that tested
  absolute paths skipped every file: every update through v0.1.4 rebuilt the
  old version and reported success. `sourceFilter` in `installer/lib.mjs`
  matches paths inside the release only, and `applyUpdate` refuses to report
  success unless `package.json` shows the downloaded version.
- **A failed upgrade puts the previous version back.** `main.mjs` moves the old
  app folder to `app-previous` before installing, and restores and restarts it
  if anything up to the migrations fails. Before that, a dropped connection
  mid-build left a pharmacy that would not even start.
- **The build never touches the network for fonts.** They are bundled in
  `src/app/fonts/` and loaded with `next/font/local`. `next/font/google`
  fetched them during `next build`, which runs on the clinic's machine at
  every update, and failed the build whenever Google was unreachable.
- **Imported sales history is not a sale.** `history_imports` and
  `history_sale_lines` (`src/db/schema/history.ts`) hold sales from before the
  till, for the Sales and Gross profit reports only. Nothing in
  `src/lib/history/` touches a batch or the ledger, and nothing about stock --
  the movement report, valuation, alerts, FEFO -- reads history. Only past days
  are accepted (today belongs to the till), an identical file is refused while
  its first copy is active, and a wrong import is *withdrawn* with a reason,
  never deleted. `sales.import_history` is the control; the Settings "import"
  switch is the catalogue's button and does not hide it.
- **Net sales are after discounts, returns and PPN**, and every table adds up to
  the statement above it. `itemSales` in `src/lib/reports/queries.ts` spreads
  each sale's discount and inclusive PPN over its lines as exact fractions and
  hands out the whole rupiah by largest remainder (`apportion`); rounding each
  product on its own left the product table a few rupiah off the statement.
  History lines without a `unit_cost` count as sales and are left out of gross
  profit -- a cost of zero would report them as pure profit.
- **A decimal point is never a thousands mark.** `parseMoney` accepts only true
  groupings (`15.000`, `1,500,000`) and refuses `9090.91`, which it used to read
  as 909.091. The spreadsheet importers use `parseSheetMoney`, which rounds a
  one- or two-digit decimal to the rupiah, and the workbook reader turns a
  number cell into plain digits (`9999.9899999` -> `9999.99`).
- **CSV writes money as a plain integer**, never a formatted amount: `15000`,
  not `Rp 15.000`. A formatted amount is text to a spreadsheet, so a column of
  them sums to zero -- `parseFloat("15.000")` arriving from the other direction.
- **The hosted demo is the only deployment with `DEMO_MODE=1`.** It runs on
  Vercel + Supabase from the `demo` branch, which the release workflow moves
  to each new tag -- nobody commits to it. `DEMO_MODE` labels every screen and
  makes `sendMail` refuse; nothing else relaxes. It must never be set on a
  clinic install. Its nightly alerts come from `/api/cron/alerts`, which
  refuses every request when `CRON_SECRET` is unset, as it is on a clinic PC.

## Conventions

**Authorization lives in the DAL** (`src/lib/dal/`), next to the data. Hiding a
nav link is a courtesy; it is not a control. Every server action calls
`assertPermission` even when its screen is already gated. `src/proxy.ts` does
optimistic cookie checks only — never a database call, never a permission check.

**No string literals in components.** Every user-visible string goes through
`next-intl` with parity between `src/i18n/messages/id.json` and `en.json`; a
test enforces that they cover the same keys. Enums store stable keys and render
through the catalogue — never store display text.

**Three locales are separate concerns:** the UI locale is per user; the receipt
locale is a business setting (customer-facing, not the cashier's preference);
data — item names, lot numbers, typed reasons — is never translated.

**Expiry is a calendar date**, stored as `YYYY-MM-DD`, rendered as `15 Mar 2027`
in both languages. Never a numeric date: `03/04/2027` is two different days
depending on the reader, and a misread expiry is a safety problem.

**Enum values live in `src/lib/catalogue/enums.ts`**, not in the schema. The
schema builds its `pgEnum`s from that module, so forms can render options
without pulling drizzle's pg-core into the browser bundle.

**Every report downloads as CSV and as Excel from one description**:
`src/app/(app)/reports/[report]/export/model.ts` lists each report's tables as
plain values (rupiah as integers, percentages as basis points) and `route.ts`
writes the first table as CSV or all of them as a workbook -- a summary sheet,
then a sheet per table, each with the letterhead, number cells and a totals
row. A report is also printable on A4 (the report page sets its own `@page`;
the global print rule is the 80mm receipt), and a table prints every row even
when the screen shows the first 25.

**Reports aggregate in SQL**, in `src/lib/reports/queries.ts`, which takes an
executor and no session -- the same split as `src/lib/stock/*`, and what makes
the arithmetic testable against a real database. Note that Postgres will not
match a `GROUP BY` expression containing a bind parameter against the same
expression in the `SELECT`; group by output position (`groupBy(sql`1`)`) when
the timezone is interpolated.

**The camera is a scanner, not a second entry path.** `ScanButton` in
`src/components/BarcodeScanner.tsx` hands its payload to the same `findForSale`
the keyboard feeds, so a GS1 code read off a box resolves exactly as a USB
scanner's would. It uses the browser's own `BarcodeDetector` -- no bundled
decoder, because one that misreads drug packaging is worse than no camera. Where
it cannot scan it says which of the three things is missing -- https, the camera
API, the decoder -- rather than hiding the button. A button that is simply absent
is indistinguishable from a feature that was never built, and nobody can act on
that; "the camera needs https" is something the owner can fix.

**The import template is a workbook, and only its first sheet is read.**
`/items/import/template` serves an .xlsx: a Data sheet to fill in, and a Guide
sheet (`src/lib/catalogue/import-guide.ts`) saying what every column wants,
translated into the downloader's language. The column names on the Data sheet
are fixed English identifiers and stay untranslated -- they are what
`parseImportCsv` matches. An uploaded .xlsx is turned into CSV by
`importFileToCsv` and goes through the one validator; there is no second set of
rules. `src/lib/format/xlsx.ts` is a small reader and writer on `fflate` rather
than a spreadsheet library, which would add tens of megabytes to a machine a
shopkeeper installs. The template writes every cell as text so a date stays
`2027-12-31` and a barcode keeps its leading zeros.

**The Tutorial button opens written guides, filtered like the menu.**
`src/lib/tutorials/guides.ts` lists each guide and section with the
permissions (any of) and module it needs; `/tutorials` shows only what the
account can use, and each guide's "show me" button runs the guided tour over
just its own screens. The words are in `guides.items.*` in both catalogues, with
steps as numbered keys (`"1"`, `"2"`...) because the catalogues are trees of
strings. When a screen's behaviour changes, change its guide too -- a guide
that describes the old till is worse than none.

**Every literal message key exists.** `tests/message-keys.test.ts` scans `src`
for `t("a.b.c")` and fails on any key that is not text in both catalogues; a
missing key renders as its own name on screen. It cannot see keys built at run
time, so a key that is both a label and a group of labels (`reports.export` once
was) still needs care.

**Add a dependency by editing `package-lock.json`, not by `npm install` on a
Mac.** npm on macOS prunes the optional platform packages from the lock (esbuild
and friends for Windows and Linux), which is exactly what broke `npm ci` on
Windows once. Check `git diff --stat package-lock.json` after any install: a
new package is a handful of added lines, never hundreds of removed ones.

**Money and dates go through `src/lib/format/`.** Never `parseFloat` a price:
`parseFloat("15.000")` is 15, and in Indonesian that string means fifteen
thousand.

**Server-only modules** import `server-only`. `src/lib/auth/password.ts` cannot
— the seed and migrate scripts need it — so anything the UI needs from it lives
in `password-policy.ts` instead. Importing the crypto module from a client
component fails the build on a missing wasm target rather than on anything that
names the real problem.

**Business logic stays out of the DAL.** `src/lib/stock/*` holds the rules and
takes an executor and an actor id; `src/lib/dal/*` adds permissions and audit
around it. That split is what makes the ledger and the till testable at all --
anything welded to a session cannot be tested.

## Visual language

Purple accent on a lightly purple-biased neutral, with a **dark sidebar that
stays dark in both themes** -- the content area carries the theme, the
navigation is a constant anchor.

Two colour rules do not bend to the accent:

- **Drug class marks keep the official Indonesian colours** -- green circle for
  Obat Bebas, blue for Obat Bebas Terbatas, red with a K for Obat Keras. Staff
  read those off packaging all day; they are not ours to restyle.
- **Status colours were chosen with the data-viz validator, not by eye.** Amber
  and red are adjacent hues and the first pass failed the normal-vision
  separation floor. Re-run `scripts/validate_palette.js` from the dataviz skill
  before changing any of them.

## Testing

`npm test`. Integration tests build a private in-memory Postgres and apply the
real migrations, so the check constraints and partial indexes are exercised
rather than mocked around. When adding a guard to the schema, add a test that
drives the database directly and asserts the constraint name — "something threw"
would also pass if the query failed for an unrelated reason.

PGlite serves one connection, and the pool cap is per process while its limit is
global -- so **stop the dev server before running data scripts**. The
development pool is capped at one connection, because overlapping queries
otherwise reset the connection and wedge the instance. Do **not** avoid
`Promise.all` in application code to work around this -- the cap handles it, and
against production Postgres concurrent reads are correct and faster.

**Concurrency is tested against a real Postgres server**, because PGlite serves
one connection and never contends:

```
brew services start postgresql@18        # once
createdb pharmacy_concurrency            # once
CONCURRENCY_DATABASE_URL=postgres://127.0.0.1:5432/pharmacy_concurrency npm test
```

Without that variable `tests/concurrency.test.ts` skips. Run it before any
release that touches `sale.ts`, `ledger.ts`, or anything that allocates a
document number.

**Contend deliberately; never hope for a race.** These tests take the batch lock
themselves and start the contenders behind it, so the contended path is
guaranteed. The first version fired concurrent sales and asserted the outcome --
and passed with every row lock deleted, because each transaction finished in
about a millisecond and they never overlapped. When changing them, delete a lock
and confirm the test fails; a concurrency test that cannot fail is a claim of
safety with nothing behind it.

## Regulatory

Not settled by us; the pharmacy's APJ and accountant decide. Current PPN
position and PKP status, record retention periods, and the SIPNAP reporting
format are all open — see the end of the plan. The code treats each as
configuration rather than hardcoding a value.
