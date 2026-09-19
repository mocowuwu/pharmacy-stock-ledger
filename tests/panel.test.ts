import { Script } from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * The control panel's page carries its script inside a server-side template
 * literal, so an escape meant for the browser can silently become a syntax
 * error there -- and a panel whose script does not parse shows its buttons and
 * does nothing when they are pressed. Nothing on the server would notice.
 */
describe("the control panel page", () => {
  it("serves a script that parses", async () => {
    const { page } = await import("../installer/panel.mjs");
    const html: string = page(
      [{ key: "data", path: "C:\\Users\\Apotek Sehat\\pharmacy\\data" }],
      true,
      "C:\\Users\\Apotek Sehat\\pharmacy\\pharmacy.cmd",
    );
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const source of scripts) {
      expect(() => new Script(source)).not.toThrow();
    }
  });

  it("carries the maker's mark", async () => {
    const { page } = await import("../installer/panel.mjs");
    expect(page([], false, "pharmacy")).toContain("cuanison");
  });
});
