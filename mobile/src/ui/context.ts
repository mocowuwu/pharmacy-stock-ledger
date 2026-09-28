import { createContext, useContext } from "react";
import type { Locale, Translate } from "../i18n";
import type { DeviceFile, StoredUser } from "../storage-format";

export type AppContextValue = {
  device: DeviceFile | null;
  setDevice: (d: DeviceFile | null) => void;
  locale: Locale;
  t: Translate;
  /** The person signed in to the offline till. Memory only: a restart signs them out. */
  session: StoredUser | null;
  setSession: (u: StoredUser | null) => void;
  /** null while the first check is in flight. */
  reachable: boolean | null;
  recheck: () => Promise<boolean>;
  /** Bumped whenever the files change, so screens re-read them. */
  revision: number;
  bump: () => void;
  /** Set once the server came back during an offline session and the queue was sent. */
  serverBack: boolean;
  /** `replace` for steps Back should not return to (a finished sale, a sign-in). */
  go: (route: string, opts?: { replace?: boolean }) => void;
  /** Leaves the shell for the website. */
  leaveFor: (url: string) => void;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppContext");
  return ctx;
}
