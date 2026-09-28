import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { PAYMENT_METHODS, type PaymentMethod, type SnapshotItem } from "@/lib/offline/contract";
import { RESTRICTED_DRUG_CLASSES } from "@/lib/catalogue/enums";
import type { MessageKey } from "../i18n";
import { checkPass } from "../lib/pass";
import { clock, recordSale } from "../lib/services";
import { hasPermission } from "../lib/signin";
import { readQueue, readSnapshot, readState } from "../lib/store";
import {
  allocateItem,
  cartTotals,
  findByCode,
  itemName,
  MIN_QUERY,
  offlineToday,
  searchItems,
  stockOf,
  usedByBatch,
  type CartLine,
} from "../lib/till";
import { Alert, Bar, DrugMark, StatusLine } from "./components";
import { useApp } from "./context";
import { formatExpiry, formatMoney, parseMoney } from "./format";

/**
 * The backup till. Deliberately smaller than the website's: sell, and look up
 * stock -- nothing else is possible offline. Every rule that decides money or
 * stock lives in lib/till.ts and the server modules it imports; this screen
 * only gathers the cart and shows what those rules say.
 *
 * `readOnly` is the locked till: stock and expiry can be looked up, nothing
 * can be sold.
 */
export function TillScreen({ readOnly }: { readOnly: boolean }) {
  const { t, locale, session, setSession, go, revision, bump, reachable, serverBack } = useApp();
  void revision;

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountText, setDiscountText] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("tunai");
  const [tenderedText, setTenderedText] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const snapshot = readSnapshot();
  const state = readState();
  const c = clock();
  const pass = checkPass(snapshot, state.usage, c, state.wallHighWater);

  // Selling needs a person and a pass; either missing sends the cashier back
  // to the sign-in screen, which says which.
  const mustLeave = !readOnly && (!session || !pass.ok);
  useEffect(() => {
    if (mustLeave) go("/offline");
  }, [mustLeave, go]);

  const items = snapshot?.data.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  if (!snapshot || mustLeave) return null;

  const tz = snapshot.data.settings.timezone;
  // Offline-now; when locked (read-only), the last trustworthy moment is the
  // pass's own time, which is the best the phone can say about "today".
  const now = pass.ok ? pass.now : Date.parse(snapshot.data.pass.issuedAt);
  const today = offlineToday(now, tz);
  const used = usedByBatch(snapshot, state.usage, readQueue());
  const results = searchItems(items, query);

  const mayDiscount = session ? hasPermission(session, "sales.discount") : false;
  const discount = mayDiscount ? (parseMoney(discountText) ?? 0) : 0;
  const totals = cartTotals(snapshot, cart, discount);
  const tendered = payment === "tunai" ? parseMoney(tenderedText) : null;

  function add(item: SnapshotItem) {
    setError(null);
    setCart((lines) => {
      const found = lines.find((l) => l.itemId === item.id);
      if (found) return lines.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...lines, { itemId: item.id, qty: 1 }];
    });
  }

  function setQty(itemId: string, qty: number) {
    setCart((lines) =>
      qty <= 0 ? lines.filter((l) => l.itemId !== itemId) : lines.map((l) => (l.itemId === itemId ? { ...l, qty } : l)),
    );
  }

  // A barcode scanner types the code and presses Enter.
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || readOnly) return;
    const hit = findByCode(items, query) ?? (results.length === 1 ? results[0] : null);
    if (hit) {
      add(hit);
      setQuery("");
    }
  }

  function complete() {
    if (!session || busy) return;
    setError(null);
    if (discountText.trim() && parseMoney(discountText) === null) {
      setError(t("till.badMoney"));
      return;
    }
    if (payment === "tunai" && tenderedText.trim() && tendered === null) {
      setError(t("till.badMoney"));
      return;
    }
    setBusy(true);
    const result = recordSale({
      cart,
      discount,
      paymentMethod: payment,
      tendered: payment === "tunai" ? tendered : null,
      notes,
      cashier: session,
    });
    setBusy(false);
    if (result.ok) {
      setCart([]);
      setDiscountText("");
      setTenderedText("");
      setNotes("");
      bump();
      go(`/receipt/${encodeURIComponent(result.entry.sale.clientId)}`);
      return;
    }
    const r = result.refusal;
    switch (r.code) {
      case "short": {
        const item = byId.get(r.itemId);
        let text = t("till.short", { name: item ? itemName(item) : "?", available: r.available });
        if (r.expired > 0) text += ` ${t("till.shortExpired", { expired: r.expired })}`;
        setError(text);
        break;
      }
      case "tendered_short":
        setError(t("till.tenderedShort", { total: formatMoney(r.total) }));
        break;
      case "discount_not_allowed":
        setError(t("till.noDiscount"));
        break;
      default: {
        const keys: Record<string, MessageKey> = {
          empty: "till.empty",
          bad_qty: "till.badQty",
          unknown_item: "till.unknownItem",
          sales_limit: "till.salesLimit",
          total_limit: "till.totalLimit",
          pass: "till.pass",
          save_failed: "till.saveFailed",
        };
        setError(t(keys[r.code] ?? "common.error"));
      }
    }
  }

  const restricted = cart.some((l) =>
    (RESTRICTED_DRUG_CLASSES as readonly string[]).includes(byId.get(l.itemId)?.drugClass ?? ""),
  );

  return (
    <>
      <Bar
        title={t("till.title")}
        sub={session ? t("till.cashier", { name: session.fullName }) : t("till.readOnly")}
      >
        {session && !readOnly ? (
          <button
            className="small"
            onClick={() => {
              setSession(null);
              go("/offline");
            }}
          >
            {t("common.signOut")}
          </button>
        ) : (
          <button className="small" onClick={() => go("/offline")}>
            {t("common.back")}
          </button>
        )}
      </Bar>
      <StatusLine />
      <main>
        {reachable ? (
          <div className="card no-print">
            <Alert tone="ok">
              <strong>{t("till.serverBack")}</strong>
              {serverBack ? ` — ${t("till.serverBackBody")}` : ""}
            </Alert>
            {readQueue().sales.length > 0 ? (
              <p className="small-text muted">{t("till.serverBackPending", { n: readQueue().sales.length })}</p>
            ) : null}
            <button
              className="primary block"
              onClick={() => {
                setSession(null);
                go("/login");
              }}
            >
              {t("till.signInOnline")}
            </button>
          </div>
        ) : null}

        {readOnly ? <Alert tone="warning">{t("till.readOnly")}</Alert> : null}
        {pass.ok && !readOnly ? (
          <p className="hint">{t("till.passLeft", { hours: Math.max(1, Math.floor(pass.remainingMs / 3_600_000)) })}</p>
        ) : null}

        <div className="card">
          <input
            autoFocus
            type="search"
            placeholder={t("till.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {query.trim().length > 0 && query.trim().length < MIN_QUERY ? (
            <p className="hint">{t("till.minChars")}</p>
          ) : null}
          {query.trim().length >= MIN_QUERY && results.length === 0 ? (
            <p className="hint">{t("till.noResults")}</p>
          ) : null}
          <div>
            {results.map((item) => {
              const stock = stockOf(item, used, today, tz);
              const nextExpiry = item.batches
                .filter((b) => b.expiryDate >= today)
                .map((b) => b.expiryDate)
                .sort()[0];
              return (
                <div className="item" key={item.id}>
                  <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                    <div className="name">{itemName(item)}</div>
                    <div className="meta">
                      <DrugMark drugClass={item.drugClass} />
                      <span>{formatMoney(item.price)}</span>
                      <span>{stock.sellable > 0 ? t("till.stock", { n: stock.sellable }) : t("till.outOfStock")}</span>
                      {nextExpiry ? <span>{t("till.expires", { date: formatExpiry(nextExpiry, locale) })}</span> : null}
                      {stock.expired > 0 ? (
                        <span style={{ color: "var(--critical)" }}>{t("till.expiredStock", { n: stock.expired })}</span>
                      ) : null}
                    </div>
                  </div>
                  {!readOnly ? (
                    <button className="small primary" disabled={stock.sellable <= 0} onClick={() => add(item)}>
                      {t("till.add")}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {!readOnly ? (
          <>
            <div className="card">
              <h2>{t("till.cart")}</h2>
              {cart.length === 0 ? <p className="muted">{t("till.cartEmpty")}</p> : null}
              {cart.map((line) => {
                const item = byId.get(line.itemId);
                if (!item) return null;
                const plan = allocateItem(item, line.qty, used, today, tz);
                return (
                  <div className="item" key={line.itemId}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name">{itemName(item)}</div>
                      <div className="meta">
                        <DrugMark drugClass={item.drugClass} withLabel={false} />
                        <span>
                          {line.qty} × {formatMoney(item.price)} = {formatMoney(line.qty * item.price)}
                        </span>
                      </div>
                      <div className="meta">
                        {t("till.lots")}:{" "}
                        {plan.allocations.map((a) => (
                          <span key={a.batchId}>
                            {a.lotNumber ?? t("till.noLot")} ({t("till.expires", { date: formatExpiry(a.expiryDate, locale) })}) ×{a.qty}
                          </span>
                        ))}
                      </div>
                      {plan.shortfall > 0 ? (
                        <div className="meta" style={{ color: "var(--critical)" }}>
                          {t("till.short", { name: itemName(item), available: line.qty - plan.shortfall })}
                        </div>
                      ) : null}
                    </div>
                    <div className="qty">
                      <button onClick={() => setQty(line.itemId, line.qty - 1)} aria-label="−">
                        −
                      </button>
                      <input
                        inputMode="numeric"
                        value={line.qty}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/gu, ""));
                          if (Number.isSafeInteger(n)) setQty(line.itemId, n);
                        }}
                      />
                      <button onClick={() => setQty(line.itemId, line.qty + 1)} aria-label="+">
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
              {restricted ? <Alert tone="warning">{t("till.restricted")}</Alert> : null}
            </div>

            {cart.length > 0 ? (
              <div className="card">
                {mayDiscount ? (
                  <>
                    <label htmlFor="discount">{t("till.discount")}</label>
                    <input
                      id="discount"
                      inputMode="numeric"
                      value={discountText}
                      onChange={(e) => setDiscountText(e.target.value)}
                      placeholder="0"
                    />
                  </>
                ) : null}

                <label>{t("till.payment")}</label>
                <div className="choices">
                  {PAYMENT_METHODS.map((m) => (
                    <button key={m} aria-pressed={payment === m} onClick={() => setPayment(m)}>
                      {t(`payment.${m}` as MessageKey)}
                    </button>
                  ))}
                </div>

                {payment === "tunai" ? (
                  <>
                    <label htmlFor="tendered">{t("till.tendered")}</label>
                    <input
                      id="tendered"
                      inputMode="numeric"
                      value={tenderedText}
                      onChange={(e) => setTenderedText(e.target.value)}
                      placeholder={formatMoney(totals.total, { bare: true })}
                    />
                  </>
                ) : null}

                <label htmlFor="notes">{t("till.notes")}</label>
                <input id="notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />

                <table className="totals" style={{ marginTop: 14 }}>
                  <tbody>
                    <tr>
                      <td>{t("receipt.subtotal")}</td>
                      <td className="num">{formatMoney(totals.subtotal)}</td>
                    </tr>
                    {totals.discount > 0 ? (
                      <tr>
                        <td>{t("receipt.discount")}</td>
                        <td className="num">−{formatMoney(totals.discount)}</td>
                      </tr>
                    ) : null}
                    {totals.taxAmount > 0 ? (
                      <tr>
                        <td>PPN</td>
                        <td className="num">{formatMoney(totals.taxAmount)}</td>
                      </tr>
                    ) : null}
                    <tr className="grand">
                      <td>{t("receipt.total")}</td>
                      <td className="num">{formatMoney(totals.total)}</td>
                    </tr>
                    {payment === "tunai" && tendered !== null && tendered >= totals.total ? (
                      <tr>
                        <td>{t("till.change")}</td>
                        <td className="num">{formatMoney(tendered - totals.total)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>

                {error ? <Alert tone="critical">{error}</Alert> : null}
                <button className="primary block" disabled={busy} onClick={complete}>
                  {t("till.complete")}
                </button>
              </div>
            ) : error ? (
              <Alert tone="critical">{error}</Alert>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
