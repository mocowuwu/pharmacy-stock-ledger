import type { ReactNode } from "react";
import { hasKey } from "../i18n";
import { currentPass } from "../lib/services";
import { readQueue } from "../lib/store";
import { useApp } from "./context";

/**
 * Indonesian drug classification with the colour printed on the box: green
 * circle for Obat Bebas, blue for Bebas Terbatas, red circle with K for Obat
 * Keras. Staff read these off packaging all day; they are not ours to restyle.
 * Same table as the website's `DrugClassMark`.
 */
const CLASS_MARKS: Record<string, { color: string; glyph?: string }> = {
  bebas: { color: "#1e8f4e" },
  bebas_terbatas: { color: "#1f6fb2" },
  keras: { color: "#c1272d", glyph: "K" },
  owa: { color: "#c1272d", glyph: "K" },
  psikotropika: { color: "#c1272d", glyph: "K" },
  narkotika: { color: "#c1272d", glyph: "+" },
  jamu: { color: "#7a6a34" },
  oht: { color: "#3f7a34" },
  fitofarmaka: { color: "#2f6b3d" },
  alkes: { color: "#6b7b76" },
  consumable: { color: "#6b7b76" },
};

export function DrugMark({ drugClass, withLabel = true }: { drugClass: string; withLabel?: boolean }) {
  const { t } = useApp();
  const mark = CLASS_MARKS[drugClass] ?? CLASS_MARKS.consumable;
  const key = `drugClass.${drugClass}`;
  const label = hasKey(key) ? t(key) : drugClass;
  return (
    <span className="mark" title={label} aria-label={withLabel ? undefined : label}>
      <span className="circle" aria-hidden="true" style={{ color: mark.color }}>
        {mark.glyph ?? ""}
      </span>
      {withLabel ? <span>{label}</span> : null}
    </span>
  );
}

export function Bar({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="bar">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Online / offline with the number of sales waiting / locked -- on every
 * screen, because "are my sales safe?" is the question a cashier has during an
 * outage.
 */
export function StatusLine() {
  const { t, reachable, device, revision } = useApp();
  void revision;
  const pending = readQueue().sales.length;
  const waiting = pending > 0 ? ` · ${t("status.waiting", { n: pending })}` : "";

  if (reachable === null) {
    return (
      <div className="status no-print" role="status">
        <span className="dot checking" /> {t("status.checking")}
        {waiting}
      </div>
    );
  }
  if (reachable) {
    return (
      <div className="status no-print" role="status">
        <span className="dot online" /> {t("status.online")}
        {waiting}
      </div>
    );
  }
  const locked = device?.role === "till" && !currentPass().check.ok;
  return (
    <div className="status no-print" role="status">
      <span className={`dot ${locked ? "locked" : "offline"}`} />{" "}
      {locked ? t("status.locked") : t("status.offline")}
      {waiting}
    </div>
  );
}

export function Alert({ tone, children }: { tone: "critical" | "warning" | "notice" | "ok"; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === "critical" ? "alert" : "status"}>
      {children}
    </div>
  );
}
