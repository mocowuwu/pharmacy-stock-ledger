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

function write(name: FileName, value: unknown): void {
  if (!native().writeFile(name, JSON.stringify(value))) {
    throw new StorageError(`Could not write ${name}`);
  }
}

export function readDevice(): DeviceFile | null {
  const d = parseFile<DeviceFile | null>(native().readFile(FILES.device), null);
  return d && d.deviceId && d.serverUrl ? d : null;
}
export const writeDevice = (d: DeviceFile) => write(FILES.device, d);

export function readSnapshot(): SnapshotFile | null {
  const s = parseFile<SnapshotFile | null>(native().readFile(FILES.snapshot), null);
  return s && s.data && s.data.pass ? s : null;
}
export const writeSnapshot = (s: SnapshotFile) => write(FILES.snapshot, s);
export const deleteSnapshot = () => native().deleteFile(FILES.snapshot);

export function readUsers(): UsersFile {
  const u = parseFile<UsersFile>(native().readFile(FILES.users), { users: [] });
  return Array.isArray(u.users) ? u : { users: [] };
}
export const writeUsers = (u: UsersFile) => write(FILES.users, u);
export const deleteUsers = () => native().deleteFile(FILES.users);

/**
 * The queue holds sales that exist nowhere else. If it ever fails to parse,
 * the unreadable text is set aside in `queuedamaged.json` before anything
 * overwrites it, so a person can still recover the sales by hand.
 */
export function readQueue(): QueueFile {
  const text = native().readFile(FILES.queue);
  const q = parseFile<QueueFile | null>(text, null);
  if (q && Array.isArray(q.sales)) return q;
  if (text != null && text !== "" && native().readFile("queuedamaged.json") == null) {
    native().writeFile("queuedamaged.json", JSON.stringify({ text }));
  }
  return { sales: [] };
}
export const writeQueue = (q: QueueFile) => write(FILES.queue, q);

export function readHistory(): HistoryFile {
  const h = parseFile<HistoryFile>(native().readFile(FILES.history), { sales: [] });
  return Array.isArray(h.sales) ? h : { sales: [] };
}
export const writeHistory = (h: HistoryFile) => write(FILES.history, h);

export function readState(): StateFile {
  const s = parseFile<Partial<StateFile>>(native().readFile(FILES.state), {});
  return {
    ...EMPTY_STATE,
    ...s,
    signIn: { ...EMPTY_STATE.signIn, ...(s.signIn ?? {}) },
  };
}
export const writeState = (s: StateFile) => write(FILES.state, s);
