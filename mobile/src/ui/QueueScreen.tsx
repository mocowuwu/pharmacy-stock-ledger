import { useCallback, useState } from "react";
import type { MessageKey } from "../i18n";
import { syncQueue } from "../lib/services";
import { readHistory, readQueue, readSnapshot } from "../lib/store";
import { Alert, Bar, Empty, Spinner, Toast } from "./components";
import { useApp } from "./context";
import { formatMoney, formatMoment } from "./format";
import { Icon } from "./icons";

const STATUS_TONE: Record<string, string> = { posted: "ok", review: "warning", duplicate: "" };

/**
 * "Are my sales safe?" -- what is still on the phone, and what the server did
 * with what it has received, with the real number next to the temporary one.
 */
export function QueueScreen() {
  const { t, locale, device, go, session, revision, bump, reachable } = useApp();
  void revision;
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  if (!device) return null;
  const queue = readQueue().sales;
  const history = readHistory().sales;
  const tz = readSnapshot()?.data.settings.timezone ?? "Asia/Jakarta";
  const waitingTotal = queue.reduce((sum, e) => sum + e.sale.total, 0);

  async function send() {
    if (!device) return;
    setBusy(true);
    setError(null);
    const result = await syncQueue(device);
    setBusy(false);
    bump();
    if (result.ok) setToast(t("queue.sent", { n: result.sent }));
    else
      setError(
        result.reason === "unreachable"
          ? t("queue.unreachable")
          : result.reason === "revoked"
            ? t("queue.revoked")
            : t("queue.failed"),
      );
  }

  return (
    <div className="screen">
      <Bar title={t("queue.title")} onBack={() => go(session ? "/till" : "/home")} />
      <main>
        <div className="section-title">
          <span>{t("queue.pending", { n: queue.length })}</span>
          {queue.length > 0 ? <span className="num">{formatMoney(waitingTotal)}</span> : null}
        </div>
        {queue.length === 0 ? (
          <div className="card">
            <Empty icon="checkCircle">{t("queue.none")}</Empty>
          </div>
        ) : (
          <>
            <div className="card flush">
              {queue.map((e) => (
                <button
                  key={e.sale.clientId}
                  className="list-row"
                  onClick={() => go(`/receipt/${encodeURIComponent(e.sale.clientId)}`)}
                >
                  <span className="glyph" style={{ background: "var(--warning-soft)", color: "var(--warning-ink)" }}>
                    <Icon name="clock" />
                  </span>
                  <span className="body">
                    <span className="title mono">{e.sale.offlineNumber}</span>
                    <span className="meta">
                      {formatMoment(e.receipt.soldAt, locale, tz)} · {e.receipt.cashierName}
                    </span>
                  </span>
                  <span className="num">{formatMoney(e.sale.total)}</span>
                </button>
              ))}
            </div>
            {error ? <Alert tone="critical">{error}</Alert> : null}
            <button className="primary block big" disabled={busy || reachable === false} onClick={() => void send()}>
              {busy ? <Spinner /> : <Icon name="upload" />}
              {busy ? t("queue.syncing") : reachable === false ? t("queue.waitingForServer") : t("queue.syncNow")}
            </button>
          </>
        )}

        <div className="section-title">
          <span>{t("queue.history")}</span>
        </div>
        {history.length === 0 ? (
          <div className="card">
            <Empty icon="receipt">{t("queue.historyNone")}</Empty>
          </div>
        ) : (
          <div className="card flush">
            {history.map((h) => (
              <button key={h.clientId} className="list-row" onClick={() => go(`/receipt/${encodeURIComponent(h.clientId)}`)}>
                <span className="body">
                  <span className="title">
                    <span className="mono">{h.saleNumber ?? h.offlineNumber}</span>
                  </span>
                  <span className="meta">
                    {h.saleNumber ? <span className="mono">{h.offlineNumber}</span> : null}
                    <span>{formatMoment(h.receipt.soldAt, locale, tz)}</span>
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span className="num" style={{ display: "block", fontWeight: 650 }}>
                    {formatMoney(h.receipt.total)}
                  </span>
                  <span className={`chip ${STATUS_TONE[h.status] ?? ""}`}>{t(`queue.status.${h.status}` as MessageKey)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
