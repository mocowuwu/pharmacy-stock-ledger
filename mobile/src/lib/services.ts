/**
 * The app's operations: the pure rules in `pass`, `signin`, `till` and `sync`,
 * joined to the network and the files.
 */
import type { DeviceUser, LoginResponse, PaymentMethod } from "@/lib/offline/contract";
import { native } from "../native";
import { HISTORY_LIMIT, type DeviceFile, type QueueEntry, type SnapshotFile, type StoredUser } from "../storage-format";
import {
  ApiFailure,
  fetchSnapshot,
  handoffUrl,
  login,
  postSync,
  postTillSale,
  Unreachable,
} from "./api";
import { onlineHistoryEntry, onlineReceipt, recordOnlineUsage, tillSaleRequest } from "./online";
import { checkPass, raiseHighWater, type Clock, type PassCheck } from "./pass";
import {
  checkVerifier,
  findUser,
  lockMinutesLeft,
  makeVerifier,
  offlineEligibility,
  reconcileUsers,
  recordFailure,
  recordSuccess,
  rememberUser,
  type OfflineSignInProblem,
} from "./signin";
import * as store from "./store";
import { applySyncResults, SYNC_BATCH } from "./sync";
import { buildSale, type CartLine, type SaleInput, type SaleRefusal } from "./till";

export function clock(): Clock {
  const n = native();
  return { elapsed: Number(n.elapsedRealtime()), bootCount: Number(n.bootCount()), wall: Date.now() };
}

/** The pass as it stands right now, for the till and the status bar. */
export function currentPass(): { check: PassCheck; snapshot: SnapshotFile | null } {
  const snapshot = store.readSnapshot();
  const state = store.readState();
  return { check: checkPass(snapshot, state.usage, clock(), state.wallHighWater), snapshot };
}

/**
 * Records the phone's clock as seen, so a later turn-back is noticed. Skipped
 * while the clock already reads as turned back -- the mark only rises anyway.
 */
export function touchHighWater(): void {
  const state = store.readState();
  const wall = Date.now();
  if (wall > state.wallHighWater) store.writeState({ ...state, wallHighWater: raiseHighWater(state.wallHighWater, wall) });
}

/**
 * Applies a snapshot the shell has not processed yet -- whether the shell
 * fetched it or the website wrote it during its 15-minute refresh. Users the
 * server says are suspended or have a new password are forgotten here, before
 * anyone can sign in offline against a stale verifier.
 */
export function applySnapshotIfNew(): void {
  const snapshot = store.readSnapshot();
  if (!snapshot) return;
  const state = store.readState();
  if (state.appliedPassId === snapshot.data.pass.id) return;

  store.writeUsers(reconcileUsers(store.readUsers(), snapshot.data.users));

  const device = store.readDevice();
  if (device && device.deviceCode !== snapshot.data.device.code) {
    store.writeDevice({ ...device, deviceCode: snapshot.data.device.code });
  }
  store.writeState({
    ...state,
    appliedPassId: snapshot.data.pass.id,
    // Sold counts belong to a pass; this snapshot already includes whatever
    // the server had received, and the queue covers what it had not.
    usage: { passId: snapshot.data.pass.id, sales: 0, total: 0, soldByBatch: {} },
    // The server was reachable at this moment, so the phone's clock is
    // re-based here: a clock that was wrong and has been corrected no longer
    // keeps the till locked.
    wallHighWater: snapshot.receivedWall,
  });
}

/**
 * How often the till takes a fresh copy while the server answers. The website
 * used to do this while it was open; now the till is the app's own screen, so
 * the app does it. Keeps prices current for online sales and the pass full for
 * when the server drops out.
 */
export const SNAPSHOT_REFRESH_MS = 15 * 60_000;

/** Whether the till's copy is due for a refresh (missing, from before a reboot, or older than the interval). */
export function snapshotDue(): boolean {
  const snapshot = store.readSnapshot();
  if (!snapshot) return true;
  const c = clock();
  if (c.bootCount !== snapshot.bootCount) return true;
  return c.elapsed - snapshot.receivedElapsed > SNAPSHOT_REFRESH_MS;
}

/** Fetches a fresh snapshot and pass. Till devices only; management devices never keep one. */
export async function refreshSnapshot(device: DeviceFile): Promise<void> {
  if (device.role !== "till" || !device.deviceToken) return;
  const userIds = store.readUsers().users.map((u) => u.id);
  const data = await fetchSnapshot(device.serverUrl, { userIds }, device.deviceToken);
  const n = native();
  store.writeSnapshot({
    receivedElapsed: Number(n.elapsedRealtime()),
    bootCount: Number(n.bootCount()),
    receivedWall: Date.now(),
    data,
  });
  applySnapshotIfNew();
}

let syncing: Promise<SyncOutcome> | null = null;

export type SyncOutcome =
  | { ok: true; sent: number; remaining: number }
  | { ok: false; reason: "unreachable" | "revoked" | "error"; sent: number; remaining: number };

/** Sends the queue. Concurrent callers share one run. */
export function syncQueue(device: DeviceFile): Promise<SyncOutcome> {
  if (!syncing) {
    syncing = runSync(device).finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

async function runSync(device: DeviceFile): Promise<SyncOutcome> {
  let sent = 0;
  for (;;) {
    const before = store.readQueue();
    if (before.sales.length === 0) return { ok: true, sent, remaining: 0 };
    if (!device.deviceToken) {
      return { ok: false, reason: "revoked", sent, remaining: before.sales.length };
    }
    const batch = before.sales.slice(0, SYNC_BATCH).map((e) => e.sale);
    let results;
    try {
      ({ results } = await postSync(device.serverUrl, { sales: batch }, device.deviceToken));
    } catch (e) {
      const reason =
        e instanceof Unreachable
          ? "unreachable"
          : e instanceof ApiFailure && (e.status === 401 || e.status === 403)
            ? "revoked"
            : "error";
      return { ok: false, reason, sent, remaining: before.sales.length };
    }
    // Read the queue again after the wait: a sale may have been rung while
    // the request was in flight, and it must not be lost by writing back the
    // older copy.
    const applied = applySyncResults(store.readQueue(), store.readHistory(), results, Date.now());
    store.writeHistory(applied.history);
    store.writeQueue(applied.queue);
    sent += applied.answered;
    if (applied.answered === 0) {
      // The server answered for none of them; stop rather than loop.
      return { ok: false, reason: "error", sent, remaining: applied.queue.sales.length };
    }
  }
}

/* ---------------------------------------------------------- live session */

/**
 * What lets the till sell online: the cashier's till session from the
 * server. Memory only -- a restart signs the cashier out, as it always has.
 *
 * Someone who signed in offline has no session yet. For them, and only until
 * the server is back and one sign-in has been tried, the password they typed
 * is kept here too, so the till can go online without asking them again. It
 * never touches the disk, and it is dropped after the first attempt either way
 * -- a password that has since changed must not be retried into a lock-out.
 */
type Live = { userId: string; token: string | null; password: string | null };
let live: Live | null = null;

export function setLive(next: Live | null): void {
  live = next;
}

/** The till session for this cashier, if the till can sell online for them. */
export function liveToken(userId: string): string | null {
  return live && live.userId === userId ? live.token : null;
}

/** Whether the till could still go online for this cashier without asking them to sign in. */
export function canResume(userId: string): boolean {
  return !!live && live.userId === userId && !live.token && !!live.password;
}

let resuming: Promise<boolean> | null = null;

/**
 * Signs the offline cashier in online, once the server is back, with the
 * password they gave offline. True when the till can now sell online.
 */
export function resumeOnline(device: DeviceFile, cashier: StoredUser): Promise<boolean> {
  if (!resuming) {
    resuming = runResume(device, cashier).finally(() => {
      resuming = null;
    });
  }
  return resuming;
}

async function runResume(device: DeviceFile, cashier: StoredUser): Promise<boolean> {
  if (!live || live.userId !== cashier.id || live.token || !live.password) return false;
  const password = live.password;
  let response: LoginResponse;
  try {
    response = await login(
      device.serverUrl,
      {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        role: device.role,
        username: cashier.username,
        password,
        appVersion: String(native().appVersion()),
      },
      device.deviceToken,
    );
  } catch (e) {
    // Not there after all: try again on the next tick. Refused: never again.
    if (!(e instanceof Unreachable) && live?.userId === cashier.id) live = { ...live, password: null };
    return false;
  }
  if (response.user.id !== cashier.id || !response.tillSession) {
    if (live?.userId === cashier.id) live = { ...live, password: null };
    return false;
  }
  const verifier = response.user.mustChangePassword ? null : await makeVerifier(password);
  store.writeUsers(rememberUser(store.readUsers(), response.user, response.serverTime, verifier));
  if (response.deviceToken) store.writeDevice({ ...device, deviceToken: response.deviceToken });
  live = { userId: cashier.id, token: response.tillSession, password: null };
  return true;
}

/* --------------------------------------------------------------- sign in */

export type OnlineSignIn =
  /**
   * `till` set: stay in the app and sell; the till session is already live.
   * Otherwise open `url`, the website, already signed in.
   */
  | { ok: true; url: string; user: DeviceUser; till: StoredUser | null }
  | {
      ok: false;
      problem: "invalid" | "locked" | "suspended" | "revoked" | "unreachable" | "error";
      minutes?: number;
    };

function failureOf(e: unknown): Exclude<OnlineSignIn, { ok: true }> {
  if (e instanceof Unreachable) return { ok: false, problem: "unreachable" };
  if (e instanceof ApiFailure) {
    const code = e.body?.error;
    if (code === "invalid") return { ok: false, problem: "invalid" };
    if (code === "locked") return { ok: false, problem: "locked", minutes: e.body?.minutes };
    if (code === "suspended") return { ok: false, problem: "suspended" };
    if (code === "device_revoked") return { ok: false, problem: "revoked" };
  }
  return { ok: false, problem: "error" };
}

/** The handoff code lives 60 s; ask for a fresh one if preparing took most of that. */
const HANDOFF_FRESH_MS = 40_000;
/** How long sync + snapshot may hold up the sign-in before the website takes over. */
const PREPARE_BUDGET_MS = 25_000;

export async function onlineSignIn(
  deviceIn: DeviceFile,
  username: string,
  password: string,
  onPreparing?: () => void,
  /** The person asked for the website, not the till. */
  options: { website?: boolean } = {},
): Promise<OnlineSignIn> {
  let device = deviceIn;
  const body = {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    role: device.role,
    username: username.trim(),
    password,
    appVersion: String(native().appVersion()),
  };

  let response: LoginResponse;
  const started = Date.now();
  try {
    try {
      response = await login(device.serverUrl, body, device.deviceToken);
    } catch (e) {
      // A token the server no longer knows (a reinstalled server, say) is
      // dropped and the sign-in tried once without it. A revoked device is not:
      // the owner removed it on purpose.
      if (e instanceof ApiFailure && e.body?.error === "unauthorized" && device.deviceToken) {
        device = { ...device, deviceToken: null };
        store.writeDevice(device);
        response = await login(device.serverUrl, body, null);
      } else {
        throw e;
      }
    }
  } catch (e) {
    const failure = failureOf(e);
    if (failure.problem === "revoked") {
      store.writeDevice({ ...device, deviceToken: null });
    }
    return failure;
  }

  device = {
    ...device,
    deviceToken: response.deviceToken ?? device.deviceToken,
    deviceCode: response.device.code,
  };
  store.writeDevice(device);

  if (device.role === "till") {
    onPreparing?.();
    const verifier = response.user.mustChangePassword ? null : await makeVerifier(password);
    store.writeUsers(rememberUser(store.readUsers(), response.user, response.serverTime, verifier));
    // Send anything rung offline, then take a fresh copy. Neither may keep
    // the person from the website for long: the website refreshes the
    // snapshot itself every 15 minutes.
    await Promise.race([
      (async () => {
        await syncQueue(device).catch(() => undefined);
        await refreshSnapshot(device).catch(() => undefined);
      })(),
      new Promise((resolve) => setTimeout(resolve, PREPARE_BUDGET_MS)),
    ]);
  } else if (store.readQueue().sales.length > 0) {
    await syncQueue(device).catch(() => undefined);
  }

  // The till's cashier stays in the app. It needs a usable copy to sell from
  // (the catalogue, and the pass for when the server drops out); on a phone
  // that could not fetch one, the website's till will do.
  if (device.role === "till" && response.tillSession && !options.website) {
    const cashier = store.readUsers().users.find((u) => u.id === response.user.id) ?? null;
    applySnapshotIfNew();
    if (cashier && currentPass().check.ok) {
      live = { userId: cashier.id, token: response.tillSession, password: null };
      return { ok: true, url: "", user: response.user, till: cashier };
    }
  }

  if (Date.now() - started > HANDOFF_FRESH_MS) {
    try {
      response = await login(device.serverUrl, body, device.deviceToken);
    } catch (e) {
      return failureOf(e);
    }
  }

  return {
    ok: true,
    url: handoffUrl(device.serverUrl, response.handoffCode, options.website ? "/" : undefined),
    user: response.user,
    till: null,
  };
}

export type OfflineSignIn =
  | { ok: true; user: StoredUser }
  | { ok: false; problem: OfflineSignInProblem | "invalid" | "locked" | "pass"; minutes?: number };

export async function offlineSignIn(username: string, password: string): Promise<OfflineSignIn> {
  applySnapshotIfNew();
  const { check } = currentPass();
  if (!check.ok) return { ok: false, problem: "pass" };

  const c = clock();
  const state = store.readState();
  const minutes = lockMinutesLeft(state.signIn, c.elapsed, c.bootCount);
  if (minutes > 0) return { ok: false, problem: "locked", minutes };

  const user = findUser(store.readUsers(), username);
  const passwordOk = user?.verifier ? await checkVerifier(password, user.verifier) : false;

  if (!passwordOk) {
    // Unknown names count against the lock like wrong passwords, so it
    // cannot be side-stepped by guessing names.
    const next = recordFailure(state.signIn, c.elapsed, c.bootCount);
    store.writeState({ ...store.readState(), signIn: next });
    if (next.lockedUntilElapsed > c.elapsed) {
      return { ok: false, problem: "locked", minutes: lockMinutesLeft(next, c.elapsed, c.bootCount) };
    }
    if (!user) return { ok: false, problem: "unknown" };
    if (!user.verifier) return { ok: false, problem: "no_verifier" };
    return { ok: false, problem: "invalid" };
  }

  store.writeState({ ...store.readState(), signIn: recordSuccess(c.bootCount) });
  // The password is right, but the sign-in may still be too long ago or the
  // account not allowed to sell.
  const eligible = offlineEligibility(user, check.now);
  if (eligible !== "ok") return { ok: false, problem: eligible };
  return { ok: true, user: user! };
}

/* ------------------------------------------------------------------ sale */

export type RecordedSale =
  | { ok: true; entry: QueueEntry }
  | { ok: false; refusal: SaleRefusal | { code: "pass" } | { code: "save_failed" } };

/**
 * Rings an offline sale. The pass is checked again at this instant, and the
 * sale is on disk -- the sequence number first, so it can never be handed out
 * twice, then the queue -- before the caller is allowed to show a receipt.
 */
export function recordSale(
  input: Omit<SaleInput, "snapshot" | "state" | "queue" | "now" | "elapsed" | "wall" | "clientId"> & {
    /** Given when an online attempt came first, so the server books the two as one. */
    clientId?: string;
  },
): RecordedSale {
  applySnapshotIfNew();
  const snapshot = store.readSnapshot();
  const state = store.readState();
  const c = clock();
  const check = checkPass(snapshot, state.usage, c, state.wallHighWater);
  if (!snapshot || !check.ok) return { ok: false, refusal: { code: "pass" } };

  const queue = store.readQueue();
  const outcome = buildSale({
    ...input,
    snapshot,
    state,
    queue,
    now: check.now,
    elapsed: c.elapsed,
    wall: c.wall,
    clientId: input.clientId ?? crypto.randomUUID(),
  });
  if (!outcome.ok) return outcome;

  try {
    store.writeState(outcome.state);
    store.writeQueue({ sales: [...queue.sales, outcome.entry] });
  } catch {
    return { ok: false, refusal: { code: "save_failed" } };
  }
  return { ok: true, entry: outcome.entry };
}

export type OnlineSale =
  | { kind: "sold" }
  /** The server would not book it. Nothing was sold; say why and let the cashier fix the cart. */
  | { kind: "refused"; code: string; detail?: Record<string, unknown> }
  /** The cashier's till session is no longer valid -- suspended, reset, or simply expired. */
  | { kind: "session_ended" }
  /** No answer, or no usable one: keep the sale on the phone instead, under the same id. */
  | { kind: "offline" };

/**
 * Rings the sale on the server. On "sold" the receipt is on disk in the
 * history, with the server's number, before the caller shows it.
 */
export async function sellOnline(
  device: DeviceFile,
  cashier: StoredUser,
  input: {
    cart: readonly CartLine[];
    discount: number;
    paymentMethod: PaymentMethod;
    tendered: number | null;
    notes: string | null;
    clientId: string;
  },
): Promise<OnlineSale> {
  const token = liveToken(cashier.id);
  const snapshot = store.readSnapshot();
  if (!token || !device.deviceToken || !snapshot) return { kind: "offline" };

  let response;
  try {
    response = await postTillSale(device.serverUrl, tillSaleRequest(snapshot, input), device.deviceToken, token);
  } catch (e) {
    if (e instanceof ApiFailure) {
      if (e.status === 409 && e.body?.error === "refused") {
        return { kind: "refused", code: e.body.code ?? "error", detail: e.body.detail };
      }
      if (e.body?.error === "session_ended") {
        if (live?.userId === cashier.id) live = { ...live, token: null };
        return { kind: "session_ended" };
      }
      // A server error may have come after the sale was booked; the offline
      // copy carries the same id, so the sync finds it rather than booking it twice.
      if (e.status >= 500) return { kind: "offline" };
      return { kind: "refused", code: e.body?.error ?? "error" };
    }
    return { kind: "offline" };
  }

  const receipt = onlineReceipt(snapshot, response, cashier.fullName, input.paymentMethod);
  try {
    const history = store.readHistory();
    store.writeHistory({
      sales: [onlineHistoryEntry(input.clientId, receipt, Date.now()), ...history.sales].slice(0, HISTORY_LIMIT),
    });
    store.writeState(recordOnlineUsage(store.readState(), snapshot, response.lines));
  } catch {
    // Booked on the server either way; the receipt just could not be kept for reprinting.
  }
  return { kind: "sold" };
}
