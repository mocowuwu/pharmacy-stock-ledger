import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import * as schema from "@/db/schema";
import { batches, items, suppliers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale, SaleError } from "@/lib/stock/sale";
import { applyMovement, findLedgerDrift, receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";

/**
 * Real concurrency, which needs a real Postgres server.
 *
 * PGlite serves a single connection, so `SELECT ... FOR UPDATE` parses and runs
 * but never contends. These tests skip unless CONCURRENCY_DATABASE_URL points
 * at a Postgres server:
 *
 *   brew services start postgresql@18
 *   createdb pharmacy_concurrency
 *   CONCURRENCY_DATABASE_URL=postgres://127.0.0.1:5432/pharmacy_concurrency npm test
 *
 * **They are written to contend deliberately, not to hope for a race.** An
 * earlier version fired several sales with `Promise.allSettled` and asserted
 * the outcome; it passed with the row locks removed from both `sale.ts` and
 * `ledger.ts`, because the work inside each transaction takes about a
 * millisecond and the two never actually overlapped. A test that passes when
 * the thing it tests is deleted is worse than no test: it is a claim of safety
 * with nothing behind it.
 *
 * So each test below opens a real transaction, takes the batch lock itself, and
 * only then lets the application code run. The contended path is guaranteed
 * rather than likely.
 *
 * These were then checked by deleting the locks and confirming the tests fail.
 * What that exercise showed is worth recording: the sale path is protected
 * twice over. `commitSale` locks the batches it allocates from, and
 * `applyMovement` locks the batch again before moving it, so removing either
 * one on its own changes nothing -- the other still serialises the tills. Only
 * with both gone do these tests fail, which is the honest claim to make about
 * them. Neither lock is redundant, though: `applyMovement` is the chokepoint
 * every other path goes through, and receiving, adjustments, returns and
 * disposals have no second lock behind them.
 */
const URL = process.env.CONCURRENCY_DATABASE_URL;

/** Long enough that a query which is not blocked would certainly have finished. */
const BLOCKED_FOR_MS = 300;

describe.skipIf(!URL)("two tills at once", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let cashierA: string;
  let cashierB: string;
  let supplierId: string;

  const ex = () => db as unknown as Executor;

  beforeAll(async () => {
    // Room for the blocker plus every contender, or the test would deadlock on
    // the pool rather than on the row and prove nothing.
    pool = new Pool({ connectionString: URL, max: 16 });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });

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

  /**
   * Holds an exclusive lock on one batch until released.
   *
   * This is the starting gun. Everything queued behind it is provably waiting
   * on the row rather than merely likely to be.
   */
  async function holdBatchLock(batchId: string) {
    const client: PoolClient = await pool.connect();
    await client.query("begin");
    await client.query("select id from batches where id = $1 for update", [batchId]);
    return async () => {
      await client.query("commit");
      client.release();
    };
  }

  const settled = async (promise: Promise<unknown>) => {
    let done = false;
    void promise.then(
      () => (done = true),
      () => (done = true),
    );
    await new Promise((resolve) => setTimeout(resolve, BLOCKED_FOR_MS));
    return done;
  };

  it("makes a movement wait for the batch lock rather than reading past it", async () => {
    const { batchId } = await itemWithStock("LOCK", 10);

    const release = await holdBatchLock(batchId);

    const movement = db.transaction(async (tx) =>
      applyMovement(tx as unknown as Executor, {
        batchId,
        type: "adjust",
        qtyDelta: -1,
        performedBy: cashierA,
        reason: "Uji kunci",
      }),
    );

    // With the lock gone this resolves immediately against stale data, which is
    // exactly the bug the lock exists to prevent.
    expect(await settled(movement)).toBe(false);

    await release();
    await expect(movement).resolves.toMatchObject({ qtyAfter: 9 });
  });

  it("lets exactly one of two tills sell the last box", async () => {
    const { itemId, batchId } = await itemWithStock("LAST", 1);

    // Both tills are started while the row is locked, so both are inside
    // `commitSale` and waiting before either can read the quantity.
    const release = await holdBatchLock(batchId);
    const attempts = [sell(cashierA, itemId, 1), sell(cashierB, itemId, 1)];
    const results = Promise.allSettled(attempts);

    expect(await settled(results)).toBe(false);
    await release();

    const outcome = await results;
    const ok = outcome.filter((r) => r.status === "fulfilled");
    const failed = outcome.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaleError);
    expect((failed[0] as PromiseRejectedResult).reason.code).toBe("insufficient_stock");

    const [row] = await db
      .select({ q: batches.qtyRemaining })
      .from(batches)
      .where(eq(batches.id, batchId));
    expect(row.q).toBe(0);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("never goes negative when more tills want stock than there is stock", async () => {
    const { itemId, batchId } = await itemWithStock("BURST", 20);

    const release = await holdBatchLock(batchId);
    // Ten tills, three units each: thirty wanted, twenty available.
    const attempts = Array.from({ length: 10 }, (_, i) =>
      sell(i % 2 === 0 ? cashierA : cashierB, itemId, 3),
    );
    const results = Promise.allSettled(attempts);

    expect(await settled(results)).toBe(false);
    await release();

    const outcome = await results;
    const succeeded = outcome.filter((r) => r.status === "fulfilled").length;

    // Six sales of three fit into twenty; the remaining four must be refused,
    // and the two leftover units must still be on the shelf.
    expect(succeeded).toBe(6);
    for (const failure of outcome.filter((r) => r.status === "rejected")) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(SaleError);
    }

    const [row] = await db
      .select({ q: batches.qtyRemaining })
      .from(batches)
      .where(eq(batches.id, batchId));

    expect(row.q).toBe(2);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("never issues one sale number twice", async () => {
    const { itemId, batchId } = await itemWithStock("NUMS", 100);

    const release = await holdBatchLock(batchId);
    const results = Promise.allSettled(
      Array.from({ length: 10 }, () => sell(cashierA, itemId, 1)),
    );
    expect(await settled(results)).toBe(false);
    await release();

    const outcome = await results;
    const numbers = outcome
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<{ saleNumber: string }>).value.saleNumber);

    // Two receipts carrying one number would be worse than a refused sale, so
    // the unique index refuses instead of allowing it. Whatever got through
    // must be distinct.
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.length).toBeGreaterThan(0);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });
});
