"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Disables itself while the form is in flight. On a shared till a double-click
 * on "save" is routine, and without this the second click submits again.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-contrast"
      : "border border-rule text-muted hover:border-accent hover:text-accent";
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`rounded px-4 py-2 font-medium disabled:opacity-60 ${styles}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
