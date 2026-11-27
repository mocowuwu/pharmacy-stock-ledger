import { afterEach, describe, expect, it, vi } from "vitest";
import type { SnapshotItem } from "@/lib/offline/contract";
import { randomId } from "../src/lib/id";
import { findByCode, searchItems } from "../src/lib/till";
import { snapshot } from "./fixtures";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("ids on a WebView without crypto.randomUUID", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses randomUUID where the WebView has it", () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  it("builds a version-4 UUID from getRandomValues where it does not", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("refuses rather than inventing an id without a secure generator", () => {
    vi.stubGlobal("crypto", {});
    expect(() => randomId()).toThrow();
  });
});

describe("the till's indexed search", () => {
  function item(over: Partial<SnapshotItem>): SnapshotItem {
    return { ...snapshot().data.items[0], ...over };
  }

  it("matches names, brands and codes, but never across two fields", () => {
    const items = [
      item({ id: "a", genericName: "Paracetamol", brandName: "Sanmol", code: "P1" }),
      item({ id: "b", genericName: "Ibuprofen", brandName: null, code: "IBU" }),
    ];
    expect(searchItems(items, "sanm").map((i) => i.id)).toEqual(["a"]);
    expect(searchItems(items, "ibu").map((i) => i.id)).toEqual(["b"]);
    // "mol" ends the generic name and "san" starts the brand: no match spans them.
    expect(searchItems(items, "molsan")).toEqual([]);
  });

  it("puts a scanned code's item first and stops at the limit", () => {
    const items = Array.from({ length: 50 }, (_, n) =>
      item({ id: `i${n}`, code: `C${n}`, genericName: "Vitamin C 89912", barcodes: n === 40 ? ["8991200000001"] : [] }),
    );
    const found = searchItems(items, "8991200000001", 5);
    expect(found[0].id).toBe("i40");
    expect(searchItems(items, "vitamin", 5)).toHaveLength(5);
  });

  it("picks the earliest item when two share a barcode, as the old walk did", () => {
    const items = [
      item({ id: "first", code: "X1", barcodes: ["08991234567890"] }),
      item({ id: "second", code: "X2", barcodes: ["8991234567890"] }),
    ];
    expect(findByCode(items, "8991234567890")?.id).toBe("first");
  });

  it("does not match a code without digits to a barcode without digits", () => {
    const items = [item({ id: "a", code: "A", barcodes: ["NOBARCODE"] })];
    expect(findByCode(items, "ZZZ")).toBeNull();
    expect(findByCode(items, "NOBARCODE")?.id).toBe("a");
  });
});
