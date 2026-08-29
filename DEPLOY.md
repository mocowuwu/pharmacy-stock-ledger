# Getting it running in the clinic

Two paths. **The first has been tested end to end**; the second is written but
has not been built, because Docker was not installed on the machine this was
developed on. Use the first unless you have a reason not to.

Either way you need one machine that stays on. A mini PC in the back room is
the recommendation: when the internet drops, the till keeps selling. A cloud
server means a closed counter on the morning the connection fails.

---

## What you need

- **A machine that stays on.** A used mini PC is plenty — this is a few hundred
  items and a few dozen sales a day, not a busy website. 8 GB of memory is
  generous. An SSD matters more than the processor.
- **Node 22 or newer** and **PostgreSQL 18**.
- **A fixed address on the clinic network**, so the till machine can always find
  it. Either a static IP or a DHCP reservation on the router.
- **Somewhere for backups that is not that machine.** An external drive is
  enough to start.

---

## Path A — plain Node and Postgres (tested)

### 1. Install the two dependencies

On Ubuntu or Debian:

```bash
sudo apt update
sudo apt install -y postgresql-18 postgresql-client-18 nodejs npm git
```

On macOS:

```bash
brew install node postgresql@18
brew services start postgresql@18
```

### 2. Create the database and a user for the app

```bash
sudo -u postgres createuser --pwprompt pharmacy
sudo -u postgres createdb --owner pharmacy pharmacy
```

Write the password down; it goes in the next step and nowhere else.

### 3. Get the code onto the machine and install

```bash
git clone <wherever this repo lives> /srv/pharmacy
cd /srv/pharmacy
npm ci
```

### 4. Configure

Create `/srv/pharmacy/.env.local`:

```
DATABASE_URL=postgres://pharmacy:<the password>@127.0.0.1:5432/pharmacy
PHARMACY_TIMEZONE=Asia/Jakarta
SESSION_TTL_HOURS=12

# Only if you serve over plain HTTP on the clinic LAN. Read the warning below.
COOKIE_SECURE=false
```

**On `COOKIE_SECURE`.** The session cookie is marked HTTPS-only by default. Over
plain `http://` on the LAN nobody can sign in, so this must be `false` — and
that is a real reduction in security, because the cookie then travels the
network in the clear. On a small wired clinic network with a password-protected
router that is a defensible trade. Putting a certificate in front of it is
better; see "TLS" below.

There is no session secret to set. Sessions are opaque random tokens stored as
hashes, so there is no key to generate, protect or lose.

### 5. Set up the database and create the owner

```bash
npm run db:migrate
npm run db:seed
```

`db:seed` prints the owner's username and a one-time password. **Write it down
now** — it is shown once and can only be replaced, never recovered.

### 6. Build and run

```bash
npm run build
npx next start -p 3000
```

Open `http://<the machine's address>:3000` from the till and sign in. You will
be asked to replace the temporary password immediately.

### 7. Make it start by itself

The pharmacy should not need anyone to run a command after a power cut. On
Linux, `/etc/systemd/system/pharmacy.service`:

```ini
[Unit]
Description=Pharmacy stock ledger
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=pharmacy
WorkingDirectory=/srv/pharmacy
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pharmacy
```

### 8. The nightly jobs

```bash
crontab -e
```

```cron
0 1 * * *  cd /srv/pharmacy && npm run alerts
0 2 * * *  cd /srv/pharmacy && npm run backup
0 7 * * *  cd /srv/pharmacy && npm run digest
```

Alerts first, then the backup, then the digest — the digest reports on the alert
list the first job has just reconciled.

---

## Path B — Docker Compose (written, not verified)

If Docker is already on the machine this is fewer steps, but it has not been
built and run, so budget time for it to need a fix.

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, and COOKIE_SECURE=false for plain HTTP
docker compose up -d --build
docker compose exec app npm run db:seed    # once, for the owner account
```

The app container runs migrations at start. The database lives in a named
volume, `pgdata`, and is not published to the host — only the app reaches it.

---

## TLS, if you want it

`COOKIE_SECURE=false` is a compromise. Two ways out, both fine for a clinic:

- **Caddy in front**, with a certificate from a private CA you install on the
  till machines once. Caddy takes about five lines of config and renews nothing.
- **A real domain and Let's Encrypt**, if the machine is reachable from the
  internet — which for an on-premise install it usually should not be.

Neither is required to start. Get it running, use it, add TLS when you have a
quiet afternoon.

---

## Before real data goes in

Prove the backup works. This is step 0 of `GO-LIVE.md` and the one people skip:

```bash
npm run backup
npm run restore -- backups/pharmacy-<date>.dump
DATABASE_URL=postgres://127.0.0.1:5432/pharmacy_restore_test npm run check-ledger
```

The third command is the one that matters — it proves the restored ledger still
reconciles, rather than that files copied.

Then follow `GO-LIVE.md`: settings, accounts, catalogue entry, clear the demo
data, count, parallel run.

---

## If something goes wrong

| Symptom | Cause |
|---|---|
| Sign-in silently fails, no error | `COOKIE_SECURE=true` over plain HTTP. The cookie is set and immediately dropped |
| `ECONNREFUSED` on start | Postgres is not running, or `DATABASE_URL` names the wrong host |
| Works locally, not from the till | The app is bound to localhost, or the machine's firewall is blocking 3000 |
| Sales fail with a duplicate key | Two app instances against one database. There should be exactly one |
| Times and expiry dates look a day out | `PHARMACY_TIMEZONE` and the Settings timezone disagree with where you are |
