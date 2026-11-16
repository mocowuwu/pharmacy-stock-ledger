"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { buttonPrimaryLarge, buttonSecondary } from "@/components/ui";

/**
 * Whether the order form is open, on a phone.
 *
 * On a wide screen the form sits beside the list and is always there. On a
 * phone it is the tallest thing on the page, and pushing the list three screens
 * down to make room for a form most visits do not use is the wrong trade. So it
 * starts folded away behind a button directly under the title -- the first
 * thing a person reaches for -- and opens in place when pressed.
 *
 * The button and the form live in different places in the page (the button is
 * at the top, the form is the first block of the grid under it), so they share
 * their open/closed state through a context rather than a wrapper around both.
 * From `xl` up the button is gone and the form is always shown, so none of this
 * exists on a desktop.
 */
const Open = createContext<{ open: boolean; toggle: () => void; id: string } | null>(null);

function useOpen() {
  const value = useContext(Open);
  if (!value) throw new Error("PanelEntry parts must sit inside <PanelEntryProvider>");
  return value;
}

export function PanelEntryProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <Open.Provider value={{ open, toggle: () => setOpen((value) => !value), id }}>{children}</Open.Provider>;
}

/** The phone's way in: one wide button, under the title. Gone from `xl`. */
export function PanelEntryButton({ openLabel, closeLabel }: { openLabel: string; closeLabel: string }) {
  const { open, toggle, id } = useOpen();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={toggle}
      className={`${open ? `${buttonSecondary} w-full` : buttonPrimaryLarge} mb-5 xl:hidden print:hidden`}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        {open ? "×" : "+"}
      </span>
      {open ? closeLabel : openLabel}
    </button>
  );
}

/** The form's place in the page: folded away until the button opens it, always shown from `xl`. */
export function PanelEntryBody({ children }: { children: ReactNode }) {
  const { open, id } = useOpen();
  return (
    <div id={id} className={`${open ? "block" : "hidden"} mb-5 xl:mb-0 xl:block print:hidden`}>
      {children}
    </div>
  );
}
