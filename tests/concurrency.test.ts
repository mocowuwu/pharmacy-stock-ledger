import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { batches, items, suppliers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale, SaleError } from "@/lib/stock/sale";
import { findLedgerDrift, receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";

/**
 * Real concurrency, which needs a real Postgres server.
 *
 * PGlite serves a single connection, so `SELECT ... FOR UPDATE` parses and runs
 * but never actually contends -- the one behaviour that matters here cannot be
 * reproduced in the development database. These tests therefore skip unless
 * CONCURRENCY_DATABASE_URL points at a Postgres server:
 *
 *   createdb pharmacy_concurrency
 *   CONCURRENCY_DATABASE_URL=postgres://localhost:5432/pharmacy_concurrency npm test
 *
 * What they assert is the rule the till depends on: two cashiers reaching for
 * the last box produce one sale and one clear refusal, never a negative
 * quantity and never two sales of the same unit.
 */
const URL = process.env.CONCURRENCY_DATABASE_URL;

describe.skipIf(!URL)("two tills at once", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let cashierA: string;
  let cashierB: string;
  let supplierId: string;

  const ex = () => db as unknown as Executor;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 8 });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });

    // A clean slate, so a re-run does not inherit the previous one's stock.
    await db.execute(
      "truncate table stock_movements, sale_lines, sales, batches, items, suppliers, users restart identity cascade",
    );

    const hash = await hashPassword("a-long-enough-password");
    [{ id: cashierA }] = await db.insert(users)
      .values({ username: "kasir_a", fullName: "Kasir A", passwordHash: hash })
      .returning({ id: users.id });
    [{ id: cashierB }] = await db.insert(users)
      .values({ username: "kasir_b", fullName: "Kasir B", passwordHash: hash })
      .returning({ id: users.id });
    [{ id: supplierId }] = await db.insert(suppliers)
      .values({ name: "PT Sumber Sehat" })
      .returning({ id: suppliers.id });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function itemWithStock(code: string, qty: number) {
    const [item] = await db
      .insert(items)
      .values({
        code, genericName: `Item ${code}`, form: "tablet",
        unit: "tablet", drugClass: "bebas", defaultPrice: 1_000,
      })
      .returning({ id: items.id });

    const { batchId } = await receiveStock(ex(), {
      itemId: item.id,
      lotNumber: `${code}-1`,
      expiryDate: addDays(today(), 365),
      supplierId,
      receivedDate: today(),
      qty,
      unitCost: 500,
      performedBy: cashierA,
    });
    return { itemId: item.id, batchId };
  }

  const sell = (actorId: string, itemId: string, qty: number) =>
    db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId,
        lines: [{ itemId, qty, unitPrice: 1_000 }],
        paymentMethod: "tunai",
      }),
    );

  it("lets exactly one of two tills sell the last box", async () => {
    const { itemId, batchId } = await itemWithStock("LAST", 1);

    const results = await Promise.allSettled([
      sell(cashierA, itemId, 1),
      sell(cashierB, itemId, 1),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaleError);

    const [row] = await db
      .select({ q: batches.qtyRemaining })
      .from(batches)
      .where(eq(batches.id, batchId));
    expect(row.q).toBe(0);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("never goes negative under a burst of simultaneous sales", async () => {
    const { itemId, batchId } = await itemWithStock("BURST", 20);

    // Twenty tills each wanting three units of twenty available: some must be
    // refused, and the total sold must be exactly what was on the shelf or less.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      sell(i % 2 === 0 ? cashierA : cashierB, itemId, 3),
    );
    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThan(0);
    expect(succeeded).toBeLessThanOrEqual(6); // 20 units / 3 per sale

    const [row] = await db
      .select({ q: batches.qtyRemaining })
      .from(batches)
      .where(eq(batches.id, batchId));

    expect(row.q).toBe(20 - succeeded * 3);
    expect(row.q).toBeGreaterThanOrEqual(0);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("issues a unique sale number to every concurrent sale", async () => {
    const { itemId } = await itemWithStock("NUMS", 100);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => sell(cashierA, itemId, 1)),
    );
    const numbers = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<{ saleNumber: string }>).value.saleNumber);

    // A duplicate number on two receipts would be worse than a failed sale, so
    // the unique index must refuse rather than allow it.
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
