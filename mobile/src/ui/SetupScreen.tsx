import { useState } from "react";
import type { DeviceRole } from "@/lib/offline/contract";
import { normaliseServerUrl, ping } from "../lib/api";
import { readDevice, readQueue } from "../lib/store";
import { Alert, Bar } from "./components";
import { useApp } from "./context";

/**
 * First run, and later from Settings: which server, what this phone is called,
 * and whether it is the till.
 *
 * Changing the server or the role is refused while offline sales are still
 * waiting: they belong to the server they were rung against, and a till
 * switched to management would stop trying to send them.
 */
export function SetupScreen() {
  const { t, setDevice, go } = useApp();
  const existing = readDevice();
  const [server, setServer] = useState(existing?.serverUrl ?? "");
  const [checked, setChecked] = useState<{ url: string; name: string } | null>(
    existing ? { url: existing.serverUrl, name: "" } : null,
  );
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState(existing?.deviceName ?? "");
  const [role, setRole] = useState<DeviceRole>(existing?.role ?? "till");
  const [error, setError] = useState<string | null>(null);

  const pending = readQueue().sales.length;

  async function check() {
    setError(null);
    const url = normaliseServerUrl(server);
    if (!url) {
      setError(t("setup.invalidUrl"));
      return;
    }
    setChecking(true);
    const answer = await ping(url, 8_000);
    setChecking(false);
    if (!answer) {
      setChecked(null);
      setError(t("setup.notFound"));
      return;
    }
    setServer(url);
    // A pharmacy that has not named itself in Settings yet still gets a
    // confirmation -- silence here reads as "nothing happened".
    setChecked({ url, name: answer.businessName.trim() || new URL(url).host });
  }

  function save() {
    setError(null);
    const url = normaliseServerUrl(server);
    if (!url || !checked || checked.url !== url) {
      setError(t("setup.mustCheck"));
      return;
    }
    if (!name.trim()) {
      setError(t("setup.deviceNameRequired"));
      return;
    }
    const changing = existing && (existing.serverUrl !== url || existing.role !== role);
    if (changing && pending > 0) {
      setError(t("setup.pendingBlock", { n: pending }));
      return;
    }
    const serverChanged = existing && existing.serverUrl !== url;
    setDevice({
      deviceId: existing?.deviceId ?? crypto.randomUUID(),
      deviceName: name.trim(),
      role,
      serverUrl: url,
      // A token and code belong to one server.
      deviceToken: serverChanged ? null : (existing?.deviceToken ?? null),
      deviceCode: serverChanged ? null : (existing?.deviceCode ?? null),
    });
    go("/login");
  }

  return (
    <>
      <Bar title={t("setup.title")}>
        {existing ? (
          <button className="small" onClick={() => go("/home")}>
            {t("common.back")}
          </button>
        ) : null}
      </Bar>
      <main>
        <p className="muted">{t("setup.intro")}</p>
        <div className="card">
          <label htmlFor="server">{t("setup.server")}</label>
          <div className="row">
            <input
              id="server"
              className="grow"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              value={server}
              onChange={(e) => {
                setServer(e.target.value);
                setChecked(null);
              }}
              placeholder="https://…ts.net"
            />
            <button onClick={() => void check()} disabled={checking}>
              {checking ? t("setup.checking") : t("setup.check")}
            </button>
          </div>
          <p className="hint">{t("setup.serverHint")}</p>
          {checked?.name ? <Alert tone="ok">{t("setup.found", { name: checked.name })}</Alert> : null}

          <label htmlFor="name">{t("setup.deviceName")}</label>
          <input
            id="name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("setup.deviceNameHint")}
          />

          <label>{t("setup.role")}</label>
          <div className="choices">
            <button className="role-choice" aria-pressed={role === "till"} onClick={() => setRole("till")}>
              <strong>{t("setup.roleTill")}</strong>
              <span className="small-text">{t("setup.roleTillHelp")}</span>
            </button>
            <button
              className="role-choice"
              aria-pressed={role === "management"}
              onClick={() => setRole("management")}
            >
              <strong>{t("setup.roleManagement")}</strong>
              <span className="small-text">{t("setup.roleManagementHelp")}</span>
            </button>
          </div>

          {error ? <Alert tone="critical">{error}</Alert> : null}
          <button className="primary block" onClick={save}>
            {t("setup.save")}
          </button>
        </div>
        {existing ? <p className="hint">{t("setup.deviceId", { id: existing.deviceId })}</p> : null}
      </main>
    </>
  );
}
