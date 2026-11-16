import { z } from "zod";
import { getDb } from "@/db";
import { authenticate, clientIp } from "@/lib/auth/sign-in";
import { createSession } from "@/lib/auth/session";
import { AuthEvents, recordAudit } from "@/lib/audit";
import { bearer, fail, json, preflight } from "@/lib/offline/http";
import { createHandoff, deviceUser, registerDevice } from "@/lib/offline/devices";
import { DEVICE_ROLES } from "@/lib/catalogue/enums";
import type { LoginResponse } from "@/lib/offline/contract";

const Body = z.object({
  deviceId: z.uuid(),
  deviceName: z.string().trim().min(1).max(60),
  role: z.enum(DEVICE_ROLES),
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(500),
  appVersion: z.string().max(40),
});

/**
 * Sign-in on the app's own screen.
 *
 * The same checks as the website's form -- rate limits, account lock, audit --
 * because it is the same `authenticate`. What differs is the answer: instead of
 * a cookie, the app gets its device token (the first time), the user's details
 * for offline sign-in, and a one-minute code that becomes a website session
 * when the app opens `/api/device/handoff`. On the till it also gets a session
 * of its own to sell with (`/api/device/sale`), because the cashier stays in
 * the app rather than going to the website.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(request, 400, "bad_request");
  const input = parsed.data;

  const result = await authenticate({
    username: input.username,
    password: input.password,
    ip: await clientIp(),
  });
  if (!result.ok) {
    const status = result.error === "locked" ? 423 : result.error === "suspended" ? 403 : 401;
    return fail(request, status, result.error, result.minutes);
  }
  const { user } = result;

  const db = await getDb();
  const registered = await registerDevice(db, {
    deviceId: input.deviceId,
    name: input.deviceName,
    role: input.role,
    appVersion: input.appVersion,
    presentedToken: bearer(request),
    userId: user.id,
  });
  if (!registered.ok) return fail(request, 403, registered.error);
  const { device } = registered;

  if (registered.created) {
    await recordAudit({
      userId: user.id,
      actorLabel: user.username,
      action: "device.registered",
      entityType: "devices",
      entityId: device.id,
      after: { name: device.name, role: device.role, code: device.code },
    });
  }
  await recordAudit({
    action: AuthEvents.signInSucceeded,
    userId: user.id,
    actorLabel: user.username,
    after: { via: "android_app", deviceId: device.id },
  });

  const appUser = await deviceUser(db, user);
  // The till sells in the app itself, so the cashier needs a session the app
  // can sell with. Someone on a temporary password changes it on the website
  // first; someone who may not sell gets the website, not the till.
  const tillSession =
    device.role === "till" && !user.mustChangePassword && appUser.permissions.includes("sales.create")
      ? (
          await createSession(user.id, {
            ip: await clientIp(),
            userAgent: request.headers.get("user-agent"),
          })
        ).token
      : null;

  const body: LoginResponse = {
    ...(registered.token ? { deviceToken: registered.token } : {}),
    ...(tillSession ? { tillSession } : {}),
    device: { id: device.id, name: device.name, role: device.role, code: device.code },
    user: { ...appUser, mustChangePassword: user.mustChangePassword },
    serverTime: new Date().toISOString(),
    handoffCode: await createHandoff(db, { deviceId: device.id, userId: user.id }),
  };
  return json(request, body);
}

export const OPTIONS = preflight;
