"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { buttonPrimary, buttonSecondary } from "./ui";

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
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={variant === "primary" ? buttonPrimary : buttonSecondary}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
