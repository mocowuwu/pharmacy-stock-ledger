import { describe, expect, it } from "vitest";
import { checkPass, CLOCK_ROLLBACK_TOLERANCE_MS, offlineNow, saleFitsPass } from "../src/lib/pass";
import { HOUR, ISSUED, snapshot } from "./fixtures";

const snap = snapshot();
const at = (hoursAfter: number, over: Partial<{ bootCount: number; wall: number }> = {}) => ({
  elapsed: snap.receivedElapsed + hoursAfter * HOUR,
  bootCount: over.bootCount ?? snap.bootCount,
  wall: over.wall ?? ISSUED + hoursAfter * HOUR,
});

describe("the offline pass", () => {
  it("is valid for 24 hours of monotonic time and dates things from the server's clock", () => {
    const check = checkPass(snap, null, at(5), ISSUED);
    expect(check).toEqual({ ok: true, now: ISSUED + 5 * HOUR, remainingMs: 19 * HOUR });
    expect(offlineNow(snap, at(5).elapsed)).toBe(ISSUED + 5 * HOUR);
  });

  it("expires at 24 hours whatever the phone's calendar says", () => {
    expect(checkPass(snap, null, at(24), ISSUED)).toEqual({ ok: false, problem: "expired" });
    // Setting the date back does not make it young again: age is monotonic.
    expect(checkPass(snap, null, at(25, { wall: ISSUED }), ISSUED)).toEqual({ ok: false, problem: "expired" });
  });

  it("ends at a reboot, which resets the monotonic clock", () => {
    expect(checkPass(snap, null, at(1, { bootCount: 8 }), ISSUED)).toEqual({ ok: false, problem: "rebooted" });
  });

  it("locks when the wall clock is turned back past the tolerance", () => {
    const highWater = ISSUED + 3 * HOUR;
    expect(checkPass(snap, null, at(3, { wall: highWater - CLOCK_ROLLBACK_TOLERANCE_MS - 1 }), highWater)).toEqual({
      ok: false,
      problem: "clock_turned_back",
    });
    expect(checkPass(snap, null, at(3, { wall: highWater - 60_000 }), highWater).ok).toBe(true);
  });

  it("locks without a snapshot", () => {
    expect(checkPass(null, null, at(0), 0)).toEqual({ ok: false, problem: "no_snapshot" });
  });

  it("caps the number and value of sales under one pass", () => {
    const usage = { passId: "pass-1", sales: 3, total: 10_000, soldByBatch: {} };
    expect(checkPass(snap, usage, at(1), ISSUED)).toEqual({ ok: false, problem: "sales_limit" });
    const nearly = { passId: "pass-1", sales: 1, total: 95_000, soldByBatch: {} };
    expect(saleFitsPass(snap, nearly, 5_000)).toBe("ok");
    expect(saleFitsPass(snap, nearly, 5_001)).toBe("total_limit");
    // Usage recorded under an older pass does not count against this one.
    expect(saleFitsPass(snap, { ...usage, passId: "old" }, 1)).toBe("ok");
  });
});
