/**
 * The files the app keeps in its private storage, and their shapes.
 *
 * This is a contract, not an implementation detail: the website, running
 * inside the same WebView, reads `device.json` and `users.json` and writes
 * `snapshot.json` through `window.PharmacyNative` when it refreshes the till's
 * catalogue every 15 minutes. Both sides must agree on these shapes, so they
 * live here, are documented in README.md, and change only on purpose.
 *
 * Every file is written whole through `PharmacyNative.writeFile`, which writes
 * a temporary file, syncs it to disk and renames it over the old one: a phone
 * that dies mid-write keeps the previous version, never half of each.
 */
import type {
  DeviceRole,
  DeviceUser,
  OfflineSale,
  PaymentMethod,
  SnapshotResponse,
  SyncResult,
} from "@/lib/offline/contract";

export const FILES = {
  device: "device.json",
  snapshot: "snapshot.json",
  users: "users.json",
  queue: "queue.json",
  history: "history.json",
  state: "state.json",
} as const;

export type FileName = (typeof FILES)[keyof typeof FILES];

/** `device.json` -- written by the setup screen and on each online sign-in. */
export type DeviceFile = {
  /** crypto.randomUUID(), made once at setup. */
  deviceId: string;
  deviceName: string;
  role: DeviceRole;
  /** Origin of the pharmacy server, no trailing slash: `https://pharmacy-pc.tailnet-abc.ts.net`. */
  serverUrl: string;
  /** From LoginResponse.deviceToken; null until the server has issued one. */
  deviceToken: string | null;
  /** LoginResponse.device.code; used in offline numbers (`OFF-<code>-0001`). */
  deviceCode: string | null;
  /** The pharmacy's name as the server last gave it, for the sign-in screen. */
  businessName?: string | null;
};

/**
 * `snapshot.json` -- the till's offline copy. Till devices only.
 *
 * The three numbers are taken on the phone the moment the response arrives,
 * and together they are what make the pass unforgeable by changing the date:
 * `receivedElapsed` is `SystemClock.elapsedRealtime()` (milliseconds since
 * boot, which no setting can move), `bootCount` is `Settings.Global.BOOT_COUNT`
 * (so a reboot, which resets the monotonic clock, ends the pass), and
 * `receivedWall` is `Date.now()`, the baseline for spotting a clock turned back.
 */
export type SnapshotFile = {
  receivedElapsed: number;
  bootCount: number;
  receivedWall: number;
  data: SnapshotResponse;
};

/** A password verifier: PBKDF2-SHA256 over the password. Never the password. */
export type Verifier = {
  /** base64, 16 random bytes. */
  salt: string;
  /** base64, 32 bytes. */
  hash: string;
  iterations: number;
};

export type StoredUser = Omit<DeviceUser, "credentialStamp"> & {
  credentialStamp: string;
  /** LoginResponse.serverTime of the last online sign-in on this device, ISO. */
  signedInAt: string;
  /** Null when the last sign-in used a temporary password. */
  verifier: Verifier | null;
};

/** `users.json` -- the people who may sign in offline on this device. */
export type UsersFile = { users: StoredUser[] };

/** What the customer was handed, kept so it can be shown and reprinted. */
export type ReceiptLine = {
  itemId: string;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  drugClass: string;
  lots: Array<{ batchId: string; lotNumber: string | null; expiryDate: string; qty: number }>;
};

export type Receipt = {
  offlineNumber: string;
  /** Offline-now at the sale (pass time, not the phone's clock), epoch ms. */
  soldAt: number;
  cashierName: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  taxMode: "inclusive" | "exclusive" | null;
  taxRateBps: number | null;
  total: number;
  paymentMethod: PaymentMethod;
  tendered: number | null;
  change: number | null;
};

export type QueueEntry = {
  /** Exactly what is sent to /api/device/sync. */
  sale: OfflineSale;
  /** Which lots the units left from; local only, used to cap stock. */
  allocations: Array<{ itemId: string; batchId: string; qty: number }>;
  receipt: Receipt;
};

/** `queue.json` -- sales waiting for the server, oldest first. */
export type QueueFile = { sales: QueueEntry[] };

export type HistoryEntry = {
  clientId: string;
  offlineNumber: string;
  /** The real number, once the server has booked it. */
  saleNumber: string | null;
  status: SyncResult["status"];
  flags: string[];
  /** Phone wall clock at sync; informational. */
  syncedAt: number;
  receipt: Receipt;
};

/** `history.json` -- the last HISTORY_LIMIT synced sales, newest first. */
export type HistoryFile = { sales: HistoryEntry[] };
export const HISTORY_LIMIT = 200;

export type PassUsage = {
  passId: string;
  sales: number;
  /** Whole rupiah. */
  total: number;
  /** Units sold offline since this pass's snapshot, per batch id. */
  soldByBatch: Record<string, number>;
};

/** `state.json` -- counters that must survive a restart. Shell-owned. */
export type StateFile = {
  /** The last offline sequence number used. Only ever goes up. */
  seq: number;
  /** Highest phone wall clock seen, epoch ms. A clock far below it is a clock turned back. */
  wallHighWater: number;
  /** The pass whose snapshot the shell last applied (users reconciled, usage reset). */
  appliedPassId: string | null;
  usage: PassUsage | null;
  signIn: {
    failures: number;
    /** elapsedRealtime until which offline sign-in is refused, on `bootCount`. */
    lockedUntilElapsed: number;
    bootCount: number;
  };
};

export const EMPTY_STATE: StateFile = {
  seq: 0,
  wallHighWater: 0,
  appliedPassId: null,
  usage: null,
  signIn: { failures: 0, lockedUntilElapsed: 0, bootCount: -1 },
};

/** Parses a stored file, falling back when it is missing or unreadable. */
export function parseFile<T>(text: string | null, fallback: T): T {
  if (text == null || text === "") return fallback;
  try {
    const value = JSON.parse(text) as T;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
