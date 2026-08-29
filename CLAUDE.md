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
  audit log survive it.
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
- **CSV writes money as a plain integer**, never a formatted amount: `15000`,
  not `Rp 15.000`. A formatted amount is text to a spreadsheet, so a column of
  them sums to zero -- `parseFloat("15.000")` arriving from the other direction.

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

**Reports aggregate in SQL**, in `src/lib/reports/queries.ts`, which takes an
executor and no session -- the same split as `src/lib/stock/*`, and what makes
the arithmetic testable against a real database. Note that Postgres will not
match a `GROUP BY` expression containing a bind parameter against the same
expression in the `SELECT`; group by output position (`groupBy(sql`1`)`) when
the timezone is interpolated.

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
