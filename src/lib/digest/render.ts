import type { DigestData } from "./content";
import { formatDate, formatExpiry } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

/**
 * The email itself.
 *
 * Written as a table-based HTML document with inline styles, which is not how
 * anything else in this project is built and is deliberate: email clients are
 * not browsers. Gmail strips `<style>` blocks in some views, Outlook renders
 * through Word, and flexbox is not reliable in either. Tables and inline styles
 * are the only things that behave the same everywhere.
 *
 * A plain-text alternative goes alongside it. Some phones show the text part,
 * and a digest that arrives as a wall of markup is a digest nobody reads.
 */

const TEXT = {
  id: {
    subject: (name: string, date: string) => `${name} — ringkasan ${date}`,
    quietSubject: (name: string) => `${name} — tidak ada yang perlu tindakan`,
    heading: "Ringkasan pagi",
    takings: "Penjualan kemarin",
    net: "Bersih",
    gross: "Kotor",
    refunds: "Retur",
    sales: "transaksi",
    critical: "Perlu tindakan hari ini",
    expiring: "Segera kedaluwarsa",
    outOfStock: "Stok habis",
    disposed: "Dimusnahkan kemarin",
    nothing: "Tidak ada yang perlu tindakan pagi ini.",
    quietBody:
      "Tidak ada penjualan, tidak ada stok kedaluwarsa, dan tidak ada yang habis. Email ini dikirim supaya Anda tahu sistemnya masih berjalan.",
    expiresOn: "kedaluwarsa",
    units: "unit",
    footer: "Dikirim otomatis oleh sistem apotek. Matikan di Pengaturan.",
  },
  en: {
    subject: (name: string, date: string) => `${name} — ${date} summary`,
    quietSubject: (name: string) => `${name} — nothing needs attention`,
    heading: "Morning summary",
    takings: "Yesterday's sales",
    net: "Net",
    gross: "Gross",
    refunds: "Refunded",
    sales: "sales",
    critical: "Needs attention today",
    expiring: "Expiring soon",
    outOfStock: "Out of stock",
    disposed: "Written off yesterday",
    nothing: "Nothing needs attention this morning.",
    quietBody:
      "No sales, no expired stock and nothing out of stock. This email is sent so you know the system is still running.",
    expiresOn: "expires",
    units: "units",
    footer: "Sent automatically by the pharmacy system. Switch it off in Settings.",
  },
} as const;

export type DigestLocale = keyof typeof TEXT;

const INK = "#17141f";
const MUTED = "#5b5570";
const RULE = "#e6e3ef";
const CRITICAL = "#b3261e";
const WARNING = "#8a5a00";

export function digestSubject(data: DigestData, locale: DigestLocale): string {
  const t = TEXT[locale];
  const date = formatDate(data.on, locale);
  return data.quiet ? t.quietSubject(data.business) : t.subject(data.business, date);
}

export function renderDigestText(data: DigestData, locale: DigestLocale): string {
  const t = TEXT[locale];
  const lines: string[] = [
    `${data.business} — ${formatDate(data.on, locale)}`,
    "",
  ];

  if (data.quiet) {
    lines.push(t.nothing, "", t.quietBody);
    return lines.join("\n");
  }

  lines.push(
    `${t.takings}: ${formatMoney(data.takings.net)} (${data.takings.sales} ${t.sales})`,
  );
  if (data.takings.refunds > 0) {
    lines.push(`  ${t.gross} ${formatMoney(data.takings.gross)} − ${t.refunds} ${formatMoney(data.takings.refunds)}`);
  }

  if (data.critical.length > 0) {
    lines.push("", `${t.critical} (${data.critical.length}):`);
    for (const row of data.critical) lines.push(`  - ${row.itemName} ${row.detail}`.trimEnd());
  }
  if (data.outOfStock.length > 0) {
    lines.push("", `${t.outOfStock} (${data.outOfStock.length}):`);
    for (const row of data.outOfStock) lines.push(`  - ${row.itemName} (${row.code})`);
  }
  if (data.expiring.length > 0) {
    lines.push("", `${t.expiring} (${data.expiring.length}):`);
    for (const row of data.expiring) {
      lines.push(
        `  - ${row.itemName} · ${row.lotNumber ?? "—"} · ${t.expiresOn} ${formatExpiry(row.expiryDate, locale)} · ${row.qty} ${t.units}`,
      );
    }
  }
  if (data.disposed.count > 0) {
    lines.push("", `${t.disposed}: ${formatMoney(data.disposed.value)}`);
  }

  lines.push("", t.footer);
  return lines.join("\n");
}

const escape = (value: string) =>
  value.replace(/[&<>"]/gu, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );

function section(title: string, colour: string, rows: string[]): string {
  if (rows.length === 0) return "";
  return `
    <tr><td style="padding:20px 24px 0 24px">
      <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${colour};text-transform:uppercase;letter-spacing:.04em">${escape(title)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px">
        ${rows.join("")}
      </table>
    </td></tr>`;
}

const row = (main: string, side = "") => `
  <tr>
    <td style="padding:6px 0;border-bottom:1px solid ${RULE};font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">${escape(main)}</td>
    <td style="padding:6px 0;border-bottom:1px solid ${RULE};font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED};text-align:right;white-space:nowrap">${escape(side)}</td>
  </tr>`;

export function renderDigestHtml(data: DigestData, locale: DigestLocale): string {
  const t = TEXT[locale];

  const body = data.quiet
    ? `<tr><td style="padding:24px">
         <div style="font:600 16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">${escape(t.nothing)}</div>
         <div style="margin-top:8px;font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">${escape(t.quietBody)}</div>
       </td></tr>`
    : `
      <tr><td style="padding:24px 24px 0 24px">
        <div style="font:400 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">${escape(t.takings)}</div>
        <div style="margin-top:4px;font:600 30px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">${escape(formatMoney(data.takings.net))}</div>
        <div style="margin-top:4px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">
          ${data.takings.sales} ${escape(t.sales)}${
            data.takings.refunds > 0
              ? ` · ${escape(t.gross)} ${escape(formatMoney(data.takings.gross))} − ${escape(t.refunds)} ${escape(formatMoney(data.takings.refunds))}`
              : ""
          }
        </div>
      </td></tr>
      ${section(
        t.critical,
        CRITICAL,
        data.critical.map((r) => row(r.itemName, r.detail)),
      )}
      ${section(
        t.outOfStock,
        CRITICAL,
        data.outOfStock.map((r) => row(r.itemName, r.code)),
      )}
      ${section(
        t.expiring,
        WARNING,
        data.expiring.map((r) =>
          row(
            r.itemName,
            `${formatExpiry(r.expiryDate, locale)} · ${r.qty} ${t.units}`,
          ),
        ),
      )}
      ${
        data.disposed.count > 0
          ? section(t.disposed, MUTED, [row(formatMoney(data.disposed.value), "")])
          : ""
      }`;

  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(digestSubject(data, locale))}</title></head>
<body style="margin:0;padding:24px 12px;background:#f6f5fa">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:12px">
    <tr><td style="padding:20px 24px;background:#221c33;border-radius:12px 12px 0 0">
      <div style="font:600 16px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#edeaf6">${escape(data.business)}</div>
      <div style="margin-top:2px;font:400 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#9a93b5">${escape(t.heading)} · ${escape(formatDate(data.on, locale))}</div>
    </td></tr>
    ${body}
    <tr><td style="padding:20px 24px;border-top:1px solid ${RULE};font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${MUTED}">
      ${escape(t.footer)}
    </td></tr>
  </table>
</body></html>`;
}
