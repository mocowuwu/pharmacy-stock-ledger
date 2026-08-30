"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import type { NavEntry } from "./Sidebar";
import { buttonPrimary } from "@/components/ui";

/**
 * The tutorial's table of contents is exactly the sidebar's nav entries: the
 * same permission and module filtering already decided what a cashier sees,
 * so a cashier's tutorial walks through a cashier's screens rather than a
 * separate list that can drift out of sync with the real one.
 *
 * The layout renders two launcher buttons -- one in the sidebar's bottom
 * section, one in the mobile header, since only one of those two exists at a
 * given screen width. They share this one context rather than each carrying
 * their own state, so there is exactly one prompt and one walkthrough dialog
 * mounted at a time, never a hidden duplicate a screen reader or a script
 * driving the page could land on.
 */
type TutorialState = {
  open: () => void;
};

const TutorialContext = createContext<TutorialState | null>(null);

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
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [promptOpen, setPromptOpen] = useState(!seen);
  const [, startTransition] = useTransition();

  const total = chapters.length + 2; // intro + chapters + outro

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

  const closeWalkthrough = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (open) closeWalkthrough();
      else if (promptOpen) dismissPrompt();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, promptOpen, closeWalkthrough, dismissPrompt]);

  const startWalkthrough = () => {
    setPromptOpen(false);
    setStep(0);
    setOpen(true);
    markSeen();
  };

  const openFromLauncher = () => {
    setPromptOpen(false);
    setStep(0);
    setOpen(true);
  };

  return (
    <TutorialContext.Provider value={{ open: openFromLauncher }}>
      {children}

      {promptOpen ? (
        <TutorialPrompt onStart={startWalkthrough} onDismiss={dismissPrompt} />
      ) : null}

      {open ? (
        <TutorialWalkthrough
          chapters={chapters}
          isOwner={isOwner}
          step={step}
          total={total}
          onStep={setStep}
          onClose={closeWalkthrough}
        />
      ) : null}
    </TutorialContext.Provider>
  );
}

/** Placed in the sidebar's bottom section and, separately, the mobile header. */
export function TutorialLauncher({ variant }: { variant: "block" | "compact" }) {
  const t = useTranslations("tutorial");
  const ctx = useContext(TutorialContext);
  if (!ctx) return null;

  return (
    <button
      type="button"
      onClick={ctx.open}
      aria-label={t("launcher")}
      className={
        variant === "block"
          ? "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
          : "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
      }
    >
      <TutorialIcon />
      {variant === "block" ? t("launcher") : null}
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
  onDismiss,
}: {
  onStart: () => void;
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
      <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold text-ink">{t("prompt.title")}</h2>
        <p className="mt-1.5 text-sm text-muted">{t("prompt.body")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink"
          >
            {t("prompt.later")}
          </button>
          <button
            type="button"
            onClick={onStart}
            className={buttonPrimary}
          >
            {t("prompt.start")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TutorialWalkthrough({
  chapters,
  isOwner,
  step,
  total,
  onStep,
  onClose,
}: {
  chapters: NavEntry[];
  isOwner: boolean;
  step: number;
  total: number;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("tutorial");

  const isIntro = step === 0;
  const isOutro = step === total - 1;
  const chapter = !isIntro && !isOutro ? chapters[step - 1] : undefined;

  const title = isIntro
    ? t("intro.title")
    : isOutro
      ? t("outro.title")
      : (chapter?.label ?? "");
  const body = isIntro
    ? t(isOwner ? "intro.owner" : "intro.staff")
    : isOutro
      ? t("outro.body")
      : t(`chapters.${chapter?.key}`);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("launcher")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex w-full max-w-md flex-col rounded-xl bg-surface p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-faint">
            {t("step", { current: step + 1, total })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-lg px-2 py-1 text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        <h2 className="mt-2 text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onStep(step - 1)}
            disabled={step === 0}
            className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-0"
          >
            {t("back")}
          </button>
          {isOutro ? (
            <button
              type="button"
              onClick={onClose}
              className={buttonPrimary}
            >
              {t("finish")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStep(step + 1)}
              className={buttonPrimary}
            >
              {t("next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
