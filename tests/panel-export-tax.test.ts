import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { settings, taxRates, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { toCsv } from "@/lib/format/csv";
import {
  applyCostVisibility,
  decidePanelEntry,
  listPanelRows,
  panelTotals,
  recordPanelEntry,
  type PanelInput,
} from "@/lib/panel/entries";
import { buildPanelExportModel, type Translate } from "@/lib/panel/export";
import { csvRows } from "@/lib/reports/export-file";
import id from "@/i18n/messages/id.json";
import en from "@/i18n/messages/en.json";

/**
 * The Panel download with PPN and approval in play. Counted orders in the first
 * table (what the CSV carries), PPN columns only when an order has PPN, and the
 * orders that do not count -- waiting or rejected -- on a sheet of their own.
 */
let db: TestDb;
let close: () => Promise<void>;
let clerk: string;
let boss: string;

const pdb = () => db as unknown as Database;
const range = { from: "2026-05-01", to: "2026-05-31" };

function translator(messages: unknown): Translate {
  return (key, values) => {
    const found = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    if (typeof found !== "string") throw new Error(`missing message: ${key}`);
    return found.replace(/\{(\w+)\}/gu, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  };
}

const entry = (over: Partial<PanelInput>): PanelInput & { actorId: string } => ({
  entryDate: "2026-05-10",
  orderRef: "SP/1",
  itemCode: "PARA500",
  itemName: "Paracetamol 500 mg",
  unit: "tablet",
  qty: 10,
  unitCost: 400,
  unitPrice: 1_000,
  partnerName: null,
  destination: "dr. Budi",
  notes: null,
  pharmacistId: null,
  actorId: clerk,
  ...over,
});

async function dataFor(canSeeCost: boolean) {
  const { rows } = await listPanelRows(pdb(), range, null);
  const totals = await panelTotals(pdb(), range);
  return { canSeeCost, ...applyCostVisibility({ rows, totals }, canSeeCost) };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(settings).values({ id: 1, taxEnabled: true, taxMode: "exclusive" }).onConflictDoNothing();
  await db.update(settings).set({ taxEnabled: true, taxMode: "exclusive" }).where(eq(settings.id, 1));
  await db.insert(taxRates).values({ name: "PPN", rateBps: 1100, effectiveFrom: "2020-01-01" });
  [{ id: clerk }] = await db
    .insert(users)
    .values({ username: "kasir", fullName: "Siti Kasir", passwordHash: "x" })
    .returning({ id: users.id });
  [{ id: boss }] = await db
    .insert(users)
    .values({ username: "bos", fullName: "Bu Bos", passwordHash: "x", isOwner: true })
    .returning({ id: users.id });

  // 10 x 1.000 with 11% on top: PPN 1.100, paid 11.100.
  await recordPanelEntry(pdb(), entry({ orderRef: "SP/ON-TOP", taxed: true }));
  // 5 x 2.000 with PPN inside: 10.000 * 1100 / 12100 ... in whole rupiah, from the till's own arithmetic.
  await db.update(settings).set({ taxMode: "inclusive" }).where(eq(settings.id, 1));
  await recordPanelEntry(pdb(), entry({ orderRef: "SP/INSIDE", taxed: true, qty: 5, unitPrice: 2_000, unitCost: 900 }));
  // No PPN at all.
  await recordPanelEntry(pdb(), entry({ orderRef: "SP/PLAIN", qty: 2, unitPrice: 500, unitCost: 100 }));

  await db.update(settings).set({ panelApprovalRequired: true }).where(eq(settings.id, 1));
  await recordPanelEntry(pdb(), entry({ orderRef: "SP/WAITING", qty: 77, unitPrice: 7_777, unitCost: 4_321 }));
  const refused = await recordPanelEntry(pdb(), entry({ orderRef: "SP/REFUSED", qty: 66, unitPrice: 6_666 }));
  await decidePanelEntry(pdb(), {
    entryId: refused.id,
    decision: "reject",
    note: "Price not agreed",
    actorId: boss,
    actorIsOwner: true,
  });
});

afterAll(async () => close());

describe("the panel download with PPN and approval", () => {
  it("keeps waiting and rejected orders out of the table the CSV carries, and the figures with it", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const [entries] = model.tables;

    expect(entries.rows.map((row) => row[2]).sort()).toEqual(["SP/INSIDE", "SP/ON-TOP", "SP/PLAIN"]);
    const csv = toCsv(entries.columns.map((column) => column.label), csvRows(entries));
    expect(csv).not.toContain("SP/WAITING");
    expect(csv).not.toContain("SP/REFUSED");
    // Nor in any number: 77 x 7.777 = 598.829 and 66 x 6.666 = 439.956 appear nowhere.
    expect(JSON.stringify(model.summary)).not.toMatch(/598829|439956/u);
  });

  it("lists them on a sheet of their own, with who decided and why", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const pending = model.tables.find((table) => table.title === "Not counted")!;

    expect(pending.rows).toHaveLength(2);
    const waiting = pending.rows.find((row) => row.includes("SP/WAITING"))!;
    const refused = pending.rows.find((row) => row.includes("SP/REFUSED"))!;
    expect(waiting).toContain("Waiting for approval");
    expect(refused).toContain("Rejected");
    expect(refused).toContain("Bu Bos");
    expect(refused).toContain("Price not agreed");
    expect(model.notes).toHaveLength(1);
  });

  it("adds PPN columns because an order carries PPN, and the totals row ties to the summary", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const [entries] = model.tables;
    const labels = entries.columns.map((column) => column.label);
    const at = (label: string) => labels.indexOf(label);
    const total = entries.totals as (string | number | null)[];

    expect(labels).toContain("PPN");
    expect(labels).toContain("PPN mode");
    expect(total[at("PPN")]).toBe(model.summary.find((line) => line.label === "PPN")!.value);

    const sold = 10_000 + 10_000 + 1_000;
    const cost = 4_000 + 4_500 + 200;
    expect(total[at("Total sold")]).toBe(sold);
    expect(total[at("Total cost")]).toBe(cost);
    // Margin is on what is kept: the price less the PPN sitting inside it.
    const inside = entries.rows.find((row) => row.includes("SP/INSIDE"))![at("PPN")] as number;
    expect(total[at("Margin")]).toBe(sold - inside - cost);
    expect(model.summary.find((line) => line.label === "Margin")!.value).toBe(sold - inside - cost);
  });

  it("says where PPN sits, in the reader's words", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(true));
    const [entries] = model.tables;
    const mode = entries.columns.findIndex((column) => column.label === "PPN mode");
    const byRef = (ref: string) => entries.rows.find((row) => row.includes(ref))![mode];

    expect(byRef("SP/ON-TOP")).toBe("on top of the price");
    expect(byRef("SP/INSIDE")).toBe("inside the price");
    expect(byRef("SP/PLAIN")).toBe("");
  });

  it("leaves a reader without cost access with no cost and no cost in any file", async () => {
    const model = buildPanelExportModel(translator(en), await dataFor(false));
    const labels = model.tables[0].columns.map((column) => column.label);
    for (const hidden of ["Purchase price / unit", "Total cost", "Margin"]) expect(labels).not.toContain(hidden);
    for (const row of model.tables[0].rows) expect(row).toHaveLength(labels.length);
    // The waiting order's cost (4.321 a unit) is in no cell.
    expect(JSON.stringify(model)).not.toContain("4321");
  });

  it("has every string it needs in both languages", async () => {
    const data = await dataFor(true);
    for (const messages of [en, id]) {
      expect(() => buildPanelExportModel(translator(messages), data)).not.toThrow();
    }
  });

  it("omits the PPN columns for a pharmacy whose orders carry none", async () => {
    const plain = { from: "2026-06-01", to: "2026-06-30" };
    await db.update(settings).set({ panelApprovalRequired: false }).where(eq(settings.id, 1));
    await recordPanelEntry(pdb(), entry({ entryDate: "2026-06-05", orderRef: "SP/NOTAX" }));
    const { rows } = await listPanelRows(pdb(), plain, null);
    const totals = await panelTotals(pdb(), plain);
    const model = buildPanelExportModel(translator(en), {
      canSeeCost: true,
      ...applyCostVisibility({ rows, totals }, true),
    });

    expect(model.tables[0].columns.map((column) => column.label)).not.toContain("PPN");
    expect(model.summary.map((line) => line.label)).not.toContain("PPN");
    expect(model.tables).toHaveLength(1);
  });
});
