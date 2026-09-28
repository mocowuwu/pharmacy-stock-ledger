import { readQueue } from "../lib/store";
import { Bar, StatusLine } from "./components";
import { useApp } from "./context";

/** The app's own menu, for when the website is not the answer. */
export function HomeScreen() {
  const { t, device, go, revision } = useApp();
  void revision;
  if (!device) return null;
  const pending = readQueue().sales.length;

  return (
    <>
      <Bar
        title={t("home.title")}
        sub={t("home.device", { name: device.deviceName })}
      />
      <StatusLine />
      <main>
        <div className="card stack">
          <button className="primary block" onClick={() => go("/start")}>
            {t("home.openWebsite")}
          </button>
          <button className="block" onClick={() => go("/login")}>
            {t("home.signIn")}
          </button>
          {device.role === "till" ? (
            <button className="block" onClick={() => go("/offline")}>
              {t("home.offlineTill")}
            </button>
          ) : null}
          {device.role === "till" || pending > 0 ? (
            <button className="block" onClick={() => go("/queue")}>
              {t("home.queue")}
              {pending > 0 ? ` (${pending})` : ""}
            </button>
          ) : null}
          <button className="block" onClick={() => go("/setup")}>
            {t("common.settings")}
          </button>
        </div>
        <p className="hint">
          {device.role === "till" ? t("home.roleTill") : t("home.roleManagement")}
          {device.deviceCode ? ` · ${device.deviceCode}` : ""} · {device.serverUrl}
        </p>
      </main>
    </>
  );
}
