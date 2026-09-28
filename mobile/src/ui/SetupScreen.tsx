import { useState } from "react";
import type { DeviceRole } from "@/lib/offline/contract";
import { normaliseServerUrl, ping } from "../lib/api";
import { readDevice, readQueue } from "../lib/store";
import { Alert, Bar, Spinner } from "./components";
import { useApp } from "./context";
import { Icon } from "./icons";

/**
 * First run, and later from the menu: which server, what this phone is called,
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
  const [checked, setChecked] = useState<{ url: string; name: string; businessName: string } | null>(
    existing ? { url: existing.serverUrl, name: "", businessName: existing.businessName ?? "" } : null,
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
    setChecked({ url, name: answer.businessName.trim() || new URL(url).host, businessName: answer.businessName.trim() });
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
      businessName: checked.businessName || null,
    });
    go("/login", { replace: true });
  }

  const verified = checked !== null && checked.url === normaliseServerUrl(server);

  return (
    <div className="screen">
      <Bar title={t("setup.title")} status={false} onBack={existing ? () => go("/home") : undefined} />
      <main>
        <p className="lead">{t("setup.intro")}</p>

        <div className="card">
          <label htmlFor="server">{t("setup.server")}</label>
          <div className="row">
            <input
              id="server"
              className="grow"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={server}
              onChange={(e) => {
                setServer(e.target.value);
                setChecked(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void check()}
              placeholder="https://…ts.net"
            />
            <button className={verified ? "soft" : ""} onClick={() => void check()} disabled={checking} style={{ minHeight: 52 }}>
              {checking ? <Spinner /> : verified ? <Icon name="check" /> : null}
              {checking ? t("setup.checking") : verified ? t("setup.checked") : t("setup.check")}
            </button>
          </div>
          {checked?.name && verified ? (
            <Alert tone="ok">{t("setup.found", { name: checked.name })}</Alert>
          ) : (
            <p className="hint">{t("setup.serverHint")}</p>
          )}

          <label htmlFor="name">{t("setup.deviceName")}</label>
          <input
            id="name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("setup.deviceNameHint")}
          />
        </div>

        <div className="section-title">{t("setup.role")}</div>
        <div className="choices" style={{ marginBottom: 14 }}>
          <button className="choice" aria-pressed={role === "till"} onClick={() => setRole("till")}>
            <strong>
              <Icon name="store" /> {t("setup.roleTill")}
            </strong>
            <span>{t("setup.roleTillHelp")}</span>
          </button>
          <button className="choice" aria-pressed={role === "management"} onClick={() => setRole("management")}>
            <strong>
              <Icon name="phone" /> {t("setup.roleManagement")}
            </strong>
            <span>{t("setup.roleManagementHelp")}</span>
          </button>
        </div>

        {error ? <Alert tone="critical">{error}</Alert> : null}
        <button className="primary block big" onClick={save}>
          {t("setup.save")}
        </button>
        {existing ? <p className="hint center mono">{t("setup.deviceId", { id: existing.deviceId })}</p> : null}
      </main>
    </div>
  );
}
