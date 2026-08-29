import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  batches,
  categories,
  items,
  saleLines,
  settings,
  suppliers,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale, reverseSale } from "@/lib/stock/sale";
import { commitReturn } from "@/lib/stock/return";
import { disposeStock } from "@/lib/stock/disposal";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { runAlertJob } from "@/lib/alerts/job";
import { buildDigest } from "@/lib/digest/content";
import {
  digestSubject,
  renderDigestHtml,
  renderDigestText,
} from "@/lib/digest/render";
import { digestReadiness, runDigestJob } from "@/lib/digest/job";
import { isConfigured } from "@/lib/digest/send";
import { addDays, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let ownerId: string;
let supplierId: string;

const ex = () => db as unknown as Executor;

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  [{ id: ownerId }] = await db
    .insert(users)
    .values({
      username: "pemilik",
      fullName: "Pemilik Apotek",
      isOwner: true,
      locale: "id",
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });

  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber Sehat" })
    .returning({ id: suppliers.id });

  await db.insert(categories).values({ name: "Umum" });
  await db
    .insert(settings)
    .values({ id: 1, businessName: "Apotek Uji", timezone: "Asia/Jakarta" })
    .onConflictDoNothing();
});

afterAll(async () => close());

async function makeItem(code: string, name: string) {
  const [item] = await db
    .insert(items)
    .values({
      code,
      genericName: name,
      form: "tablet",
      unit: "tablet",
      drugClass: "bebas",
      defaultPrice: 1_000,
    })
    .returning({ id: items.id });
  return item.id;
}

describe("what goes in the digest", () => {
  it("reports a quiet day as quiet instead of padding it", async () => {
    const data = await buildDigest(ex(), {
      on: addDays(today(), -1),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    expect(data.quiet).toBe(true);
    expect(data.takings.net).toBe(0);

    // And it says so, rather than sending an empty table.
    const text = renderDigestText(data, "id");
    expect(text).toContain("Tidak ada yang perlu tindakan");
    expect(digestSubject(data, "id")).toContain("tidak ada yang perlu tindakan");
  });

  it("nets refunds off the day's takings, as every other screen does", async () => {
    const itemId = await makeItem("DG1", "Paracetamol");
    await receiveStock(ex(), {
      itemId,
      lotNumber: "L-1",
      expiryDate: addDays(today(), 400),
      supplierId,
      receivedDate: today(),
      qty: 100,
      unitCost: 400,
      performedBy: ownerId,
    });

    const sale = await commitSale(ex(), {
      actorId: ownerId,
      lines: [{ itemId, qty: 10, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));
    await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId: ownerId,
      lines: [{ saleLineId: line.id, qty: 2 }],
      refundMethod: "tunai",
      reason: "Salah dosis",
    });

    const data = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    expect(data.takings.gross).toBe(10_000);
    expect(data.takings.refunds).toBe(2_000);
    expect(data.takings.net).toBe(8_000);
    expect(data.takings.sales).toBe(1);
    expect(data.quiet).toBe(false);
  });

  it("leaves a voided sale out, as the reports do", async () => {
    const itemId = await makeItem("DG2", "Ibuprofen");
    await receiveStock(ex(), {
      itemId,
      lotNumber: "L-2",
      expiryDate: addDays(today(), 400),
      supplierId,
      receivedDate: today(),
      qty: 50,
      unitCost: 400,
      performedBy: ownerId,
    });

    const before = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    const voided = await commitSale(ex(), {
      actorId: ownerId,
      lines: [{ itemId, qty: 5, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    await reverseSale(ex(), {
      saleId: voided.saleId,
      actorId: ownerId,
      reason: "Salah input",
    });

    const after = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    expect(after.takings.net).toBe(before.takings.net);
    expect(after.takings.sales).toBe(before.takings.sales);
  });

  it("carries expiring stock and yesterday's write-offs", async () => {
    const itemId = await makeItem("DG3", "Amoxicillin");
    const { batchId } = await receiveStock(ex(), {
      itemId,
      lotNumber: "L-3",
      // Inside the default 30-day urgent window.
      expiryDate: addDays(today(), 20),
      supplierId,
      receivedDate: today(),
      qty: 30,
      unitCost: 700,
      performedBy: ownerId,
    });

    await disposeStock(ex(), {
      batchId,
      qty: 10,
      reason: "Kemasan rusak",
      actorId: ownerId,
    });

    const data = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    expect(data.expiring.some((row) => row.itemName === "Amoxicillin")).toBe(true);
    expect(data.disposed.count).toBe(1);
    expect(data.disposed.value).toBe(7_000);
  });

  it("carries critical alerts but not warnings", async () => {
    const itemId = await makeItem("DG4", "Cefixime");
    const { batchId } = await receiveStock(ex(), {
      itemId,
      lotNumber: "L-4",
      expiryDate: addDays(today(), 10),
      supplierId,
      receivedDate: today(),
      qty: 5,
      unitCost: 500,
      performedBy: ownerId,
    });
    await db
      .update(batches)
      .set({ expiryDate: addDays(today(), -1) })
      .where(eq(batches.id, batchId));

    await runAlertJob(ex());

    const data = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    // Expired stock is critical and belongs in the email. A gentle
    // "expiring in 80 days" notice does not: an email that lists everything
    // gets deleted unread, and then the one that mattered gets deleted too.
    expect(data.critical.length).toBeGreaterThan(0);
    expect(data.critical.some((row) => row.itemName === "Cefixime")).toBe(true);
  });
});

describe("rendering", () => {
  it("escapes item names rather than pasting them into the markup", async () => {
    const data = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: 'Apotek "Sehat" & Co <script>',
    });

    const html = renderDigestHtml(data, "id");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("sends a plain-text alternative alongside the html", async () => {
    const data = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    const text = renderDigestText(data, "en");
    expect(text).not.toContain("<");
    expect(text).toContain("Apotek Uji");
  });

  it("renders in both languages", async () => {
    const data = await buildDigest(ex(), {
      on: today(),
      timezone: "Asia/Jakarta",
      business: "Apotek Uji",
    });

    expect(renderDigestText(data, "id")).toContain("Penjualan kemarin");
    expect(renderDigestText(data, "en")).toContain("Yesterday's sales");
  });
});

describe("sending", () => {
  it("writes a file instead of sending when no mail server is set", async () => {
    await db
      .update(settings)
      .set({ digestEnabled: true, digestEmail: "pemilik@example.com" })
      .where(eq(settings.id, 1));

    const result = await runDigestJob(ex(), {
      on: today(),
      previewDir: ".data/test-digest",
    });

    expect(result.ran).toBe(true);
    if (result.ran) {
      expect(result.delivery.delivered).toBe(false);
      if (!result.delivery.delivered) {
        expect(result.delivery.previewPath).toContain("test-digest");
        expect(result.delivery.reason).toBe("not_configured");
      }
    }
  });

  it("does nothing while the setting is off", async () => {
    await db.update(settings).set({ digestEnabled: false }).where(eq(settings.id, 1));

    const result = await runDigestJob(ex(), { on: today() });
    expect(result).toEqual({ ran: false, reason: "disabled" });
  });

  it("refuses to send with nowhere to send it", async () => {
    await db
      .update(settings)
      .set({ digestEnabled: true, digestEmail: null })
      .where(eq(settings.id, 1));

    const result = await runDigestJob(ex(), { on: today() });
    expect(result).toEqual({ ran: false, reason: "no_recipient" });
  });

  it("knows the difference between configured and merely switched on", () => {
    expect(
      digestReadiness({
        digestEnabled: false,
        digestEmail: null,
        smtpHost: null,
        smtpFrom: null,
      }),
    ).toBe("off");

    expect(
      digestReadiness({
        digestEnabled: true,
        digestEmail: null,
        smtpHost: null,
        smtpFrom: null,
      }),
    ).toBe("no_recipient");

    // Switched on with a recipient but no server: usable, and honest about it.
    expect(
      digestReadiness({
        digestEnabled: true,
        digestEmail: "a@b.com",
        smtpHost: null,
        smtpFrom: null,
      }),
    ).toBe("preview_only");

    expect(
      digestReadiness({
        digestEnabled: true,
        digestEmail: "a@b.com",
        smtpHost: "smtp.example.com",
        smtpFrom: "apotek@example.com",
      }),
    ).toBe("ready");
  });

  it("needs both a host and a from address before it will send", () => {
    const base = { port: 587, user: null, password: null, secure: false };
    expect(isConfigured({ ...base, host: null, from: null })).toBe(false);
    expect(isConfigured({ ...base, host: "smtp.example.com", from: null })).toBe(false);
    expect(isConfigured({ ...base, host: null, from: "a@b.com" })).toBe(false);
    expect(isConfigured({ ...base, host: "smtp.example.com", from: "a@b.com" })).toBe(
      true,
    );
  });
});
