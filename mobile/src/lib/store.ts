/**
 * Typed reads and writes of the app's files through the native bridge.
 *
 * A write that the phone refuses throws: the till must never show a receipt
 * for a sale that is not on disk.
 */
import { native } from "../native";
import {
  EMPTY_STATE,
  FILES,
  parseFile,
  type DeviceFile,
  type FileName,
  type HistoryFile,
  type QueueFile,
  type SnapshotFile,
  type StateFile,
  type UsersFile,
} from "../storage-format";

export class StorageError extends Error {}

/*
 * What was last read or written, per file. The till re-renders on every
 * keystroke, and reading the catalogue through the bridge and parsing it each
 * time is felt on a phone once the pharmacy has a few thousand items. Only
 * this page writes while it is open -- the website's refresh writes while the
 * app's screens are not loaded, and a page load starts with an empty cache --
 * so the copy here is never stale. Callers must not mutate what they get.
 */
const cache = new Map<string, string | null>();

function readText(name: string): string | null {
  if (!cache.has(name)) cache.set(name, native().readFile(name));
  return cache.get(name) ?? null;
}

const parsed = new Map<string, { text: string | null; value: unknown }>();

function readParsed<T>(name: FileName, fallback: T): T {
  const text = readText(name);
  const hit = parsed.get(name);
  if (hit && hit.text === text) return hit.value as T;
  const value = parseFile<T>(text, fallback);
  parsed.set(name, { text, value });
  return value;
}

function write(name: FileName, value: unknown): void {
  const text = JSON.stringify(value);
  if (!native().writeFile(name, text)) {
    cache.delete(name);
    throw new StorageError(`Could not write ${name}`);
  }
  cache.set(name, text);
  parsed.set(name, { text, value });
}

function remove(name: FileName): boolean {
  cache.delete(name);
  parsed.delete(name);
  return native().deleteFile(name);
}

export function readDevice(): DeviceFile | null {
  const d = readParsed<DeviceFile | null>(FILES.device, null);
  return d && d.deviceId && d.serverUrl ? d : null;
}
export const writeDevice = (d: DeviceFile) => write(FILES.device, d);

export function readSnapshot(): SnapshotFile | null {
  const s = readParsed<SnapshotFile | null>(FILES.snapshot, null);
  return s && s.data && s.data.pass ? s : null;
}
export const writeSnapshot = (s: SnapshotFile) => write(FILES.snapshot, s);
export const deleteSnapshot = () => remove(FILES.snapshot);

export function readUsers(): UsersFile {
  const u = readParsed<UsersFile>(FILES.users, { users: [] });
  return Array.isArray(u.users) ? u : { users: [] };
}
export const writeUsers = (u: UsersFile) => write(FILES.users, u);
export const deleteUsers = () => remove(FILES.users);

/**
 * The queue holds sales that exist nowhere else. If it ever fails to parse,
 * the unreadable text is set aside in `queuedamaged.json` before anything
 * overwrites it, so a person can still recover the sales by hand.
 */
export function readQueue(): QueueFile {
  const text = readText(FILES.queue);
  const q = readParsed<QueueFile | null>(FILES.queue, null);
  if (q && Array.isArray(q.sales)) return q;
  if (text != null && text !== "" && native().readFile("queuedamaged.json") == null) {
    native().writeFile("queuedamaged.json", JSON.stringify({ text }));
  }
  return { sales: [] };
}
export const writeQueue = (q: QueueFile) => write(FILES.queue, q);

export function readHistory(): HistoryFile {
  const h = readParsed<HistoryFile>(FILES.history, { sales: [] });
  return Array.isArray(h.sales) ? h : { sales: [] };
}
export const writeHistory = (h: HistoryFile) => write(FILES.history, h);

export function readState(): StateFile {
  const s = readParsed<Partial<StateFile>>(FILES.state, {});
  return {
    ...EMPTY_STATE,
    ...s,
    signIn: { ...EMPTY_STATE.signIn, ...(s.signIn ?? {}) },
  };
}
export const writeState = (s: StateFile) => write(FILES.state, s);
