import { useState } from "react";
import type { MessageKey } from "../i18n";
import { syncQueue } from "../lib/services";
import { readHistory, readQueue, readSnapshot } from "../lib/store";
import { Alert, Bar, StatusLine } from "./components";
import { useApp } from "./context";
import { formatMoney, formatMoment } from "./format";

/**
 * "Are my sales safe?" -- what is still on the phone, and what the server did
 * with what it has received, with the real number next to the temporary one.
 */
export function QueueScreen() {
  const { t, locale, device, go, session, revision, bump } = useApp();
  void revision;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "critical"; text: string } | null>(null);

  if (!device) return null;
  const queue = readQueue().sales;
  const history = readHistory().sales;
  const tz = readSnapshot()?.data.settings.timezone ?? "Asia/Jakarta";

  async function send() {
    if (!device) return;
    setBusy(true);
    setMessage(null);
    const result = await syncQueue(device);
    setBusy(false);
    bump();
    if (result.ok) setMessage({ tone: "ok", text: t("queue.sent", { n: result.sent }) });
    else
      setMessage({
        tone: "critical",
        text:
          result.reason === "unreachable"
            ? t("queue.unreachable")
            : result.reason === "revoked"
              ? t("queue.revoked")
              : t("queue.failed"),
      });
  }

  return (
    <>
      <Bar title={t("queue.title")}>
        <button className="small" onClick={() => go(session ? "/till" : "/home")}>
          {t("common.back")}
        </button>
      </Bar>
      <StatusLine />
      <main>
        <div className="card">
          <h2>{t("queue.pending", { n: queue.length })}</h2>
          {queue.length === 0 ? <p className="muted">{t("queue.none")}</p> : null}
          {queue.map((e) => (
            <button
              key={e.sale.clientId}
              className="item"
              style={{ width: "100%", border: 0, borderTop: "1px solid var(--rule)", borderRadius: 0, textAlign: "left" }}
              onClick={() => go(`/receipt/${encodeURIComponent(e.sale.clientId)}`)}
            >
              <span style={{ flex: 1 }}>
                <span className="name">{e.sale.offlineNumber}</span>
                <span className="meta">
                  {formatMoment(e.receipt.soldAt, locale, tz)} · {e.receipt.cashierName}
                </span>
              </span>
              <span className="num">{formatMoney(e.sale.total)}</span>
            </button>
          ))}
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          {queue.length > 0 ? (
            <button className="primary block" disabled={busy} onClick={() => void send()}>
              {busy ? t("queue.syncing") : t("queue.syncNow")}
            </button>
          ) : null}
        </div>

        <div className="card">
          <h2>{t("queue.history")}</h2>
          {history.length === 0 ? <p className="muted">{t("queue.historyNone")}</p> : null}
          {history.map((h) => (
            <button
              key={h.clientId}
              className="item"
              style={{ width: "100%", border: 0, borderTop: "1px solid var(--rule)", borderRadius: 0, textAlign: "left" }}
              onClick={() => go(`/receipt/${encodeURIComponent(h.clientId)}`)}
            >
              <span style={{ flex: 1 }}>
                <span className="name">
                  {h.offlineNumber}
                  {h.saleNumber ? ` → ${h.saleNumber}` : ""}
                </span>
                <span className="meta">
                  <span style={{ color: h.status === "review" ? "var(--warning-ink)" : undefined }}>
                    {t(`queue.status.${h.status}` as MessageKey)}
                  </span>
                  <span>{formatMoment(h.receipt.soldAt, locale, tz)}</span>
                </span>
              </span>
              <span className="num">{formatMoney(h.receipt.total)}</span>
            </button>
          ))}
        </div>
      </main>
    </>
  );
}
