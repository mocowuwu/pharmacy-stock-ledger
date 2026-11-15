import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, violatedConstraint, type TestDb } from "./helpers/db";
import { dashboardLayouts, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { DashboardError, layoutFor, saveLayout, storedLayout } from "@/lib/dashboard/layouts";
import {
  DEFAULT_LAYOUT,
  WIDGETS,
  WIDGET_PERMISSION,
  refusalToSaveLayout,
  resolveLayout,
  visibleWidgets,
} from "@/lib/dashboard/widgets";
import id from "../src/i18n/messages/id.json";
import en from "../src/i18n/messages/en.json";

let db: TestDb;
let close: () => Promise<void>;
let owner: string;
let cashier: string;

const ex = () => db as unknown as Database;
const grantOf = (isOwner: boolean, ...permissions: string[]) => ({
  isOwner,
  permissions: new Set(permissions),
});

beforeAll(async () => {
  const made = await createTestDb();
  db = made.db;
  close = made.close;
  const [o] = await db
    .insert(users)
    .values({ username: "owner", fullName: "Owner", passwordHash: "x", isOwner: true })
    .returning({ id: users.id });
  const [c] = await db
    .insert(users)
    .values({ username: "kasir", fullName: "Kasir", passwordHash: "x" })
    .returning({ id: users.id });
  owner = o!.id;
  cashier = c!.id;
});
afterAll(async () => close());

describe("who may set a dashboard", () => {
  it("refuses anyone but the owner, however valid the list", () => {
    expect(refusalToSaveLayout({ isOwner: false }, ["sales_chart"])).toBe("not_owner");
    expect(refusalToSaveLayout({ isOwner: true }, ["sales_chart"])).toBeNull();
  });

  it("refuses unknown and repeated widgets", () => {
    expect(refusalToSaveLayout({ isOwner: true }, ["nope"])).toBe("unknown_widget");
    expect(refusalToSaveLayout({ isOwner: true }, ["sales_chart", "sales_chart"])).toBe(
      "duplicate_widget",
    );
  });

  it("writes nothing when a non-owner tries", async () => {
    await expect(saveLayout(ex(), { id: cashier, isOwner: false }, cashier, ["sales_chart"])).rejects.toMatchObject({
      code: "not_owner",
    });
    expect(await storedLayout(ex(), cashier)).toBeNull();
  });
});

describe("stored layouts", () => {
  it("an untouched account is on the default, in the original order", async () => {
    expect(await layoutFor(ex(), cashier)).toEqual([...DEFAULT_LAYOUT]);
  });

  it("keeps the owner's order and omissions", async () => {
    await saveLayout(ex(), { id: owner, isOwner: true }, cashier, ["catalogue_counts", "takings_today"]);
    expect(await layoutFor(ex(), cashier)).toEqual(["catalogue_counts", "takings_today"]);
  });

  it("an empty list is a real choice, not the default", async () => {
    await saveLayout(ex(), { id: owner, isOwner: true }, cashier, []);
    expect(await layoutFor(ex(), cashier)).toEqual([]);
  });

  it("reset stores null and keeps the row and who decided", async () => {
    const { before } = await saveLayout(ex(), { id: owner, isOwner: true }, cashier, null);
    expect(before).toEqual([]);
    const [row] = await db.select().from(dashboardLayouts).where(eq(dashboardLayouts.userId, cashier));
    expect(row?.widgets).toBeNull();
    expect(row?.updatedBy).toBe(owner);
    expect(await layoutFor(ex(), cashier)).toEqual([...DEFAULT_LAYOUT]);
  });

  it("refuses an account that does not exist", async () => {
    const err = await saveLayout(ex(), { id: owner, isOwner: true }, "00000000-0000-0000-0000-000000000000", []).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(DashboardError);
    expect(err.code).toBe("user_not_found");
  });

  it("the database itself refuses a layout for a missing user", async () => {
    const name = await violatedConstraint(
      db.insert(dashboardLayouts).values({
        userId: "00000000-0000-0000-0000-000000000000",
        widgets: [],
        updatedBy: owner,
      }),
    );
    expect(name).toBe("dashboard_layouts_user_id_users_id_fk");
  });
});

describe("reading defensively", () => {
  it("drops retired and repeated keys rather than breaking the page", () => {
    expect(resolveLayout(["sales_chart", "retired_widget", "sales_chart", 7])).toEqual(["sales_chart"]);
  });

  it("null and garbage are the default", () => {
    expect(resolveLayout(null)).toEqual([...DEFAULT_LAYOUT]);
    expect(resolveLayout("sales_chart")).toEqual([...DEFAULT_LAYOUT]);
  });
});

describe("a layout is never a grant", () => {
  it("drops every widget the account has no permission for", () => {
    expect(visibleWidgets(WIDGETS, grantOf(false))).toEqual([]);
    expect(visibleWidgets(WIDGETS, grantOf(false, "items.view"))).toEqual(["catalogue_counts"]);
  });

  it("keeps the owner's order for what remains", () => {
    const layout = ["catalogue_counts", "sales_chart", "alerts_summary"] as const;
    expect(visibleWidgets(layout, grantOf(false, "alerts.view", "items.view"))).toEqual([
      "catalogue_counts",
      "alerts_summary",
    ]);
  });

  it("the owner holds every widget", () => {
    expect(visibleWidgets(WIDGETS, grantOf(true))).toEqual([...WIDGETS]);
  });

  it("every widget names a permission", () => {
    expect(Object.keys(WIDGET_PERMISSION).sort()).toEqual([...WIDGETS].sort());
  });
});

describe("strings", () => {
  it.each([["id", id], ["en", en]] as const)("%s names every widget and its hint", (_, messages) => {
    for (const key of WIDGETS) {
      expect(messages.dashboardEditor.widget[key]).toBeTruthy();
      expect(messages.dashboardEditor.widget[`${key}Hint` as `${typeof key}Hint`]).toBeTruthy();
    }
  });
});
