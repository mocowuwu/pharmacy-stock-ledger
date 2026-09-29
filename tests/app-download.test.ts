import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_VERSION, findApk } from "@/lib/app-download";

/**
 * The server's copy of the Android app: fetched once from the release that
 * matches its own version, kept, and never served half-downloaded.
 */

const APK = Buffer.from("PK\u0003\u0004 pretend apk ".repeat(4096));
let server: Server;
let base: string;
let requests: string[] = [];
let mode: "ok" | "missing" | "broken" = "ok";
let cache: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    if (mode === "missing") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    if (mode === "broken") {
      // Half the file, then the connection drops.
      res.write(APK.subarray(0, APK.length / 2));
      res.destroy();
      return;
    }
    res.end(APK);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  process.env.APP_RELEASE_URL = `${base}/releases/download/`;
});

afterAll(async () => {
  delete process.env.APP_RELEASE_URL;
  delete process.env.APP_CACHE_DIR;
  delete process.env.APP_APK_PATH;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
  mode = "ok";
  cache = mkdtempSync(join(tmpdir(), "apk-cache-"));
  process.env.APP_CACHE_DIR = cache;
  delete process.env.APP_APK_PATH;
  return () => rmSync(cache, { recursive: true, force: true });
});

describe("the app download", () => {
  it("fetches the APK of the server's own version once, then serves the kept copy", async () => {
    const first = await findApk();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(requests).toEqual([`/releases/download/v${APP_VERSION}/apotek-android.apk`]);
    expect(first.size).toBe(APK.length);
    expect(readFileSync(first.path).equals(APK)).toBe(true);

    const second = await findApk();
    expect(second).toEqual(first);
    expect(requests).toHaveLength(1);
  });

  it("says so when the release carries no app", async () => {
    mode = "missing";
    expect(await findApk()).toEqual({ ok: false, reason: "not_published" });
  });

  it("never keeps a download that was cut off", async () => {
    mode = "broken";
    expect(await findApk()).toEqual({ ok: false, reason: "unreachable" });
    expect(readdirSync(cache)).toEqual([]);
    mode = "ok";
    expect((await findApk()).ok).toBe(true);
  });

  it("serves a file named in APP_APK_PATH without asking the release", async () => {
    const local = join(cache, "given.apk");
    writeFileSync(local, APK);
    process.env.APP_APK_PATH = local;
    expect(await findApk()).toEqual({ ok: true, path: local, size: APK.length });
    expect(requests).toEqual([]);
  });
});
