import { describe, expect, it } from "vitest";
import {
  checkVerifier,
  lockMinutesLeft,
  makeVerifier,
  MAX_FAILURES,
  offlineEligibility,
  reconcileUsers,
  recordFailure,
  rememberUser,
} from "../src/lib/signin";
import { cashier, HOUR, ISSUED } from "./fixtures";

describe("offline sign-in", () => {
  it("keeps a verifier that checks the password but is not the password", async () => {
    const v = await makeVerifier("correct horse battery", 1_000);
    expect(JSON.stringify(v)).not.toContain("correct horse");
    expect(await checkVerifier("correct horse battery", v)).toBe(true);
    expect(await checkVerifier("correct horse batterY", v)).toBe(false);
  });

  it("works for 24 hours after the last online sign-in, measured in offline-now", () => {
    const user = cashier({ signedInAt: new Date(ISSUED).toISOString() });
    expect(offlineEligibility(user, ISSUED + 23 * HOUR)).toBe("ok");
    expect(offlineEligibility(user, ISSUED + 24 * HOUR)).toBe("too_old");
  });

  it("refuses someone who cannot sell, or who signed in with a temporary password", () => {
    expect(offlineEligibility(cashier({ permissions: ["items.view"] }), ISSUED)).toBe("not_permitted");
    expect(offlineEligibility(cashier({ permissions: [], isOwner: true }), ISSUED)).toBe("ok");
    const temp = rememberUser(
      { users: [] },
      { ...cashier(), mustChangePassword: true },
      new Date(ISSUED).toISOString(),
      { salt: "s", hash: "h", iterations: 1 },
    );
    expect(temp.users[0].verifier).toBe(null);
    expect(offlineEligibility(temp.users[0], ISSUED)).toBe("no_verifier");
  });

  it("forgets users the server has suspended or whose password changed", () => {
    const kept = cashier({ id: "a", credentialStamp: "s1" });
    const suspended = cashier({ id: "b", credentialStamp: "s2" });
    const repassworded = cashier({ id: "c", credentialStamp: "s3" });
    const serverSays = [
      { ...kept, active: true, permissions: ["sales.create", "sales.discount"] },
      { ...suspended, active: false },
      { ...repassworded, credentialStamp: "s3-new", active: true },
    ];
    const result = reconcileUsers({ users: [kept, suspended, repassworded] }, serverSays);
    expect(result.users.map((u) => u.id)).toEqual(["a"]);
    expect(result.users[0].permissions).toContain("sales.discount");
  });

  it("locks for 15 minutes after five failures, on the monotonic clock", () => {
    let s = { failures: 0, lockedUntilElapsed: 0, bootCount: 7 };
    for (let i = 0; i < MAX_FAILURES; i += 1) s = recordFailure(s, 1_000, 7);
    expect(lockMinutesLeft(s, 1_000, 7)).toBe(15);
    expect(lockMinutesLeft(s, 1_000 + 15 * 60_000, 7)).toBe(0);
  });
});
