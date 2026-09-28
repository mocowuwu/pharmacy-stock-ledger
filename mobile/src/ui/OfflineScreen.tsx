import { useEffect, useState, type FormEvent } from "react";
import type { MessageKey } from "../i18n";
import { applySnapshotIfNew, currentPass, offlineSignIn } from "../lib/services";
import { Alert, Bar, StatusLine } from "./components";
import { useApp } from "./context";

const PROBLEMS: Record<string, MessageKey> = {
  unknown: "offline.unknown",
  no_verifier: "offline.noVerifier",
  too_old: "offline.tooOld",
  not_permitted: "offline.notPermitted",
  invalid: "login.invalid",
};

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
  const [error, setError] = useState<string | null>(null);

  // Already signed in to the till: the till screen checks the pass itself.
  useEffect(() => {
    if (session && device?.role === "till") go("/till");
  }, [session, device, go]);

  if (!device) return null;

  const back = (
    <button className="small" onClick={() => go("/home")}>
      {t("common.back")}
    </button>
  );

  if (device.role !== "till") {
    return (
      <>
        <Bar title={t("mgmt.title")}>{back}</Bar>
        <StatusLine />
        <main>
          <div className="card">
            <p>{t("mgmt.message")}</p>
            <button className="primary block" onClick={() => void recheck().then((ok) => ok && go("/login"))}>
              {t("common.retry")}
            </button>
          </div>
        </main>
      </>
    );
  }

  applySnapshotIfNew();
  const { check } = currentPass();

  const onlineAgain =
    reachable === true ? (
      <div className="card">
        <Alert tone="ok">{serverBack ? t("till.serverBackBody") : t("status.online")}</Alert>
        <button className="primary block" onClick={() => go("/login")}>
          {t("offline.tryOnline")}
        </button>
      </div>
    ) : null;

  if (!check.ok) {
    return (
      <>
        <Bar title={t("locked.title")}>{back}</Bar>
        <StatusLine />
        <main>
          {onlineAgain}
          <div className="card">
            <Alert tone="critical">{t(`locked.${check.problem}` as MessageKey)}</Alert>
            <p>{t("locked.message")}</p>
            <p className="muted small-text">{t("locked.stockOnly")}</p>
            {check.problem !== "no_snapshot" ? (
              <button className="block" onClick={() => go("/stock")}>
                {t("locked.viewStock")}
              </button>
            ) : null}
            <button className="block" onClick={() => go("/queue")}>
              {t("home.queue")}
            </button>
            <p className="hint">{t("offline.checkingServer")}</p>
          </div>
        </main>
      </>
    );
  }

  if (session) return null;

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
      go("/till");
      return;
    }
    if (result.problem === "locked") setError(t("login.locked", { minutes: result.minutes ?? 15 }));
    else if (result.problem === "pass") setError(t("till.pass"));
    else setError(t(PROBLEMS[result.problem] ?? "common.error"));
  }

  return (
    <>
      <Bar title={t("offline.title")}>{back}</Bar>
      <StatusLine />
      <main>
        {onlineAgain}
        <p className="muted">{t("offline.intro")}</p>
        <form className="card" onSubmit={(e) => void submit(e)}>
          <label htmlFor="u">{t("login.username")}</label>
          <input
            id="u"
            autoCapitalize="off"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <label htmlFor="p">{t("login.password")}</label>
          <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error ? <Alert tone="critical">{error}</Alert> : null}
          <button className="primary block" type="submit" disabled={busy}>
            {busy ? t("login.signingIn") : t("login.submit")}
          </button>
        </form>
        <p className="hint">
          {t("till.passLeft", { hours: Math.max(1, Math.floor(check.remainingMs / 3_600_000)) })}
        </p>
      </main>
    </>
  );
}
