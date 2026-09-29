import { useEffect, useRef } from "react";

/**
 * The phone's Back button, for things that are not pages: the payment sheet,
 * the camera. Android users expect Back to close whatever is on top before it
 * leaves the screen, so MainActivity asks the page first
 * (`window.__pharmacyBack()`) and only navigates when nothing took it.
 */

type Handler = () => void;
const stack: Handler[] = [];

declare global {
  interface Window {
    __pharmacyBack?: () => boolean;
  }
}

window.__pharmacyBack = () => {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
};

/** While `active`, Back calls `onBack` instead of navigating. The latest opened wins. */
export function useBackHandler(active: boolean, onBack: Handler): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    const handler: Handler = () => latest.current();
    stack.push(handler);
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
