"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The width a chart is actually drawn at, in CSS pixels.
 *
 * The charts are SVG with a viewBox, and a viewBox scales its text along with
 * everything else: an axis label set at 11 units in a 720-unit drawing is
 * about 5px tall on a phone. Drawing at the container's real width instead
 * keeps the labels at 11px everywhere. The server has no container to
 * measure, so the first render uses `fallback` and the measured width
 * follows on the client.
 */
export function useChartWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
