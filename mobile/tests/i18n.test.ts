import { describe, expect, it } from "vitest";
import { en, id } from "../src/i18n";
import { DRUG_CLASSES } from "@/lib/catalogue/enums";
import { PAYMENT_METHODS } from "@/lib/offline/contract";

describe("the app's messages", () => {
  it("cover the same keys in both languages, with the same placeholders", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/gu)].map((m) => m[1]).sort();
    for (const key of Object.keys(id) as Array<keyof typeof id>) {
      expect(vars(en[key]), key).toEqual(vars(id[key]));
    }
  });

  it("name every drug class and payment method the server can send", () => {
    for (const c of DRUG_CLASSES) expect(id, c).toHaveProperty([`drugClass.${c}`]);
    for (const m of PAYMENT_METHODS) expect(id, m).toHaveProperty([`payment.${m}`]);
  });
});
