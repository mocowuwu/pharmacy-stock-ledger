import { describe, expect, it } from "vitest";
import id from "./messages/id.json";
import en from "./messages/en.json";
import { LOCALES } from "./config";
import { PERMISSION_GROUPS } from "@/lib/auth/permissions";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

/**
 * Bilingual discipline decays silently: a feature ships with English strings,
 * the Indonesian catalogue is updated "later", and the gap only surfaces when
 * a cashier sees a raw message key. These tests are the thing that stops it.
 */
describe("message catalogues", () => {
  const idKeys = flatten(id as Tree);
  const enKeys = flatten(en as Tree);

  it("cover exactly the same keys", () => {
    expect(new Set(idKeys)).toEqual(new Set(enKeys));
  });

  it("has no empty strings in either language", () => {
    for (const [locale, tree] of [["id", id], ["en", en]] as const) {
      for (const key of flatten(tree as Tree)) {
        const value = key.split(".").reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown>)[part],
          tree,
        );
        expect(value, `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("uses the same interpolation placeholders in both languages", () => {
    const placeholders = (tree: Tree, key: string): string[] => {
      const value = key.split(".").reduce<unknown>(
        (acc, part) => (acc as Record<string, unknown>)[part],
        tree,
      ) as string;
      return [...value.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).sort();
    };
    for (const key of idKeys) {
      expect(placeholders(id as Tree, key), key).toEqual(placeholders(en as Tree, key));
    }
  });

  it("labels every enum value the database can store", () => {
    // Enums store stable keys and render through the catalogue, so a value
    // without a label would reach the screen as a raw key like "bebas_terbatas".
    const required: Record<string, readonly string[]> = {
      drugClass: ["bebas","bebas_terbatas","keras","owa","psikotropika","narkotika","jamu","oht","fitofarmaka","alkes","consumable"],
      paymentMethod: ["tunai","kartu_debit","kartu_kredit","qris","transfer","lainnya"],
      movementType: ["opening","receive","sale","sale_void","return","adjust","dispose"],
      batchStatus: ["active","quarantined","expired","disposed","depleted"],
      alertType: ["expired_stock","out_of_stock","expiring_urgent","low_stock","expiring_notice","dead_stock"],
      alertSeverity: ["critical","warning","notice"],
    };
    for (const [group, values] of Object.entries(required)) {
      for (const locale of LOCALES) {
        const tree = (locale === "id" ? id : en) as unknown as Record<string, Record<string, string>>;
        for (const value of values) {
          expect(tree[group]?.[value], `${locale}:${group}.${value}`).toBeTruthy();
        }
      }
    }
  });
});

describe("permission catalogue", () => {
  it("has no duplicate keys across groups", () => {
    const all = Object.values(PERMISSION_GROUPS).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses a consistent area.action shape", () => {
    for (const p of Object.values(PERMISSION_GROUPS).flat()) {
      expect(p, p).toMatch(/^[a-z_]+\.[a-z_]+$/u);
    }
  });
});
