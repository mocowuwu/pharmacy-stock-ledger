# Pharmacy Stock Ledger

Inventory and dispensing system for a single clinic pharmacy in Indonesia.

Items hold no quantity. Stock lives on **batches** — the physical lots you
received, each with its own lot number, expiry date, supplier and cost — and
every change is written to an append-only **ledger** before the batch moves.
Stock on hand is derived, never edited. Batch tracking with expiry dates is the
storage model rather than a feature bolted onto it, and the alerts are queries
over the same data.

- **Design:** https://claude.ai/code/artifact/33cae6a2-5954-4f39-93a0-d6e83284d249
- **Plan:** `~/.claude/plans/indonesia-not-right-now-moonlit-adleman.md`

## Interface

A dark sidebar beside a light content area, purple accent, card-based screens.
The sidebar collapses to a horizontal nav below 768px. Both light and dark
themes are designed rather than inverted, and the sidebar stays dark in both.

## Requirements

Node 20+ (built and tested on 26). Nothing else — the development database runs
in-process and needs no Postgres install.

## Getting started

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`db:seed` prints a username and a one-time temporary password for the owner
account. It is shown once and cannot be recovered; you are asked to replace it
at first sign-in.

Then open http://localhost:3000.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development database and the app together |
| `npm run db:serve` | Development database only, for running scripts without the app |
| `npm run db:generate` | Generates a migration from schema changes |
| `npm run db:migrate` | Applies pending migrations |
| `npm run db:seed` | Settings, the opening-balance supplier, starter categories, the owner |
| `npm run test` | Unit and integration tests |
| `npm run test:concurrency` | The same, plus the real-concurrency tests (needs Postgres) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Production build |

Reset a password (the recovery path when the owner is locked out — no one else
can rescue that account):

```bash
npx tsx scripts/reset-password.ts pemilik
```

It issues a new temporary password, clears any lockout, revokes every existing
session for that account, and records the reset in the audit log. It cannot show
you the existing password, because nothing can.

Create a staff account from a template:

```bash
npx tsx scripts/make-user.ts kasir "Siti Kasir" cashier
```

Templates are `cashier`, `stock_clerk` and `manager`. They pre-fill the
permission set and every permission stays individually editable afterwards.

Load a sample catalogue to look at the system with something in it (kept out of
`db:seed` on purpose -- a real pharmacy's database should not start with
invented items):

```bash
npx tsx scripts/demo-data.ts --stock
```

`--stock` also books in sample batches with a deliberate spread of shelf life
and quantity. `--clear` removes it all again.

Reconcile every batch against the ledger (the invariant the design rests on;
exits non-zero if anything disagrees, so it can be wired to an alert):

```bash
npm run check-ledger
```

Recompute alerts and quarantine anything past its expiry date. Meant to run
nightly (`0 1 * * * cd /srv/pharmacy && npm run alerts`):

```bash
npm run alerts
```

### Concurrency tests

Two cashiers reaching for the last box must produce one sale and one clear
refusal. PGlite serves a single connection, so `SELECT ... FOR UPDATE` never
actually contends there and these tests skip by default. Point them at a real
Postgres server to run them:

```bash
CONCURRENCY_DATABASE_URL=postgres://localhost:5432/pharmacy_concurrency npm test
```

## The database

One driver, two hosts. `DATABASE_URL` points at Postgres, and that is the path
in development and production alike — so the local code path is the deployed
code path.

In development `npm run dev` starts [PGlite](https://pglite.dev) (real Postgres
compiled to WASM) behind a Postgres wire-protocol socket. That matters: PGlite
is in-process, so two processes pointed at one data directory each hold their
own view of it and silently diverge — a dev server would not see rows a seed
script had just written. The socket server exists so there is exactly one owner
of the data.

With no `DATABASE_URL` at all, the fallback is an in-memory database. That is
for tests, which each build a private one and apply the real migrations to it.

One development-only caveat, and it is a sharp one: PGlite serves a **single
connection**. The pool is capped at one (`DATABASE_MAX_CONNECTIONS=1` in
`.env.local`) and releases idle connections quickly, but the cap is per process
and PGlite's limit is global -- so a running dev server plus a seed script is
already two connections. **Stop the dev server before running data scripts.**

Against a real Postgres server none of this applies: the cap is unset,
concurrent queries genuinely run concurrently, and application code never has to
know the difference. Installing Postgres locally (`brew install postgresql@18`)
removes the whole class of problem and is worth doing before the till is built,
which needs real concurrency to test.

## Deployment

`docker-compose.yml` runs the app against Postgres 18 and is host-agnostic by
design: environment variables only, no provider SDKs, no local-disk assumptions
beyond a declared volume, and the scheduled job runs as a plain container
process rather than a platform cron product. It runs the same on a mini PC in
the clinic as on a VPS.

On-premise is the recommendation. When the internet drops, a cloud-hosted till
stops selling, and for a working pharmacy that is a closed counter rather than a
degraded experience.

One setting matters there: `COOKIE_SECURE`. Session cookies are `secure` by
default, so an install served over plain HTTP on the clinic LAN must set it to
`false` or nobody can sign in. That is a real reduction in security — terminating
TLS locally, even with a private CA, is the better answer.

## Status

Phase 1 (foundations) is complete: schema and migrations, sessions, sign-in,
forced password change, the permission system, the audit log, the bilingual
scaffolding and the currency and date formatting. Phases 2–9 are in the plan.
