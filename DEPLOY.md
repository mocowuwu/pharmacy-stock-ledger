# Getting it running in the clinic

**Start here: the installer.** It takes a machine with nothing on it to a
pharmacy the tills can open, in one command, and it brings its own PostgreSQL so
there is nothing to install by hand.

```
macOS    double-click  install-macos.command
Linux    sh install-linux.sh
Windows  double-click  install-windows.bat
```

It installs into `~/pharmacy` and touches nothing outside that folder.
Uninstalling is deleting it.

On macOS and Linux it needs no administrator password. **Windows is the
exception, twice.** The PostgreSQL binaries are built with MSVC and import
`vcruntime140.dll`, which Windows does not ship, so the installer installs the
Microsoft Visual C++ runtime system-wide before anything else — one prompt. The
firewall rule and the boot task want administrator rights too — a second prompt.
The runtime is shared and stays behind after uninstalling; it is Microsoft's,
versioned by them, and already present on most machines that have run a desktop
application. Nothing else survives deleting the folder.

The macOS path has been run end to end on a clean directory: PostgreSQL fetched
and checksum-verified, cluster created, application built, owner account seeded,
service registered, and a backup taken and restored with the ledger reconciling.
**The Windows path has now been run**, on Windows 11, end to end: runtime
installed, PostgreSQL fetched and checksum-verified, cluster created,
application built, owner account seeded, boot task and firewall rule
registered, and a backup taken and restored with the ledger reconciling. Seven
bugs were found and fixed doing it; see "Windows" at the end of this file.
Two things it does not yet prove: that the till reaches it across a real LAN
(this was a NAT'd VM), and that it survives a reboot. Do both before go-live.

**The Linux path is written but has not been run.** Expect to fix something;
the installer stops with a sentence rather than half-finishing.

On Windows the installer asks for administrator rights **twice** on a first
install — once for the Microsoft Visual C++ runtime, once for the firewall rule
and boot task — and the operator should click Yes to both. An upgrade after the
machine has rebooted asks a third time, to stop the pharmacy SYSTEM is running. It buys exactly two things: the
firewall rule that lets the till reach this machine, and the boot task that
reopens the pharmacy after a power cut. Clicking No still finishes the install
and prints the two commands to run by hand.

What it prints at the end is the part that matters: the owner's one-time
password, and the LAN address to open from the till. Write both down.

Afterwards, `~/pharmacy/pharmacy` is the control command — on Windows,
`%USERPROFILE%\pharmacy\pharmacy.cmd`, which is double-clickable:

```bash
~/pharmacy/pharmacy status     # is it running, and where to open it
~/pharmacy/pharmacy backup     # take a backup now
~/pharmacy/pharmacy logs       # the last 60 lines
~/pharmacy/pharmacy restart    # after editing .env.local
~/pharmacy/pharmacy uninstall  # removes the software, keeps the records
```

## The control panel

The same things with a face on them, for an owner who is not going to type any
of the above. On Windows the installer puts **Panel Kontrol Apotek** on the
Desktop and in the Start Menu; everywhere else it is `~/pharmacy/pharmacy-panel`.

Opening it starts a small server and opens one page in the default browser:
whether the pharmacy and the database are running, the address to type at the
till, the real path to the database, backups and logs with a button that opens
each in the file manager, and buttons for start, stop, restart and back up now.
It is in Indonesian, because the owner is who opens it.

It is a **panel over a service, not a launcher for one**. The boot task owns the
pharmacy so it returns after a power cut with nobody logged in; closing the page
stops nothing, and the panel's own process exits by itself once nobody has
looked at it for five minutes.

It is bound to `127.0.0.1` on a port chosen at random, behind a token minted per
launch and checked on every request, with a `Host` check against DNS rebinding
and `POST` required for anything that changes something. That is not
belt-and-braces: it is a page with a "stop the pharmacy" button on a machine
that also runs a browser. Nothing about it is reachable from the network, and it
needs no firewall rule.

Adding nothing to `package.json` was a constraint, not a coincidence — it is
served by the Node the installer already brings.

Running the installer again over an existing install upgrades it: the database,
its records and the owner account are left exactly as they are.

---

# Doing it by hand

Everything below is the manual path, kept because it is what the installer
automates and what you fall back to when something about your machine is
unusual. The Docker path at the end is written but unverified.

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

*The installer above does all of this for you. This is the long way round.*

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

**One feature does need it.** Scanning a barcode with a phone's camera is only
offered over `https` (or on `localhost`): browsers refuse camera access to an
insecure page, and no server setting changes that. Over plain `http` on the LAN
the scan button is still there, and says so when tapped rather than failing
silently. Everything else -- including a USB scanner, which is a keyboard --
works either way. If the pharmacy runs the till on a phone, that
moves TLS from "nice" to "the reason the camera is missing".

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

---

## Windows

The installer now covers Windows: `install-windows.bat` finds or fetches Node,
then runs the same `installer/main.mjs` that macOS and Linux run. What is
Windows-specific lives in `installer/windows.mjs` and `installer/bootstrap.ps1`.

**It has now been run on Windows 11**, in a snapshotted VM, and reaches
"Installed" with the pharmacy serving, the boot task registered as SYSTEM at
system start-up, and the firewall rule in place. Seven bugs were found doing
it. Three were Windows-only:

- **The Microsoft Visual C++ runtime is not on a clean Windows**, and every
  PostgreSQL binary here imports `vcruntime140.dll`. `initdb` died with
  `0xC0000135`, surfaced as the bare number 3221225781. The machine check now
  installs the runtime first. This is the one thing installed outside the
  pharmacy folder.
- **`spawn` cannot run `npm.cmd`.** Since the fix for CVE-2024-27980, `spawn`
  with `shell: false` refuses a `.cmd` outright with `EINVAL`. npm is now run
  as a script under the Node already running the installer — no shell, so
  nothing re-parses a path containing a space.
- **The Windows checksum file is `certutil` format**, with a header line before
  the hash. The anchored regex matched nothing, so every Windows install
  downloaded PostgreSQL unverified and blamed the publisher for it.

Two more were Windows-only but only appear after the machine has rebooted once,
when the pharmacy belongs to SYSTEM and the operator's installer cannot touch
it:

- **An upgrade could not stop the running pharmacy.** `schtasks /End` and
  `pg_ctl stop` are both refused, both failures were swallowed, and the install
  then died on `could not open log file ... Permission denied` — the running
  server still holding it. It now elevates to stop it, and says why.
- **`pharmacy status` reported the database down while it was serving.**
  `pg_ctl status` cannot inspect a SYSTEM-owned process and reports "no server
  running". Worse, `backup` believed it and would start a second postmaster
  over a live one. The postmaster's PID file is now consulted, which still
  distinguishes *our* server from any other.

The remaining two were latent on every platform and Windows merely got there
first: the database password was written in step 5 but the cluster created in
step 3, so any failure in between left an install nothing could ever
authenticate against; and `package-lock.json` was out of sync, making `npm ci`
impossible on a clean checkout anywhere.

Still unproven: reaching it from a till across a real LAN (the first run was a
NAT'd VM), and surviving a reboot.

### What it does that the other platforms do not

- **Opens the firewall.** This is the one that wastes an afternoon. The app
  already listens on every interface, so it works perfectly in a browser on the
  machine itself and is invisible from the till — Windows Defender Firewall
  drops the inbound connection with no error anywhere. The till just spins. The
  installer adds an inbound TCP allow rule for the app port on the private and
  domain profiles.
- **Registers a boot task**, `PharmacyStockLedger`, via `schtasks`. It runs at
  startup as SYSTEM, so the pharmacy comes back after a power cut with nobody
  in the building. The task runs `pharmacy-service.cmd`, a wrapper that loops —
  that loop is the `Restart=always` the systemd unit gets for free.
- **Asks for administrator rights.** Both of the above need it, so they are
  done together behind a single UAC prompt. Decline it and the install still
  completes, falling back to a per-user task that starts at *logon* rather than
  at boot, and printing the two commands to finish by hand.

  A first install prompts once more before that, for the Microsoft Visual C++
  runtime, and an upgrade on a machine that has rebooted prompts again to stop
  the pharmacy SYSTEM is running. Both are separate prompts because both are
  separate elevations; neither can be folded into the one above, which happens
  at the end.

### Things to check on that first run

- **The network profile must be Private.** The firewall rule covers private and
  domain, not public. A clinic Wi-Fi first joined as "Public" will still block
  the till, and nothing in the app can tell.
- **A path with a space** — `C:\Users\Apotek Sehat\pharmacy` — is the normal
  case, not the edge case. Every generated script quotes for it; that quoting is
  the first thing to distrust if something fails to start.
- **SmartScreen.** An unsigned `.bat` may warn. The operator clicks *More info
  → Run anyway* once. Removing that needs a code-signing certificate at a few
  hundred dollars a year, rarely worth it for one clinic.
- **Antivirus holding a file open** mid-copy, during `npm ci` or the build.
  This is the classic Windows install failure and it reads as a corrupt file
  rather than as a lock.
- **PostgreSQL is x64-only** here, so an ARM Windows machine is refused up
  front rather than half-installed.
- **The install directory must be a local disk.** A network folder or a mapped
  drive is refused: PostgreSQL needs fsync semantics a share does not give, and
  the boot task runs as SYSTEM, which cannot see a per-user mapped drive at all.
  Running the installer *from* a share is fine — only the destination matters.

The manual path above also works on Windows, and remains the fallback. It is
longer, not worse.
