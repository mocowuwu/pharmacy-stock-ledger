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

function currentRoute(): { path: string; params: URLSearchParams } {
  const hash = window.location.hash.replace(/^#/u, "") || "/start";
  const [path, query = ""] = hash.split("?");
  return { path: path || "/start", params: new URLSearchParams(query) };
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [device, setDeviceState] = useState<DeviceFile | null>(() => store.readDevice());
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

  // On every load: tell the native side which origin may stay in the WebView
  // (it only accepts this from the shell), take in any snapshot the website
  // refreshed while it was showing, and record the clock as seen. A device
  // switched to management keeps no copy at all.
  useEffect(() => {
    if (!device) return;
    native().setServerOrigin(device.serverUrl);
    if (device.role === "till") {
      applySnapshotIfNew();
      touchHighWater();
    } else {
      store.deleteSnapshot();
      store.deleteUsers();
    }
    bump();
  }, [device, bump]);

  const setDevice = useCallback((d: DeviceFile | null) => {
    if (d) store.writeDevice(d);
    setDeviceState(d);
  }, []);

  const recheck = useCallback(async () => {
    if (!device) return false;
    const ok = (await ping(device.serverUrl)) !== null;
    setReachable(ok);
    return ok;
  }, [device]);

  useEffect(() => {
    if (!device) return;
    void recheck();
    const timer = setInterval(() => {
      void recheck();
      if (device.role === "till") touchHighWater();
    }, PING_EVERY_MS);
    return () => clearInterval(timer);
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

  useEffect(() => {
    if (reachable === false) setServerBack(false);
  }, [reachable]);

  const locale: Locale = session?.locale ?? "id";
  const t = useMemo(() => translator(locale), [locale]);

  const go = useCallback((r: string) => {
    window.location.hash = r.startsWith("#") ? r : `#${r}`;
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
