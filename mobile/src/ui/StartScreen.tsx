import { useEffect, useState } from "react";
import { syncQueue } from "../lib/services";
import { readQueue, readSnapshot } from "../lib/store";
import { Spinner } from "./components";
import { useApp } from "./context";
import { Capsule } from "./icons";

/**
 * Where the app opens: a continuation of the launch screen -- same dark
 * chrome, same capsule -- while it finds out whether the server is there.
 *
 * Reachable: anything rung offline is sent, then straight to the website (if
 * its session has lapsed, the website sends the person to the app's sign-in).
 * Unreachable: the offline screen, which knows whether this phone can sell.
 */
export function StartScreen() {
  const { device, t, recheck, go, leaveFor } = useApp();
  const [phase, setPhase] = useState<"checking" | "sending" | "opening">("checking");
  const name = readSnapshot()?.data.settings.businessName || device?.businessName;

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
        setPhase("sending");
        await Promise.race([
          syncQueue(device).catch(() => undefined),
          new Promise((r) => setTimeout(r, 15_000)),
        ]);
      }
      if (cancelled) return;
      setPhase("opening");
      leaveFor(`${device.serverUrl}/`);
    })();
    return () => {
      cancelled = true;
    };
    // Once per arrival on this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="splash">
      <span className="brand-mark">
        <Capsule size={56} />
      </span>
      <div className="name">{name || t("app.name")}</div>
      <div className="note">
        <Spinner />
        {phase === "sending" ? t("start.sending") : phase === "opening" ? t("start.opening") : t("start.connecting")}
      </div>
      <button className="small ghost" style={{ color: "var(--chrome-muted)", marginTop: 24 }} onClick={() => go("/home")}>
        {t("start.menu")}
      </button>
    </div>
  );
}
