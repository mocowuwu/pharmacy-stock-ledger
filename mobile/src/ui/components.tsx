import { useEffect, type ReactNode } from "react";
import { hasKey } from "../i18n";
import { currentPass } from "../lib/services";
import { readQueue } from "../lib/store";
import { useApp } from "./context";
import { Icon, type IconName } from "./icons";

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

/**
 * Online, offline with the number of sales waiting, or locked -- in the
 * header of every screen, because "are my sales safe?" is the question a
 * cashier has during an outage.
 */
export function StatusPill() {
  const { t, reachable, device, revision } = useApp();
  void revision;
  const pending = readQueue().sales.length;
  let tone: "checking" | "online" | "offline" | "locked";
  let text: string;
  if (reachable === null) {
    tone = "checking";
    text = t("status.checkingShort");
  } else if (reachable) {
    tone = "online";
    text = t("status.online");
  } else if (device?.role === "till" && !currentPass().check.ok) {
    tone = "locked";
    text = t("status.locked");
  } else {
    tone = "offline";
    text = t("status.offline");
  }
  return (
    <span className="pill" role="status" aria-live="polite">
      <span className={`dot ${tone}`} />
      {text}
      {pending > 0 ? <span className="faint">· {pending}</span> : null}
    </span>
  );
}

export function Bar({
  title,
  sub,
  onBack,
  status = true,
  children,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
  status?: boolean;
  children?: ReactNode;
}) {
  const { t } = useApp();
  return (
    <header className="bar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label={t("common.back")} style={{ marginLeft: -8 }}>
          <Icon name="back" size={22} />
        </button>
      ) : null}
      <div className="titles">
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {status ? <StatusPill /> : null}
      {children}
    </header>
  );
}

const ALERT_ICONS: Record<string, IconName> = {
  critical: "alert",
  warning: "alert",
  notice: "info",
  ok: "checkCircle",
};

export function Alert({ tone, children }: { tone: "critical" | "warning" | "notice" | "ok"; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === "critical" ? "alert" : "status"}>
      <Icon name={ALERT_ICONS[tone]} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** A short confirmation at the bottom of the screen; gone after a few seconds. */
export function Toast({
  message,
  onDone,
  icon = "checkCircle",
  aboveDock = false,
}: {
  message: string | null;
  onDone: () => void;
  icon?: IconName;
  aboveDock?: boolean;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className={`toast${aboveDock ? " above-dock" : ""}`} role="status">
      <Icon name={icon} size={20} />
      <span>{message}</span>
    </div>
  );
}

export function Empty({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} strokeWidth={1.6} />
      <div>{children}</div>
    </div>
  );
}

/** A short buzz on a scan or a finished sale: the cashier's eyes are on the customer. */
export function buzz(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not every WebView allows it; the feedback is a nicety.
  }
}
