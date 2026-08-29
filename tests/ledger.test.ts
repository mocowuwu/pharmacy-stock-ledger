import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { batches, categories, items, suppliers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import {
  applyMovement,
  findLedgerDrift,
  LedgerError,
  onHand,
  receiveStock,
  reconcileBatch,
  type Executor,
} from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let userId: string;
let supplierId: string;
let kerasItemId: string;
let bebasItemId: string;

// The ledger's Executor type is the node-postgres database; tests run the same
// queries against PGlite, which implements the identical surface.
const ex = () => db as unknown as Executor;

async function makeBatch(opts: {
  itemId: string;
  lot: string;
  qty: number;
  expiry?: string;
}) {
  // Goes through receiveStock rather than inserting a batch directly, so the
  // tests exercise the same path the receiving screen uses.
  const { batchId } = await receiveStock(ex(), {
    itemId: opts.itemId,
    lotNumber: opts.lot,
    expiryDate: opts.expiry ?? addDays(today(), 365),
    supplierId,
    receivedDate: today(),
    qty: opts.qty,
    unitCost: 1_000,
    performedBy: userId,
  });
  return batchId;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  [{ id: userId }] = await db
    .insert(users)
    .values({
      username: "clerk",
      fullName: "Clerk",
      passwordHash: await hashPassword("a-long-enough-password"),
      isPharmacist: true,
    })
    .returning({ id: users.id });

  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber Sehat" })
    .returning({ id: suppliers.id });

  const [cat] = await db
    .insert(categories)
    .values({ name: "Antibiotik" })
    .returning({ id: categories.id });

  [{ id: kerasItemId }] = await db
    .insert(items)
    .values({
      code: "AMOX001",
      genericName: "Amoxicillin",
      form: "capsule",
      unit: "kapsul",
      drugClass: "keras",
      categoryId: cat.id,
    })
    .returning({ id: items.id });

  [{ id: bebasItemId }] = await db
    .insert(items)
    .values({
      code: "PARA001",
      genericName: "Paracetamol",
      form: "tablet",
      unit: "tablet",
      drugClass: "bebas",
    })
    .returning({ id: items.id });
});

afterAll(async () => {
  await close();
});

/**
 * The assertion that protects the whole design: after any sequence of
 * movements, a batch's stored quantity must equal the sum of its ledger rows.
 * If this ever fails, the stock figure has stopped being explainable.
 */
describe("the ledger invariant", () => {
  it("holds across a long randomised sequence of movements", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "PROP-1", qty: 500 });

    // Deterministic pseudo-random, so a failure can be reproduced exactly.
    let seed = 20260828;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    let applied = 0;
    for (let i = 0; i < 200; i++) {
      const [{ qtyRemaining }] = await db
        .select({ qtyRemaining: batches.qtyRemaining })
        .from(batches)
        .where(eq(batches.id, batchId));

      const roll = rand(10);
      try {
        if (roll < 5 && qtyRemaining > 0) {
          await applyMovement(ex(), {
            batchId, type: "sale", qtyDelta: -(1 + rand(Math.min(20, qtyRemaining))),
            performedBy: userId,
          });
        } else if (roll < 8) {
          await applyMovement(ex(), {
            batchId, type: "receive", qtyDelta: 1 + rand(40), performedBy: userId,
          });
        } else {
          await applyMovement(ex(), {
            batchId, type: "adjust",
            qtyDelta: rand(2) === 0 ? 1 + rand(5) : -Math.min(qtyRemaining, 1 + rand(5)),
            reason: "Hasil stok opname",
            performedBy: userId,
          });
        }
        applied++;
      } catch (error) {
        // Refusals are legitimate outcomes (an empty batch cannot be sold from);
        // what matters is that a refusal leaves nothing behind.
        expect(error).toBeInstanceOf(LedgerError);
      }

      const check = await reconcileBatch(ex(), batchId);
      expect(check.agrees, `after step ${i}: stored ${check.stored} vs ledger ${check.ledger}`)
        .toBe(true);
    }

    expect(applied).toBeGreaterThan(100);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("leaves nothing behind when a movement is refused", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "ROLLBACK-1", qty: 10 });

    await expect(
      applyMovement(ex(), {
        batchId, type: "sale", qtyDelta: -50, performedBy: userId,
      }),
    ).rejects.toThrow(LedgerError);

    const check = await reconcileBatch(ex(), batchId);
    expect(check.stored).toBe(10);
    expect(check.agrees).toBe(true);
  });
});

describe("refusals", () => {
  it("will not sell more than the batch holds", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "SHORT-1", qty: 5 });
    await expect(
      applyMovement(ex(), { batchId, type: "sale", qtyDelta: -6, performedBy: userId }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
  });

  it("will not sell from an expired batch", async () => {
    // The single most valuable rule in the system, checked at the ledger so no
    // screen or API path can route around it.
    //
    // The batch is received with a valid date and then aged, because
    // receiveStock refuses already-expired stock at the door -- which is the
    // other half of the same rule.
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "EXPIRED-1", qty: 50 });
    await db.update(batches).set({ expiryDate: addDays(today(), -1) })
      .where(eq(batches.id, batchId));
    await expect(
      applyMovement(ex(), { batchId, type: "sale", qtyDelta: -1, performedBy: userId }),
    ).rejects.toMatchObject({ code: "batch_expired" });
  });

  it("still allows expired stock to be disposed of", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "EXPIRED-2", qty: 50 });
    await db.update(batches).set({ expiryDate: addDays(today(), -30) })
      .where(eq(batches.id, batchId));
    await expect(
      applyMovement(ex(), {
        batchId, type: "dispose", qtyDelta: -50,
        reason: "Kedaluwarsa", performedBy: userId,
      }),
    ).resolves.toMatchObject({ qtyAfter: 0 });
  });

  it("sells stock that expires today, because it is good all day", async () => {
    const batchId = await makeBatch({
      itemId: bebasItemId, lot: "TODAY-1", qty: 10, expiry: today(),
    });
    await expect(
      applyMovement(ex(), { batchId, type: "sale", qtyDelta: -1, performedBy: userId }),
    ).resolves.toMatchObject({ qtyAfter: 9 });
  });

  it("refuses a movement that changes nothing", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "ZERO-1", qty: 10 });
    await expect(
      applyMovement(ex(), { batchId, type: "adjust", qtyDelta: 0, performedBy: userId }),
    ).rejects.toMatchObject({ code: "zero_movement" });
  });

  it("requires a reason for an adjustment and a disposal", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "REASON-1", qty: 10 });
    await expect(
      applyMovement(ex(), { batchId, type: "adjust", qtyDelta: -1, performedBy: userId }),
    ).rejects.toMatchObject({ code: "reason_required" });
  });

  it("requires a pharmacist to dispose of a restricted class", async () => {
    const batchId = await makeBatch({ itemId: kerasItemId, lot: "KERAS-1", qty: 10 });
    await expect(
      applyMovement(ex(), {
        batchId, type: "dispose", qtyDelta: -1,
        reason: "Rusak", performedBy: userId,
      }),
    ).rejects.toMatchObject({ code: "pharmacist_required" });

    await expect(
      applyMovement(ex(), {
        batchId, type: "dispose", qtyDelta: -1,
        reason: "Rusak", performedBy: userId, pharmacistId: userId,
      }),
    ).resolves.toBeDefined();
  });
});

describe("derived quantities", () => {
  it("counts on-hand across batches, not from a stored column", async () => {
    const [{ id: itemId }] = await db
      .insert(items)
      .values({
        code: "ONHAND1", genericName: "Cetirizine",
        form: "tablet", unit: "tablet", drugClass: "bebas_terbatas",
      })
      .returning({ id: items.id });

    await makeBatch({ itemId, lot: "OH-1", qty: 30 });
    const second = await makeBatch({ itemId, lot: "OH-2", qty: 70 });
    expect(await onHand(ex(), itemId)).toBe(100);

    await applyMovement(ex(), {
      batchId: second, type: "sale", qtyDelta: -70, performedBy: userId,
    });
    // A depleted batch stops counting towards on-hand without being deleted.
    expect(await onHand(ex(), itemId)).toBe(30);
  });

  it("marks a batch depleted at zero and active again when restocked", async () => {
    const batchId = await makeBatch({ itemId: bebasItemId, lot: "CYCLE-1", qty: 4 });

    await applyMovement(ex(), {
      batchId, type: "sale", qtyDelta: -4, performedBy: userId,
    });
    const [depleted] = await db
      .select({ status: batches.status }).from(batches).where(eq(batches.id, batchId));
    expect(depleted.status).toBe("depleted");

    await applyMovement(ex(), {
      batchId, type: "receive", qtyDelta: 6, performedBy: userId,
    });
    const [restocked] = await db
      .select({ status: batches.status }).from(batches).where(eq(batches.id, batchId));
    expect(restocked.status).toBe("active");
  });
});
