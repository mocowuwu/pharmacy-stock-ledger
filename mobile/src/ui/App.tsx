import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translator, type Locale } from "../i18n";
import { native } from "../native";
import { ping } from "../lib/api";
import {
  applySnapshotIfNew,
  canResume,
  refreshSnapshot,
  resumeOnline,
  setLive,
  snapshotDue,
  syncQueue,
  touchHighWater,
} from "../lib/services";
import * as store from "../lib/store";
import type { DeviceFile, StoredUser } from "../storage-format";
import { AppContext, type AppContextValue } from "./context";
import "./back";
import { HomeScreen } from "./HomeScreen";
import { LoginScreen } from "./LoginScreen";
import { OfflineScreen } from "./OfflineScreen";
import { QueueScreen } from "./QueueScreen";
import { ReceiptScreen } from "./ReceiptScreen";
import { SetupScreen } from "./SetupScreen";
import { StartScreen } from "./StartScreen";
import { TillScreen } from "./TillScreen";

/** While the shell is open the server is pinged this often; offline, it is how the till notices the server is back. */
const PING_EVERY_MS = 15_000;

/**
 * Brings the files in line with the device before anything reads them: tells
 * the native side which origin may stay in the WebView (it only accepts this
 * from the app's own pages), takes in any snapshot the website refreshed while
 * it was showing, and records the clock as seen. A device switched to
 * management keeps no copy at all. Done as the device is set, not in an
 * effect, so no screen ever renders the files as they were a moment before.
 */
function prepareDevice(device: DeviceFile | null): DeviceFile | null {
  if (!device) return null;
  native().setServerOrigin(device.serverUrl);
  if (device.role === "till") {
    applySnapshotIfNew();
    touchHighWater();
  } else {
    store.deleteSnapshot();
    store.deleteUsers();
  }
  return device;
}

function currentRoute(): { path: string; params: URLSearchParams } {
  const hash = window.location.hash.replace(/^#/u, "") || "/start";
  const [path, query = ""] = hash.split("?");
  return { path: path || "/start", params: new URLSearchParams(query) };
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [device, setDeviceState] = useState<DeviceFile | null>(() => prepareDevice(store.readDevice()));
  const [session, setSessionState] = useState<StoredUser | null>(null);
  const sessionRef = useRef<StoredUser | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [revision, setRevision] = useState(0);
  const [serverBack, setServerBack] = useState(false);
  const wasReachable = useRef<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  // The first screen has drawn: the launch screen can give way to it.
  useEffect(() => {
    native().ready();
  }, []);

  const setDevice = useCallback((d: DeviceFile | null) => {
    if (d) store.writeDevice(d);
    setDeviceState(prepareDevice(d));
  }, []);

  // Signing out also forgets the till session (and any password held to get one).
  const setSession = useCallback((u: StoredUser | null) => {
    if (!u) setLive(null);
    sessionRef.current = u;
    setSessionState(u);
  }, []);

  /**
   * What the till does while the server answers, on every ping: anything on
   * the phone goes at once, the copy is kept fresh, a cashier who signed in
   * offline is taken online, and one the server no longer recognises
   * (suspended, password changed) is signed out.
   */
  const maintaining = useRef(false);
  const maintain = useCallback(async () => {
    if (!device || maintaining.current) return;
    maintaining.current = true;
    try {
      let changed = false;
      if (store.readQueue().sales.length > 0) {
        const sent = await syncQueue(device).catch(() => null);
        if (sent && sent.sent > 0) changed = true;
      }
      if (device.role === "till" && snapshotDue()) {
        await refreshSnapshot(device).catch(() => undefined);
        changed = true;
      }
      const who = sessionRef.current;
      if (who && device.role === "till") {
        if (!store.readUsers().users.some((u) => u.id === who.id)) {
          setSession(null);
          changed = true;
        } else if (canResume(who.id) && (await resumeOnline(store.readDevice() ?? device, who))) {
          changed = true;
        }
      }
      const current = store.readDevice();
      if (current && current.deviceToken !== device.deviceToken) setDeviceState(current);
      if (changed) bump();
    } finally {
      maintaining.current = false;
    }
  }, [device, bump, setSession]);

  const recheck = useCallback(async () => {
    if (!device) return false;
    const answer = await ping(device.serverUrl);
    setReachable(answer !== null);
    // "Sent while you were offline" belongs to one reconnection only.
    if (answer === null) setServerBack(false);
    // The owner may rename the pharmacy in Settings; the sign-in screen follows.
    const name = answer?.businessName.trim() || null;
    if (answer && name !== (device.businessName ?? null)) {
      const updated = { ...device, businessName: name };
      store.writeDevice(updated);
      setDeviceState(updated);
    }
    return answer !== null;
  }, [device]);

  useEffect(() => {
    if (!device) return;
    const first = setTimeout(() => void recheck(), 0);
    const timer = setInterval(() => {
      void recheck().then((ok) => (ok ? maintain() : undefined));
      if (device.role === "till") touchHighWater();
    }, PING_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [device, recheck, maintain]);

  // The server came back: send the queue, then take a fresh copy (and with it
  // a new pass), then take the cashier online.
  useEffect(() => {
    const before = wasReachable.current;
    wasReachable.current = reachable;
    if (!device || reachable !== true || before === true) return;
    if (store.readQueue().sales.length === 0 && device.role !== "till") return;
    let cancelled = false;
    void (async () => {
      await syncQueue(device).catch(() => undefined);
      await refreshSnapshot(device).catch(() => undefined);
      if (cancelled) return;
      if (before === false) setServerBack(true);
      bump();
      await maintain();
    })();
    return () => {
      cancelled = true;
    };
  }, [reachable, device, bump, maintain]);

  // Back from the background -- after lunch, after a call -- the status and
  // the pass should be right on the first glance, not 15 seconds later.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void recheck();
      bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recheck, bump]);

  // Before anyone signs in, the screens speak the language of whoever signed
  // in here last: on a phone one cashier uses all day, that is theirs.
  const lastLocale = useMemo<Locale>(() => {
    const users = store.readUsers().users;
    const latest = [...users].sort((a, b) => b.signedInAt.localeCompare(a.signedInAt))[0];
    return latest?.locale ?? "id";
    // Re-read when the files change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const locale: Locale = session?.locale ?? lastLocale;
  const t = useMemo(() => translator(locale), [locale]);

  const go = useCallback((r: string, opts?: { replace?: boolean }) => {
    const hash = r.startsWith("#") ? r : `#${r}`;
    if (opts?.replace) window.location.replace(hash);
    else window.location.hash = hash;
  }, []);

  const leaveFor = useCallback(
    (url: string) => {
      if (device) native().setServerOrigin(device.serverUrl);
      window.location.href = url;
    },
    [device],
  );

  const value: AppContextValue = {
    device,
    setDevice,
    locale,
    t,
    session,
    setSession,
    reachable,
    recheck,
    revision,
    bump,
    serverBack,
    go,
    leaveFor,
  };

  let screen;
  if (!device && route.path !== "/setup") {
    screen = <SetupScreen />;
  } else {
    switch (route.path) {
      case "/setup":
        screen = <SetupScreen />;
        break;
      case "/login":
        screen = <LoginScreen key={route.params.get("to") ?? ""} website={route.params.get("to") === "web"} />;
        break;
      case "/home":
        screen = <HomeScreen />;
        break;
      case "/offline":
        screen = <OfflineScreen />;
        break;
      case "/till":
        screen = <TillScreen readOnly={false} />;
        break;
      case "/stock":
        screen = <TillScreen readOnly />;
        break;
      case "/queue":
        screen = <QueueScreen />;
        break;
      default:
        if (route.path.startsWith("/receipt/")) {
          screen = <ReceiptScreen clientId={decodeURIComponent(route.path.slice("/receipt/".length))} />;
        } else {
          screen = <StartScreen />;
        }
    }
  }

  return <AppContext.Provider value={value}>{screen}</AppContext.Provider>;
}
