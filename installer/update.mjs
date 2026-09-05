import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { download, extractTarGz, run, ui } from "./lib.mjs";

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
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
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
 * Downloads the latest release and runs the installer's own upgrade path
 * against it.
 *
 * Deliberately reuses `main.mjs` rather than re-implementing what it does:
 * that file is what takes the pre-upgrade backup, stops the running pharmacy,
 * copies files in, runs migrations, and starts it again -- and it needs to be
 * the *new* `main.mjs`, in case the upgrade steps themselves have changed,
 * which is why it is run out of the freshly downloaded source rather than the
 * copy already on disk.
 */
export async function applyUpdate(paths, config) {
  const latest = await latestRelease();
  const workDir = join(paths.root, "downloads", `update-${latest.version}`);
  const archive = `${workDir}.tar.gz`;

  await rm(workDir, { recursive: true, force: true });
  await rm(archive, { force: true });

  ui.step(`Downloading version ${latest.version}`);
  await download(latest.tarballUrl, archive);
  ui.ok("downloaded");

  await extractTarGz(archive, workDir);
  await rm(archive, { force: true });

  // GitHub wraps a tarball's contents in one directory named after the
  // commit, not the tag -- found rather than guessed.
  const entries = await readdir(workDir, { withFileTypes: true });
  const top = entries.find((entry) => entry.isDirectory());
  if (!top) throw new Error("the downloaded release archive was empty");
  const sourceDir = join(workDir, top.name);

  ui.step("Installing the update");
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
    { inherit: false },
  );

  await rm(workDir, { recursive: true, force: true });

  return { ok: true, version: latest.version, output };
}
