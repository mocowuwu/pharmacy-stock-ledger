"use client";

/** Browser print, which is what every till already has. No driver integration. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-rule px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}
