import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDb, violatedConstraint, type TestDb } from "./helpers/db";
import {
  batches,
  deviceHandoffs,
  devicePasses,
  devices,
  items,
  offlineSaleReviews,
  sales,
  settings,
  stockMovements,
  suppliers,
  userPermissions,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { findLedgerDrift, receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, dayOf, today } from "@/lib/format/date";
import { saleTotals } from "@/lib/stock/totals";
import {
  buildSnapshot,
  createHandoff,
  credentialStamp,
  deviceForToken,
  redeemHandoff,
  registerDevice,
  type DeviceRow,
} from "@/lib/offline/devices";
import { closeOfflineReview, replayOfflineSale, retryOfflineReview } from "@/lib/offline/replay";
import type { OfflineSale } from "@/lib/offline/contract";
import type { Database } from "@/db/client";

let db: TestDb;
let close: () => Promise<void>;
let cashierId: string;
let managerId: string;
let supplierId: string;
let till: DeviceRow;

const ex = () => db as unknown as Executor;
const d = () => db as unknown as Database;

async function makeItem(code: string, price = 1_000) {
  const [item] = await db
    .insert(items)
    .values({ code, genericName: `Obat ${code}`, form: "tablet", unit: "tablet", drugClass: "bebas", defaultPrice: price })
    .returning({ id: items.id });
  return item.id;
}

async function stock(itemId: string, lot: string, qty: number, days: number) {
  const { batchId } = await receiveStock(ex(), {
    itemId,
    lotNumber: lot,
    expiryDate: addDays(today(), days),
    supplierId,
    receivedDate: today(),
    qty,
    unitCost: 400,
    performedBy: managerId,
  });
  return batchId;
}

async function qtyOf(batchId: string) {
  const [row] = await db.select({ q: batches.qtyRemaining }).from(batches).where(eq(batches.id, batchId));
  return row.q;
}

async function pass(issuedAgoMs = 60_000, hours = 24) {
  const issuedAt = new Date(Date.now() - issuedAgoMs);
  const [row] = await db
    .insert(devicePasses)
    .values({
      deviceId: till.id,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + hours * 3_600_000),
      maxSales: 500,
      maxTotal: 50_000_000,
    })
    .returning();
  return row;
}

let seq = 0;
function offlineSale(passId: string, lines: OfflineSale["lines"], extra: Partial<OfflineSale> = {}): OfflineSale {
  seq += 1;
  const total = saleTotals(
    lines.map((l) => ({ ...l, taxExempt: false })),
    extra.discount ?? 0,
    null,
  ).total;
  return {
    clientId: randomUUID(),
    offlineNumber: `OFF-${till.code}-${String(seq).padStart(4, "0")}`,
    passId,
    elapsedMs: 30_000,
    deviceTime: new Date().toISOString(),
    cashierId,
    lines,
    discount: 0,
    paymentMethod: "tunai",
    tendered: null,
    notes: null,
    total,
    ...extra,
  };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();

  [{ id: cashierId }] = await db
    .insert(users)
    .values({ username: "kasir", fullName: "Siti Kasir", passwordHash: await hashPassword("a-long-enough-password"), mustChangePassword: false })
    .returning({ id: users.id });
  await db.insert(userPermissions).values([
    { userId: cashierId, permission: "sales.create" },
    { userId: cashierId, permission: "items.view" },
  ]);
  [{ id: managerId }] = await db
    .insert(users)
    .values({ username: "manajer", fullName: "Budi Manajer", passwordHash: await hashPassword("another-long-password") })
    .returning({ id: users.id });
  [{ id: supplierId }] = await db.insert(suppliers).values({ name: "PT Sumber" }).returning({ id: suppliers.id });

  const registered = await registerDevice(d(), {
    deviceId: randomUUID(),
    name: "HP Kasir",
    role: "till",
    appVersion: "1.0.0",
    presentedToken: null,
    userId: cashierId,
  });
  if (!registered.ok) throw new Error("setup");
  till = registered.device;
});

afterAll(async () => {
  await close();
});

describe("devices", () => {
  it("registers on first sign-in with a short code and a token only the phone holds", async () => {
    const id = randomUUID();
    const first = await registerDevice(d(), { deviceId: id, name: "Tablet", role: "management", appVersion: "1", presentedToken: null, userId: managerId });
    expect(first.ok && first.created).toBe(true);
    if (!first.ok || !first.token) throw new Error("expected a token");
    expect(first.device.code).toMatch(/^[A-Z2-9]{3}$/u);
    expect(first.device.tokenHash).not.toContain(first.token);

    // Signing in again with the token keeps it.
    const again = await registerDevice(d(), { deviceId: id, name: "Tablet Manajer", role: "management", appVersion: "1", presentedToken: first.token, userId: managerId });
    expect(again.ok && again.token).toBe(null);
    expect((await deviceForToken(d(), first.token)).ok).toBe(true);

    // A phone that lost its token gets a new one, and the old one stops working.
    const rotated = await registerDevice(d(), { deviceId: id, name: "Tablet", role: "management", appVersion: "1", presentedToken: null, userId: managerId });
    expect(rotated.ok && rotated.token).toBeTruthy();
    expect(await deviceForToken(d(), first.token)).toEqual({ ok: false, error: "unauthorized" });
  });

  it("refuses a revoked device everything", async () => {
    const id = randomUUID();
    const reg = await registerDevice(d(), { deviceId: id, name: "Hilang", role: "till", appVersion: "1", presentedToken: null, userId: managerId });
    if (!reg.ok || !reg.token) throw new Error("setup");
    await db.update(devices).set({ revokedAt: new Date(), revokedBy: managerId }).where(eq(devices.id, id));

    expect(await deviceForToken(d(), reg.token)).toEqual({ ok: false, error: "device_revoked" });
    expect(
      await registerDevice(d(), { deviceId: id, name: "Hilang", role: "till", appVersion: "1", presentedToken: reg.token, userId: managerId }),
    ).toEqual({ ok: false, error: "device_revoked" });
  });

  it("requires a revocation to name who did it", async () => {
    expect(
      await violatedConstraint(db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, till.id))),
    ).toBe("devices_revocation_is_attributed");
  });
});

describe("handoff", () => {
  it("signs in exactly once", async () => {
    const code = await createHandoff(d(), { deviceId: till.id, userId: cashierId });
    const first = await redeemHandoff(d(), code);
    expect(first?.user.id).toBe(cashierId);
    expect(await redeemHandoff(d(), code)).toBe(null);
  });

  it("dies after its minute", async () => {
    const code = await createHandoff(d(), { deviceId: till.id, userId: cashierId });
    await db.update(deviceHandoffs).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await redeemHandoff(d(), code)).toBe(null);
  });
});

describe("the snapshot", () => {
  it("carries sell prices and stock, never cost, and a fresh 24-hour pass", async () => {
    const itemId = await makeItem("SNAP", 2_500);
    await stock(itemId, "SNAP-1", 40, 200);

    const snap = await buildSnapshot(d(), till, [cashierId]);
    const item = snap.items.find((i) => i.id === itemId);
    expect(item?.price).toBe(2_500);
    expect(item?.batches).toEqual([
      expect.objectContaining({ lotNumber: "SNAP-1", qty: 40 }),
    ]);
    expect(JSON.stringify(snap)).not.toMatch(/unitCost|unit_cost|400/u);

    const hours = (Date.parse(snap.pass.expiresAt) - Date.parse(snap.pass.issuedAt)) / 3_600_000;
    expect(hours).toBe(24);
    expect(snap.users).toEqual([expect.objectContaining({ id: cashierId, active: true })]);
    expect(snap.users[0].permissions).toContain("sales.create");
  });

  it("changes a user's stamp when their password changes", async () => {
    const before = (await buildSnapshot(d(), till, [cashierId])).users[0].credentialStamp;
    const [user] = await db.select().from(users).where(eq(users.id, cashierId));
    expect(before).toBe(credentialStamp(user.passwordHash));
    const newHash = await hashPassword("a-completely-new-password");
    expect(credentialStamp(newHash)).not.toBe(before);
  });
});

describe("replaying offline sales", () => {
  it("books the sale on the day it was rung, keeping the receipt's temporary number", async () => {
    const itemId = await makeItem("R1", 1_000);
    const batchId = await stock(itemId, "R1-A", 20, 300);
    // Issued 30 hours ago; rung 2 hours after it was issued.
    const p = await pass(30 * 3_600_000);
    const sale = offlineSale(p.id, [{ itemId, qty: 3, unitPrice: 1_000 }], { elapsedMs: 2 * 3_600_000 });

    const result = await replayOfflineSale(d(), till, sale);
    expect(result.status).toBe("posted");
    expect(result.flags).toEqual([]);

    const [row] = await db.select().from(sales).where(eq(sales.offlineClientId, sale.clientId));
    const expectedSoldAt = p.issuedAt.getTime() + 2 * 3_600_000;
    expect(row.soldAt.getTime()).toBe(expectedSoldAt);
    expect(row.offlineNumber).toBe(sale.offlineNumber);
    expect(row.deviceId).toBe(till.id);
    expect(row.cashierId).toBe(cashierId);
    // Numbered in the series of the day it was sold, not the day it synced.
    const soldDay = dayOf(new Date(expectedSoldAt)).replaceAll("-", "").slice(2);
    expect(row.saleNumber.startsWith(`${soldDay}-`)).toBe(true);

    expect(await qtyOf(batchId)).toBe(17);
    expect(await findLedgerDrift(ex())).toEqual([]);
  });

  it("books a sale sent twice only once", async () => {
    const itemId = await makeItem("R2");
    const batchId = await stock(itemId, "R2-A", 10, 300);
    const p = await pass();
    const sale = offlineSale(p.id, [{ itemId, qty: 4, unitPrice: 1_000 }]);

    const first = await replayOfflineSale(d(), till, sale);
    const second = await replayOfflineSale(d(), till, sale);
    expect(first.status).toBe("posted");
    expect(second).toEqual({ clientId: sale.clientId, status: "duplicate", saleNumber: first.saleNumber, flags: [] });
    expect(await qtyOf(batchId)).toBe(6);
  });

  it("holds a sale whose stock is gone for review, without touching the ledger", async () => {
    const itemId = await makeItem("R3");
    const batchId = await stock(itemId, "R3-A", 2, 300);
    const p = await pass();
    const sale = offlineSale(p.id, [{ itemId, qty: 5, unitPrice: 1_000 }]);
    const movementsBefore = (await db.select().from(stockMovements)).length;

    const result = await replayOfflineSale(d(), till, sale);
    expect(result.status).toBe("review");
    expect(result.flags[0]).toBe("insufficient_stock");
    expect(await qtyOf(batchId)).toBe(2);
    expect((await db.select().from(stockMovements)).length).toBe(movementsBefore);

    const [review] = await db.select().from(offlineSaleReviews).where(eq(offlineSaleReviews.clientId, sale.clientId));
    expect(review.kind).toBe("not_posted");
    expect(review.saleId).toBe(null);
    expect((review.payload as OfflineSale).lines).toEqual(sale.lines);

    // Resending it does not make a second review.
    expect((await replayOfflineSale(d(), till, sale)).status).toBe("duplicate");

    // A retry before anything changed still cannot book it, and leaves it open.
    expect(await retryOfflineReview(d(), { reviewId: review.id, actorId: managerId, note: "coba lagi" })).toEqual({
      ok: false,
      code: "insufficient_stock",
    });

    // Once the delivery is in, the manager books it -- as the cashier who rang it.
    await stock(itemId, "R3-B", 10, 400);
    const retried = await retryOfflineReview(d(), { reviewId: review.id, actorId: managerId, note: "stok diterima" });
    expect(retried.ok).toBe(true);
    const [booked] = await db.select().from(sales).where(eq(sales.offlineClientId, sale.clientId));
    expect(booked.cashierId).toBe(cashierId);
    const [closed] = await db.select().from(offlineSaleReviews).where(eq(offlineSaleReviews.id, review.id));
    expect(closed.resolvedBy).toBe(managerId);
    expect(closed.saleId).toBe(booked.id);
    expect(await findLedgerDrift(ex())).toEqual([]);
  });

  it("books but flags a sale rung at a price that has since changed", async () => {
    const itemId = await makeItem("R4", 1_500);
    await stock(itemId, "R4-A", 10, 300);
    const p = await pass();
    const sale = offlineSale(p.id, [{ itemId, qty: 1, unitPrice: 1_200 }]);

    const result = await replayOfflineSale(d(), till, sale);
    expect(result.status).toBe("review");
    expect(result.saleNumber).toBeTruthy();
    expect(result.flags).toEqual(["price_differs"]);
    const [review] = await db.select().from(offlineSaleReviews).where(eq(offlineSaleReviews.clientId, sale.clientId));
    expect(review.kind).toBe("flagged");
    expect(review.saleId).not.toBe(null);

    expect(await closeOfflineReview(d(), { reviewId: review.id, actorId: managerId, note: "harga lama, benar" })).toBe(true);
    expect(await closeOfflineReview(d(), { reviewId: review.id, actorId: managerId, note: "lagi" })).toBe(false);
  });

  it("flags a cashier suspended since the sale, and one who may not give discounts", async () => {
    const itemId = await makeItem("R5");
    await stock(itemId, "R5-A", 10, 300);
    const p = await pass();
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, cashierId));
    const result = await replayOfflineSale(
      d(),
      till,
      offlineSale(p.id, [{ itemId, qty: 1, unitPrice: 1_000 }], { discount: 100 }),
    );
    await db.update(users).set({ status: "active" }).where(eq(users.id, cashierId));

    expect(result.status).toBe("review");
    expect(result.flags).toEqual(expect.arrayContaining(["cashier_inactive", "discount_without_permission"]));
  });

  it("dates a sale from the pass, never in the future, and flags one outside its pass", async () => {
    const itemId = await makeItem("R6");
    await stock(itemId, "R6-A", 10, 300);
    const p = await pass(60_000);
    const sale = offlineSale(p.id, [{ itemId, qty: 1, unitPrice: 1_000 }], { elapsedMs: 40 * 3_600_000 });
    const before = Date.now();

    const result = await replayOfflineSale(d(), till, sale);
    expect(result.flags).toContain("outside_pass");
    const [row] = await db.select().from(sales).where(eq(sales.offlineClientId, sale.clientId));
    expect(row.soldAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row.soldAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("flags a pass the server never issued to this device", async () => {
    const itemId = await makeItem("R7");
    await stock(itemId, "R7-A", 10, 300);
    const result = await replayOfflineSale(d(), till, offlineSale(randomUUID(), [{ itemId, qty: 1, unitPrice: 1_000 }]));
    expect(result.flags).toContain("unknown_pass");
  });

  it("refuses expired stock on replay, as the counter does", async () => {
    const itemId = await makeItem("R8");
    const batchId = await stock(itemId, "R8-A", 10, 5);
    // Expired since the phone last synced.
    await db.execute(sql`update batches set expiry_date = ${addDays(today(), -1)} where id = ${batchId}`);
    const p = await pass();
    const result = await replayOfflineSale(d(), till, offlineSale(p.id, [{ itemId, qty: 1, unitPrice: 1_000 }]));
    expect(result.status).toBe("review");
    expect(result.flags[0]).toBe("insufficient_stock");
    expect(await qtyOf(batchId)).toBe(10);
  });
});

describe("offline schema guards", () => {
  it("keeps an offline sale's three markers together", async () => {
    expect(
      await violatedConstraint(
        db.insert(sales).values({
          saleNumber: "990101-9999",
          cashierId,
          subtotal: 0,
          total: 0,
          paymentMethod: "tunai",
          offlineClientId: randomUUID(),
        }),
      ),
    ).toBe("sales_offline_is_complete");
  });

  it("refuses a flagged review with no booked sale", async () => {
    expect(
      await violatedConstraint(
        db.insert(offlineSaleReviews).values({
          kind: "flagged",
          deviceId: till.id,
          clientId: randomUUID(),
          offlineNumber: "OFF-XXX-0001",
          cashierId,
          soldAt: new Date(),
          reasons: ["price_differs"],
          payload: {},
        }),
      ),
    ).toBe("offline_sale_reviews_flagged_is_booked");
  });

  it("refuses a resolution that does not say who or why", async () => {
    const [row] = await db
      .insert(offlineSaleReviews)
      .values({
        kind: "not_posted",
        deviceId: till.id,
        clientId: randomUUID(),
        offlineNumber: "OFF-XXX-0002",
        cashierId,
        soldAt: new Date(),
        reasons: ["insufficient_stock"],
        payload: {},
      })
      .returning();
    expect(
      await violatedConstraint(
        db.update(offlineSaleReviews).set({ resolvedAt: new Date() }).where(eq(offlineSaleReviews.id, row.id)),
      ),
    ).toBe("offline_sale_reviews_resolution_is_explained");
  });
});
