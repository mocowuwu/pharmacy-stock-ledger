import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { exists, isWindows, layout, run, ui } from "./lib.mjs";
import * as operations from "./operations.mjs";
import * as remote from "./remote.mjs";

/**
 * The control panel — the pharmacy's own face, for the person at the machine.
 *
 * `pharmacy.cmd` already does all of this, and a pharmacist is never going to
 * type it. This serves one page in the operator's browser: is it running, what
 * address does the till open, where do the records actually live, and the four
 * buttons worth having.
 *
 * A page rather than a desktop application because the bundled Node can serve
 * one with nothing added -- no Electron, no second build, nothing new in
 * package.json for a window.
 *
 * **It does not own the pharmacy.** The boot task does, so the pharmacy comes
 * back from a power cut with nobody logged in. Closing this page must never
 * stop anything, and the process exits by itself once nobody is looking at it.
 */

/* ------------------------------------------------------------------ strings */

/**
 * Indonesian, because the owner is who opens this.
 *
 * Not `next-intl`: this runs outside the Next application, with no bundler and
 * no message catalogue. Kept in one object rather than scattered through the
 * markup so a second locale stays cheap, which is the same reason the rule
 * exists for `src/` -- but this is not that rule, and there is no id/en parity
 * to enforce here.
 *
 * Data is never translated: paths, ports and the address render as they are.
 */
const T = {
  title: "Apotek — Panel Kontrol",
  heading: "Panel Kontrol Apotek",
  running: "berjalan",
  stopped: "tidak berjalan",
  checking: "memeriksa…",
  pharmacy: "Apotek",
  database: "Basis data",
  addressLabel: "Alamat untuk komputer kasir",
  addressHint: "Ketik alamat ini di peramban komputer kasir.",
  remoteOnHint:
    "Akses jarak jauh aktif. Alamat ini hanya bisa dibuka dari perangkat yang " +
    "sudah masuk ke Tailscale. Apotek tidak lagi bisa dijangkau dari jaringan " +
    "kabel klinik.",
  remoteTitle: "Akses jarak jauh",
  remoteOff: "Nonaktifkan akses jarak jauh",
  remoteOn: "Aktifkan akses jarak jauh (Tailscale)",
  remoteHint:
    "Untuk kasir yang berada di gedung lain. Setiap perangkat kasir harus " +
    "memasang Tailscale dan masuk terlebih dahulu.",
  /**
   * Refusals from remote.mjs, by code. The English prose it also returns is for
   * the terminal; the owner reads this page, and a technical sentence in the
   * wrong language at the moment something has failed is no help at all.
   */
  remoteErrors: {
    "tailscale-missing":
      "Tailscale belum terpasang di komputer ini. Pasang dari " +
      "https://tailscale.com/download/windows, masuk, lalu coba lagi.",
    "tailscale-signed-out":
      "Tailscale sudah terpasang tetapi belum masuk. Buka Tailscale, masuk " +
      "dengan akun Anda, lalu coba lagi.",
    "tailscale-serve-failed":
      "Tailscale tidak dapat menyajikan apotek. Periksa Tailscale di komputer " +
      "ini, lalu coba lagi.",
    "tailscale-serve-timeout":
      "Tailscale tidak merespons. Buka aplikasi Tailscale, pastikan sudah " +
      "masuk dan berjalan, lalu coba lagi.",
  },
  updateAdminWarning:
    "Memasang pembaruan mendaftarkan ulang layanan latar belakang. Windows " +
    "akan meminta izin di tengah proses -- klik Ya walau jendelanya muncul " +
    "di belakang peramban ini.",
  remoteNoHttps:
    "Sertifikat HTTPS belum diaktifkan untuk jaringan Tailscale Anda, jadi " +
    "alamat ini memakai nomor IP. Lalu lintasnya tetap terenkripsi antar " +
    "perangkat. Aktifkan HTTPS Certificates di konsol admin Tailscale untuk " +
    "alamat yang lebih rapi dan agar pemindai kamera berfungsi.",
  copy: "Salin",
  copied: "Tersalin",
  openPharmacy: "Buka apotek",
  actions: "Tindakan",
  start: "Jalankan",
  stop: "Hentikan",
  restart: "Mulai ulang",
  backup: "Cadangkan sekarang",
  adminWarning: "Windows akan meminta izin. Klik Ya.",
  working: "Sedang berjalan…",
  updateTitle: "Pembaruan",
  checkUpdate: "Periksa pembaruan",
  updateNow: "Pasang pembaruan",
  updateHint:
    "Mengunduh versi terbaru dan memasangnya. Basis data dicadangkan lebih " +
    "dulu, dan apotek berhenti sebentar selama proses berlangsung.",
  upToDate: "Sudah versi terbaru",
  updateAvailable: "Versi baru tersedia:",
  updateInstalled: "Terpasang:",
  updateDone: "Pembaruan selesai. Versi sekarang:",
  updatePhases: {
    release: "Memeriksa versi terbaru di GitHub…",
    download: "Mengunduh versi",
    extract: "Membongkar arsip…",
    install: "Memasang pembaruan…",
    done: "Selesai",
  },
  /**
   * The installer's steps, by the English title it prints. A step missing here
   * shows its English title rather than nothing -- a newer release may add one
   * before this panel has heard of it.
   */
  updateSteps: {
    "Checking the machine": "Memeriksa komputer dan mencadangkan basis data",
    "Fetching PostgreSQL": "Menyiapkan PostgreSQL",
    "Setting up the database": "Menyalakan basis data",
    "Installing the application": "Memasang aplikasi — mengunduh paket, beberapa menit",
    "Writing the configuration": "Menulis konfigurasi",
    "Building": "Membangun aplikasi — langkah paling lama",
    "Preparing the database": "Memperbarui struktur basis data",
    "Creating the owner account": "Memeriksa akun pemilik",
    "Adding the pharmacy command": "Memasang perintah apotek",
    "Making it start by itself": "Mendaftarkan apotek agar menyala sendiri",
  },
  updateElapsed: "Waktu berjalan:",
  updateNeedsAdmin:
    "Windows meminta izin administrator, dan pembaruan menunggu sampai " +
    "dijawab. Cari jendela izinnya -- bisa tersembunyi di belakang peramban " +
    "ini atau berkedip di taskbar -- lalu klik Ya.",
  updateQuiet:
    "Belum ada kabar baru selama {t}. Langkah ini memang bisa lama di komputer " +
    "kecil; tetap biarkan halaman ini terbuka.",
  updateLog: "Catatan lengkap:",
  updateDetails: "Rincian proses",
  folders: "Lokasi berkas",
  foldersHint:
    "Rekaman apotek disimpan di folder basis data. Cadangan yang belum disalin " +
    "keluar dari komputer ini belum terhitung sebagai cadangan.",
  open: "Buka",
  folderNames: {
    data: "Basis data (rekaman apotek)",
    backups: "Cadangan",
    logs: "Catatan (log)",
    root: "Folder apotek",
  },
  logs: "Catatan terakhir",
  noLogs: "Belum ada catatan — apotek belum pernah dijalankan sejak dipasang.",
  lastBackup: "Cadangan terakhir:",
  lastBackupNever: "Cadangan otomatis belum pernah berjalan.",
  lastBackupFailed: "Cadangan otomatis terakhir GAGAL:",
  backupDone: "Cadangan dibuat:",
  backupStarted: "Basis data tidak berjalan; dijalankan dulu untuk pencadangan.",
  failed: "Gagal:",
  closeHint:
    "Menutup halaman ini tidak menghentikan apotek. Apotek berjalan sendiri, " +
    "termasuk setelah komputer menyala kembali.",
  shutdownTitle: "Matikan total",
  shutdownBody:
    "Ini menghentikan seluruh apotek, mematikan aktifnya secara otomatis, " +
    "dan menonaktifkan halaman panel ini juga -- semuanya, bukan sebagian. " +
    "Rekaman dan cadangan yang sudah ada tetap aman dan tidak terhapus.",
  shutdownHow: "Untuk melakukannya, buka terminal di komputer ini dan jalankan:",
  shutdownUndo:
    "Tidak ada tombol untuk menyalakannya kembali dari sini -- itu sengaja. " +
    "Satu-satunya cara adalah menjalankan pemasang (installer) lagi.",
};

/* ----------------------------------------------------------------- security */

/**
 * This page can stop the pharmacy and take backups, over HTTP, on a machine
 * running a browser. Without these, any web page the operator happened to have
 * open could drive it.
 *
 *   - loopback only, so nothing off this machine can reach it at all, and so
 *     no firewall rule and no Windows network prompt are involved;
 *   - an ephemeral port, so it is not somewhere to guess;
 *   - a token minted per launch and required on every request;
 *   - a Host check, which is what stops DNS rebinding turning a name the
 *     attacker controls into 127.0.0.1;
 *   - POST for anything that changes something, so no link or image can.
 */
const TOKEN = randomBytes(24).toString("base64url");

function tokenMatches(given) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** No heartbeat for this long and the panel closes itself. */
const IDLE_MS = 5 * 60 * 1000;

/* -------------------------------------------------------------------- page */

const escape = (value) =>
  String(value).replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

function page(folders, needsAdministrator, controlPath) {
  const folderRows = folders
    .map(
      (folder) => `
      <tr>
        <td class="name">${escape(T.folderNames[folder.key] ?? folder.key)}</td>
        <td class="path"><code>${escape(folder.path)}</code></td>
        <td><button class="ghost" data-reveal="${escape(folder.key)}">${T.open}</button></td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T.title}</title>
<style>
  /* Taken from src/app/globals.css so this reads as the same product. */
  :root {
    --bg:#f6f5fa; --surface:#fff; --surface-2:#f1eff7; --ink:#17141f;
    --muted:#5c5670; --faint:#8b85a0; --rule:#e6e3ef;
    --accent:#6d3beb; --accent-soft:#eee9fd; --accent-contrast:#fff;
    --critical:#b3261e; --critical-soft:#fbeae8;
    --notice:#1f6fb2; --notice-soft:#e7f1fa;
    --sidebar:#221c33; --sidebar-ink:#edeaf6; --sidebar-muted:#9a93b5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0f0d16; --surface:#17141f; --surface-2:#1e1a2a; --ink:#edeaf6;
      --muted:#9c95b3; --faint:#7a7391; --rule:#2a2438;
      --accent:#9b7bf5; --accent-soft:#241d3a; --accent-contrast:#120e22;
      --critical:#d8443a; --critical-soft:#2e1614;
      --notice:#4e97d8; --notice-soft:#14202e;
      --sidebar:#191527;
    }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  header {
    background:var(--sidebar); color:var(--sidebar-ink);
    padding:18px 28px; font-size:17px; font-weight:600;
  }
  main { max-width:820px; margin:0 auto; padding:24px 20px 56px; }
  section {
    background:var(--surface); border:1px solid var(--rule);
    border-radius:12px; padding:20px 22px; margin-bottom:18px;
  }
  h2 {
    margin:0 0 14px; font-size:13px; font-weight:600; letter-spacing:.06em;
    text-transform:uppercase; color:var(--faint);
  }
  .states { display:flex; gap:12px; flex-wrap:wrap; }
  .chip {
    display:flex; align-items:center; gap:9px; padding:9px 14px;
    border-radius:9px; background:var(--surface-2); font-weight:500;
  }
  .chip .dot { width:9px; height:9px; border-radius:50%; background:var(--faint); }
  /* No green: the validated status set is critical/notice/warning, and every
     chip says its state in words as well, so nothing rests on colour alone. */
  .chip.up   { background:var(--notice-soft);   color:var(--notice); }
  .chip.up   .dot { background:var(--notice); }
  .chip.down { background:var(--critical-soft); color:var(--critical); }
  .chip.down .dot { background:var(--critical); }
  .address {
    display:flex; align-items:center; gap:12px; flex-wrap:wrap;
    background:var(--accent-soft); border-radius:10px; padding:14px 16px;
  }
  .address code {
    font-size:21px; font-weight:600; color:var(--accent);
    font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;
  }
  p.hint { color:var(--muted); font-size:13.5px; margin:10px 0 0; }
  button {
    font:inherit; font-weight:500; cursor:pointer; border-radius:8px;
    padding:9px 15px; border:1px solid var(--accent);
    background:var(--accent); color:var(--accent-contrast);
  }
  button.ghost { background:transparent; color:var(--accent); }
  button:disabled { opacity:.5; cursor:default; }
  .actions { display:flex; gap:10px; flex-wrap:wrap; }
  table { width:100%; border-collapse:collapse; }
  td { padding:9px 10px 9px 0; border-top:1px solid var(--rule); vertical-align:middle; }
  tr:first-child td { border-top:0; }
  td.name { white-space:nowrap; color:var(--muted); }
  td.path code { font-size:12.5px; color:var(--ink); word-break:break-all; }
  pre {
    background:var(--surface-2); border-radius:9px; padding:14px;
    max-height:260px; overflow:auto; margin:0;
    font-size:12.5px; white-space:pre-wrap; word-break:break-word;
  }
  #update-progress { margin-top:16px; }
  .bar-head { display:flex; justify-content:space-between; gap:12px; font-weight:500; }
  .bar-head #update-percent { font-variant-numeric:tabular-nums; color:var(--accent); }
  .bar {
    height:10px; border-radius:99px; background:var(--surface-2);
    overflow:hidden; margin:8px 0 6px;
  }
  .bar .fill {
    height:100%; width:0; border-radius:99px; background:var(--accent);
    transition:width .6s ease;
  }
  /* Moving stripes while it runs: the percentage only advances between
     steps, and the build step alone can hold it still for ten minutes. The
     stripes are what say "alive" in between. */
  #update-progress.running .fill {
    background-image:linear-gradient(45deg,rgba(255,255,255,.28) 25%,transparent 25%,
      transparent 50%,rgba(255,255,255,.28) 50%,rgba(255,255,255,.28) 75%,transparent 75%);
    background-size:20px 20px; animation:stripes 1s linear infinite;
  }
  @keyframes stripes { to { background-position:20px 0; } }
  @media (prefers-reduced-motion: reduce) { #update-progress.running .fill { animation:none; } }
  #update-progress.failed .fill { background:var(--critical); }
  .notice {
    margin:10px 0 0; padding:10px 14px; border-radius:9px;
    background:var(--critical-soft); color:var(--critical); font-weight:500;
  }
  .notice.soft { background:var(--notice-soft); color:var(--notice); font-weight:400; }
  details { margin-top:10px; }
  summary { cursor:pointer; color:var(--muted); font-size:13.5px; }
  details pre { margin-top:8px; }
  #message { margin:0 0 18px; padding:12px 16px; border-radius:9px; display:none; white-space:pre-line; }
  #message.show { display:block; }
  #message.bad { background:var(--critical-soft); color:var(--critical); }
  #message.good { background:var(--notice-soft); color:var(--notice); }
  footer { color:var(--faint); font-size:13px; text-align:center; padding:0 20px; }
</style>
</head>
<body>
<header>${T.heading}</header>
<main>
  <p id="message"></p>

  <section>
    <h2>Status</h2>
    <div class="states">
      <div class="chip" id="chip-app"><span class="dot"></span><span>${T.pharmacy}: <b id="state-app">${T.checking}</b></span></div>
      <div class="chip" id="chip-db"><span class="dot"></span><span>${T.database}: <b id="state-db">${T.checking}</b></span></div>
    </div>
  </section>

  <section>
    <h2>${T.addressLabel}</h2>
    <div class="address">
      <code id="address">—</code>
      <button class="ghost" id="copy">${T.copy}</button>
      <button class="ghost" id="open-app">${T.openPharmacy}</button>
    </div>
    <p class="hint" id="address-hint">${T.addressHint}</p>
  </section>

  <section>
    <h2>${T.remoteTitle}</h2>
    <div class="actions">
      <button data-action="remote">${T.remoteOn}</button>
    </div>
    <p class="hint">${T.remoteHint}</p>
  </section>

  <section>
    <h2>${T.actions}</h2>
    <div class="actions">
      <button data-action="start">${T.start}</button>
      <button data-action="stop">${T.stop}</button>
      <button data-action="restart">${T.restart}</button>
      <button data-action="backup">${T.backup}</button>
    </div>
    <p class="hint" id="last-backup">—</p>
    ${needsAdministrator ? `<p class="hint">${T.adminWarning}</p>` : ""}
  </section>

  <section>
    <h2>${T.updateTitle}</h2>
    <div class="actions">
      <button data-action="check-update">${T.checkUpdate}</button>
      <button data-action="update" id="update-now" hidden>${T.updateNow}</button>
    </div>
    <p class="hint" id="update-status">—</p>
    <div id="update-progress" hidden>
      <div class="bar-head">
        <span id="update-label">—</span>
        <span id="update-percent">0%</span>
      </div>
      <div class="bar" id="update-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="fill" id="update-fill"></div>
      </div>
      <p class="hint" id="update-meta"></p>
      <p class="notice" id="update-admin" hidden>${T.updateNeedsAdmin}</p>
      <p class="notice soft" id="update-quiet" hidden></p>
      <details id="update-details" open>
        <summary>${T.updateDetails}</summary>
        <pre id="update-log"></pre>
      </details>
    </div>
    <p class="hint">${T.updateHint}</p>
    ${needsAdministrator ? `<p class="hint">${T.updateAdminWarning}</p>` : ""}
  </section>

  <section>
    <h2>${T.folders}</h2>
    <table>${folderRows}</table>
    <p class="hint">${T.foldersHint}</p>
  </section>

  <section>
    <h2>${T.logs}</h2>
    <pre id="logs">—</pre>
  </section>

  <section>
    <h2>${T.shutdownTitle}</h2>
    <p>${T.shutdownBody}</p>
    <p class="hint">${T.shutdownHow}</p>
    <pre>${escape(controlPath)} disable</pre>
    <p class="hint">${T.shutdownUndo}</p>
  </section>

  <footer>${T.closeHint}</footer>
</main>
<script>
  // The token arrives in the URL and is then kept only in memory; it is
  // stripped from the address bar so it does not end up in history or in a
  // screenshot of the browser.
  const token = new URLSearchParams(location.search).get("t") || "";
  history.replaceState(null, "", location.pathname);

  const T = ${JSON.stringify(T)};
  const $ = (id) => document.getElementById(id);
  let busy = false;

  async function api(path, method = "GET") {
    const response = await fetch(path, {
      method,
      headers: { "x-pharmacy-token": token },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  function say(text, good) {
    const box = $("message");
    box.textContent = text;
    box.className = "show " + (good ? "good" : "bad");
  }

  function paint(state) {
    $("state-app").textContent = state.app ? T.running : T.stopped;
    $("state-db").textContent = state.database ? T.running : T.stopped;
    $("chip-app").className = "chip " + (state.app ? "up" : "down");
    $("chip-db").className = "chip " + (state.database ? "up" : "down");
    $("address").textContent = state.address;
    $("open-app").disabled = !state.app;

    // The button says what pressing it will do, not what is currently true --
    // a toggle labelled with its own state is the classic way to turn a thing
    // off while believing you turned it on.
    const button = document.querySelector('button[data-action="remote"]');
    button.textContent = state.remote ? T.remoteOff : T.remoteOn;
    button.dataset.remote = state.remote ? "on" : "off";
    $("address-hint").textContent = state.remote ? T.remoteOnHint : T.addressHint;
  }

  function paintBackup(jobs) {
    const last = (jobs || {}).backup;
    const box = $("last-backup");
    if (!last) { box.textContent = T.lastBackupNever; return; }
    // A failed run shows as failed. Printing its timestamp as though it were a
    // backup is the one thing this line must never do.
    const when = new Date(last.at).toLocaleString("id-ID");
    box.textContent = last.ok
      ? T.lastBackup + " " + when
      : T.lastBackupFailed + " " + when;
  }

  function paintLogs(log) {
    $("logs").textContent = log.missing || !log.lines.length
      ? T.noLogs
      : log.lines.join("\\n");
  }

  async function refresh() {
    if (busy) return;
    try {
      const data = await api("/api/state");
      paint(data.status);
      paintLogs(data.logs);
      paintBackup(data.jobs);
    } catch { /* a refresh that fails is not worth shouting about */ }
  }

  function setBusy(on) {
    busy = on;
    document.querySelectorAll("button[data-action]").forEach((b) => (b.disabled = on));
  }

  const clock = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  };

  function updateLabel(p) {
    if (p.phase === "download") {
      const mb = (p.bytes / 1024 / 1024).toFixed(1);
      return T.updatePhases.download + " " + (p.version || "") + "… " + mb + " MB";
    }
    if (p.phase === "install" && p.step) return T.updateSteps[p.step] || p.step;
    return T.updatePhases[p.phase] || T.updatePhases.install;
  }

  function paintUpdate(u) {
    const p = u.progress || { phase: "release", percent: 0, lines: [] };
    const failed = u.done && u.done.ok === false;
    const percent = u.done && u.done.ok ? 100 : Math.round(p.percent);

    const box = $("update-progress");
    box.hidden = false;
    box.className = u.active ? "running" : failed ? "failed" : "";
    $("update-fill").style.width = percent + "%";
    $("update-bar").setAttribute("aria-valuenow", String(percent));
    $("update-percent").textContent = percent + "%";
    $("update-label").textContent = failed ? T.failed : updateLabel(p);
    $("update-meta").textContent = T.updateElapsed + " " + clock(u.elapsedMs || 0);

    // Only while it is actually waiting: a notice that outlives the prompt
    // sends the owner hunting for a dialog that is no longer there.
    $("update-admin").hidden = !(u.active && p.needsAdmin);
    const quiet = u.active && !p.needsAdmin && u.quietMs > 90000;
    $("update-quiet").hidden = !quiet;
    if (quiet) $("update-quiet").textContent = T.updateQuiet.replace("{t}", clock(u.quietMs));

    // Follows the tail unless the owner has scrolled up to read something.
    const log = $("update-log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.textContent = p.lines.join("\\n");
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  // The install behind "Pasang pembaruan" runs for many minutes, so it is
  // started and then polled rather than awaited in one request -- see
  // startUpdate in operations.mjs. That is also what lets it survive a UAC
  // prompt mid-install, and a reload of this page: nothing is sitting on the
  // network waiting for the answer.
  async function pollUpdate() {
    for (;;) {
      let u;
      try {
        u = await api("/api/update-status");
      } catch {
        // A poll that fails is not the update failing -- the panel process is
        // still running it. Try again rather than declaring anything.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      paintUpdate(u);

      if (!u.active && u.done) {
        const result = u.done;
        if (result.status) paint(result.status);
        if (result.ok === false) {
          say(
            T.failed + " " + (result.reason || "") +
              (result.logFile ? "\\n\\n" + T.updateLog + " " + result.logFile : ""),
            false,
          );
        } else {
          $("update-now").hidden = true;
          $("update-status").textContent = T.updateDone + " " + result.version;
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  document.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      setBusy(true);
      const original = button.textContent;
      button.textContent = T.working;
      try {
        // Remote is a toggle, so the path carries the direction rather than
        // the server guessing from current state -- two clicks racing must not
        // be able to leave it in the state neither of them asked for.
        const path =
          button.dataset.action === "remote"
            ? "/api/remote/" + (button.dataset.remote === "on" ? "off" : "on")
            : "/api/" + button.dataset.action;
        const result = await api(path, "POST");

        if (button.dataset.action === "update") {
          // Busy stays on and the button stays disabled for the whole poll --
          // the alternative is every other button staying clickable while an
          // install is mid-flight underneath them. The finally block below
          // restores the button once pollUpdate resolves.
          await pollUpdate();
          return;
        }

        if (result.status) paint(result.status);
        // An operation that refused is a 200 carrying ok:false -- a declined
        // administrator prompt is an answer, not a server error. Saying so is
        // the whole point; a button that silently did nothing is worse than
        // one that failed.
        if (result.ok === false) {
          say(T.remoteErrors[result.code] || T.failed + " " + (result.reason || ""), false);
        }
        else if (button.dataset.action === "check-update") {
          $("update-now").hidden = !result.updateAvailable;
          $("update-status").textContent = result.updateAvailable
            ? T.updateAvailable + " " + result.current + " → " + result.latest
            : T.upToDate + " (" + result.current + ")";
        }
        else if (result.message) say(T.remoteNoHttps, true);
        else if (result.address) say(result.address, true);
        else if (result.file) say(T.backupDone + " " + result.file, true);
        else if (result.startedDatabase) say(T.backupStarted, true);
        else $("message").className = "";
      } catch (error) {
        say(T.failed + " " + error.message, false);
      } finally {
        button.textContent = original;
        setBusy(false);
        refresh();
      }
    });
  });

  document.querySelectorAll("button[data-reveal]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("/api/reveal/" + button.dataset.reveal, "POST");
      } catch (error) {
        say(T.failed + " " + error.message, false);
      }
    });
  });

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("address").textContent);
      $("copy").textContent = T.copied;
      setTimeout(() => ($("copy").textContent = T.copy), 1500);
    } catch { /* clipboard refused; the address is on screen to read */ }
  });

  $("open-app").addEventListener("click", () => {
    window.open($("address").textContent, "_blank", "noopener");
  });

  // A page reloaded, or reopened from the desktop icon, mid-update picks the
  // progress back up instead of offering a second update on top of the first.
  api("/api/update-status").then((u) => {
    if (!u.active) return;
    const button = $("update-now");
    button.hidden = false;
    const original = button.textContent;
    button.textContent = T.working;
    setBusy(true);
    pollUpdate().finally(() => {
      button.textContent = original;
      setBusy(false);
      refresh();
    });
  }).catch(() => {});

  refresh();
  setInterval(refresh, 4000);
  // Tells the server somebody is still here. Without it the panel would sit
  // there with a stop button on it for as long as the machine stays up.
  setInterval(() => api("/api/heartbeat", "POST").catch(() => {}), 30000);
</script>
</body>
</html>`;
}

/* ---------------------------------------------------------- disabled page */

/**
 * What the panel shows instead of itself once `pharmacy disable` has run.
 *
 * "Every part of the server" includes this page -- a control panel that still
 * has a working stop/start/backup on it is not disabled, it is a pharmacy one
 * click away from being un-disabled by the same person the disable was for.
 * So there is no status, no buttons, nothing that calls into `operations.mjs`
 * at all: just the one sentence that says why, and the one sentence that says
 * how to undo it.
 */
function disabledPage() {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apotek — Dinonaktifkan</title>
<style>
  :root { --bg:#f6f5fa; --ink:#17141f; --muted:#5c5670; --sidebar:#221c33; --sidebar-ink:#edeaf6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f0d16; --ink:#edeaf6; --muted:#9c95b3; --sidebar:#191527; }
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  header { background:var(--sidebar); color:var(--sidebar-ink); padding:18px 28px; font-size:17px; font-weight:600; }
  main { max-width:560px; margin:60px auto; padding:0 20px; }
  p.muted { color:var(--muted); }
  code { font-family:ui-monospace,"Cascadia Mono",Consolas,monospace; }
</style>
</head>
<body>
<header>Panel Kontrol Apotek</header>
<main>
  <h1>Apotek dinonaktifkan</h1>
  <p>Seluruh apotek dihentikan, tidak akan menyala sendiri lagi, dan panel
  kontrol ini pun tidak melakukan apa pun selain menampilkan pesan ini.</p>
  <p>Rekaman apotek dan cadangan yang sudah ada tetap aman -- tidak ada yang
  dihapus.</p>
  <p class="muted">Untuk mengaktifkannya kembali, jalankan pemasang (installer)
  di komputer ini lagi.</p>
</main>
</body>
</html>`;
}

/** A minimal server: one static page, nothing that can be driven remotely. */
async function serveDisabled() {
  const html = disabledPage();
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address();
  const address = `http://127.0.0.1:${port}/`;

  ui.warn("Apotek dinonaktifkan.");
  ui.detail("Jalankan pemasang lagi untuk mengaktifkannya kembali.");
  await openBrowser(address).catch(() => {
    ui.warn("could not open a browser; open the address above yourself");
  });

  // No live state to poll and nothing to press, so the page does not need the
  // server once it has loaded -- unlike the real panel, which keeps it open
  // for as long as somebody is looking.
  setTimeout(() => process.exit(0), 5_000);
}

/* ------------------------------------------------------------------ server */

async function openBrowser(url) {
  if (process.platform === "win32") return run("cmd", ["/c", "start", "", url]);
  if (process.platform === "darwin") return run("open", [url]);
  return run("xdg-open", [url]);
}

async function main() {
  const root = resolve(process.env.PHARMACY_ROOT ?? process.argv[2] ?? process.cwd());
  const paths = layout(root);

  if (!(await exists(paths.config))) {
    ui.fail(
      `no installation found at ${root}.`,
      "Run this from inside the pharmacy folder.",
    );
  }
  const config = JSON.parse(await readFile(paths.config, "utf8"));

  if (config.disabled) return serveDisabled();

  let lastSeen = Date.now();
  const controlPath = join(root, isWindows ? "pharmacy.cmd" : "pharmacy");
  const html = page(operations.folders(paths), operations.stoppingNeedsAdministrator(), controlPath);

  const server = createServer(async (request, response) => {
    const send = (code, body, type = "application/json") => {
      response.writeHead(code, { "content-type": type, "cache-control": "no-store" });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    };

    try {
      const address = server.address();
      const url = new URL(request.url, `http://127.0.0.1:${address.port}`);

      // Only ever ourselves, by the name we were opened under. A request that
      // arrived via some other hostname resolving here is a rebinding attempt.
      if (request.headers.host !== `127.0.0.1:${address.port}`) {
        return send(403, "forbidden", "text/plain");
      }

      const given = request.headers["x-pharmacy-token"] ?? url.searchParams.get("t");
      if (!tokenMatches(given)) return send(403, "forbidden", "text/plain");

      lastSeen = Date.now();

      if (request.method === "GET" && url.pathname === "/") {
        return send(200, html, "text/html; charset=utf-8");
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        return send(200, {
          status: await operations.status(paths, config),
          logs: await operations.logs(paths),
          jobs: await operations.jobHistory(paths),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/update-status") {
        return send(200, operations.updateStatus());
      }

      // Everything below changes something, so nothing below answers to GET.
      if (request.method !== "POST") return send(405, "method not allowed", "text/plain");

      if (url.pathname === "/api/heartbeat") return send(200, { ok: true });

      if (url.pathname === "/api/start") return send(200, await operations.start(paths, config));
      if (url.pathname === "/api/stop") return send(200, await operations.stop(paths, config));
      if (url.pathname === "/api/restart") return send(200, await operations.restart(paths, config));
      if (url.pathname === "/api/backup") return send(200, await operations.backup(paths, config));
      if (url.pathname === "/api/check-update") return send(200, await operations.checkUpdate(paths));
      // Starts the update and returns immediately -- the install this kicks
      // off can take several minutes, and the panel polls /api/update-status
      // for progress instead of holding one request open that long.
      if (url.pathname === "/api/update") return send(200, operations.startUpdate(paths, config));

      const folder = url.pathname.match(/^\/api\/reveal\/([a-z]+)$/u)?.[1];
      if (folder) return send(200, await operations.reveal(paths, folder));

      const direction = url.pathname.match(/^\/api\/remote\/(on|off)$/u)?.[1];
      if (direction) {
        const result =
          direction === "on"
            ? await remote.enableRemote(paths, config)
            : await remote.disableRemote(paths, config);

        if (!result.ok) {
          // The code travels; the page picks the words. `reason` is kept as the
          // fallback for anything that has not been given a code yet.
          return send(200, {
            ok: false,
            code: result.code,
            reason: `${result.reason}\n\n${result.remedy}`,
          });
        }

        // The bind address and the cookie flag are both read at startup, so
        // until this restart the pharmacy is still answering the old way and
        // the address about to be shown would be a lie. Everything the page
        // sees afterwards comes from the config this returned, not the one
        // this process started with.
        Object.assign(config, result.config);
        const restarted = await operations.restart(paths, config);

        return send(200, {
          ok: true,
          status: restarted.status,
          message: result.note,
          address: result.address,
        });
      }

      return send(404, "not found", "text/plain");
    } catch (error) {
      return send(500, { ok: false, reason: error.message ?? String(error) });
    }
  });

  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/?t=${TOKEN}`;

  ui.info("Panel kontrol apotek");
  ui.detail(url);
  ui.detail("Tutup jendela peramban jika sudah selesai. Apotek tetap berjalan.");

  await openBrowser(url).catch(() => {
    ui.warn("could not open a browser; open the address above yourself");
  });

  // Nobody looking, nothing to serve. The pharmacy is untouched by this.
  //
  // Except mid-update. The installer is this process's child, writing into a
  // pipe this process holds; exiting would close that pipe under it and leave
  // the pharmacy stopped halfway through an upgrade because a browser tab was
  // closed.
  setInterval(() => {
    if (operations.updateStatus().active) return;
    if (Date.now() - lastSeen > IDLE_MS) process.exit(0);
  }, 30_000);
}

main().catch((error) => ui.fail(error.message ?? String(error)));
