import { useEffect } from "react";
import { syncQueue } from "../lib/services";
import { readQueue } from "../lib/store";
import { Bar, StatusLine } from "./components";
import { useApp } from "./context";

/**
 * Where the app opens. Reachable: straight to the website -- if its session
 * has lapsed, the website sends the person to the app's own sign-in screen.
 * Unreachable: the offline screen, which knows whether this device can sell.
 */
export function StartScreen() {
  const { device, t, recheck, go, leaveFor } = useApp();

  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    void (async () => {
      const ok = await recheck();
      if (cancelled) return;
      if (!ok) {
        go("/offline?reason=unreachable");
        return;
      }
      if (readQueue().sales.length > 0) {
        await Promise.race([
          syncQueue(device).catch(() => undefined),
          new Promise((r) => setTimeout(r, 15_000)),
        ]);
      }
      if (!cancelled) leaveFor(`${device.serverUrl}/`);
    })();
    return () => {
      cancelled = true;
    };
    // Once per arrival on this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Bar title={t("app.name")} />
      <StatusLine />
      <main>
        <p className="muted">{t("status.checking")}</p>
        <button className="block" onClick={() => go("/home")}>
          {t("home.title")}
        </button>
      </main>
    </>
  );
}
