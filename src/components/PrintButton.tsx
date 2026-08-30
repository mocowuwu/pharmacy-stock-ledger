"use client";

import { buttonSecondarySmall } from "./ui";

/** Browser print, which is what every till already has. No driver integration. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonSecondarySmall}
    >
      {label}
    </button>
  );
}
