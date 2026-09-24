import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sourceFilter } from "../installer/lib.mjs";

/**
 * The copy that turns a release into the install. An update unpacks its source
 * under `<install>/downloads/update-x.y.z`; the filter used to test absolute
 * paths, saw `downloads` in every one, and copied nothing -- so every update
 * through v0.1.4 rebuilt the old version and reported success.
 */
describe("sourceFilter", () => {
  let root: string;
  afterEach(() => rm(root, { recursive: true, force: true }));

  async function release(under: string) {
    root = await mkdtemp(join(tmpdir(), "copy-"));
    const source = join(root, under);
    for (const file of [
      "package.json",
      "src/app/page.tsx",
      "node_modules/x/index.js",
      ".next/BUILD_ID",
      ".env.local",
      ".env.development.local",
      "backups/old.dump",
    ]) {
      await mkdir(join(source, file, ".."), { recursive: true });
      await writeFile(join(source, file), "x");
    }
    return source;
  }

  it("copies a release that sits under a downloads folder", async () => {
    const source = await release("pharmacy/downloads/update-0.1.5/repo-abc123");
    const target = join(root, "pharmacy", "app");
    await cp(source, target, { recursive: true, filter: sourceFilter(source) });

    expect((await readdir(target)).sort()).toEqual(["package.json", "src"]);
    expect(await readdir(join(target, "src", "app"))).toEqual(["page.tsx"]);
  });

  it("still leaves out build output, dependencies, backups and local env files", () => {
    const source = "/home/x/pharmacy/downloads/update-0.1.5/repo";
    const keep = sourceFilter(source);
    expect(keep(source)).toBe(true);
    expect(keep(`${source}/src/lib/brand.ts`)).toBe(true);
    expect(keep(`${source}/.env.example`)).toBe(true);
    expect(keep(`${source}/node_modules`)).toBe(false);
    expect(keep(`${source}/.next/cache`)).toBe(false);
    expect(keep(`${source}/.git`)).toBe(false);
    expect(keep(`${source}/backups`)).toBe(false);
    expect(keep(`${source}/downloads`)).toBe(false);
    expect(keep(`${source}/.env.local`)).toBe(false);
    expect(keep(`${source}/.env.production.local`)).toBe(false);
  });
});
