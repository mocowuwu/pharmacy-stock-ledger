import { useEffect, useState, type FormEvent } from "react";
import type { MessageKey } from "../i18n";
import { currentPass, offlineSignIn } from "../lib/services";
import { Alert, Bar, Spinner } from "./components";
import { useApp } from "./context";
import { Icon } from "./icons";

const PROBLEMS: Record<string, MessageKey> = {
  unknown: "offline.unknown",
  no_verifier: "offline.noVerifier",
  too_old: "offline.tooOld",
  not_permitted: "offline.notPermitted",
  invalid: "login.invalid",
};

function hoursLeft(ms: number): number {
  return Math.max(1, Math.floor(ms / 3_600_000));
}

/**
 * The way into the backup till. Three answers, in order: this is a management
 * device (nothing to offer); the pass cannot be trusted (locked, stock only);
 * otherwise, an offline sign-in for someone who signed in here online in the
 * last day.
 */
export function OfflineScreen() {
  const { t, device, go, reachable, recheck, session, setSession, revision, bump, serverBack } = useApp();
  void revision;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in to the till: the till screen checks the pass itself.
  useEffect(() => {
    if (session && device?.role === "till") go("/till", { replace: true });
  }, [session, device, go]);

  if (!device || session) return null;

  async function retry() {
    setRetrying(true);
    const ok = await recheck();
    setRetrying(false);
    if (ok) go("/login");
  }

  const back = () => go("/login");

  const serverIsBack =
    reachable === true ? (
      <Alert tone="ok">
        <strong>{t("till.serverBack")}</strong>
        {serverBack ? t("till.serverBackBody") : t("offline.backBody")}
        <div style={{ marginTop: 10 }}>
          <button className="primary small" onClick={() => go("/login")}>
            {t("till.signInOnline")}
          </button>
        </div>
      </Alert>
    ) : null;

  if (device.role !== "till") {
    return (
      <div className="screen">
        <Bar title={t("mgmt.title")} onBack={back} />
        <main>
          <div className="hero">
            <div className="hero-icon warning">
              <Icon name="offline" size={34} />
            </div>
            <h2>{t("mgmt.title")}</h2>
            <p>{t("mgmt.message")}</p>
          </div>
          <button className="primary block big" onClick={() => void retry()} disabled={retrying} style={{ marginTop: 20 }}>
            {retrying ? <Spinner /> : <Icon name="refresh" />}
            {t("common.retry")}
          </button>
        </main>
      </div>
    );
  }

  const { check } = currentPass();

  if (!check.ok) {
    return (
      <div className="screen">
        <Bar title={t("locked.title")} onBack={back} />
        <main>
          {serverIsBack}
          <div className="hero">
            <div className="hero-icon critical">
              <Icon name="lock" size={32} />
            </div>
            <h2>{t("locked.title")}</h2>
            <p>{t(`locked.${check.problem}` as MessageKey)}</p>
          </div>
          <div className="card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>{t("locked.message")}</p>
            <p className="hint">{t("locked.stockOnly")}</p>
          </div>
          <div className="stack">
            {check.problem !== "no_snapshot" ? (
              <button className="block" onClick={() => go("/stock")}>
                <Icon name="search" /> {t("locked.viewStock")}
              </button>
            ) : null}
            <button className="block" onClick={() => go("/queue")}>
              <Icon name="receipt" /> {t("home.queue")}
            </button>
          </div>
          <p className="hint center" style={{ marginTop: 18 }}>
            {t("offline.checkingServer")}
          </p>
        </main>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await offlineSignIn(username, password);
    setBusy(false);
    setPassword("");
    bump();
    if (result.ok) {
      setSession(result.user);
      go("/till", { replace: true });
      return;
    }
    if (result.problem === "locked") setError(t("login.locked", { minutes: result.minutes ?? 15 }));
    else if (result.problem === "pass") setError(t("till.pass"));
    else setError(t(PROBLEMS[result.problem] ?? "common.error"));
  }

  return (
    <div className="screen">
      <Bar title={t("offline.title")} onBack={back} />
      <main>
        {serverIsBack}
        <div className="hero" style={{ paddingTop: 12 }}>
          <div className="hero-icon warning">
            <Icon name="offline" size={34} />
          </div>
          <h2>{t("offline.heading")}</h2>
          <p>{t("offline.intro")}</p>
        </div>
        <form className="card" onSubmit={(e) => void submit(e)} style={{ marginTop: 18 }}>
          <label htmlFor="u">{t("login.username")}</label>
          <input
            id="u"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <label htmlFor="p">{t("login.password")}</label>
          <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error ? <Alert tone="critical">{error}</Alert> : null}
          <button className="primary block big" type="submit" disabled={busy} style={{ marginTop: 18 }}>
            {busy ? <Spinner /> : null}
            {busy ? t("login.signingIn") : t("offline.submit")}
          </button>
        </form>
        <p className="hint center">
          <Icon name="clock" size={14} /> {t("till.passLeft", { hours: hoursLeft(check.remainingMs) })}
        </p>
      </main>
    </div>
  );
}
