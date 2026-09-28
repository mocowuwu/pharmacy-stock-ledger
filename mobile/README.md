# Apotek — the Android app

A phone window onto the pharmacy website, plus a backup till that keeps selling
when the pharmacy server cannot be reached.

- **Online**, the app *is* the website: staff sign in on the app's own screen,
  and it opens the website already signed in.
- **Offline**, on the one phone set up as the **till**, staff can sell from a
  copy of the catalogue. Sales wait on the phone and go to the server when it
  is back. Nothing else works offline — no receiving, returns, voids or counts.

Tailscale is the network security: only devices on the pharmacy's tailnet can
reach the server. The app adds no login of its own beyond the normal staff
username and password.

## Getting it onto a phone

Staff download it from the website: **Aplikasi Android** in the menu (under
Pengaturan), open to everyone who signs in. That page shows the server
address the app asks for and walks through the install. Opened inside the
app, the same page updates it: the download goes straight to Android's
installer.

The APK comes from the GitHub release matching the server's version. The
release workflow builds it, signs it and attaches it as `apotek-android.apk`,
and the server fetches it once and serves it to phones over the tailnet
(`src/lib/app-download.ts`). A server that cannot reach GitHub can be given a
file instead: `APP_APK_PATH=/path/to/apotek-android.apk` in `.env.local`.

## Signing

Every release must be signed with the same key: Android installs an update
only over an app signed by the one before, and uninstalling to get round that
deletes unsent offline sales. Make the key once, on the owner's computer:

```bash
cd mobile
npm run signing-key
```

It is written to `~/.apotek-signing/`, outside the repository. **Back that
folder up**; a lost key cannot be recreated. Then give it to the release
workflow as repository secrets (needs the `gh` CLI, signed in):

```bash
npm run signing-key -- --upload
```

From the next tagged release on, the release carries `apotek-android.apk`.
Without the secrets the workflow skips the app with a warning rather than
signing it with a throwaway key.

## Building it yourself

Needs Android Studio (for the Android SDK and its bundled JDK 21) and Node.

```bash
cd mobile
npm ci
npm run apk
```

Without a signing key this makes `release/apotek-<version>-debug.apk`, for
trying things out: install it with `adb install -r` or by opening it on the
phone. It is signed with a development key, so it cannot update a
release-signed app (or be updated by one) without uninstalling first. With
the key (`source ~/.apotek-signing/signing.env` first) it makes the signed
`release/apotek-android.apk`.

The app is versioned with the pharmacy release it ships in (`../package.json`);
the Android version code is derived from it (0.1.8 -> 108), so every release
installs as an update.

The launcher icon is drawn as vectors in `android/app/src/main/res/drawable/`;
`resources/` holds the same capsule as SVG and renders the PNGs Android 7
needs (`resources/render-icons.sh`).

`npm run apk` finds a JDK 17–21 by itself, because Gradle 8 fails on newer Java
with an error that never mentions Java ("Unsupported class file major version").

Other scripts: `npm test` (the offline rules), `npm run typecheck`,
`npm run dev` (the app's screens in a desktop browser, with localStorage
standing in for the phone's storage).

## Setting up a phone

1. Install Tailscale and sign in to the pharmacy's tailnet.
2. Open the app. Enter the server address — the `https://….ts.net` address the
   control panel's remote-access section shows. A plain `http://` LAN address
   also works, but the website's camera scanner needs https.
3. Name the phone and choose **Till** (one phone, at the counter) or
   **Management** (everyone else). Management devices keep nothing on the phone.

The owner sees every device under Users → Devices, and can revoke a lost one.

## The offline rules

All of these are enforced on the phone, and checked again by the server when
the sales arrive (`src/lib/offline/replay.ts`) — the phone's copy is never the
record.

| Rule | Where |
|---|---|
| The till must reach the server once a day: each sync brings a 24-hour pass. | `src/lib/pass.ts` `checkPass` |
| The pass is timed on Android's monotonic clock, so changing the date does nothing; a reboot ends it; a clock turned back locks the till. | `src/lib/pass.ts` |
| "Now" offline is the server's time at the pass plus monotonic time since — used for expiry, receipts and the date the server books the sale on. | `offlineNow`, server `replayOfflineSale` |
| A pass caps the number (500) and value (Rp 50 juta) of offline sales. | `saleFitsPass`; server flags `over_pass_limit` |
| Offline sign-in only for someone who signed in online on this phone in the last 24 hours, holds `sales.create`, and was not on a temporary password. The phone keeps a PBKDF2 verifier, never the password. | `src/lib/signin.ts` |
| A suspended user or a changed password is forgotten at the next sync. | `reconcileUsers` |
| 5 wrong offline passwords lock sign-in for 15 minutes. | `recordFailure` |
| Expired stock is refused, judged on the pass's day, not the phone's. | `src/lib/till.ts` `batchesFor` |
| A sale can use only what the copy showed, minus what this phone already sold. | `usedByBatch` |
| Totals, FEFO and barcode parsing are the server's own code, bundled. | `@/lib/stock/totals`, `fefo`, `gs1` |
| The sale is written to disk (atomic write + fsync) before the receipt shows. | `recordSale`, `NativeBridge.writeFile` |
| Receipts carry a temporary `OFF-<device>-<seq>` number; the server gives the real one and keeps both. | `offlineNumber`; `sales.offline_number` |
| Sending a sale twice books it once. | server dedupes on `clientId` |
| A sale the server cannot book (stock gone since) is never dropped: it waits on Sales → Offline sales to review. | `offline_sale_reviews` |

## How the app and the website share the phone

The app's own screens are served from `https://localhost` inside the phone;
the website is served from the pharmacy server. Both run in the same WebView,
and both can use `window.PharmacyNative`, which the app installs
(`android/…/NativeBridge.java`):

| Method | |
|---|---|
| `elapsedRealtime(): number` | ms since boot, monotonic |
| `bootCount(): number` | `Settings.Global.BOOT_COUNT`, or -1 |
| `readFile(name): string \| null` | names must match `^[a-z]+\.json$` |
| `writeFile(name, content): boolean` | temp file, fsync, rename |
| `deleteFile(name): boolean` | |
| `print(jobName)` | Android print dialog for the current page |
| `ready()` | the first screen has drawn; the launch screen gives way |
| `appVersion(): string` | |
| `setServerOrigin(origin): boolean` | only from `https://localhost` |

The file methods refuse any page that is not `https://localhost` or the saved
server origin. Downloads a page starts (a report's CSV or Excel file, the app
update) go to Android's download manager with the session cookie and open
when finished (`AppDownloads.java`). The Back button first closes whatever is
open on top -- the payment sheet, the camera -- by asking the page
(`window.__pharmacyBack`), and never steps from the website back into the
app's sign-in screen. `LedgerWebViewClient` keeps that one server in the WebView,
opens every other link in the phone's browser, and sends a server page that
fails to load (or a Tailscale Serve 502/503/504) to the offline screen.

The website (`src/components/AppBridge.tsx`, active only when the user agent
contains `PharmacyLedgerApp/`) sends its own sign-in page to the app's, routes
`window.print()` to the phone, refreshes the till's copy every 15 minutes, and
shows a "server not answering → open the offline till" bar.

### Files (`src/storage-format.ts`)

| File | Written by | Holds |
|---|---|---|
| `device.json` | app | `{ deviceId, deviceName, role, serverUrl, deviceToken, deviceCode }` |
| `snapshot.json` | app, and the website's refresh | `{ receivedElapsed, bootCount, receivedWall, data: SnapshotResponse }` |
| `users.json` | app | `{ users: StoredUser[] }` — who may sign in offline |
| `queue.json` | app | sales waiting for the server |
| `history.json` | app | the last 200 sent sales, with their real numbers |
| `state.json` | app | offline sequence number, clock high-water mark, pass usage, sign-in lock |

The request and response shapes are `src/lib/offline/contract.ts` in the
server, imported by both sides.
