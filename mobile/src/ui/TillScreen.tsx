import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  itemIndex,
  itemName,
  MIN_QUERY,
  quickCash,
  offlineToday,
  searchItems,
  stockOf,
  usedByBatch,
  type CartLine,
} from "../lib/till";
import { Alert, Bar, buzz, DrugMark, Empty, Spinner, Toast } from "./components";
import { useApp } from "./context";
import { formatExpiry, formatMoney, parseMoney } from "./format";
import { Icon, type IconName } from "./icons";
import { Scanner, scanUnavailable } from "./Scanner";
import { useBackHandler } from "./back";

/**
 * The backup till. Deliberately smaller than the website's: sell, and look up
 * stock -- nothing else is possible offline. Every rule that decides money or
 * stock lives in lib/till.ts and the server modules it imports; this screen
 * only gathers the cart and shows what those rules say.
 *
 * `readOnly` is the locked till: stock and expiry can be looked up, nothing
 * can be sold.
 */

const NO_ITEMS: SnapshotItem[] = [];
const NO_INDEX = new Map<string, SnapshotItem>();

const METHOD_ICONS: Record<PaymentMethod, IconName> = {
  tunai: "cash",
  kartu_debit: "card",
  kartu_kredit: "card",
  qris: "qr",
  transfer: "transfer",
  lainnya: "dots",
};

/**
 * A quantity that can be typed over. The field keeps whatever is being typed
 * -- including nothing, on the way from "1" to "12" -- and the cart only takes
 * the number once it is a real one; removing a line is the bin's job.
 */
function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isSafeInteger(n) && n > 0) onChange(n);
    setDraft(null);
  };
  return (
    <span className="stepper">
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="−">
        <Icon name="minus" size={18} />
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft ?? String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/gu, "").slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="qty"
      />
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="+">
        <Icon name="plus" size={18} />
      </button>
    </span>
  );
}

export function TillScreen({ readOnly }: { readOnly: boolean }) {
  const { t, locale, session, setSession, go, revision, bump, reachable, serverBack } = useApp();
  void revision;

  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paying, setPaying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const snapshot = readSnapshot();
  const state = readState();
  const pass = checkPass(snapshot, state.usage, clock(), state.wallHighWater);

  // Selling needs a person and a pass; either missing sends the cashier back
  // to the sign-in screen, which says which.
  const mustLeave = !readOnly && (!session || !pass.ok);
  useEffect(() => {
    if (mustLeave) go("/offline");
  }, [mustLeave, go]);

  const items = snapshot?.data.items ?? NO_ITEMS;
  const byId = snapshot ? itemIndex(snapshot) : NO_INDEX;
  const clearToast = useCallback(() => setToast(null), []);
  useBackHandler(paying, () => setPaying(false));
  useBackHandler(scanning, () => setScanning(false));

  function add(item: SnapshotItem, announce = false) {
    setNotFound(null);
    setCart((lines) => {
      const found = lines.find((l) => l.itemId === item.id);
      if (found) return lines.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...lines, { itemId: item.id, qty: 1 }];
    });
    buzz();
    if (announce) setToast(t("till.added", { name: itemName(item) }));
  }

  function onScanned(code: string) {
    setScanning(false);
    const hit = findByCode(items, code);
    if (hit) add(hit, true);
    else setNotFound(code);
  }

  if (!snapshot || mustLeave) return null;

  const tz = snapshot.data.settings.timezone;
  // Offline-now; when locked (read-only), the last trustworthy moment is the
  // pass's own time, which is the best the phone can say about "today".
  const now = pass.ok ? pass.now : Date.parse(snapshot.data.pass.issuedAt);
  const today = offlineToday(now, tz);
  const used = usedByBatch(snapshot, state.usage, readQueue());
  const results = searchItems(items, query);
  const totals = cartTotals(snapshot, cart, 0);
  const units = cart.reduce((n, l) => n + l.qty, 0);
  const unavailable = scanUnavailable();

  function setQty(itemId: string, qty: number) {
    setCart((lines) => lines.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
  }

  function removeLine(itemId: string) {
    setCart((lines) => lines.filter((l) => l.itemId !== itemId));
  }

  // A barcode scanner types the code and presses Enter.
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || readOnly || !query.trim()) return;
    const hit = findByCode(items, query) ?? (results.length === 1 ? results[0] : null);
    if (hit) {
      add(hit, true);
      setQuery("");
    } else if (/^[\d\x1d\]]/u.test(query.trim())) {
      setNotFound(query.trim());
      setQuery("");
    }
  }

  const restricted = cart.some((l) =>
    (RESTRICTED_DRUG_CLASSES as readonly string[]).includes(byId.get(l.itemId)?.drugClass ?? ""),
  );
  const cartProblem = cart.some((l) => {
    const item = byId.get(l.itemId);
    return !item || allocateItem(item, l.qty, used, today, tz).shortfall > 0;
  });

  return (
    <div className="screen">
      <Bar
        title={readOnly ? t("till.stockTitle") : t("till.title")}
        sub={session && !readOnly ? session.fullName : t("till.readOnly")}
        onBack={readOnly ? () => go("/offline") : undefined}
      >
        {session && !readOnly ? (
          <button
            className="icon-btn"
            aria-label={t("common.signOut")}
            onClick={() => {
              setSession(null);
              go("/offline");
            }}
          >
            <Icon name="logout" size={22} />
          </button>
        ) : null}
      </Bar>

      <main className={cart.length > 0 && !readOnly ? "with-dock" : undefined}>
        <div className="searchbar">
          <div className="row">
            <div className="field grow">
              <span className="lead-icon">
                <Icon name="search" />
              </span>
              <input
                ref={searchRef}
                className="has-icon"
                type="search"
                enterKeyHint="search"
                placeholder={t("till.search")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setNotFound(null);
                }}
                onKeyDown={onSearchKey}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            {!readOnly ? (
              <button
                className="scan-btn soft"
                aria-label={t("scan.title")}
                onClick={() => (unavailable ? setToast(t(`scan.unavailable.${unavailable}` as MessageKey)) : setScanning(true))}
              >
                <Icon name="scan" size={24} />
              </button>
            ) : null}
          </div>
        </div>

        {reachable ? (
          <Alert tone="ok">
            <strong>{t("till.serverBack")}</strong>
            {serverBack ? t("till.serverBackBody") : t("offline.backBody")}
            <div style={{ marginTop: 10 }}>
              <button
                className="primary small"
                onClick={() => {
                  setSession(null);
                  go("/login");
                }}
              >
                {t("till.signInOnline")}
              </button>
            </div>
          </Alert>
        ) : null}
        {readOnly ? <Alert tone="warning">{t("locked.stockOnly")}</Alert> : null}
        {notFound ? (
          <Alert tone="warning">
            <strong>{t("till.codeNotFound")}</strong>
            <span className="mono">{notFound}</span>
          </Alert>
        ) : null}

        {query.trim().length > 0 && query.trim().length < MIN_QUERY ? <p className="hint">{t("till.minChars")}</p> : null}

        {query.trim().length >= MIN_QUERY ? (
          results.length === 0 ? (
            <div className="card">
              <Empty icon="search">{t("till.noResults")}</Empty>
            </div>
          ) : (
            <div className="card flush">
              {results.map((item) => {
                const stock = stockOf(item, used, today, tz);
                const inCart = cart.find((l) => l.itemId === item.id)?.qty ?? 0;
                const nextExpiry = item.batches
                  .filter((b) => b.expiryDate >= today)
                  .map((b) => b.expiryDate)
                  .sort()[0];
                return (
                  <div className="product" key={item.id}>
                    <div className="body">
                      <div className="name">{itemName(item)}</div>
                      <div className="meta">
                        <span className="price">{formatMoney(item.price)}</span>
                        <DrugMark drugClass={item.drugClass} withLabel={false} />
                        <span>{stock.sellable > 0 ? t("till.stock", { n: stock.sellable, unit: item.unit }) : t("till.outOfStock")}</span>
                        {nextExpiry ? <span>{t("till.expires", { date: formatExpiry(nextExpiry, locale) })}</span> : null}
                      </div>
                      {stock.expired > 0 ? (
                        <div className="meta">
                          <span className="warn">{t("till.expiredStock", { n: stock.expired })}</span>
                        </div>
                      ) : null}
                    </div>
                    {!readOnly ? (
                      <button
                        className={`add-btn ${inCart ? "soft" : "primary"}`}
                        disabled={stock.sellable <= inCart}
                        onClick={() => add(item)}
                        aria-label={t("till.add")}
                      >
                        {inCart ? <span className="num">{inCart}</span> : <Icon name="plus" size={22} />}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {!readOnly ? (
          <>
            <div className="section-title">
              <span>{t("till.cart")}</span>
              {cart.length > 0 ? (
                <button className="ghost small" onClick={() => setCart([])} style={{ minHeight: 32, padding: "2px 6px" }}>
                  {t("till.clear")}
                </button>
              ) : null}
            </div>
            {cart.length === 0 ? (
              <div className="card">
                <Empty icon="cart">{t("till.cartEmpty")}</Empty>
              </div>
            ) : (
              <div className="card flush">
                {cart.map((line) => {
                  const item = byId.get(line.itemId);
                  if (!item) return null;
                  const plan = allocateItem(item, line.qty, used, today, tz);
                  const stock = stockOf(item, used, today, tz);
                  return (
                    <div className="cart-line" key={line.itemId}>
                      <div className="top">
                        <div className="name">
                          {itemName(item)}{" "}
                          <DrugMark drugClass={item.drugClass} withLabel={false} />
                        </div>
                        <div className="amount num">{formatMoney(line.qty * item.price)}</div>
                      </div>
                      <div className="lots">
                        {plan.allocations.map((a, i) => (
                          <span key={a.batchId}>
                            {i > 0 ? " · " : ""}
                            <span className="mono">{a.lotNumber ?? t("till.noLot")}</span> {t("till.expires", { date: formatExpiry(a.expiryDate, locale) })} ×{a.qty}
                          </span>
                        ))}
                      </div>
                      {plan.shortfall > 0 ? (
                        <Alert tone="critical">{t("till.short", { name: itemName(item), available: stock.sellable })}</Alert>
                      ) : null}
                      <div className="bottom">
                        <span className="muted small-text num">
                          {formatMoney(item.price)} / {item.unit}
                        </span>
                        <span className="row">
                          <Stepper value={line.qty} max={stock.sellable} onChange={(n) => setQty(line.itemId, n)} />
                          <button className="icon-btn danger" onClick={() => removeLine(line.itemId)} aria-label={t("till.remove")}>
                            <Icon name="trash" />
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {restricted ? <Alert tone="warning">{t("till.restricted")}</Alert> : null}
            {pass.ok ? (
              <p className="hint center">
                <Icon name="clock" size={14} /> {t("till.passLeft", { hours: Math.max(1, Math.floor(pass.remainingMs / 3_600_000)) })}
              </p>
            ) : null}
          </>
        ) : null}
      </main>

      {!readOnly && cart.length > 0 ? (
        <div className="dock">
          <div className="inner">
            <div className="sum">
              <div className="label">{t("till.units", { n: units })}</div>
              <div className="total num">{formatMoney(totals.total)}</div>
            </div>
            <button className="primary big" disabled={cartProblem} onClick={() => setPaying(true)}>
              {t("till.pay")}
            </button>
          </div>
        </div>
      ) : null}

      <Toast message={toast} onDone={clearToast} aboveDock={cart.length > 0} />

      {paying && session ? (
        <PaymentSheet
          cart={cart}
          onClose={() => setPaying(false)}
          onDone={(clientId) => {
            setPaying(false);
            setCart([]);
            buzz(40);
            bump();
            go(`/receipt/${encodeURIComponent(clientId)}`, { replace: true });
          }}
        />
      ) : null}
      {scanning ? <Scanner onCode={onScanned} onClose={() => setScanning(false)} /> : null}
    </div>
  );
}

function PaymentSheet({
  cart,
  onClose,
  onDone,
}: {
  cart: CartLine[];
  onClose: () => void;
  onDone: (clientId: string) => void;
}) {
  const { t, session } = useApp();
  const snapshot = readSnapshot()!;
  const byId = itemIndex(snapshot);
  const [method, setMethod] = useState<PaymentMethod>("tunai");
  const [tenderedText, setTenderedText] = useState("");
  const [discountText, setDiscountText] = useState("");
  const [showDiscount, setShowDiscount] = useState(false);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mayDiscount = session ? hasPermission(session, "sales.discount") : false;
  const discount = mayDiscount ? (parseMoney(discountText) ?? 0) : 0;
  const totals = cartTotals(snapshot, cart, discount);
  const tendered = method === "tunai" ? parseMoney(tenderedText) : null;
  const cash = method === "tunai";
  const change = cash && tendered !== null ? tendered - totals.total : null;

  function complete() {
    if (!session || busy) return;
    setError(null);
    if (discountText.trim() && parseMoney(discountText) === null) {
      setError(t("till.badMoney"));
      return;
    }
    if (cash && tenderedText.trim() && tendered === null) {
      setError(t("till.badMoney"));
      return;
    }
    setBusy(true);
    const result = recordSale({
      cart,
      discount,
      paymentMethod: method,
      tendered: cash ? tendered : null,
      notes,
      cashier: session,
    });
    setBusy(false);
    if (result.ok) {
      onDone(result.entry.sale.clientId);
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

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("till.pay")}>
        <div className="grabber" />
        <div className="sheet-head">
          <h3>{t("till.pay")}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")} disabled={busy}>
            <Icon name="close" />
          </button>
        </div>

        <div className="due">
          <div className="label">{t("till.due")}</div>
          <div className="total num">{formatMoney(totals.total)}</div>
        </div>

        <label>{t("till.payment")}</label>
        <div className="choices three">
          {PAYMENT_METHODS.map((m) => (
            <button key={m} className="seg" aria-pressed={method === m} onClick={() => setMethod(m)}>
              <Icon name={METHOD_ICONS[m]} size={18} />
              {t(`paymentShort.${m}` as MessageKey)}
            </button>
          ))}
        </div>

        {cash ? (
          <>
            <label htmlFor="tendered">{t("till.tendered")}</label>
            <input
              id="tendered"
              inputMode="numeric"
              value={tenderedText}
              onChange={(e) => setTenderedText(e.target.value)}
              placeholder={formatMoney(totals.total, { bare: true })}
              style={{ fontSize: 20, fontWeight: 700 }}
            />
            <div className="quick">
              {quickCash(totals.total).map((amount) => (
                <button
                  key={amount}
                  className={tendered === amount ? "soft" : ""}
                  onClick={() => setTenderedText(formatMoney(amount, { bare: true }))}
                >
                  {amount === totals.total ? t("till.exact") : formatMoney(amount, { bare: true })}
                </button>
              ))}
            </div>
            {change !== null ? (
              <div className={`change-line${change < 0 ? " short" : ""}`}>
                <span>{change < 0 ? t("till.stillDue") : t("till.change")}</span>
                <span className="num">{formatMoney(Math.abs(change))}</span>
              </div>
            ) : null}
          </>
        ) : null}

        {mayDiscount ? (
          showDiscount ? (
            <>
              <label htmlFor="discount">{t("till.discount")}</label>
              <input id="discount" inputMode="numeric" value={discountText} onChange={(e) => setDiscountText(e.target.value)} placeholder="0" autoFocus />
            </>
          ) : (
            <button className="ghost small" onClick={() => setShowDiscount(true)} style={{ marginTop: 10 }}>
              <Icon name="plus" size={16} /> {t("till.addDiscount")}
            </button>
          )
        ) : null}
        {showNotes ? (
          <>
            <label htmlFor="notes">{t("till.notes")}</label>
            <input id="notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} autoFocus />
          </>
        ) : (
          <button className="ghost small" onClick={() => setShowNotes(true)} style={{ marginTop: 6 }}>
            <Icon name="plus" size={16} /> {t("till.addNote")}
          </button>
        )}

        <table className="totals">
          <tbody>
            <tr>
              <td className="muted">{t("receipt.subtotal")}</td>
              <td className="num">{formatMoney(totals.subtotal)}</td>
            </tr>
            {totals.discount > 0 ? (
              <tr>
                <td className="muted">{t("receipt.discount")}</td>
                <td className="num">−{formatMoney(totals.discount)}</td>
              </tr>
            ) : null}
            {totals.taxAmount > 0 ? (
              <tr>
                <td className="muted">{t("till.tax")}</td>
                <td className="num">{formatMoney(totals.taxAmount)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {error ? <Alert tone="critical">{error}</Alert> : null}
        <button
          className="primary block big"
          style={{ marginTop: 16 }}
          disabled={busy || (cash && change !== null && change < 0)}
          onClick={complete}
        >
          {busy ? <Spinner /> : <Icon name="check" />}
          {t("till.complete")}
        </button>
      </div>
    </div>
  );
}
