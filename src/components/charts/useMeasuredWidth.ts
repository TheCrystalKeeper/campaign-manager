import { useEffect, useRef, useState, type RefObject } from "react";

/** Tracks an element's content width so SVG charts can render in real pixels
 *  (crisp 1px hairlines, fixed-size text) instead of a scaled viewBox. */
export function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.round(entry.contentRect.width));
      }
    });
    observer.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
