import "server-only";

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pkg from "../../package.json";

/**
 * Where the Android app comes from when staff download it from the website.
 *
 * The clinic's machine builds the website from source at every update but has
 * no Android toolchain, so the app is built by the release workflow and
 * attached to each GitHub release as `apotek-android.apk`. The server fetches
 * the copy that belongs to its own version -- a phone and the server it talks
 * to should come from the same release -- keeps it, and serves it to phones
 * over the tailnet from then on, so each phone's download never leaves the
 * pharmacy's network.
 *
 * `APP_APK_PATH` overrides all of that with a file on disk, for a machine
 * that cannot reach GitHub.
 */

/** Same repository as installer/update.mjs. */
const RELEASE_REPO = "mocowuwu/pharmacy-stock-ledger";
const ASSET = "apotek-android.apk";

export const APP_VERSION: string = pkg.version;

export type ApkSource =
  | { ok: true; path: string; size: number }
  | { ok: false; reason: "not_published" | "unreachable" };

function cacheDir(): string {
  // The data folder where there is one; the system temp folder where the
  // filesystem is read-only (the hosted demo).
  for (const dir of [join(process.cwd(), ".data", "app"), join(tmpdir(), "pharmacy-app")]) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // Try the next one.
    }
  }
  return tmpdir();
}

function fileIfPresent(path: string | undefined): { path: string; size: number } | null {
  if (!path || !existsSync(path)) return null;
  const size = statSync(path).size;
  return size > 0 ? { path, size } : null;
}

async function fetchFrom(url: string, into: string): Promise<"ok" | "missing"> {
  const response = await fetch(url, { redirect: "follow" });
  if (response.status === 404) return "missing";
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  // Written beside the final name and renamed into place, so a download cut
  // off halfway is never served as the app.
  const partial = `${into}.${process.pid}.${Date.now()}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    renameSync(partial, into);
  } catch (error) {
    try {
      unlinkSync(partial);
    } catch {
      // Already gone.
    }
    throw error;
  }
  return "ok";
}

export async function findApk(): Promise<ApkSource> {
  const override = fileIfPresent(process.env.APP_APK_PATH);
  if (override) return { ok: true, ...override };

  const cached = join(cacheDir(), `apotek-android-${APP_VERSION}.apk`);
  const hit = fileIfPresent(cached);
  if (hit) return { ok: true, ...hit };

  try {
    const url = `https://github.com/${RELEASE_REPO}/releases/download/v${APP_VERSION}/${ASSET}`;
    if ((await fetchFrom(url, cached)) === "missing") return { ok: false, reason: "not_published" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const fetched = fileIfPresent(cached);
  return fetched ? { ok: true, ...fetched } : { ok: false, reason: "unreachable" };
}
