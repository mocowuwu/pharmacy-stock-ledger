import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { download, extractTarGz, run } from "./lib.mjs";

/**
 * Checking for and applying an update from GitHub Releases.
 *
 * The installer already knows how to upgrade an existing install in place --
 * see the `alreadyInstalled` branch in `main.mjs` -- given a `--source`
 * pointing at the new code. All this adds is getting that source onto the
 * machine: download the tagged release's source archive, unpack it, and hand
 * it to the same installer the owner would otherwise have run by hand.
 *
 * Nothing here builds anything. The archive is raw source, exactly what a
 * `git clone` at that tag would produce -- the installer's own `npm ci` and
 * `npm run build` steps do the rest, on the machine, against the machine's
 * own PostgreSQL. That is also why no compiled artifact needs publishing: the
 * release only has to exist, tagged, for `tarball_url` to resolve.
 */

const REPO = "mocowuwu/pharmacy-stock-ledger";

/** `1.4.2` < `1.10.0`, which string comparison gets wrong. */
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] || 0) - (pb[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function currentVersion(paths) {
  const pkg = JSON.parse(await readFile(join(paths.app, "package.json"), "utf8"));
  return pkg.version;
}

async function latestRelease() {
  // Bounded, because the panel's "Periksa pembaruan" and the first step of an
  // update both wait on this, and a network that swallows the request rather
  // than refusing it would otherwise leave either one spinning for good.
  //
  // Node reports an unreachable network as a bare "fetch failed", which tells
  // the owner nothing they can act on; the connection is the thing to check.
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  }).catch((error) => {
    const why = error.name === "TimeoutError" ? "no answer in 20 seconds" : error.cause?.code;
    throw new Error(
      `could not reach GitHub to check for updates${why ? ` (${why})` : ""}. ` +
        "Check this computer's internet connection and try again. Nothing was changed.",
    );
  });
  if (!response.ok) {
    throw new Error(`could not reach GitHub releases (status ${response.status})`);
  }
  const data = await response.json();
  const version = String(data.tag_name ?? "").replace(/^v/u, "");
  if (!version || !data.tarball_url) {
    throw new Error("the latest release is missing a tag or a source archive");
  }
  return {
    version,
    tarballUrl: data.tarball_url,
    notes: data.body ?? "",
    publishedAt: data.published_at ?? null,
  };
}

/** Whether a newer version is published, without downloading anything. */
export async function checkForUpdate(paths) {
  const current = await currentVersion(paths);
  const latest = await latestRelease();
  return {
    ok: true,
    current,
    latest: latest.version,
    updateAvailable: compareVersions(current, latest.version) < 0,
    notes: latest.notes,
    publishedAt: latest.publishedAt,
  };
}

/**
 * The steps `main.mjs` prints, weighted by how long each one actually takes on
 * a small clinic machine -- `npm ci` and the build are most of an update, and a
 * bar that gave each step a tenth would sit at 90% for ten minutes.
 *
 * Matched on the title the installer prints, not its number, because it is the
 * *new* release's installer that runs and its numbering may have moved. A step
 * this table does not know leaves the bar where it is rather than guessing.
 */
const INSTALL_STEPS = [
  ["Checking the machine", 8],
  ["Fetching PostgreSQL", 3],
  ["Fetching the cloud backup tool", 1],
  ["Setting up the database", 4],
  ["Installing the application", 30],
  ["Writing the configuration", 1],
  ["Building", 39],
  ["Preparing the database", 6],
  ["Creating the owner account", 3],
  ["Adding the pharmacy command", 2],
  ["Making it start by itself", 3],
];

/** Where each phase sits on the bar. The install gets nearly all of it. */
const RANGE = { release: [0, 2], download: [2, 10], extract: [10, 12], install: [12, 99] };

/**
 * Lines that mean Windows is about to show a UAC prompt and the installer is
 * blocked until somebody answers it. That prompt can open behind the browser
 * the owner is watching, and an update waiting on a dialog nobody can see is
 * indistinguishable from a hung one -- unless the page says so.
 */
const ASKS_FOR_ADMIN = /needs administrator rights|Windows will ask for permission/iu;

const MAX_LINES = 200;

/**
 * Downloads the latest release and runs the installer's own upgrade path
 * against it.
 *
 * Deliberately reuses `main.mjs` rather than re-implementing what it does:
 * that file is what takes the pre-upgrade backup, stops the running pharmacy,
 * copies files in, runs migrations, and starts it again -- and it needs to be
 * the *new* `main.mjs`, in case the upgrade steps themselves have changed,
 * which is why it is run out of the freshly downloaded source rather than the
 * copy already on disk.
 *
 * `onProgress` receives a fresh snapshot every time something changes: the
 * phase, a percentage, the installer's current step, and its output so far.
 * Every line also goes to `logs/update.log`, which outlives this process -- the
 * one record of what an update did if it failed while nobody was looking.
 */
export async function applyUpdate(paths, config, onProgress = () => {}) {
  const logFile = join(paths.logs, "update.log");
  await mkdir(paths.logs, { recursive: true });
  const log = createWriteStream(logFile, { flags: "w" });

  const progress = {
    phase: "release",
    percent: 0,
    version: null,
    step: null,
    detail: null,
    bytes: 0,
    needsAdmin: false,
    lines: [],
    lineCount: 0,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    logFile,
  };
  const emit = () => onProgress({ ...progress, lines: [...progress.lines] });

  const phase = (name) => {
    progress.phase = name;
    progress.percent = Math.max(progress.percent, RANGE[name][0]);
    emit();
  };

  const line = (text) => {
    log.write(`${new Date().toISOString()}  ${text}\n`);
    progress.lines.push(text);
    progress.lineCount += 1;
    if (progress.lines.length > MAX_LINES) progress.lines.shift();
    progress.lastOutputAt = Date.now();
    progress.needsAdmin = ASKS_FOR_ADMIN.test(text);

    // A download inside the current step (see `download` in lib.mjs): shown
    // beside the step's name until the next step begins.
    if (/^downloading… /u.test(text)) progress.detail = text.replace(/^downloading… /u, "");

    // `1. Checking the machine` -- the installer announcing its next step.
    // A step this table does not know is still named -- the page shows the
    // title as printed -- so a newer installer's extra step never leaves the
    // previous step's label on screen for as long as the new one takes.
    const title = progress.phase === "install" ? /^\d+\.\s+(.+)$/u.exec(text)?.[1] : undefined;
    if (title) {
      progress.step = title;
      progress.detail = null;
    }
    const index = INSTALL_STEPS.findIndex(([name]) => name === title);
    if (index !== -1) {
      const done = INSTALL_STEPS.slice(0, index).reduce((sum, [, weight]) => sum + weight, 0);
      const [from, to] = RANGE.install;
      progress.percent = Math.max(progress.percent, Math.round(from + ((to - from) * done) / 100));
    }
    emit();
  };

  try {
    phase("release");
    line("Checking GitHub for the latest release");
    const latest = await latestRelease();
    progress.version = latest.version;

    const workDir = join(paths.root, "downloads", `update-${latest.version}`);
    const archive = `${workDir}.tar.gz`;
    await rm(workDir, { recursive: true, force: true });
    await rm(archive, { force: true });

    phase("download");
    line(`Downloading version ${latest.version}`);
    // GitHub's source archives are streamed without a length, so there is no
    // honest percentage for this part -- the count of bytes arriving is what
    // shows it is moving.
    await download(latest.tarballUrl, archive, {
      onBytes: (received) => {
        progress.bytes = received;
        progress.lastOutputAt = Date.now();
        emit();
      },
    });
    line(`Downloaded ${(progress.bytes / 1024 / 1024).toFixed(1)} MB`);

    phase("extract");
    await extractTarGz(archive, workDir);
    await rm(archive, { force: true });

    // GitHub wraps a tarball's contents in one directory named after the
    // commit, not the tag -- found rather than guessed.
    const entries = await readdir(workDir, { withFileTypes: true });
    const top = entries.find((entry) => entry.isDirectory());
    if (!top) throw new Error("the downloaded release archive was empty");
    const sourceDir = join(workDir, top.name);

    phase("install");

    // The installer being re-run prints one line per step (ui.step / ui.info /
    // ui.ok in lib.mjs). Captured, those lines would vanish into this
    // process's stdout, invisible to whoever is watching the panel -- which is
    // how an update came to look exactly the same whether it was building,
    // waiting on a UAC prompt, or dead. Forwarded as they arrive, they are the
    // progress bar.
    let buffer = "";
    const forwardLines = (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const text = rawLine.replace(/\x1b\[[0-9;]*[A-Za-z]/gu, "").trim();
        if (text) line(text);
      }
    };

    const output = await run(
      process.execPath,
      [
        join(sourceDir, "installer", "main.mjs"),
        "--dir",
        paths.root,
        "--source",
        sourceDir,
        "--db-port",
        String(config.pgPort),
        "--port",
        String(config.appPort),
      ],
      { inherit: false, onOutput: forwardLines, env: { PHARMACY_PROGRESS: "lines" } },
    );

    // The installer saying it finished is not the same as the new version
    // being in place. Every update up to 0.1.4 printed success while copying
    // nothing (see the copy filter in main.mjs), and nothing checked. This is
    // that check: the version on disk is the one that was downloaded, or the
    // update failed.
    const installed = await currentVersion(paths);
    if (installed !== latest.version) {
      throw new Error(
        `the installer finished, but version ${installed} is still installed instead of ${latest.version}`,
      );
    }

    await rm(workDir, { recursive: true, force: true });

    progress.phase = "done";
    progress.percent = 100;
    progress.needsAdmin = false;
    line(`Updated to ${latest.version}`);
    return { ok: true, version: latest.version, output, logFile };
  } catch (error) {
    progress.needsAdmin = false;
    // The installer ends a refusal with `Stopped. <sentence>` and the way out
    // (ui.fail in lib.mjs). That is what the owner needs to read; the error
    // `run` builds leads with the full node command line, which is not.
    const said = /Stopped\.\s*([\s\S]*)$/u.exec(error.output ?? "")?.[1]?.trim();
    const reason = said || (error.message ?? String(error));
    log.write(`${new Date().toISOString()}  ${error.message ?? String(error)}\n`);
    line(`FAILED: ${reason}`);
    const failure = new Error(reason);
    failure.logFile = logFile;
    throw failure;
  } finally {
    await new Promise((resolve) => log.end(resolve));
  }
}
