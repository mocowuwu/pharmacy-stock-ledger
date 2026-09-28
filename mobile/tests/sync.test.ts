import { describe, expect, it } from "vitest";
import { applySyncResults } from "../src/lib/sync";
import type { QueueEntry } from "../src/storage-format";

const entry = (id: string): QueueEntry =>
  ({ sale: { clientId: id, offlineNumber: `OFF-K7Q-${id}` }, allocations: [], receipt: {} }) as unknown as QueueEntry;

describe("sync results", () => {
  it("removes answered sales, keeps the rest in order, and files history newest first", () => {
    const out = applySyncResults(
      { sales: [entry("1"), entry("2"), entry("3")] },
      { sales: [] },
      [
        { clientId: "1", status: "posted", saleNumber: "260928-0001", flags: [] },
        { clientId: "3", status: "review", flags: ["insufficient_stock"] },
      ],
      0,
    );
    expect(out.queue.sales.map((e) => e.sale.clientId)).toEqual(["2"]);
    expect(out.history.sales.map((h) => [h.clientId, h.saleNumber, h.status])).toEqual([
      ["3", null, "review"],
      ["1", "260928-0001", "posted"],
    ]);
    expect(out.answered).toBe(2);
  });
});
