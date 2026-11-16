import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { createTestDb, violatedConstraint, type TestDb } from "./helpers/db";
import { batches, items, panelEntries, settings, stockMovements, taxRates, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { today } from "@/lib/format/date";
import {
  PANEL_ERROR_CODES,
  applyCostVisibility,
  decidePanelEntry,
  panelPendingCount,
  PanelError,
  listPanelRows,
  panelTotals,
  parsePanelInput,
  recordPanelEntry,
  searchPanelItems,
  voidPanelEntry,
  type PanelInput,
  type RawPanelInput,
} from "@/lib/panel/entries";
import { saleTotals } from "@/lib/stock/totals";
import id from "../src/i18n/messages/id.json";
import en from "../src/i18n/messages/en.json";

/**
 * Panel entries record medicine the pharmacy orders for a doctor. They sit
 * beside the stock ledger and never touch it, so the first thing these tests
 * pin is that nothing here writes a movement or moves a batch.
 */

let db: TestDb;
let close: () => Promise<void>;
let clerk: string;
let pharmacist: string;
let suspendedPharmacist: string;

const ex = () => db as unknown as Database;

const raw = (over: Partial<RawPanelInput> = {}): RawPanelInput => ({
  entryDate: today(),
  orderRef: "SP/2026/10/014",
  itemCode: "PARA500",
  itemName: "Paracetamol 500 mg",
  unit: "tablet",
  qty: "100",
  unitCost: "400",
  unitPrice: "650",
  partnerName: "PT Kimia Farma",
  destination: "dr. Budi",
  notes: "",
  pharmacistId: "",
  ...over,
});

const input = (over: Partial<PanelInput> = {}): PanelInput & { actorId: string } => ({
  entryDate: today(),
  orderRef: "SP/1",
  itemCode: "PARA500",
  itemName: "Paracetamol 500 mg",
  unit: "tablet",
  qty: 10,
  unitCost: 400,
  unitPrice: 650,
  partnerName: null,
  destination: "dr. Budi",
  notes: null,
  pharmacistId: null,
  actorId: clerk,
  ...over,
});

async function expectPanelError(work: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof work === "function" ? work() : work);
  } catch (error) {
    expect(error).toBeInstanceOf(PanelError);
    expect((error as PanelError).code).toBe(code);
    return;
  }
  throw new Error(`Expected PanelError ${code}, but nothing was thrown.`);
}

async function makeItem(code: string, over: Partial<typeof items.$inferInsert> = {}) {
  const [row] = await db
    .insert(items)
    .values({
      code,
      genericName: `Generic ${code}`,
      form: "tablet",
      unit: "tablet",
      drugClass: "keras",
      defaultPrice: 1_000,
      ...over,
    })
    .returning({ id: items.id });
  return row.id;
}

beforeAll(async () => {
  const made = await createTestDb();
  db = made.db;
  close = made.close;

  const [a] = await db
    .insert(users)
    .values({ username: "clerk", fullName: "Clerk", passwordHash: "x" })
    .returning({ id: users.id });
  clerk = a.id;
  const [b] = await db
    .insert(users)
    .values({ username: "apt", fullName: "Apt. Sari", passwordHash: "x", isPharmacist: true })
    .returning({ id: users.id });
  pharmacist = b.id;
  const [c] = await db
    .insert(users)
    .values({
      username: "gone",
      fullName: "Apt. Gone",
      passwordHash: "x",
      isPharmacist: true,
      status: "suspended",
    })
    .returning({ id: users.id });
  suspendedPharmacist = c.id;
});

afterAll(async () => {
  await close();
});

describe("reading a submission", () => {
  it("accepts a complete entry and reads the money as whole rupiah", () => {
    const parsed = parsePanelInput(raw({ qty: "1.000", unitCost: "1.500", unitPrice: "2,000" }));
    expect(parsed).toMatchObject({ qty: 1_000, unitCost: 1_500, unitPrice: 2_000 });
    expect(parsed.partnerName).toBe("PT Kimia Farma");
    expect(parsed.notes).toBeNull();
    expect(parsed.pharmacistId).toBeNull();
  });

  it("refuses a decimal point read as a thousands mark", () => {
    // parseFloat-style reading turns "9090.91" into 909,091 rupiah.
    expect(() => parsePanelInput(raw({ unitPrice: "9090.91" }))).toThrowError(PanelError);
  });

  it("requires both prices, and accepts an explicit zero", () => {
    // A blank price is a slip; defaulting it to zero would book an order at no cost.
    expect(() => parsePanelInput(raw({ unitCost: "" }))).toThrowError(/invalid_cost/u);
    expect(() => parsePanelInput(raw({ unitPrice: "  " }))).toThrowError(/invalid_price/u);
    expect(parsePanelInput(raw({ unitCost: "0", unitPrice: "0" }))).toMatchObject({
      unitCost: 0,
      unitPrice: 0,
    });
  });

  it.each([
    ["qty", { qty: "0" }, "invalid_quantity"],
    ["qty", { qty: "-3" }, "invalid_quantity"],
    ["qty", { qty: "abc" }, "invalid_quantity"],
    ["qty", { qty: "99999999999" }, "invalid_quantity"],
    ["code", { itemCode: "  " }, "required"],
    ["name", { itemName: "" }, "required"],
    ["unit", { unit: "" }, "required"],
    ["order", { orderRef: " " }, "order_ref_required"],
    ["recipient", { destination: "" }, "recipient_required"],
    ["date", { entryDate: "2026-02-30" }, "invalid_date"],
    ["date", { entryDate: "01/10/2026" }, "invalid_date"],
    ["notes", { notes: "x".repeat(501) }, "too_long"],
    ["pharmacist", { pharmacistId: "not-a-uuid" }, "not_a_pharmacist"],
  ] as const)("refuses a bad %s (%j)", (_label, over, code) => {
    try {
      parsePanelInput(raw(over));
    } catch (error) {
      expect((error as PanelError).code).toBe(code);
      return;
    }
    throw new Error(`Expected ${code}`);
  });

  it("refuses a date after today in the pharmacy's timezone", () => {
    expect(() => parsePanelInput(raw({ entryDate: "2031-01-01" }), "2026-10-01")).toThrowError(
      /date_in_future/u,
    );
    // Today itself is fine, and so is the past.
    expect(parsePanelInput(raw({ entryDate: "2026-10-01" }), "2026-10-01").entryDate).toBe("2026-10-01");
    expect(parsePanelInput(raw({ entryDate: "2026-09-01" }), "2026-10-01").entryDate).toBe("2026-09-01");
  });
});

describe("recording an entry", () => {
  it("writes the entry and nothing else: no ledger row, no batch moved", async () => {
    const itemId = await makeItem("LEDGER1");
    const movementsBefore = await db.select().from(stockMovements);
    const batchesBefore = await db.select().from(batches);

    const created = await recordPanelEntry(ex(), input({ itemCode: "LEDGER1" }));

    expect(created.entryNumber).toMatch(/^PNL\d{6}-0001$/u);
    expect(created.recordedBy).toBe(clerk);
    expect(await db.select().from(stockMovements)).toEqual(movementsBefore);
    expect(await db.select().from(batches)).toEqual(batchesBefore);
    expect(itemId).toBeTruthy();
  });

  it("numbers entries in sequence within a day and never reuses a number", async () => {
    const first = await recordPanelEntry(ex(), input({ orderRef: "SP/seq" }));
    const second = await recordPanelEntry(ex(), input({ orderRef: "SP/seq" }));
    const [a, b] = [first.entryNumber, second.entryNumber].map((n) => Number(n.split("-")[1]));
    expect(b).toBe(a + 1);
    expect(first.entryNumber.split("-")[0]).toBe(second.entryNumber.split("-")[0]);
  });

  it("refuses narcotics and psychotropics by catalogue code, whatever the case", async () => {
    await makeItem("NARK1", { drugClass: "narkotika" });
    await makeItem("PSIK1", { drugClass: "psikotropika" });
    await expectPanelError(recordPanelEntry(ex(), input({ itemCode: "NARK1" })), "restricted_class");
    await expectPanelError(recordPanelEntry(ex(), input({ itemCode: "psik1" })), "restricted_class");
  });

  it("accepts a catalogue item of another class, and a code the catalogue does not know", async () => {
    await makeItem("KERAS1", { drugClass: "keras" });
    await recordPanelEntry(ex(), input({ itemCode: "KERAS1" }));
    // The pharmacist's own code, as in "xxx for paracetamol".
    const manual = await recordPanelEntry(ex(), input({ itemCode: "xxx" }));
    expect(manual.itemCode).toBe("xxx");
  });

  it("names a pharmacist only if they are an active pharmacist account", async () => {
    await expectPanelError(recordPanelEntry(ex(), input({ pharmacistId: clerk })), "not_a_pharmacist");
    await expectPanelError(
      recordPanelEntry(ex(), input({ pharmacistId: suspendedPharmacist })),
      "not_a_pharmacist",
    );
    const ok = await recordPanelEntry(ex(), input({ pharmacistId: pharmacist }));
    expect(ok.pharmacistId).toBe(pharmacist);
  });
});

describe("the schema's own guards", () => {
  // An approved row names who decided and when, so a row built for another guard
  // has to carry that or the decision check refuses it first.
  const base = () => ({
    entryNumber: `T-${Math.random().toString(36).slice(2)}`,
    entryDate: today(),
    recordedBy: clerk,
    itemCode: "C",
    itemName: "N",
    unit: "u",
    decidedBy: clerk,
    decidedAt: new Date(),
  });

  it("refuses a zero or negative quantity", async () => {
    expect(await violatedConstraint(db.insert(panelEntries).values({ ...base(), qty: 0 }))).toBe(
      "panel_entries_qty_positive",
    );
  });

  it("refuses a negative price", async () => {
    expect(
      await violatedConstraint(db.insert(panelEntries).values({ ...base(), qty: 1, unitPrice: -1 })),
    ).toBe("panel_entries_money_not_negative");
  });

  it("refuses a half-made void", async () => {
    expect(
      await violatedConstraint(
        db.insert(panelEntries).values({ ...base(), qty: 1, voidedAt: new Date() }),
      ),
    ).toBe("panel_entries_void_complete");
  });

  it("refuses a duplicate number", async () => {
    const row = { ...base(), qty: 1 };
    await db.insert(panelEntries).values(row);
    expect(await violatedConstraint(db.insert(panelEntries).values(row))).toBe("panel_entries_number_idx");
  });
});

describe("voiding", () => {
  it("keeps the row, records who and why, and refuses a second void", async () => {
    const created = await recordPanelEntry(ex(), input({ orderRef: "SP/void" }));
    const voided = await voidPanelEntry(ex(), {
      entryId: created.id,
      reason: "  Typo in the price  ",
      actorId: pharmacist,
    });
    expect(voided.voidReason).toBe("Typo in the price");
    expect(voided.voidedBy).toBe(pharmacist);
    expect(voided.voidedAt).toBeInstanceOf(Date);

    const [still] = await db.select().from(panelEntries).where(eq(panelEntries.id, created.id));
    expect(still).toBeTruthy();

    await expectPanelError(
      voidPanelEntry(ex(), { entryId: created.id, reason: "again", actorId: clerk }),
      "already_voided",
    );
  });

  it("needs a reason, and an entry that exists", async () => {
    const created = await recordPanelEntry(ex(), input());
    await expectPanelError(
      voidPanelEntry(ex(), { entryId: created.id, reason: "   ", actorId: clerk }),
      "reason_required",
    );
    await expectPanelError(
      voidPanelEntry(ex(), {
        entryId: "00000000-0000-4000-8000-000000000000",
        reason: "x",
        actorId: clerk,
      }),
      "entry_not_found",
    );
    // The refused void changed nothing.
    const [row] = await db.select().from(panelEntries).where(eq(panelEntries.id, created.id));
    expect(row.voidedAt).toBeNull();
  });
});

describe("the window and the totals", () => {
  it("counts the whole of the last day, and nothing outside the range", async () => {
    // Entry dates are plain days. Compared as instants, "2026-08-15" as an upper
    // bound would have stopped at midnight and dropped everything entered that day.
    await recordPanelEntry(ex(), input({ entryDate: "2026-08-14", orderRef: "W/14" }));
    await recordPanelEntry(ex(), input({ entryDate: "2026-08-15", orderRef: "W/15" }));
    await recordPanelEntry(ex(), input({ entryDate: "2026-08-16", orderRef: "W/16" }));

    const { rows, truncated } = await listPanelRows(ex(), { from: "2026-08-15", to: "2026-08-15" });
    expect(rows.map((row) => row.orderRef)).toEqual(["W/15"]);
    expect(truncated).toBe(false);

    const wide = await listPanelRows(ex(), { from: "2026-08-14", to: "2026-08-16" });
    expect(wide.rows.map((row) => row.orderRef).sort()).toEqual(["W/14", "W/15", "W/16"]);
    // Names come from the accounts, not a bare id.
    expect(wide.rows[0].recordedBy).toBe("Clerk");
  });

  it("adds up in bigint, leaves voided entries out, and derives the margin", async () => {
    // 3,000,000 units at Rp 1,000 is Rp 3 billion on one line: past what an INT holds.
    const day = "2026-07-04";
    await recordPanelEntry(
      ex(),
      input({ entryDate: day, orderRef: "T/big", qty: 3_000_000, unitCost: 600, unitPrice: 1_000 }),
    );
    await recordPanelEntry(
      ex(),
      input({ entryDate: day, orderRef: "T/small", qty: 10, unitCost: 100, unitPrice: 150 }),
    );
    const wrong = await recordPanelEntry(
      ex(),
      input({ entryDate: day, orderRef: "T/wrong", qty: 5, unitCost: 1, unitPrice: 999_999 }),
    );
    await voidPanelEntry(ex(), { entryId: wrong.id, reason: "wrong price", actorId: clerk });

    const totals = await panelTotals(ex(), { from: day, to: day });
    expect(totals).toEqual({
      entries: 2,
      qty: 3_000_010,
      revenue: 3_000_000_000 + 1_500,
      tax: 0,
      cost: 1_800_000_000 + 1_000,
      margin: 3_000_001_500 - 1_800_001_000,
    });

    // The voided row is still listed, marked, for whoever reads the record.
    const { rows } = await listPanelRows(ex(), { from: day, to: day });
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.orderRef === "T/wrong")?.voidedAt).toBeInstanceOf(Date);
  });

  it("totals nothing for an empty window", async () => {
    expect(await panelTotals(ex(), { from: "2001-01-01", to: "2001-01-02" })).toEqual({
      entries: 0,
      qty: 0,
      revenue: 0,
      tax: 0,
      cost: 0,
      margin: 0,
    });
  });
});

describe("the item picker's search", () => {
  it("offers active items of allowed classes, matched on code, name or brand", async () => {
    await makeItem("SRCH-A", { genericName: "Amoxicillin", brandName: "Amoxan", strength: "500 mg" });
    await makeItem("SRCH-N", { genericName: "Amoxicillin narcotic twin", drugClass: "narkotika" });
    await makeItem("SRCH-X", { genericName: "Amoxicillin old", status: "archived" });

    const byName = await searchPanelItems(ex(), "amoxic");
    expect(byName.map((hit) => hit.code)).toEqual(["SRCH-A"]);
    expect(byName[0].name).toBe("Amoxicillin 500 mg (Amoxan)");

    expect((await searchPanelItems(ex(), "amoxan")).map((hit) => hit.code)).toEqual(["SRCH-A"]);
    expect((await searchPanelItems(ex(), "srch-a")).map((hit) => hit.code)).toEqual(["SRCH-A"]);
  });

  it("treats LIKE wildcards as ordinary characters and wants two letters", async () => {
    // An unescaped "%%" would match the whole catalogue.
    expect(await searchPanelItems(ex(), "%%")).toEqual([]);
    expect(await searchPanelItems(ex(), "_")).toEqual([]);
    expect(await searchPanelItems(ex(), "a")).toEqual([]);
  });

  it("caps what it returns", async () => {
    for (let i = 0; i < 25; i += 1) await makeItem(`CAP-${i}`, { genericName: `Capped drug ${i}` });
    expect(await searchPanelItems(ex(), "capped", 1_000)).toHaveLength(20);
    expect(await searchPanelItems(ex(), "capped", 0)).toHaveLength(10);
    expect(await searchPanelItems(ex(), "capped", 3)).toHaveLength(3);
  });
});

describe("who may see what the pharmacy pays", () => {
  it("removes cost and margin before the data leaves, and keeps the selling side", async () => {
    const day = "2026-06-10";
    await recordPanelEntry(
      ex(),
      input({ entryDate: day, orderRef: "C/1", qty: 7, unitCost: 4_321, unitPrice: 6_543 }),
    );
    const data = {
      rows: (await listPanelRows(ex(), { from: day, to: day })).rows,
      totals: await panelTotals(ex(), { from: day, to: day }),
    };

    const hidden = applyCostVisibility(data, false);
    expect(hidden.rows.every((row) => row.unitCost === null)).toBe(true);
    expect(hidden.totals).toEqual({ entries: 1, qty: 7, revenue: 7 * 6_543, tax: 0, cost: null, margin: null });
    // Not merely nulled in the fields a screen reads: the number is nowhere in
    // what would be serialised to the browser.
    expect(JSON.stringify(hidden)).not.toContain("4321");
    expect(JSON.stringify(hidden)).not.toContain(String(7 * 4_321));

    const shown = applyCostVisibility(data, true);
    expect(shown.rows[0].unitCost).toBe(4_321);
    expect(shown.totals.cost).toBe(7 * 4_321);
    expect(shown.totals.margin).toBe(7 * (6_543 - 4_321));
  });
});

describe("migration 0010 on rows written before it", () => {
  it("recovers the day a pharmacist chose, whatever the session timezone", async () => {
    // Build the schema as 0009 left it, write a row the old way (the chosen day as
    // UTC midnight), then apply 0010. A bare timestamptz-to-date cast in a western
    // session zone would have filed it under the day before.
    const folder = mkdtempSync(join(tmpdir(), "panel-migration-"));
    try {
      cpSync("./drizzle", folder, { recursive: true });
      const journalPath = join(folder, "meta", "_journal.json");
      const full = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { idx: number; tag: string }[];
      };
      writeFileSync(
        journalPath,
        JSON.stringify({ ...full, entries: full.entries.filter((entry) => entry.idx <= 9) }),
      );

      const client = new PGlite();
      const old = drizzle(client);
      await migrate(old, { migrationsFolder: folder });

      await client.exec(`insert into users (username, full_name, password_hash)
        values ('legacy', 'Legacy', 'x')`);
      await client.exec(`insert into panel_entries
        (entry_number, entry_date, recorded_by, item_code, item_name, unit, qty)
        select 'PANEL-2026-001', '2026-10-01T00:00:00Z', id, 'XXX', 'Paracetamol', 'tablet', 5
        from users where username = 'legacy'`);

      await client.exec(`set time zone 'America/Los_Angeles'`);
      await migrate(old, { migrationsFolder: "./drizzle" });

      const result = await client.query<{
        entry_date: string;
        order_ref: string | null;
        status: string;
        auto_decided: boolean;
        tax_mode: string | null;
        tax_amount: string;
      }>(
        `select entry_date::text as entry_date, order_ref, status::text as status,
                (decided_by = recorded_by and decided_at = created_at) as auto_decided,
                tax_mode::text as tax_mode, tax_amount::text as tax_amount
           from panel_entries`,
      );
      expect(result.rows).toEqual([
        {
          entry_date: "2026-10-01",
          order_ref: null,
          // Written before approval existed, so in effect from the moment it was saved:
          // approved by its own recorder, at that moment, with no PPN.
          status: "approved",
          auto_decided: true,
          tax_mode: null,
          tax_amount: "0",
        },
      ]);
      await client.close();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("messages", () => {
  it("has a message for every panel error code, in both languages", () => {
    for (const [locale, tree] of [["id", id], ["en", en]] as const) {
      const errors = (tree as unknown as { errors: Record<string, string> }).errors;
      for (const code of PANEL_ERROR_CODES) {
        expect(errors[code], `${locale}: errors.${code}`).toBeTruthy();
      }
    }
  });
});

describe("PPN on an order", () => {
  const taxed = (over: Partial<PanelInput> = {}) => input({ taxed: true, orderRef: "TAX/1", ...over });
  const switchTax = (values: Partial<typeof settings.$inferInsert>) =>
    db.update(settings).set(values).where(eq(settings.id, 1));

  beforeAll(async () => {
    await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
    await db.insert(taxRates).values([
      { name: "PPN", rateBps: 1100, effectiveFrom: "2020-01-01", effectiveTo: "2025-12-31" },
      { name: "PPN", rateBps: 1200, effectiveFrom: "2026-01-01" },
    ]);
  });

  it("is refused when the pharmacy charges no PPN, rather than quietly dropped", async () => {
    await switchTax({ taxEnabled: false });
    await expectPanelError(recordPanelEntry(ex(), taxed()), "tax_unavailable");
  });

  it("is refused, naming the missing rate, when none is in force on the order's day", async () => {
    await switchTax({ taxEnabled: true, taxMode: "exclusive" });
    await expectPanelError(recordPanelEntry(ex(), taxed({ entryDate: "2019-12-31" })), "no_tax_rate");
  });

  it("adds PPN on top at the rate in force on the entry's own day", async () => {
    await switchTax({ taxEnabled: true, taxMode: "exclusive" });
    const old = await recordPanelEntry(ex(), taxed({ entryDate: "2025-06-01", qty: 10, unitPrice: 1_000 }));
    const current = await recordPanelEntry(ex(), taxed({ entryDate: "2026-02-01", qty: 10, unitPrice: 1_000 }));

    expect(old).toMatchObject({ taxMode: "exclusive", taxRateBps: 1100, taxAmount: 1_100 });
    expect(current).toMatchObject({ taxMode: "exclusive", taxRateBps: 1200, taxAmount: 1_200 });
  });

  it("finds PPN inside the price when the pharmacy prices that way, and rounds like the till", async () => {
    await switchTax({ taxEnabled: true, taxMode: "inclusive" });
    const entry = await recordPanelEntry(ex(), taxed({ entryDate: "2026-02-01", qty: 7, unitPrice: 1_333 }));

    // The same function the till charges with, for the same amount.
    const till = saleTotals([{ qty: 7, unitPrice: 1_333, taxExempt: false }], 0, { mode: "inclusive", rateBps: 1200 });
    expect(entry.taxAmount).toBe(till.taxAmount);
    expect(entry).toMatchObject({ taxMode: "inclusive", taxRateBps: 1200 });
  });

  it("carries none when the order is not ticked, even where the pharmacy charges PPN", async () => {
    await switchTax({ taxEnabled: true, taxMode: "exclusive" });
    const entry = await recordPanelEntry(ex(), input({ orderRef: "TAX/none", entryDate: "2026-02-01" }));
    expect(entry).toMatchObject({ taxMode: null, taxRateBps: null, taxAmount: 0 });
  });

  it("is a snapshot: switching the mode later rewrites nothing", async () => {
    await switchTax({ taxEnabled: true, taxMode: "exclusive" });
    const entry = await recordPanelEntry(ex(), taxed({ entryDate: "2026-02-01", qty: 10, unitPrice: 1_000 }));
    await switchTax({ taxMode: "inclusive" });
    await db.update(taxRates).set({ rateBps: 5_000 }).where(eq(taxRates.effectiveFrom, "2026-01-01"));

    const [after] = await db.select().from(panelEntries).where(eq(panelEntries.id, entry.id));
    expect(after).toMatchObject({ taxMode: "exclusive", taxRateBps: 1200, taxAmount: 1_200 });
    await db.update(taxRates).set({ rateBps: 1200 }).where(eq(taxRates.effectiveFrom, "2026-01-01"));
  });

  it("is guarded by the schema: a mode needs a rate, and no mode means no tax", async () => {
    const base = {
      entryNumber: `TX-${Math.random().toString(36).slice(2)}`,
      entryDate: today(),
      recordedBy: clerk,
      itemCode: "C",
      itemName: "N",
      unit: "u",
      qty: 1,
      decidedBy: clerk,
      decidedAt: new Date(),
    };
    expect(
      await violatedConstraint(db.insert(panelEntries).values({ ...base, taxMode: "exclusive" })),
    ).toBe("panel_entries_tax_complete");
    expect(
      await violatedConstraint(db.insert(panelEntries).values({ ...base, taxAmount: 500 })),
    ).toBe("panel_entries_tax_complete");
  });
});

describe("approval", () => {
  let owner: string;
  let approver: string;
  const day = "2026-03-10";
  const asClerk = (over: Partial<PanelInput> = {}) =>
    recordPanelEntry(ex(), { ...input({ entryDate: day, orderRef: "APR/1", ...over }), actorId: clerk });
  const decide = (entryId: string, decision: "approve" | "reject", actorId: string, note = "", actorIsOwner = false) =>
    decidePanelEntry(ex(), { entryId, decision, note, actorId, actorIsOwner });
  const require = (on: boolean) =>
    db.update(settings).set({ panelApprovalRequired: on }).where(eq(settings.id, 1));

  beforeAll(async () => {
    await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
    [{ id: owner }] = await db
      .insert(users)
      .values({ username: "owner-apr", fullName: "Pemilik", passwordHash: "x", isOwner: true })
      .returning({ id: users.id });
    [{ id: approver }] = await db
      .insert(users)
      .values({ username: "mgr-apr", fullName: "Manajer", passwordHash: "x" })
      .returning({ id: users.id });
  });

  it("holds an order from anyone but the owner, when the pharmacy asks for it", async () => {
    await require(true);
    const held = await asClerk();
    expect(held).toMatchObject({ status: "pending", decidedBy: null, decidedAt: null });
  });

  it("never holds the owner's own: nobody is above them", async () => {
    await require(true);
    const entry = await recordPanelEntry(ex(), {
      ...input({ entryDate: day, orderRef: "APR/owner" }),
      actorId: owner,
      actorIsOwner: true,
    });
    expect(entry).toMatchObject({ status: "approved", decidedBy: owner });
  });

  it("approves on the spot, naming the recorder, when approval is not required", async () => {
    await require(false);
    const entry = await asClerk({ orderRef: "APR/off" });
    expect(entry).toMatchObject({ status: "approved", decidedBy: clerk });
    expect(entry.decidedAt).toBeInstanceOf(Date);
  });

  it("is decided by someone else, with the person and the time on the row", async () => {
    await require(true);
    const held = await asClerk({ orderRef: "APR/ok" });
    const approved = await decide(held.id, "approve", approver);
    expect(approved).toMatchObject({ status: "approved", decidedBy: approver, decisionNote: null });
    expect(approved.decidedAt).toBeInstanceOf(Date);
  });

  it("will not let a person decide their own order", async () => {
    await require(true);
    const held = await asClerk({ orderRef: "APR/own" });
    await expectPanelError(decide(held.id, "approve", clerk), "cannot_decide_own");
    await expectPanelError(decide(held.id, "reject", clerk, "no"), "cannot_decide_own");
    // Still waiting: the refusal changed nothing.
    const [row] = await db.select().from(panelEntries).where(eq(panelEntries.id, held.id));
    expect(row.status).toBe("pending");
  });

  it("lets the owner decide anyone's, and their own if one ever waited", async () => {
    await require(true);
    const held = await asClerk({ orderRef: "APR/by-owner" });
    expect((await decide(held.id, "approve", owner, "", true)).status).toBe("approved");

    // An owner's pending order cannot be written through the logic, so build one directly.
    const [own] = await db
      .insert(panelEntries)
      .values({
        entryNumber: `OWN-${Math.random().toString(36).slice(2)}`,
        entryDate: day,
        recordedBy: owner,
        itemCode: "X",
        itemName: "X",
        unit: "u",
        qty: 1,
        status: "pending",
      })
      .returning();
    expect((await decide(own.id, "approve", owner, "", true)).status).toBe("approved");
  });

  it("makes a refusal say why, and keeps the reason", async () => {
    await require(true);
    const held = await asClerk({ orderRef: "APR/no" });
    await expectPanelError(decide(held.id, "reject", approver, "   "), "reason_required");
    const rejected = await decide(held.id, "reject", approver, "Price not agreed");
    expect(rejected).toMatchObject({ status: "rejected", decisionNote: "Price not agreed", decidedBy: approver });
  });

  it("is final: a decided order cannot be decided again, and a rejected one cannot be voided", async () => {
    await require(true);
    const held = await asClerk({ orderRef: "APR/final" });
    await decide(held.id, "approve", approver);
    await expectPanelError(decide(held.id, "reject", owner, "changed my mind", true), "not_pending");

    const refused = await asClerk({ orderRef: "APR/dead" });
    await decide(refused.id, "reject", approver, "No");
    await expectPanelError(
      voidPanelEntry(ex(), { entryId: refused.id, reason: "x", actorId: owner }),
      "already_rejected",
    );
  });

  it("cannot decide an order that was voided while it waited", async () => {
    await require(true);
    const held = await asClerk({ orderRef: "APR/void" });
    await voidPanelEntry(ex(), { entryId: held.id, reason: "Typed twice", actorId: clerk });
    await expectPanelError(decide(held.id, "approve", approver), "already_voided");
    await expectPanelError(
      decide("00000000-0000-4000-8000-000000000000", "approve", approver),
      "entry_not_found",
    );
  });

  it("counts for nothing until approved, and only once", async () => {
    await require(true);
    const window = { from: "2026-04-01", to: "2026-04-30" };
    const held = await asClerk({ entryDate: "2026-04-10", orderRef: "APR/count", qty: 10, unitPrice: 1_000, unitCost: 600 });
    await asClerk({ entryDate: "2026-04-10", orderRef: "APR/count2", qty: 1, unitPrice: 5_000, unitCost: 1 });
    const pendingBefore = await panelPendingCount(ex());

    expect(await panelTotals(ex(), window)).toMatchObject({ entries: 0, revenue: 0, cost: 0, margin: 0 });
    // Still on the list for whoever has to decide it.
    expect((await listPanelRows(ex(), window)).rows).toHaveLength(2);

    await decide(held.id, "approve", approver);
    expect(await panelTotals(ex(), window)).toMatchObject({ entries: 1, revenue: 10_000, cost: 6_000, margin: 4_000 });
    expect(await panelPendingCount(ex())).toBe(pendingBefore - 1);
  });

  it("lists everything waiting, on any date, when asked", async () => {
    await require(true);
    const { rows } = await listPanelRows(ex(), { from: "2001-01-01", to: "2001-01-02" }, 200, { status: "pending" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "pending" && row.voidedAt === null)).toBe(true);
  });

  it("is guarded by the schema: a waiting order has no decision, a refusal has a reason", async () => {
    const base = {
      entryNumber: `DC-${Math.random().toString(36).slice(2)}`,
      entryDate: today(),
      recordedBy: clerk,
      itemCode: "C",
      itemName: "N",
      unit: "u",
      qty: 1,
    };
    // Waiting, yet already decided.
    expect(
      await violatedConstraint(
        db.insert(panelEntries).values({ ...base, status: "pending", decidedAt: new Date(), decidedBy: clerk }),
      ),
    ).toBe("panel_entries_decision_complete");
    // Approved, but nobody decided it.
    expect(
      await violatedConstraint(db.insert(panelEntries).values({ ...base, status: "approved" })),
    ).toBe("panel_entries_decision_complete");
    // Rejected without saying why.
    expect(
      await violatedConstraint(
        db.insert(panelEntries).values({ ...base, status: "rejected", decidedAt: new Date(), decidedBy: approver }),
      ),
    ).toBe("panel_entries_decision_complete");
  });
});
