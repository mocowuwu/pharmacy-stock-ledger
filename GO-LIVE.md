# Go-live

The largest cost in this project is not the software. It is entering a paper
catalogue and counting a shelf, and both are done by people who also have a
pharmacy to run. Plan for weeks, not an evening.

Everything below is ordered. Steps 1–3 can happen while the pharmacy trades
normally; step 4 onwards cannot.

---

## 0. Before anything, prove the backup works

Do this **before** real data exists, not after. A backup nobody has restored is
a hypothesis.

```bash
npm run backup
npm run restore -- backups/pharmacy-<date>.dump
DATABASE_URL=postgres://127.0.0.1:5432/pharmacy_restore_test npm run check-ledger
```

`restore` writes into a scratch database by default and refuses to touch the
live one without an explicit flag. The third command is the one that matters:
it proves the restored ledger still reconciles, rather than merely that files
copied.

**Also back up `.env.local` somewhere separate.** It holds the database
password, and a dump you cannot connect to is not much use. There is no session
secret to lose: sessions are opaque random tokens stored as hashes, so a
restored database works on its own.

Then decide how often. A pharmacy that trades six days a week should dump
nightly, keep a week on the machine, and copy at least weekly to something that
is not the machine — an external drive that lives at home is enough, and is
better than nothing by an enormous margin.

## 1. Settings

Sign in as the owner and fill in **Settings**:

- **Name and description** — printed on every receipt and shown on the sign-in
  screen.
- **Timezone** — WIB, WITA or WIT. This decides when a day ends, which decides
  which day a sale belongs to and the moment a batch counts as expired. Getting
  it wrong shifts figures by a day at the edges.
- **Licence number and address** — the receipt footer.
- **PPN** — leave off unless the APJ or the accountant says the business is a
  PKP. If it is on, add a rate with an effective date, or sales record no tax at
  all and nothing looks wrong until somebody audits it.
- **Alert thresholds** — the defaults (30 / 90 / 90 / 180 days) are reasonable
  for a clinic pharmacy. Adjust once you have seen a month of alerts, not before.
- **Modules** — switch off what the pharmacy does not do. It only hides screens;
  permissions remain the control.

## 2. Accounts

Create one account per person, from **Accounts**. Not one shared account —
the audit log is worth nothing if every sale says "kasir".

Start from a template, then adjust:

| Template | For |
|---|---|
| Cashier | Sells, sees stock, cannot price or void |
| Stock clerk | Receives, counts, disposes; does not sell |
| Manager | Both, plus reports — but not cost prices, accounts or settings |

Hand each person their one-time password directly. It is shown once; if it is
lost, issue another. Tick **registered pharmacist** for the APJ and record the
SIPA and STRA numbers — the narkotika register will need them.

## 3. Enter the catalogue from paper

Every item: name, form, strength, unit, drug class, reorder point. Use **save
and add another**.

For a few hundred items this is **days of typing, not hours**. Do it before the
count, not during: counting a shelf against a half-finished catalogue produces
a list of things you cannot enter.

Set reorder points from what the pharmacy actually reorders at, not from a
guess. They drive the low-stock alerts, and alerts nobody believes get ignored.

## 4. Clear the demo data

Settings → **Demo data** → type the confirmation phrase.

This clears the starting catalogue, its stock and its invented sales. Accounts,
permissions, settings, tax rates and the audit log survive. Do it **after** the
catalogue is entered and **immediately before** counting, so the two never mix.

## 5. Count, with stock frozen

Print count sheets by category from **Stock count**. The printed sheet
deliberately omits the system's figure so the counter is not anchored by it.

Count a category at a time, after hours or with that category not dispensing.
**Stock must not move during a category's count.** If it does, the sheet and the
shelf disagree and the variance is fiction.

## 6. Enter as opening batches

Receive each counted lot through **Receive stock**, with **opening stock** ticked.

Real lot numbers and real expiry dates, per lot. **Not one lump quantity per
item.** Entering "500 units, no lot" destroys the expiry alerting that is the
entire point of the system. Where a lot number genuinely cannot be determined,
record the expiry and tick *legacy* — the missing lot is then recorded honestly
rather than invented.

Then reconcile:

```bash
npm run check-ledger
```

## 7. Parallel run

Run both systems for **one to two weeks**. Every sale goes through the till and
onto the paper record, and the two are compared at closing each day.

Switch over only when they agree without anyone having to explain a difference.
This is the step people skip, and it is the step that finds the misunderstanding
that would otherwise be discovered three months later in a stock take.

## 8. Check the daily jobs are running

Nothing to turn on. The supervisor runs alerts, then the backup, then the
digest — ordered that way because the digest reports on the list the alert job
has just reconciled — whenever each has not run for twenty hours.

That is a gap rather than a clock on purpose. These used to be cron lines at
01:00 and 02:00, which never fired on a clinic machine that is switched off at
closing, and could not fire at all on Windows, which has no cron. A machine
switched on at eight runs them at eight.

So this step is a check, not a task:

```bash
~/pharmacy/pharmacy status          # or open the control panel
cat ~/pharmacy/logs/jobs.log        # what ran, and what failed
```

The control panel shows the last backup on its front page. **Look at it in the
first week** — the failure this is guarding against is a backup that silently
stopped working, and the only way to catch that is to have looked once.

Leave the digest's mail settings until you are ready: until **Test the
connection** succeeds it writes to `.data/digest/` and you can read exactly what
would have arrived. It will be recorded as failing in `jobs.log` until then,
which is honest and harmless.

## 9. Hosting

Still undecided, and it can stay that way until this point. Both paths work:

- **On-premise mini PC.** When the internet drops, the till keeps selling. For a
  working pharmacy that is the difference between a slow morning and a closed
  counter. Backups go to an external drive plus an encrypted upload.
- **VPS.** Reachable from home, nothing to maintain physically, and the counter
  stops when the connection does.
- **On-premise, reached over Tailscale** — `pharmacy remote on`; see DEPLOY.md.
  The answer when the counter and the machine are in *different buildings*, and
  the only one of the three that also gets you HTTPS for free, which is what the
  phone camera scanner needs. Understand what it costs first: every till needs
  Tailscale signed in, and the counter now stops if either end's internet does.
  If they are in the same building, a cable or an access point beats this.

Either way it is Docker Compose, environment variables, and the same backup
script. Nothing in the code assumes a host.

---

## The things that are not mine to decide

Confirm with the APJ and the accountant before go-live:

- **PPN and PKP status** — whether the business charges tax at all.
- **Record retention** — how long the ledger must be kept. Nothing in the system
  deletes, so the answer only affects backup retention.
- **SIPNAP format** — before the narkotika register is built, and only when the
  pharmacy actually begins stocking those classes.
