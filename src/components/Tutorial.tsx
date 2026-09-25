"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NavEntry } from "./Sidebar";
import { buttonPrimary } from "@/components/ui";
import { TOUR, findTarget, type TourStop } from "./tutorial-steps";
import { HIDE_NAV_EVENT, REVEAL_NAV_EVENT } from "@/lib/ui/sidebar";

/**
 * The tutorial is a guided tour of the real screens, not a slideshow about
 * them. It dims the page, lights up one thing at a time, and for the menu it
 * waits for the person to click the entry themselves -- somebody who has
 * clicked "Kasir" once knows where the till is; somebody who read that it
 * exists may not.
 *
 * The tour's chapters are exactly the sidebar's nav entries: the same
 * permission and module filtering already decided what a cashier sees, so a
 * cashier's tour walks through a cashier's screens rather than a separate list
 * that can drift out of sync with the real one. What each chapter points at is
 * in `tutorial-steps.ts`.
 *
 * The Tutorial button in the menu opens the written guides (`/tutorials`),
 * not the tour: a new cashier wants "how do I take a return", and a tour of
 * fourteen screens is the wrong answer to that. Each guide then starts this
 * tour limited to its own screens, which is what `open(keys)` is for; without
 * keys it is the full tour.
 *
 * Every launcher shares this one context rather than carrying its own state,
 * so there is exactly one prompt and one tour mounted at a time, never a
 * hidden duplicate a screen reader or a script driving the page could land on.
 */
type TutorialState = {
  open: (keys?: readonly string[]) => void;
  /** What a tour limited to `keys` would actually visit on this account. */
  available: (keys: readonly string[]) => NavEntry[];
};

const TutorialContext = createContext<TutorialState | null>(null);

type Step =
  | { kind: "intro" }
  | { kind: "outro" }
  | { kind: "nav"; chapter: NavEntry; chapterIndex: number }
  | { kind: "stop"; chapter: NavEntry; chapterIndex: number; stop: TourStop };

function buildSteps(chapters: NavEntry[]): Step[] {
  const steps: Step[] = [{ kind: "intro" }];
  chapters.forEach((chapter, chapterIndex) => {
    steps.push({ kind: "nav", chapter, chapterIndex });
    for (const stop of TOUR[chapter.key] ?? []) {
      steps.push({ kind: "stop", chapter, chapterIndex, stop });
    }
  });
  steps.push({ kind: "outro" });
  return steps;
}

export function TutorialProvider({
  chapters,
  isOwner,
  seen,
  onSeen,
  children,
}: {
  chapters: NavEntry[];
  isOwner: boolean;
  seen: boolean;
  onSeen: () => Promise<void>;
  children: React.ReactNode;
}) {
  // null: no tour. An empty list is never stored -- it means the full tour.
  const [tour, setTour] = useState<{ chapters: NavEntry[]; partial: boolean } | null>(null);
  const open = tour !== null;
  const [promptOpen, setPromptOpen] = useState(!seen);
  const router = useRouter();

  const available = useCallback(
    (keys: readonly string[]) =>
      keys.flatMap((key) => chapters.filter((chapter) => chapter.key === key)),
    [chapters],
  );
  const [, startTransition] = useTransition();

  // The Escape handler calls these, so they are declared above the effect and
  // wrapped: a plain arrow function is a new value on every render, which the
  // effect would then have to either re-subscribe for or read stale.
  const markSeen = useCallback(() => {
    startTransition(() => void onSeen());
  }, [onSeen]);

  const dismissPrompt = useCallback(() => {
    setPromptOpen(false);
    markSeen();
  }, [markSeen]);

  const closeTour = useCallback(() => {
    setTour(null);
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (open) closeTour();
      else if (promptOpen) dismissPrompt();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, promptOpen, closeTour, dismissPrompt]);

  const startTour = (keys?: readonly string[]) => {
    const limited = keys?.length ? available(keys) : [];
    setPromptOpen(false);
    setTour(
      limited.length > 0 ? { chapters: limited, partial: true } : { chapters, partial: false },
    );
    markSeen();
  };

  const browseGuides = () => {
    dismissPrompt();
    router.push("/tutorials");
  };

  return (
    <TutorialContext.Provider value={{ open: startTour, available }}>
      {children}

      {promptOpen ? (
        <TutorialPrompt
          onStart={() => startTour()}
          onGuides={browseGuides}
          onDismiss={dismissPrompt}
        />
      ) : null}

      {tour ? (
        <GuidedTour
          chapters={tour.chapters}
          partial={tour.partial}
          isOwner={isOwner}
          onClose={closeTour}
        />
      ) : null}
    </TutorialContext.Provider>
  );
}

/**
 * Placed in the sidebar's bottom section and, separately, the mobile header.
 * A link to the guides, so it works as one: middle-click, back button, and
 * a URL somebody can be sent.
 */
export function TutorialLauncher({ variant }: { variant: "block" | "compact" }) {
  const t = useTranslations("tutorial");
  const pathname = usePathname();
  const here = pathname === "/tutorials" || pathname.startsWith("/tutorials/");

  return (
    <Link
      href="/tutorials"
      aria-label={t("launcher")}
      aria-current={here ? "page" : undefined}
      title={t("launcher")}
      className={`${
        variant === "block"
          ? "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink md:group-data-[collapsed=true]/side:justify-center md:group-data-[collapsed=true]/side:px-0"
          : "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
      } ${here ? "bg-sidebar-hover text-sidebar-ink" : ""}`}
    >
      <TutorialIcon />
      {variant === "block" ? (
        <span className="md:group-data-[collapsed=true]/side:sr-only">{t("launcher")}</span>
      ) : null}
    </Link>
  );
}

/**
 * Starts the on-screen tour from a guide. Absent when none of the guide's
 * screens are in this account's menu -- a button that would open an empty
 * tour is worse than none.
 */
export function StartTourButton({
  keys,
  label,
  hint,
  className,
}: {
  /** Menu entries to walk through; empty for the full tour. */
  keys: readonly string[];
  label: string;
  hint?: string;
  className: string;
}) {
  const ctx = useContext(TutorialContext);
  if (!ctx) return null;
  if (keys.length > 0 && ctx.available(keys).length === 0) return null;

  return (
    <button type="button" onClick={() => ctx.open(keys)} title={hint} className={className}>
      <TutorialIcon />
      {label}
    </button>
  );
}

function TutorialIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3a2.5 2.5 0 0 1 4.8.9c0 1.6-2.3 1.8-2.3 3.4" />
      <circle cx="12" cy="16.7" r="0.15" fill="currentColor" />
    </svg>
  );
}

function TutorialPrompt({
  onStart,
  onGuides,
  onDismiss,
}: {
  onStart: () => void;
  onGuides: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("tutorial");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("prompt.title")}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <TutorialIcon />
        </span>
        <h2 className="mt-3 text-lg font-semibold text-ink">{t("prompt.title")}</h2>
        <p className="mt-1.5 text-sm text-muted">{t("prompt.body")}</p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="mr-auto rounded-lg px-3 py-2 text-sm text-muted hover:text-ink"
          >
            {t("prompt.later")}
          </button>
          <button
            type="button"
            onClick={onGuides}
            className="rounded-lg px-3 py-2 text-sm text-accent hover:underline"
          >
            {t("prompt.guides")}
          </button>
          <button type="button" onClick={onStart} className={buttonPrimary}>
            {t("prompt.start")}
          </button>
        </div>
      </div>
    </div>
  );
}

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6; // breathing room between the target and the edge of the hole
const GAP = 14; // between the hole and the card
const FIND_TIMEOUT_MS = 3000;
// A detail screen is a fresh page load; on a slow clinic PC that is seconds.
const OPEN_TIMEOUT_MS = 8000;

function sameRect(a: Rect | null, b: Rect | null) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height)
  );
}

/**
 * Where the card goes: beside a narrow target (a menu entry), otherwise below
 * it, above it, or -- for something taller than the screen -- floating at the
 * bottom. Always clamped inside the viewport.
 */
function placeCard(hole: Rect | null, card: { w: number; h: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(12, Math.min(x, vw - card.w - 12));
  const clampY = (y: number) => Math.max(12, Math.min(y, vh - card.h - 12));

  if (!hole) return { left: (vw - card.w) / 2, top: (vh - card.h) / 2 };

  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;

  if (hole.width < 320 && right + GAP + card.w <= vw - 12) {
    return { left: right + GAP, top: clampY(hole.top + hole.height / 2 - card.h / 2) };
  }
  if (bottom + GAP + card.h <= vh - 12) {
    return { left: clampX(hole.left), top: bottom + GAP };
  }
  if (hole.top - GAP - card.h >= 12) {
    return { left: clampX(hole.left), top: hole.top - GAP - card.h };
  }
  return { left: clampX(vw - card.w - 24), top: Math.max(12, vh - card.h - 24) };
}

function GuidedTour({
  chapters,
  partial,
  isOwner,
  onClose,
}: {
  chapters: NavEntry[];
  /** Limited to one guide's screens, so the intro must not promise every screen. */
  partial: boolean;
  isOwner: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("tutorial");
  const router = useRouter();
  const pathname = usePathname();

  const steps = useMemo(() => buildSteps(chapters), [chapters]);
  // `direction` is which way the person is moving, so a stop with nothing to
  // point at is skipped forwards on Next and backwards on Back, never bounced
  // between. `from` is the page a step began on: a menu step advances when the
  // person *arrives* at its screen, not because they happened to be there.
  const [at, setAt] = useState({ index: 0, direction: 1 as 1 | -1, from: pathname });
  const { index, direction } = at;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[index];
  const onPage =
    step.kind === "stop" && step.stop.path
      ? new RegExp(step.stop.path).test(pathname)
      : step.kind === "nav" || step.kind === "stop"
        ? pathname === step.chapter.href
        : true;

  const go = useCallback(
    (delta: 1 | -1) => {
      setTarget(null);
      setRect(null);
      setAt((a) => ({
        index: Math.max(0, Math.min(steps.length - 1, a.index + delta)),
        direction: delta,
        from: window.location.pathname,
      }));
    },
    [steps.length],
  );

  // On a phone the menu is a drawer: open it for a menu step, and put it away
  // for a step on the page, which it would otherwise cover. On a desktop the
  // sidebar is always there and neither event changes anything.
  useEffect(() => {
    if (step.kind === "intro") return;
    window.dispatchEvent(new Event(step.kind === "nav" ? REVEAL_NAV_EVENT : HIDE_NAV_EVENT));
  }, [step]);

  // A stop lives on its chapter's screen: stepping Back into the previous
  // chapter, or back out of a detail screen, has to take the person there too.
  // A detail screen itself cannot be opened for them; see `TourStop.path`.
  //
  // Only when the step change is what put the person on the wrong page. If
  // they moved -- clicking a receipt on the "open one" stop lands on its
  // screen a moment before the tour steps forward -- pulling them back to the
  // list would undo exactly what they were asked to do.
  useEffect(() => {
    if (step.kind !== "stop" || onPage || step.stop.path) return;
    if (pathname === at.from) router.push(step.chapter.href);
  }, [step, onPage, pathname, at.from, router]);

  // Clicking the lit-up menu entry is how a chapter is entered. Adjusted while
  // rendering rather than in an effect, the way React wants state derived from
  // a changed input: the next render already has `from` equal to the path, so
  // this fires once.
  if (step.kind === "nav" && pathname === step.chapter.href && at.from !== pathname) {
    setTarget(null);
    setRect(null);
    setAt({ index: Math.min(steps.length - 1, index + 1), direction: 1, from: pathname });
  }

  // Look for the thing to point at. The page may still be arriving after a
  // navigation, so this polls briefly rather than looking once.
  useEffect(() => {
    if (step.kind === "intro" || step.kind === "outro") return;
    if (step.kind === "stop" && !onPage) {
      if (!step.stop.path) return; // on its way there
      // Waiting for the click that opens the detail screen to land. If the
      // person is not headed there -- they stepped Back past it -- move on.
      // Stepping Back past it means nobody is on their way there: skip at once.
      const timer = window.setTimeout(() => go(direction), direction === -1 ? 0 : OPEN_TIMEOUT_MS);
      return () => window.clearTimeout(timer);
    }

    const selectors =
      step.kind === "nav" ? [`[data-tour="nav-${step.chapter.key}"]`] : step.stop.selectors;
    const started = Date.now();
    let cancelled = false;

    const look = () => {
      if (cancelled) return;
      const el = findTarget(selectors);
      if (el) {
        setTarget(el);
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) {
          el.scrollIntoView({ block: r.height > window.innerHeight ? "start" : "center" });
        } else {
          el.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (Date.now() - started < FIND_TIMEOUT_MS) {
        timer = window.setTimeout(look, 100);
        return;
      }
      // Nothing to point at: a stop is skipped, a menu entry falls back to a
      // centred card rather than stranding the person.
      if (step.kind === "stop") {
        const next = index + direction;
        if (next > 0 && next < steps.length) go(direction);
        else go(1);
      }
    };
    let timer = window.setTimeout(look, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, onPage, index, direction, steps.length, go]);

  // Follow the target as the page scrolls, resizes or re-renders.
  useEffect(() => {
    if (!target) return;
    let frame = 0;
    const tick = () => {
      if (!target.isConnected) {
        const again = step.kind === "stop" ? findTarget(step.stop.selectors) : null;
        if (again) setTarget(again);
        else setRect(null);
        return;
      }
      const r = target.getBoundingClientRect();
      const next = {
        top: Math.round(r.top - PAD),
        left: Math.round(r.left - PAD),
        width: Math.round(r.width + PAD * 2),
        height: Math.round(r.height + PAD * 2),
      };
      setRect((prev) => (sameRect(prev, next) ? prev : next));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, step]);

  // "Try it" stops advance on their own once the person has done the thing.
  useEffect(() => {
    if (step.kind !== "stop" || !step.stop.action || !target) return;
    let timer = 0;
    const done = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => go(1), delay);
    };
    const until = step.stop.until;
    const onInput = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (until || !target.contains(el)) return;
      if ((el.value ?? "").trim().length >= 2) done(900);
    };
    const poll = until
      ? window.setInterval(() => {
          if (findTarget(until)) {
            window.clearInterval(poll);
            done(400);
          }
        }, 200)
      : 0;
    // Straight away, not after a pause: a click that opens a screen must find
    // the tour already on the step that belongs to that screen.
    const onClick = (e: MouseEvent) => {
      if (target.contains(e.target as Node)) go(1);
    };
    if (step.stop.action === "type") document.addEventListener("input", onInput, true);
    else document.addEventListener("click", onClick, true);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [step, target, go]);

  // The card's own size decides where it fits, and it changes with the text.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { w: el.offsetWidth, h: el.offsetHeight };
      setCardSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chapterCount = chapters.length;
  const chapterNumber = step.kind === "nav" || step.kind === "stop" ? step.chapterIndex + 1 : null;
  const progress = index / (steps.length - 1);

  let title: string;
  let body: string;
  let instruction: string | null = null;
  if (step.kind === "intro") {
    title = t("intro.title");
    const intro = partial ? "intro.partial" : isOwner ? "intro.owner" : "intro.staff";
    body = `${t(intro)} ${t("tour.how")}`;
  } else if (step.kind === "outro") {
    title = t("outro.title");
    body = t("outro.body");
  } else if (step.kind === "nav") {
    title = t("tour.open", { label: step.chapter.label });
    body = t(`chapters.${step.chapter.key}`);
    instruction = onPage ? null : t("tour.clickMenu");
  } else {
    title = t(`tour.stops.${step.chapter.key}.${step.stop.id}.title`);
    body = t(`tour.stops.${step.chapter.key}.${step.stop.id}.body`);
    if (step.stop.action) instruction = t(`tour.try.${step.stop.action}`);
  }

  const hole = step.kind === "intro" || step.kind === "outro" ? null : rect;
  const waiting = (step.kind === "stop" || step.kind === "nav") && !target;
  const pos = placeCard(hole, cardSize);
  const width = typeof window === "undefined" ? 360 : Math.min(360, window.innerWidth - 24);

  // Four panels around the hole rather than one sheet with a cut-out: they
  // catch clicks everywhere except the thing being pointed at, which stays
  // live -- the menu entry to click, the field to type in.
  const dim = "pointer-events-auto fixed bg-black/55 transition-all duration-200";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("launcher")}
      // The root lets clicks through; only the dimmed panels and the card
      // catch them. Otherwise the hole would be covered too.
      className="pointer-events-none fixed inset-0 z-[60]"
    >
      {hole ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div
            className={dim}
            style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className={dim}
            style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }}
          />
          <div
            className={dim}
            style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none fixed rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-transparent transition-all duration-200 ${
              instruction ? "animate-pulse" : ""
            }`}
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          />
        </>
      ) : (
        <div className="pointer-events-auto fixed inset-0 bg-black/55" />
      )}

      <div
        ref={cardRef}
        className="pointer-events-auto fixed flex flex-col overflow-y-auto rounded-2xl border border-rule bg-surface p-5 shadow-2xl transition-[top,left] duration-200"
        // On a screen shorter than the card, it scrolls rather than hanging
        // off the top where its buttons cannot be reached.
        style={{ top: pos.top, left: pos.left, width, maxHeight: "calc(100dvh - 24px)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-faint">
            {chapterNumber
              ? t("tour.chapter", { current: chapterNumber, total: chapterCount })
              : t("launcher")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            title={t("close")}
            className="rounded-lg px-2 py-1 text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <h2 className="mt-3 text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>

        {instruction ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
            <span aria-hidden="true">👉</span>
            {instruction}
          </p>
        ) : null}
        {waiting ? <p className="mt-3 text-xs text-faint">{t("tour.loading")}</p> : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-0"
          >
            {t("back")}
          </button>
          {step.kind === "outro" ? (
            <button type="button" onClick={onClose} className={buttonPrimary}>
              {t("finish")}
            </button>
          ) : step.kind === "nav" && !onPage ? (
            // The person is meant to click the menu, but nobody should be
            // stuck because they could not find it.
            <button
              type="button"
              onClick={() => router.push(step.chapter.href)}
              className="rounded-lg px-3 py-2 text-sm text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              {t("tour.takeMe")}
            </button>
          ) : step.kind === "stop" && step.stop.action ? (
            <button
              type="button"
              onClick={() => go(1)}
              className="rounded-lg px-3 py-2 text-sm text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              {t("tour.skip")}
            </button>
          ) : (
            <button type="button" onClick={() => go(1)} className={buttonPrimary}>
              {step.kind === "intro" ? t("tour.begin") : t("next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
