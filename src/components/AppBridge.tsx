"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * The website's half of the Android app.
 *
 * Rendered only when the page is inside the app (the root layout checks the
 * user agent), and does four small things there:
 *
 *  - Sends the website's sign-in page back to the app's own. Signing in on the
 *    app's screen is what lets a cashier sign in again while the server is
 *    down, so it must be the only place anyone signs in.
 *  - Routes `window.print()` to Android's print service; a WebView ignores it.
 *  - Keeps the till's offline copy fresh. The app's own screens are not
 *    running while the website is shown, and a cashier on the website all
 *    day would otherwise reach the evening with yesterday's stock and an
 *    expired pass.
 *  - Notices when the server stops answering and offers the offline till,
 *    instead of leaving a page whose every button now fails.
 *
 * The app provides `window.PharmacyNative`; the file names and formats here
 * are the app's (see mobile/README.md). Nothing here is a control: the server
 * checks every offline sale again when it arrives.
 */

type Native = {
  readFile(name: string): string | null;
  writeFile(name: string, content: string): boolean;
  elapsedRealtime(): number;
  bootCount(): number;
  print(jobName: string): void;
};

type DeviceFile = { role?: string; deviceToken?: string };

const SHELL = "https://localhost";
const PING_MS = 20_000;
const REFRESH_MS = 15 * 60_000;

function native(): Native | null {
  return (window as unknown as { PharmacyNative?: Native }).PharmacyNative ?? null;
}

function readJson<T>(bridge: Native, name: string): T | null {
  try {
    const text = bridge.readFile(name);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/** The ids of the staff this phone can sign in offline, whatever shape the file takes. */
function offlineUserIds(bridge: Native): string[] {
  const file = readJson<unknown>(bridge, "users.json");
  const list = Array.isArray(file)
    ? file
    : file && typeof file === "object" && Array.isArray((file as { users?: unknown }).users)
      ? (file as { users: unknown[] }).users
      : file && typeof file === "object"
        ? Object.values(file)
        : [];
  return list
    .map((u) => (u && typeof u === "object" ? (u as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
}

async function refreshSnapshot(bridge: Native): Promise<void> {
  const device = readJson<DeviceFile>(bridge, "device.json");
  if (device?.role !== "till" || !device.deviceToken) return;
  const response = await fetch("/api/device/snapshot", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${device.deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userIds: offlineUserIds(bridge) }),
    cache: "no-store",
  });
  if (!response.ok) return;
  const data = await response.json();
  bridge.writeFile(
    "snapshot.json",
    JSON.stringify({
      receivedElapsed: bridge.elapsedRealtime(),
      bootCount: bridge.bootCount(),
      receivedWall: Date.now(),
      data,
    }),
  );
}

export function AppBridge() {
  const t = useTranslations("appBridge");
  const pathname = usePathname();
  const [unreachable, setUnreachable] = useState(false);
  const failures = useRef(0);

  useEffect(() => {
    if (pathname === "/login") window.location.replace(`${SHELL}/#/login`);
  }, [pathname]);

  useEffect(() => {
    const bridge = native();
    if (!bridge) return;
    const originalPrint = window.print.bind(window);
    window.print = () => {
      try {
        bridge.print(document.title);
      } catch {
        originalPrint();
      }
    };

    const refresh = () => void refreshSnapshot(bridge).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      window.print = originalPrint;
    };
  }, []);

  useEffect(() => {
    const ping = async () => {
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5_000);
        const response = await fetch("/api/device/ping", { cache: "no-store", signal: controller.signal });
        window.clearTimeout(timeout);
        if (!response.ok) throw new Error(String(response.status));
        failures.current = 0;
        setUnreachable(false);
      } catch {
        // Two misses in a row, so one dropped packet does not flash a banner.
        failures.current += 1;
        if (failures.current >= 2) setUnreachable(true);
      }
    };
    const timer = window.setInterval(ping, PING_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (!unreachable) return null;
  // Read only once the banner is needed, which is always after hydration.
  const bridge = native();
  const isTill = bridge ? readJson<DeviceFile>(bridge, "device.json")?.role === "till" : false;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-warning-soft px-4 py-3 text-sm text-warning-ink shadow-md print:hidden"
    >
      <span className="font-medium">{t("unreachable")}</span>
      <a
        href={isTill ? `${SHELL}/#/offline` : `${SHELL}/#/home`}
        className="rounded-lg border border-warning-ink/40 bg-surface px-3 py-1.5 font-medium text-warning-ink"
      >
        {isTill ? t("openOfflineTill") : t("openApp")}
      </a>
    </div>
  );
}
