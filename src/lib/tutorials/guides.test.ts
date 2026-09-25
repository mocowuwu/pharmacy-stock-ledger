import { describe, expect, it } from "vitest";
import id from "@/i18n/messages/id.json";
import en from "@/i18n/messages/en.json";
import { PERMISSION_TEMPLATES, type Grant } from "@/lib/auth/permissions";
import { MODULES, type ModuleFlags } from "@/lib/catalogue/modules";
import { GUIDES, guidesFor } from "./guides";

type Tree = Record<string, unknown>;

function at(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => (acc as Tree | undefined)?.[part], tree);
}

const allOn = Object.fromEntries(MODULES.map((m) => [m, true])) as ModuleFlags;
const owner: Grant = { isOwner: true, permissions: new Set() };
const staff = (template: keyof typeof PERMISSION_TEMPLATES): Grant => ({
  isOwner: false,
  permissions: new Set(PERMISSION_TEMPLATES[template]),
});
const keys = (grant: Grant, flags = allOn) => guidesFor({ grant, flags }).map((g) => g.key);

describe("tutorial guides", () => {
  it("have their words in both languages, and a tip or warning exactly where one is flagged", () => {
    for (const [locale, messages] of [["id", id], ["en", en]] as const) {
      for (const guide of GUIDES) {
        const base = `guides.items.${guide.key}`;
        expect(at(messages, `${base}.title`), `${locale}:${base}.title`).toBeTypeOf("string");
        expect(at(messages, `${base}.summary`), `${locale}:${base}.summary`).toBeTypeOf("string");
        const written = Object.keys(at(messages, `${base}.sections`) as Tree);
        expect(written.sort(), `${locale}:${base}.sections`).toEqual(
          guide.sections.map((s) => s.id).sort(),
        );
        for (const section of guide.sections) {
          const path = `${base}.sections.${section.id}`;
          expect(at(messages, `${path}.title`), `${locale}:${path}.title`).toBeTypeOf("string");
          const steps = Object.keys((at(messages, `${path}.steps`) ?? {}) as Tree);
          expect(steps.length, `${locale}:${path}.steps`).toBeGreaterThan(0);
          // Numbered from 1 with no gaps, or a step silently goes missing.
          expect(steps, `${locale}:${path}.steps`).toEqual(steps.map((_, i) => String(i + 1)));
          expect(at(messages, `${path}.tip`) !== undefined, `${locale}:${path}.tip`).toBe(!!section.tip);
          expect(at(messages, `${path}.warn`) !== undefined, `${locale}:${path}.warn`).toBe(!!section.warn);
        }
      }
    }
  });

  it("have the same number of steps in both languages", () => {
    // The parity test would catch this too, but this names the section.
    for (const guide of GUIDES) {
      for (const section of guide.sections) {
        const path = `guides.items.${guide.key}.sections.${section.id}.steps`;
        const count = (tree: unknown) => Object.keys(at(tree, path) as Tree).length;
        expect(count(id), path).toBe(count(en));
      }
    }
  });

  it("only tour screens that exist in the menu", () => {
    const menu = Object.keys(en.tutorial.chapters);
    for (const guide of GUIDES) {
      for (const key of guide.tour) expect(menu, `${guide.key} tours ${key}`).toContain(key);
    }
  });

  it("give a cashier the till and not the back office", () => {
    const cashier = keys(staff("cashier"));
    expect(cashier[0]).toBe("start");
    expect(cashier).toContain("cashier");
    expect(cashier).toContain("alerts");
    for (const hidden of ["setup", "delivery", "medicines", "reports", "accounts", "settings", "returns"]) {
      expect(cashier).not.toContain(hidden);
    }
  });

  it("give a stock clerk deliveries, new medicines, counts and disposal", () => {
    const clerk = keys(staff("stock_clerk"));
    for (const shown of ["delivery", "medicines", "counts", "disposal", "suppliers"]) {
      expect(clerk).toContain(shown);
    }
    expect(clerk).not.toContain("cashier");
  });

  it("cut a guide down to the sections the account can use", () => {
    const [cashierGuide] = guidesFor({ grant: staff("cashier"), flags: allOn }).filter(
      (g) => g.key === "cashier",
    );
    const sections = cashierGuide.sections.map((s) => s.id);
    expect(sections).toContain("batchOverride"); // in the cashier template
    expect(sections).not.toContain("discount");
    expect(sections).not.toContain("price");
  });

  it("keep the setup guide and clearing the demo data for the owner alone", () => {
    const manager: Grant = {
      isOwner: false,
      permissions: new Set([...PERMISSION_TEMPLATES.manager, "settings.manage"]),
    };
    expect(keys(manager)).not.toContain("setup");
    const settings = guidesFor({ grant: manager, flags: allOn }).find((g) => g.key === "settings");
    expect(settings?.sections.map((s) => s.id)).not.toContain("demo");

    expect(keys(owner)).toEqual(GUIDES.map((g) => g.key));
  });

  it("hide a switched-off module's guide, like its menu entry", () => {
    const flags = { ...allOn, dispose: false, counts: false, returns: false };
    const shown = keys(owner, flags);
    expect(shown).not.toContain("disposal");
    expect(shown).not.toContain("counts");
    // Voids still happen with returns switched off, so the guide stays for them.
    const returns = guidesFor({ grant: owner, flags }).find((g) => g.key === "returns");
    expect(returns?.sections.map((s) => s.id)).toEqual(["which", "void"]);
  });
});
