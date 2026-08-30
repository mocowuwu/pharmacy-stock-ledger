# The first Windows run

This file exists to be read by a Claude Code session running **on the Windows
machine**, and by the person sitting at it. Everything here is context that
session cannot get from the code alone.

Read `CLAUDE.md` first — it holds the rules that are not negotiable. Nothing in
this file overrides any of them. In particular: **nothing is deleted**, and the
ledger is append-only. A Windows install problem is never a reason to drop a
database or clear a table.

---

## Paste this into Claude Code to start

> I am on the Windows machine doing the first real run of the Windows installer
> for this project. Read `WINDOWS-FIRST-RUN.md`, then `DEPLOY.md`'s Windows
> section, then `installer/windows.mjs` and `installer/bootstrap.ps1`.
>
> The installer was written on a Mac and has never been run on Windows. Your job
> is to run it, find where it breaks, and fix the code — not to work around it
> by hand. A fix that only works on this machine is not a fix; it has to be a
> change to the installer that would work on the next clinic's machine too.
>
> Work one step at a time and show me what you are about to run before you run
> it. Do not delete any database or data directory without asking me first.

---

## What is already true

- The installer is **written and lint-clean, and the shared code paths pass 240
  tests on macOS.** What has never executed is the Windows-specific half.
- The macOS path has been run end to end successfully. If something behaves
  differently here, the difference is Windows, not the design.
- `installer/main.mjs` is the same file on every platform. Windows-specific work
  lives in exactly two places: `installer/windows.mjs` (boot task + firewall)
  and `installer/bootstrap.ps1` (finding or fetching Node).

## What is being tested

The install does ten steps in order. These are the ones that have never run on
Windows, and are where a failure is expected:

| Step | Windows-specific risk |
|---|---|
| Bootstrap | `Invoke-WebRequest` TLS, `Expand-Archive`, execution policy |
| Fetch PostgreSQL | `tar -xzf` via Windows' bundled bsdtar; `moveContents` across volumes |
| initdb | ICU locale availability; `--auth-host scram-sha-256` on a Windows build |
| pg_ctl start | Whether it will run under the account it is started as |
| `npm ci` / build | Antivirus holding a file open; long paths over 260 chars |
| Boot task | `schtasks` quoting; whether SYSTEM can read the install folder |
| Firewall | UAC elevation; network profile being Public rather than Private |

---

## Before you start

1. **Take a VM snapshot.** This is the whole reason to do it in a VM. The
   installer refuses rather than half-finishing, but a failed `initdb` leaves a
   data directory you want gone cleanly, and rolling back is faster and more
   honest than tidying up.
2. **Set the network profile to Private.** Settings → Network → Properties.
   The firewall rule the installer adds covers private and domain profiles. On
   a Public profile the till cannot reach the machine and *nothing anywhere
   says so* — the till just spins.
3. You do **not** need to install Node or PostgreSQL. The installer brings both.
   If Node 20+ happens to be installed it will use it.

## Getting the code onto the machine

Either clone it, or copy the folder over — or share it in from the host, which
is what is being done here. See the Parallels section directly below.

You do not need to delete `node_modules` or `.next` first. The installer copies
the source into `%USERPROFILE%\pharmacy\app` and its copy filter already skips
`node_modules`, `.next`, `.git`, `.data`, `backups` and `downloads` — so the
macOS-built binaries never reach the Windows install. If you copy the folder by
hand rather than letting the installer do it, delete those two yourself.

---

## Running from a Parallels shared folder

This is the setup in use: Windows in Parallels on a Mac, with the project folder
shared in from the host. That works, with one rule.

**Run the installer from the share; never install onto it.**

The share is only ever read. The installer copies the source onto `C:` and puts
PostgreSQL, the build and the database there. Two things break, both silently,
if the install directory itself is on a shared folder:

- **PostgreSQL's data directory needs fsync and locking semantics that `prl_fs`
  does not provide.** That is a corruption risk for the pharmacy's records, not
  a slow build.
- **The boot task runs as SYSTEM, and SYSTEM cannot see a Parallels share.**
  Mapped drives and `\\Mac\Home\...` paths are per-user and per-session. The
  pharmacy would install perfectly and then never come back from a power cut,
  failing with an error that reads like a missing file.

`installer/bootstrap.ps1` now refuses a UNC or mapped-drive install directory
outright rather than letting either of those happen. The default target,
`%USERPROFILE%\pharmacy`, is already on `C:` — so simply do not set
`PHARMACY_DIR` to anything on the share.

`install-windows.bat` uses `pushd` rather than `cd /d` for the same reason:
cmd.exe cannot hold a UNC path as a working directory, and `cd /d` there prints
an error and silently continues from `C:\Windows`.

If the install is slow or something locks during `npm ci`, copy the folder to
`C:\pharmacy-src` and run it from there instead. That removes the shared
filesystem from the picture entirely and is the first thing to try.

### Networking, for the till test

Parallels' default **Shared (NAT)** networking gives the VM an address like
`10.211.55.x`. The Mac can reach that, so steps 1–5 of the checks below will
pass — but nothing else on the clinic network can, so it does not prove the
thing the pharmacy actually needs.

For a real test set the VM's network to **Bridged**, so it takes an address on
the same LAN as everything else, and then run the `Test-NetConnection` check
from an actual second machine or a phone browser. `lanAddress()` in
`installer/lib.mjs` picks the private address it finds, so the address the
installer prints follows whichever mode is set.

Whichever mode, **set the Windows network profile to Private** — a freshly
bridged connection often arrives as Public, and that blocks the firewall rule
from applying.

### Snapshots

Take a Parallels snapshot before the first run, and again once the install
succeeds and before you go near real data. Rolling back is faster and more
honest than tidying up a half-install.

## Run it

Double-click `install-windows.bat`, or from a normal (non-admin) terminal:

```
install-windows.bat
```

Expect one UAC prompt part-way through. **Click Yes.** It buys the firewall rule
and the boot task and nothing else.

Useful variations while debugging:

```
set PHARMACY_DIR=C:\pharmacy-test
install-windows.bat --port 3001 --db-port 55433
```

---

## Verify, step by step

Do not trust "it printed Installed". Check each of these.

**1. The database is up and owns its own port**

```
"%USERPROFILE%\pharmacy\postgres\bin\pg_isready.exe" -h 127.0.0.1 -p 55432
```

**2. The app answers on the machine itself**

```
curl http://127.0.0.1:3000/login
```

**3. The boot task exists and is running as SYSTEM at startup**

```
schtasks /Query /TN PharmacyStockLedger /V /FO LIST
```

Check `Run As User: SYSTEM` and `Schedule Type: At system start up`. If it says
the current username and `At logon instead`, the UAC prompt was declined or
failed — the fallback was used, and the pharmacy will not come back from a power
cut until someone logs in.

**4. The firewall rule exists**

```powershell
Get-NetFirewallRule -DisplayName "Pharmacy Stock Ledger" | Format-List DisplayName,Enabled,Profile,Action
```

**5. The till can actually reach it.** This is the test that matters, and it has
to be run **from the till machine, not from the server**:

```powershell
Test-NetConnection -ComputerName <server ip> -Port 3000
```

`TcpTestSucceeded : True` is the goal. If steps 2 and 4 pass and this fails,
suspect the network profile (Public) before suspecting the code.

**6. It survives a reboot.** Restart the machine, do not log in, and run step 5
again from the till. This is the actual promise the boot task makes.

**7. Rehearse a restore before any real data.** Non-negotiable, and it is step 0
of `GO-LIVE.md`:

```
%USERPROFILE%\pharmacy\pharmacy.cmd backup
```

Then follow `DEPLOY.md`'s restore drill. `check-ledger` is the one that matters:
it proves the restored ledger reconciles, not merely that a file copied.

---

## Where to look when something breaks

| Where | What it holds |
|---|---|
| `%USERPROFILE%\pharmacy\logs\pharmacy.log` | The app and the supervisor |
| `%USERPROFILE%\pharmacy\logs\postgres.log` | Why the database would not start |
| `%USERPROFILE%\pharmacy\pharmacy.json` | Ports and the generated DB password |
| `%USERPROFILE%\pharmacy\pharmacy-service.cmd` | What the boot task actually runs |
| `%USERPROFILE%\pharmacy\downloads\elevate.cmd` | What was run as administrator |

The last two are generated files. If the boot task misbehaves, read
`pharmacy-service.cmd` first — a quoting bug in a path with a space shows up
there plainly, and you can run that file by hand to see the error.

## Failures worth predicting

- **`npm is not recognized` / ENOENT on npm.** `spawn` runs with `shell: false`
  and npm on Windows is `npm.cmd`. Handled via `NPM` in `installer/lib.mjs` — if
  it resurfaces, something new is calling `"npm"` as a literal.
- **A file is locked mid-copy during `npm ci` or the build.** Antivirus. It reads
  as a corrupt or missing file rather than as a lock. Retry once; if it repeats,
  add an exclusion for the install folder and note it in DEPLOY.md.
- **Paths over 260 characters** inside `node_modules`. If this bites, enable long
  paths, or install into `C:\pharmacy` instead of the profile folder.
- **`initdb` fails on the ICU locale.** Already handled — it falls back to the
  default collation with a warning. If it fails for another reason, read
  `postgres.log`; do not delete a data directory that might hold records.
- **The app runs but the till sees nothing.** In order: network profile, then the
  firewall rule, then confirm the process is actually listening on all
  interfaces with `netstat -ano | findstr :3000` — it should show `0.0.0.0:3000`,
  not `127.0.0.1:3000`.
- **The restart loop spins.** `pharmacy-service.cmd` uses `ping` as its sleep
  deliberately; `timeout` refuses to run without a console and returns instantly,
  which turns the loop hot. Do not "simplify" it back to `timeout`.

## When it works

Note what you had to change, and update `DEPLOY.md` — specifically the sentence
saying the Windows path has not been run, which stops being true. Then commit on
a branch and say what was fixed.

If the operator will run this at the clinic themselves, the only things they
need are: double-click the file, click Yes, write down the password.
