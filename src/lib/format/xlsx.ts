/**
 * A small .xlsx reader and writer, and nothing more.
 *
 * Why not a spreadsheet library: the catalogue import needs one thing from
 * Excel -- a header row, a few text rows and a second sheet of instructions --
 * and the libraries that do it weigh tens of megabytes of dependencies onto a
 * machine that is installed by a shopkeeper. An .xlsx is a zip of XML; `fflate`
 * (no dependencies) opens the zip and the rest is short.
 *
 * Everything is written as text. A cell that holds `2027-12-31` must reach the
 * importer as `2027-12-31`, not as Excel's serial number for that day, and a
 * barcode must keep its leading zeros. The reader is more forgiving, because a
 * person may have typed anything: numbers come back as they were stored, and a
 * cell Excel formatted as a date comes back as `YYYY-MM-DD`.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * A cell: text, or -- in a report export -- a number, written as a number so
 * a column of rupiah sums in the spreadsheet. The templates only ever write
 * text.
 */
export type XlsxCell = string | number | null;

/** How a number column is displayed. The stored value is always the plain figure. */
export type XlsxNumberFormat = "int" | "money" | "percent";

export type XlsxRow = {
  cells: XlsxCell[];
  /** Style of every cell in the row. */
  style?: "header" | "title" | "section" | "wrap" | "note" | "total";
  /** Points. Needed for merged rows, which Excel will not auto-fit. */
  height?: number;
  /** Merge the row's first cell across this many columns. */
  span?: number;
  /** Number formats for this row only, where one sheet mixes rupiah, counts and percentages. */
  formats?: Array<XlsxNumberFormat | undefined>;
};

export type XlsxSheet = {
  name: string;
  /** Column widths, in characters. */
  widths: number[];
  /** Give every column in the sheet a text number format, for people typing in. */
  textColumns?: boolean;
  /** Freeze the first row. */
  freezeHeader?: boolean;
  /** Freeze this many rows instead -- a report's letterhead and its column headings. */
  freezeRows?: number;
  /**
   * Display format for number cells, by column. A percentage is stored as a
   * fraction (0.253) and shown as 25,3%; rupiah and counts with thousands
   * grouping, in whatever separators the reader's Excel uses.
   */
  formats?: Array<XlsxNumberFormat | undefined>;
  /** Print landscape, one page wide -- for a sheet people read rather than fill in. */
  printFit?: boolean;
  rows: XlsxRow[];
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function esc(text: string): string {
  // Control characters other than tab, LF and CR are not legal in XML 1.0.
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, "")
    .replace(/[&<>"]/gu, (c) => XML_ESCAPES[c]);
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Cell formats, by index into `cellXfs` in STYLES below.
const STYLE_INDEX = {
  plain: 0,
  text: 1,
  header: 2,
  title: 3,
  section: 4,
  wrap: 5,
  note: 6,
  number: 7,
  percent: 8,
  total: 9,
  totalNumber: 10,
  totalPercent: 11,
} as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF5B3FA6"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FF5B3FA6"/><name val="Calibri"/></font>
<font><i/><sz val="11"/><color rgb="FF555555"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF5B3FA6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEAF8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD4CCE6"/></left><right style="thin"><color rgb="FFD4CCE6"/></right><top style="thin"><color rgb="FFD4CCE6"/></top><bottom style="thin"><color rgb="FFD4CCE6"/></bottom><diagonal/></border>
<border><left/><right/><top style="medium"><color rgb="FF5B3FA6"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="5" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="5" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="5" fillId="3" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sheet: XlsxSheet): string {
  const merges: string[] = [];

  const rows = sheet.rows
    .map((row, r) => {
      const rowNumber = r + 1;
      const s = row.style ? STYLE_INDEX[row.style] : sheet.textColumns ? STYLE_INDEX.text : 0;
      const cells = row.cells
        .map((value, c) => {
          if (value === "" || value === null) return "";
          const ref = `${columnName(c)}${rowNumber}`;
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "";
            const format = row.formats ? row.formats[c] : sheet.formats?.[c];
            const total = row.style === "total";
            const style =
              format === "percent"
                ? total
                  ? STYLE_INDEX.totalPercent
                  : STYLE_INDEX.percent
                : format
                  ? total
                    ? STYLE_INDEX.totalNumber
                    : STYLE_INDEX.number
                  : s;
            return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
        })
        .join("");
      if (row.span && row.span > 1) {
        merges.push(`<mergeCell ref="A${rowNumber}:${columnName(row.span - 1)}${rowNumber}"/>`);
      }
      const height = row.height ? ` ht="${row.height}" customHeight="1"` : "";
      return `<row r="${rowNumber}"${height}>${cells}</row>`;
    })
    .join("");

  const cols = sheet.widths
    .map((w, i) => {
      const style = sheet.textColumns ? ` style="${STYLE_INDEX.text}"` : "";
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${style}/>`;
    })
    .join("");

  const frozen = sheet.freezeRows ?? (sheet.freezeHeader ? 1 : 0);
  const pane =
    frozen > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (sheet.printFit ? `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` : "") +
    pane +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "") +
    (sheet.printFit
      ? `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
        `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`
      : "") +
    `</worksheet>`
  );
}

/**
 * A sheet name Excel will open: at most 31 characters, none of : \ / ? * [ ],
 * and unique in the workbook. A workbook that breaks any of these is refused
 * whole with a repair prompt, which reads to the owner as a corrupt download.
 */
function sheetNames(sheets: XlsxSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const base = sheet.name.replace(/[:\\/?*[\]]/gu, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Builds a workbook. The first sheet is the one Excel opens on. */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = sheetNames(sheets);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
        sheets
          .map((_, i) => `<sheet name="${esc(names[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        `</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES),
  };

  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });

  return zipSync(files, { level: 6 });
}

// ---------------------------------------------------------------- reading ---

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unesc(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

/** The text of every `<t>` inside `xml`, joined -- how a rich-text string is stored. */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/gu)) out += unesc(m[1] ?? "");
  return out;
}

/** "AB12" -> 27 (zero-based column). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/u.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel's built-in number formats that mean a date or a date and time. */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** A custom format is a date if it has a day, month or year code outside quotes and brackets. */
function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./gu, "");
  return /[dmy]/iu.test(bare) && !/^(general|@)$/iu.test(bare);
}

/** Excel's day 1 is 1900-01-01 and it counts a 1900-02-29 that never existed. */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  const days = whole > 60 ? whole - 1 : whole;
  const date = new Date(Date.UTC(1899, 11, 31) + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * A number cell as the text a person would have typed.
 *
 * Excel stores what a formula produced, not what it shows: 3 × 3333.33 is
 * kept as 9999.9899999999998 and 15000 may arrive as 1.5E4. A whole number
 * comes back whole. Anything else comes back with two decimals and a point,
 * which the importers' money parser rounds to the rupiah and their quantity
 * fields refuse -- never as a string of digits that could be mistaken for an
 * Indonesian thousands grouping.
 */
function plainNumber(text: string): string {
  const n = Number(text);
  if (text === "" || !Number.isFinite(n)) return text;
  const whole = Math.round(n);
  if (Math.abs(n - whole) < 1e-6 && Number.isSafeInteger(whole)) return String(whole);
  return n.toFixed(2);
}

/** Refuses to inflate anything that could be a decompression bomb. */
const MAX_PART_BYTES = 40_000_000;

/**
 * The first sheet of a workbook as rows of text -- the sheet Excel opens on,
 * which is the data sheet in our template. Returns null when the bytes are not
 * a readable workbook.
 */
export function readFirstSheet(bytes: Uint8Array): string[][] | null {
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (f) =>
        f.originalSize < MAX_PART_BYTES &&
        (f.name === "xl/workbook.xml" ||
          f.name === "xl/_rels/workbook.xml.rels" ||
          f.name === "xl/sharedStrings.xml" ||
          f.name === "xl/styles.xml" ||
          /^xl\/worksheets\/[^/]+\.xml$/u.test(f.name)),
    });
  } catch {
    return null;
  }

  const workbook = parts["xl/workbook.xml"];
  if (!workbook) return null;

  // First <sheet>, then its relationship to find the file it lives in.
  const sheetTag = /<sheet\s[^>]*>/u.exec(strFromU8(workbook))?.[0];
  const relId = sheetTag && /r:id="([^"]+)"/u.exec(sheetTag)?.[1];
  let target = "worksheets/sheet1.xml";
  const rels = parts["xl/_rels/workbook.xml.rels"];
  if (relId && rels) {
    for (const m of strFromU8(rels).matchAll(/<Relationship\s[^>]*>/gu)) {
      if (new RegExp(`Id="${relId}"`, "u").test(m[0])) {
        const t = /Target="([^"]+)"/u.exec(m[0])?.[1];
        if (t) target = t.replace(/^\/?(xl\/)?/u, "");
      }
    }
  }
  const sheet = parts[`xl/${target}`];
  if (!sheet) return null;

  const shared: string[] = [];
  const sharedXml = parts["xl/sharedStrings.xml"];
  if (sharedXml) {
    for (const m of strFromU8(sharedXml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/gu)) {
      shared.push(textOf(m[1] ?? ""));
    }
  }

  // Which cell styles are dates: cellXfs index -> true.
  const dateStyle: boolean[] = [];
  const stylesXml = parts["xl/styles.xml"];
  if (stylesXml) {
    const styles = strFromU8(stylesXml);
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\s[^>]*>/gu)) {
      const id = /numFmtId="(\d+)"/u.exec(m[0])?.[1];
      const code = /formatCode="([^"]*)"/u.exec(m[0])?.[1];
      if (id && code !== undefined) custom.set(Number(id), unesc(code));
    }
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u.exec(styles)?.[1] ?? "";
    for (const m of cellXfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/gu)) {
      const id = Number(/numFmtId="(\d+)"/u.exec(m[0])?.[1] ?? 0);
      const code = custom.get(id);
      dateStyle.push(code !== undefined ? isDateFormat(code) : BUILTIN_DATE_FORMATS.has(id));
    }
  }

  const out: string[][] = [];
  const xml = strFromU8(sheet);
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu)) {
    const rowNumber = Number(/\br="(\d+)"/u.exec(rowMatch[1])?.[1] ?? out.length + 1);
    const cells: string[] = [];
    let next = 0;

    for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const attrs = cell[1];
      const body = cell[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/u.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      const type = /\bt="([^"]+)"/u.exec(attrs)?.[1] ?? "n";
      const style = Number(/\bs="(\d+)"/u.exec(attrs)?.[1] ?? 0);
      const raw = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];

      let value = "";
      if (type === "s") value = raw === undefined ? "" : (shared[Number(raw)] ?? "");
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = raw === undefined ? "" : unesc(raw);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (raw !== undefined) {
        value = unesc(raw).trim();
        value = dateStyle[style] ? (serialToIso(Number(value)) ?? value) : plainNumber(value);
      }

      while (cells.length < col) cells.push("");
      cells[col] = value;
      next = col + 1;
    }

    // Keep row numbers honest: a blank row in the middle stays blank.
    while (out.length < rowNumber - 1) out.push([]);
    out[rowNumber - 1] = cells;
  }

  return out;
}

/** True when the bytes start with the zip signature every .xlsx has. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
