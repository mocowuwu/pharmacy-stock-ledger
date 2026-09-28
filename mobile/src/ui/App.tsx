import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translator, type Locale } from "../i18n";
import { native } from "../native";
import { ping } from "../lib/api";
import {
  applySnapshotIfNew,
  refreshSnapshot,
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
  const [session, setSession] = useState<StoredUser | null>(null);
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
      void recheck();
      if (device.role === "till") touchHighWater();
    }, PING_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [device, recheck]);

  // The server came back: send the queue, then take a fresh copy (and with it
  // a new pass), then invite the cashier to go online.
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
    })();
    return () => {
      cancelled = true;
    };
  }, [reachable, device, bump]);

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
        screen = <LoginScreen />;
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
