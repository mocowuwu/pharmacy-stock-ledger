import { useState, type FormEvent } from "react";
import { onlineSignIn } from "../lib/services";
import { readSnapshot } from "../lib/store";
import { Alert, Bar, Spinner } from "./components";
import { useApp } from "./context";
import { Capsule, Icon } from "./icons";

/**
 * The only place anyone signs in. Online, it hands the person to the website
 * already signed in; on the till it also leaves behind what offline sign-in
 * needs -- which is why the website sends its own sign-in page here.
 */
export function LoginScreen() {
  const { t, device, setDevice, go, leaveFor, reachable } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<null | "signing" | "preparing">(null);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  if (!device) return null;
  const businessName = readSnapshot()?.data.settings.businessName || device.businessName;

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
    <div className="screen">
      <Bar title={device.deviceName} sub={t("login.title")}>
        <button className="icon-btn" onClick={() => go("/home")} aria-label={t("home.menu")}>
          <Icon name="settings" size={22} />
        </button>
      </Bar>
      <main>
        <div className="brand-head">
          <span className="brand-mark">
            <Capsule size={40} />
          </span>
          <h2>{businessName || t("app.name")}</h2>
          <p>{t("login.intro")}</p>
        </div>

        {offline ? (
          <div className="card">
            <Alert tone="warning">
              <strong>{t("login.unreachable")}</strong>
              {device.role === "till" ? t("login.unreachableTill") : t("login.managementOffline")}
            </Alert>
            {device.role === "till" ? (
              <button className="primary block" onClick={() => go("/offline")}>
                <Icon name="store" /> {t("login.useOffline")}
              </button>
            ) : null}
          </div>
        ) : null}

        <form className="card" onSubmit={(e) => void submit(e)}>
          <label htmlFor="username">{t("login.username")}</label>
          <input
            id="username"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <label htmlFor="password">{t("login.password")}</label>
          <div className="field">
            <input
              id="password"
              className="has-button"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? t("login.hidePassword") : t("login.showPassword")}
            >
              <Icon name={show ? "eyeOff" : "eye"} />
            </button>
          </div>
          {error ? <Alert tone="critical">{error}</Alert> : null}
          <button className="primary block big" type="submit" disabled={busy !== null} style={{ marginTop: 18 }}>
            {busy ? <Spinner /> : null}
            {busy === "preparing" ? t("login.preparing") : busy ? t("login.signingIn") : t("login.submit")}
          </button>
        </form>
        <p className="hint center">{device.serverUrl.replace(/^https?:\/\//u, "")}</p>
      </main>
    </div>
  );
}
