import { useState, type FormEvent } from "react";
import { onlineSignIn } from "../lib/services";
import { Alert, Bar, StatusLine } from "./components";
import { useApp } from "./context";

/**
 * The only place anyone signs in. Online, it hands the person to the website
 * already signed in; on the till it also leaves behind what offline sign-in
 * needs -- which is why the website sends its own sign-in page here.
 */
export function LoginScreen() {
  const { t, device, setDevice, go, leaveFor, reachable } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "signing" | "preparing">(null);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  if (!device) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!device || busy) return;
    setError(null);
    setUnreachable(false);
    setBusy("signing");
    const result = await onlineSignIn(device, username, password, () => setBusy("preparing"));
    if (result.ok) {
      leaveFor(result.url);
      return;
    }
    setBusy(null);
    setPassword("");
    switch (result.problem) {
      case "invalid":
        setError(t("login.invalid"));
        break;
      case "locked":
        setError(t("login.locked", { minutes: result.minutes ?? 15 }));
        break;
      case "suspended":
        setError(t("login.suspended"));
        break;
      case "revoked":
        setDevice({ ...device, deviceToken: null });
        setError(t("login.revoked"));
        break;
      case "unreachable":
        setUnreachable(true);
        break;
      default:
        setError(t("common.error"));
    }
  }

  const offline = unreachable || reachable === false;

  return (
    <>
      <Bar title={t("login.title")} sub={device.deviceName}>
        <button className="small" onClick={() => go("/home")}>
          {t("common.settings")}
        </button>
      </Bar>
      <StatusLine />
      <main>
        <form className="card" onSubmit={(e) => void submit(e)}>
          <label htmlFor="username">{t("login.username")}</label>
          <input
            id="username"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <label htmlFor="password">{t("login.password")}</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <Alert tone="critical">{error}</Alert> : null}
          <button className="primary block" type="submit" disabled={busy !== null}>
            {busy === "preparing" ? t("login.preparing") : busy ? t("login.signingIn") : t("login.submit")}
          </button>
        </form>

        {offline ? (
          <div className="card">
            <Alert tone="warning">{t("login.unreachable")}</Alert>
            {device.role === "till" ? (
              <button className="block" onClick={() => go("/offline")}>
                {t("login.useOffline")}
              </button>
            ) : (
              <p className="muted small-text">{t("login.managementOffline")}</p>
            )}
          </div>
        ) : null}
        <p className="hint">{t("login.server", { url: device.serverUrl })}</p>
      </main>
    </>
  );
}
