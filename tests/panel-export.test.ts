import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createTestDb, type TestDb } from "./helpers/db";
import { users } from "@/db/schema";
import type { Database } from "@/db/client";
import { toCsv } from "@/lib/format/csv";
import { buildXlsx } from "@/lib/format/xlsx";
import {
  applyCostVisibility,
  listPanelRows,
  panelTotals,
  recordPanelEntry,
  voidPanelEntry,
  type PanelInput,
} from "@/lib/panel/entries";
import { buildPanelExportModel, type Translate } from "@/lib/panel/export";
import { csvRows, workbook, type WorkbookHead } from "@/lib/reports/export-file";
import id from "@/i18n/messages/id.json";
import en from "@/i18n/messages/en.json";

let db: TestDb;
let close: () => Promise<void>;
let clerk: string;
let boss: string;

const ex = () => db as unknown as Database;

/** A translator over a real catalogue: a key that is not there throws, so a
 *  missing string in either language fails here and not on a pharmacist's screen. */
function translator(messages: unknown): Translate {
  return (key, values) => {
    const found = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    if (typeof found !== "string") throw new Error(`missing message: ${key}`);
    return found.replace(/\{(\w+)\}/gu, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  };
}

const input = (over: Partial<PanelInput> = {}): PanelInput & { actorId: string } => ({
  entryDate: "2026-05-10",
  orderRef: "SP/1",
  itemCode: "PARA500",
  itemName: "Paracetamol 500 mg",
  unit: "tablet",
  qty: 10,
  unitCost: 400,
  unitPrice: 650,
  partnerName: "PT Kimia Farma",
  destination: "dr. Budi",
  notes: null,
  pharmacistId: null,
  actorId: clerk,
  ...over,
});

const range = { from: "2026-05-01", to: "2026-05-31" };

async function dataFor(canSeeCost: boolean, window = range) {
  const { rows } = await listPanelRows(ex(), window, null);
  const totals = await panelTotals(ex(), window);
  return { canSeeCost, ...applyCostVisibility({ rows, totals }, canSeeCost) };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [a] = await db
    .insert(users)
    .values({ username: "clerk", fullName: "Clerk", passwordHash: "x" })
    .returning({ id: users.id });
  clerk = a.id;
  const [b] = await db
    .insert(users)
    .values({ username: "boss", fullName: "Bu Bos", passwordHash: "x", isPharmacist: true })
    .returning({ id: users.id });
  boss = b.id;

  await recordPanelEntry(ex(), input({ orderRef: "SP/A", qty: 100, unitCost: 1_200, unitPrice: 1_500 }));
  await recordPanelEntry(
    ex(),
    input({ orderRef: "SP/B", itemCode: "AMOX1", itemName: "Amoxicillin, 500 mg", qty: 20, unitCost: 900, unitPrice: 1_100 }),
  );
  const wrong = await recordPanelEntry(
    ex(),
    input({ orderRef: "SP/C", qty: 5, unitCost: 4_321, unitPrice: 6_543, notes: 'Said "urgent"' }),
  );
  await voidPanelEntry(ex(), { entryId: wrong.id, reason: "Wrong price, re-entered", actorId: boss });
});

afterAll(async () => {
  await close();
});

describe("the panel export model", () => {
  it("lists the entries in effect, adds them up, and ties to the summary", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const [entries] = model.tables;

    expect(model.name).toBe("panel-apotek");
    expect(entries.rows).toHaveLength(2);
    expect(entries.rows.map((row) => row[2]).sort()).toEqual(["SP/A", "SP/B"]);

    // The totals row is summed from the rows, and equals the statement above it.
    const labels = entries.columns.map((column) => column.label);
    const at = (label: string) => labels.indexOf(label);
    const total = entries.totals as (string | number | null)[];
    const revenue = 100 * 1_500 + 20 * 1_100;
    const cost = 100 * 1_200 + 20 * 900;
    expect(total[at("Total sold")]).toBe(revenue);
    expect(total[at("Total cost")]).toBe(cost);
    expect(total[at("Margin")]).toBe(revenue - cost);

    const figure = (label: string) => model.summary.find((line) => line.label === label)?.value;
    expect(figure("Total sales")).toBe(revenue);
    expect(figure("Total cost")).toBe(cost);
    expect(figure("Margin")).toBe(revenue - cost);
    expect(figure("Entries")).toBe(2);
    expect(figure("Items ordered")).toBe(120);
  });

  it("keeps a voided entry out of every column that is summed, and on a sheet of its own", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const [, voided] = model.tables;

    expect(voided.title).toBe("Voided entries");
    expect(voided.rows).toHaveLength(1);
    const row = voided.rows[0];
    expect(row).toContain("SP/C");
    expect(row).toContain("Bu Bos");
    expect(row).toContain("Wrong price, re-entered");
    expect(model.notes).toHaveLength(1);

    // Not in the first table at all, and so not in the CSV.
    const [primary] = model.tables;
    expect(JSON.stringify(primary.rows)).not.toContain("SP/C");
  });

  it("writes the CSV with money as plain integers and commas and quotes escaped", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const [primary] = model.tables;
    const csv = toCsv(primary.columns.map((column) => column.label), csvRows(primary));

    expect(csv.startsWith("﻿")).toBe(true);
    // 100 x 1,500: a number a spreadsheet can sum, never "Rp 150.000".
    expect(csv).toContain(",150000,");
    expect(csv).not.toMatch(/Rp|150\.000/u);
    // A comma inside a name does not break the row into another column.
    expect(csv).toContain('"Amoxicillin, 500 mg"');
  });

  it("gives a reader without cost access no cost columns and no cost anywhere", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(false));
    const [entries] = model.tables;
    const labels = entries.columns.map((column) => column.label);

    for (const hidden of ["Purchase price / unit", "Total cost", "Margin"]) {
      expect(labels).not.toContain(hidden);
    }
    expect(model.summary.map((line) => line.label)).toEqual(["Entries", "Items ordered", "Total sales"]);
    // Every row is as wide as its header: no stray cell where a column was dropped.
    for (const row of entries.rows) expect(row).toHaveLength(labels.length);
    expect((entries.totals ?? []).length).toBe(labels.length);

    // The voided entry's cost (4,321 a unit, 21,605 in all) is nowhere in the file.
    const everything = JSON.stringify(model);
    expect(everything).not.toContain("4321");
    expect(everything).not.toContain("21605");
    expect(everything).not.toContain("1200");
  });

  it("has every string it needs in both languages", async () => {
    const data = await dataFor(true);
    for (const messages of [en, id]) {
      expect(() => buildPanelExportModel(translator(messages), data)).not.toThrow();
    }
    // The file name is the same in both.
    expect(buildPanelExportModel(translator(id), data).name).toBe("panel-apotek");
  });

  it("includes every row, not only the first screen of them", async () => {
    const window = { from: "2026-06-01", to: "2026-06-30" };
    for (let i = 0; i < 205; i += 1) {
      await recordPanelEntry(ex(), input({ entryDate: "2026-06-15", orderRef: `BULK/${i}`, qty: 1 }));
    }
    // The screen is capped and says so; the download is the whole record.
    const screen = await listPanelRows(ex(), window);
    expect(screen.rows).toHaveLength(200);
    expect(screen.truncated).toBe(true);

    const model = buildPanelExportModel(translator(en), await dataFor(true, window));
    expect(model.tables[0].rows).toHaveLength(205);
    expect(model.tables).toHaveLength(1); // nothing voided in June, so no empty sheet
    expect(model.notes).toEqual([]);
  });
});

describe("the panel workbook", () => {
  const head: WorkbookHead = {
    business: "Clinic Pharmacy",
    title: "Panel Apotek",
    period: "2026-05-01 — 2026-05-31",
    previous: null,
    printed: "Generated by Clerk, now",
    labels: {
      summary: "Summary",
      figure: "Figure",
      value: "This period",
      previous: "Previous period",
      change: "Change",
      comparedWith: "Compared with the period:",
      notes: "Notes",
    },
  };

  it("has a summary sheet, an entries sheet and a voided sheet, with figures as numbers", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const files = unzipSync(buildXlsx(workbook(model, head)));

    const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet name="([^"]+)"/gu)].map((m) => m[1]);
    expect(names).toEqual(["Summary", "Entries", "Voided entries"]);

    // 100 x 1,500 is stored as the number 150000, not as the text "150.000".
    const entries = strFromU8(files["xl/worksheets/sheet2.xml"]);
    expect(entries).toMatch(/<c r="[A-Z]+\d+" s="\d+"><v>150000<\/v><\/c>/u);
    expect(entries).not.toContain("150.000");
    // The letterhead is on every sheet, so a copied sheet still says whose it is.
    for (const sheet of ["sheet1", "sheet2", "sheet3"]) {
      expect(strFromU8(files[`xl/worksheets/${sheet}.xml`])).toContain("Clinic Pharmacy");
    }
  });
});
