import { translator } from "../i18n";
import type { MessageKey } from "../i18n";
import { native } from "../native";
import { readHistory, readQueue, readSnapshot } from "../lib/store";
import type { Receipt } from "../storage-format";
import { Alert, Bar, StatusLine } from "./components";
import { useApp } from "./context";
import { formatExpiry, formatMoney, formatMoment, formatRate } from "./format";

/**
 * The customer's receipt for an offline sale.
 *
 * In the pharmacy's receipt language, not the cashier's: it is the customer's
 * document. It says plainly that the number is temporary -- the real one comes
 * when the phone syncs, and the server keeps this one on the sale so a paper
 * receipt can always be matched to it.
 */
export function ReceiptScreen({ clientId }: { clientId: string }) {
  const { t, go, session, revision } = useApp();
  void revision;

  const queued = readQueue().sales.find((e) => e.sale.clientId === clientId);
  const synced = readHistory().sales.find((e) => e.clientId === clientId);
  const receipt: Receipt | undefined = queued?.receipt ?? synced?.receipt;
  const snapshot = readSnapshot();

  const back = (
    <button className="small" onClick={() => go(session ? "/till" : "/queue")}>
      {t("common.back")}
    </button>
  );

  if (!receipt || !snapshot) {
    return (
      <>
        <Bar title={t("receipt.number")}>{back}</Bar>
        <main>
          <Alert tone="warning">{t("receipt.notFound")}</Alert>
        </main>
      </>
    );
  }

  const s = snapshot.data.settings;
  const r = translator(s.receiptLocale);
  const loc = s.receiptLocale;

  return (
    <>
      <Bar title={receipt.offlineNumber}>{back}</Bar>
      <StatusLine />
      <main>
        <div className="no-print">
          {queued ? <Alert tone="notice">{t("receipt.queued")}</Alert> : null}
          {synced ? (
            <Alert tone={synced.status === "review" ? "warning" : "ok"}>
              {synced.saleNumber ? t("receipt.synced", { number: synced.saleNumber }) : null}{" "}
              {t(`queue.status.${synced.status}` as MessageKey)}
            </Alert>
          ) : null}
        </div>

        <div className="card receipt">
          <div className="head">
            {/* The same fallback the website's receipt uses (its app.name). */}
            <strong>{s.businessName || r("receipt.fallbackName")}</strong>
            {s.businessAddress ? <div>{s.businessAddress}</div> : null}
            {s.businessPhone ? (
              <div>
                {r("receipt.phone")} {s.businessPhone}
              </div>
            ) : null}
            {s.npwp ? (
              <div>
                {r("receipt.npwp")} {s.npwp}
              </div>
            ) : null}
            {s.licenceNumber ? (
              <div>
                {r("receipt.licence")} {s.licenceNumber}
              </div>
            ) : null}
          </div>
          <div className="offline-note">{r("receipt.offline")}</div>
          <div className="line">
            <span>{r("receipt.number")}</span>
            <span>{receipt.offlineNumber}</span>
          </div>
          <div className="line">
            <span>{r("receipt.date")}</span>
            <span>{formatMoment(receipt.soldAt, loc, s.timezone)}</span>
          </div>
          <div className="line">
            <span>{r("receipt.cashier")}</span>
            <span>{receipt.cashierName}</span>
          </div>
          <hr />
          {receipt.lines.map((line) => (
            <div key={line.itemId} style={{ marginBottom: 6 }}>
              <div>{line.name}</div>
              <div className="line">
                <span>
                  {line.qty} {line.unit} × {formatMoney(line.unitPrice)}
                </span>
                <span>{formatMoney(line.amount)}</span>
              </div>
              {line.lots.map((lot) => (
                <div className="lot" key={lot.batchId}>
                  {r("receipt.lot")} {lot.lotNumber ?? "—"} · {r("receipt.expiry")} {formatExpiry(lot.expiryDate, loc)}
                </div>
              ))}
            </div>
          ))}
          <hr />
          <div className="line">
            <span>{r("receipt.subtotal")}</span>
            <span>{formatMoney(receipt.subtotal)}</span>
          </div>
          {receipt.discount > 0 ? (
            <div className="line">
              <span>{r("receipt.discount")}</span>
              <span>−{formatMoney(receipt.discount)}</span>
            </div>
          ) : null}
          {receipt.taxAmount > 0 && receipt.taxRateBps != null ? (
            <div className="line">
              <span>
                {receipt.taxMode === "inclusive"
                  ? r("receipt.taxIncluded", { rate: formatRate(receipt.taxRateBps) })
                  : r("receipt.tax", { rate: formatRate(receipt.taxRateBps) })}
              </span>
              <span>{formatMoney(receipt.taxAmount)}</span>
            </div>
          ) : null}
          <div className="line" style={{ fontWeight: 700, fontSize: 15 }}>
            <span>{r("receipt.total")}</span>
            <span>{formatMoney(receipt.total)}</span>
          </div>
          <div className="line">
            <span>{r("receipt.payment")}</span>
            <span>{r(`payment.${receipt.paymentMethod}` as MessageKey)}</span>
          </div>
          {receipt.tendered != null ? (
            <>
              <div className="line">
                <span>{r("receipt.tendered")}</span>
                <span>{formatMoney(receipt.tendered)}</span>
              </div>
              <div className="line">
                <span>{r("receipt.change")}</span>
                <span>{formatMoney(receipt.change ?? 0)}</span>
              </div>
            </>
          ) : null}
          <hr />
          <p style={{ textAlign: "center", margin: 0 }}>{r("receipt.offlineHelp")}</p>
          {s.receiptFooter ? <p style={{ textAlign: "center", margin: "6px 0 0" }}>{s.receiptFooter}</p> : null}
        </div>

        <div className="no-print">
          <button className="block" onClick={() => native().print(receipt.offlineNumber)}>
            {t("receipt.print")}
          </button>
          {session ? (
            <button className="primary block" onClick={() => go("/till")}>
              {t("receipt.newSale")}
            </button>
          ) : null}
        </div>
      </main>
    </>
  );
}
