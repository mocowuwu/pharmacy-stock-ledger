import { randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  batches,
  deviceHandoffs,
  devicePasses,
  devices,
  itemBarcodes,
  items,
  settings,
  userPermissions,
  users,
} from "@/db/schema";
import { hashToken } from "@/lib/auth/password";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";
import { adoptPharmacyTimezone, today } from "@/lib/format/date";
import { activeTax } from "@/lib/stock/sale";
import {
  PASS_HOURS,
  type DeviceRole,
  type DeviceUser,
  type SnapshotResponse,
} from "./contract";

/**
 * Devices, passes and the offline catalogue.
 *
 * Takes an executor and no session, like `src/lib/stock/*`: the routes under
 * `/api/device` authenticate the phone and call in here, and the tests drive it
 * against a real database.
 */

/**
 * Limits carried by every pass. Generous for one clinic's day -- the point is
 * that a phone left offline cannot go on selling without bound, not to get in
 * the way of a busy Saturday.
 */
export const PASS_MAX_SALES = 500;
export const PASS_MAX_TOTAL = 50_000_000;

const HANDOFF_SECONDS = 60;

/** No 0/O, 1/I/L: a code read off a paper receipt must not be misread. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type DeviceRow = typeof devices.$inferSelect;

function newCode(): string {
  let code = "";
  for (let i = 0; i < 3; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Registers a device on first sign-in, or refreshes its name and role.
 *
 * A device that presents a wrong or missing token after someone has just
 * signed in on it with a valid password gets a fresh token: the phone lost its
 * storage, or was set up again. The old token stops working, which is the
 * right outcome if it was copied somewhere.
 */
export async function registerDevice(
  db: Database,
  input: {
    deviceId: string;
    name: string;
    role: DeviceRole;
    appVersion: string;
    presentedToken: string | null;
    userId: string;
  },
): Promise<
  | { ok: true; device: DeviceRow; token: string | null; created: boolean }
  | { ok: false; error: "device_revoked" }
> {
  const [existing] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, input.deviceId))
    .limit(1);

  if (existing?.revokedAt) return { ok: false, error: "device_revoked" };

  if (existing) {
    const keep =
      input.presentedToken !== null && hashToken(input.presentedToken) === existing.tokenHash;
    const token = keep ? null : newSecret();
    const [device] = await db
      .update(devices)
      .set({
        name: input.name,
        role: input.role,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
        ...(token ? { tokenHash: hashToken(token) } : {}),
      })
      .where(eq(devices.id, existing.id))
      .returning();
    return { ok: true, device, token, created: false };
  }

  const token = newSecret();
  // A three-letter code collides eventually; a retry is cheaper than a longer
  // code on every receipt.
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = newCode();
    const [taken] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.code, code))
      .limit(1);
    if (taken) continue;
    const [device] = await db
      .insert(devices)
      .values({
        id: input.deviceId,
        name: input.name,
        role: input.role,
        code,
        tokenHash: hashToken(token),
        appVersion: input.appVersion,
        registeredBy: input.userId,
      })
      .returning();
    return { ok: true, device, token, created: true };
  }
  throw new Error("Could not allocate a device code.");
}

/** The device behind a bearer token, or why there is none. */
export async function deviceForToken(
  db: Database,
  token: string | null,
): Promise<{ ok: true; device: DeviceRow } | { ok: false; error: "unauthorized" | "device_revoked" }> {
  if (!token) return { ok: false, error: "unauthorized" };
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, hashToken(token)))
    .limit(1);
  if (!device) return { ok: false, error: "unauthorized" };
  if (device.revokedAt) return { ok: false, error: "device_revoked" };
  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));
  return { ok: true, device };
}

/**
 * Changes whenever the password does, without saying anything about it: a
 * slice of a hash of the stored hash. The phone uses it to forget an offline
 * verifier made from a password that has since been replaced.
 */
export function credentialStamp(passwordHash: string): string {
  return hashToken(`stamp:${passwordHash}`).slice(0, 16);
}

export async function permissionsOf(
  db: Database,
  user: { id: string; isOwner: boolean },
): Promise<string[]> {
  if (user.isOwner) return [...ALL_PERMISSIONS];
  const rows = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, user.id));
  return rows.map((r) => r.permission).sort();
}

export async function deviceUser(
  db: Database,
  user: typeof users.$inferSelect,
): Promise<DeviceUser> {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    locale: user.locale,
    isOwner: user.isOwner,
    isPharmacist: user.isPharmacist,
    permissions: await permissionsOf(db, user),
    credentialStamp: credentialStamp(user.passwordHash),
  };
}

/* ---------------------------------------------------------------- handoff */

export async function createHandoff(
  db: Database,
  input: { deviceId: string; userId: string },
): Promise<string> {
  const code = newSecret();
  await db.insert(deviceHandoffs).values({
    codeHash: hashToken(code),
    deviceId: input.deviceId,
    userId: input.userId,
    expiresAt: new Date(Date.now() + HANDOFF_SECONDS * 1000),
  });
  return code;
}

/**
 * Spends a handoff code. The update is the check: only one request can move
 * `used_at` off null, so a code replayed from history or raced by two taps
 * signs in exactly once.
 */
export async function redeemHandoff(
  db: Database,
  code: string,
): Promise<{ user: typeof users.$inferSelect; device: DeviceRow } | null> {
  const [spent] = await db
    .update(deviceHandoffs)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(deviceHandoffs.codeHash, hashToken(code)),
        isNull(deviceHandoffs.usedAt),
        gt(deviceHandoffs.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!spent) return null;

  const [row] = await db
    .select({ user: users, device: devices })
    .from(users)
    .innerJoin(devices, eq(devices.id, spent.deviceId))
    .where(eq(users.id, spent.userId))
    .limit(1);
  if (!row || row.user.status !== "active" || row.device.revokedAt) return null;
  return row;
}

/* --------------------------------------------------------------- snapshot */

export async function issuePass(db: Database, deviceId: string) {
  const issuedAt = new Date();
  const [pass] = await db
    .insert(devicePasses)
    .values({
      deviceId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + PASS_HOURS * 3_600_000),
      maxSales: PASS_MAX_SALES,
      maxTotal: PASS_MAX_TOTAL,
    })
    .returning();
  return pass;
}

/**
 * Everything the till needs to sell for a day without the server.
 *
 * Sell prices, stock and expiry -- never cost prices: the phone sits on the
 * counter, and what the pharmacy pays is kept off the shop floor everywhere
 * else too.
 */
export async function buildSnapshot(
  db: Database,
  device: DeviceRow,
  userIds: readonly string[],
): Promise<SnapshotResponse> {
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  adoptPharmacyTimezone(config?.timezone);
  const on = today();
  const tax = await activeTax(db, on);

  const itemRows = await db
    .select({
      id: items.id,
      code: items.code,
      genericName: items.genericName,
      brandName: items.brandName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
      price: items.defaultPrice,
      isTaxExempt: items.isTaxExempt,
    })
    .from(items)
    .where(eq(items.status, "active"))
    .orderBy(items.genericName);

  const batchRows = await db
    .select({
      id: batches.id,
      itemId: batches.itemId,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qty: batches.qtyRemaining,
    })
    .from(batches)
    .where(and(eq(batches.status, "active"), gt(batches.qtyRemaining, 0)))
    .orderBy(batches.expiryDate);

  const barcodeRows = await db
    .select({ itemId: itemBarcodes.itemId, barcode: itemBarcodes.barcode })
    .from(itemBarcodes);

  const batchesByItem = new Map<string, SnapshotResponse["items"][number]["batches"]>();
  for (const b of batchRows) {
    const list = batchesByItem.get(b.itemId) ?? [];
    list.push({ id: b.id, lotNumber: b.lotNumber, expiryDate: b.expiryDate, qty: b.qty });
    batchesByItem.set(b.itemId, list);
  }
  const barcodesByItem = new Map<string, string[]>();
  for (const b of barcodeRows) {
    const list = barcodesByItem.get(b.itemId) ?? [];
    list.push(b.barcode);
    barcodesByItem.set(b.itemId, list);
  }

  const userRows = userIds.length
    ? await db.select().from(users).where(inArray(users.id, [...userIds]))
    : [];

  const pass = await issuePass(db, device.id);
  await db.update(devices).set({ lastSyncAt: new Date() }).where(eq(devices.id, device.id));

  return {
    serverTime: new Date().toISOString(),
    serverToday: on,
    settings: {
      businessName: config?.businessName ?? "",
      businessAddress: config?.businessAddress ?? null,
      businessPhone: config?.businessPhone ?? null,
      npwp: config?.npwp ?? null,
      licenceNumber: config?.licenceNumber ?? null,
      receiptFooter: config?.receiptFooter ?? null,
      receiptLocale: config?.receiptLocale ?? "id",
      timezone: config?.timezone ?? "Asia/Jakarta",
      currencyCode: config?.currencyCode ?? "IDR",
      currencyDecimals: config?.currencyDecimals ?? 0,
    },
    tax: tax ? { mode: tax.mode, rateBps: tax.rate.rateBps } : null,
    items: itemRows.map((item) => ({
      ...item,
      barcodes: barcodesByItem.get(item.id) ?? [],
      batches: batchesByItem.get(item.id) ?? [],
    })),
    users: await Promise.all(
      userRows.map(async (u) => ({ ...(await deviceUser(db, u)), active: u.status === "active" })),
    ),
    pass: {
      id: pass.id,
      issuedAt: pass.issuedAt.toISOString(),
      expiresAt: pass.expiresAt.toISOString(),
      maxSales: pass.maxSales,
      maxTotal: pass.maxTotal,
    },
    device: { id: device.id, name: device.name, role: device.role, code: device.code },
  };
}
