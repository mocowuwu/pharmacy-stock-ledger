import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A download inside an update runs in the installer's child process, whose
 * stdout is a pipe to the control panel rather than a terminal. The terminal
 * counter printed nothing there, and a ten-minute rclone download on a clinic
 * connection showed as ten minutes of silence.
 */
describe("download progress under the updater", () => {
  const size = 4 * 1024 * 1024;
  let server: Server;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "download-"));
    server = createServer((_, response) => {
      response.writeHead(200, { "content-length": String(size) });
      // In pieces, as a real connection delivers it.
      const piece = Buffer.alloc(size / 16);
      for (let index = 0; index < 16; index += 1) response.write(piece);
      response.end();
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    url = `http://127.0.0.1:${address.port}/file`;
  });

  afterAll(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function downloadIn(env: Record<string, string>) {
    const lib = resolve("installer/lib.mjs");
    const script = `const { download } = await import(${JSON.stringify(lib)});
      await download(${JSON.stringify(url)}, ${JSON.stringify(join(dir, "file"))});`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { ...process.env, ...env } },
    );
    return stdout.split("\n").filter(Boolean);
  }

  it("prints a whole line per tenth when the updater asks for lines", async () => {
    const lines = await downloadIn({ PHARMACY_PROGRESS: "lines" });
    expect(lines.length).toBeGreaterThanOrEqual(9);
    expect(lines.length).toBeLessThanOrEqual(11);
    for (const line of lines) {
      expect(line).toMatch(/^ {3}downloading… \d+% \(\d+\.\d of 4\.0 MB\)$/u);
    }
    const percents = lines.map((line) => Number(/(\d+)%/u.exec(line)?.[1]));
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBeGreaterThanOrEqual(90);
  });

  it("stays quiet in a pipe nobody asked to read", async () => {
    expect(await downloadIn({ PHARMACY_PROGRESS: "" })).toEqual([]);
  });
});
