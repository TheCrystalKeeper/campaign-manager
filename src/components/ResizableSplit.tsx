import { useCallback, useEffect, useRef, useState } from "react";

type ResizableSplitProps = {
  main: React.ReactNode;
  sidebar: React.ReactNode;
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  /** Optional absolute max width in px. */
  maxWidth?: number;
  /** Max width as a fraction of the container (e.g. 0.5 = half the screen). */
  maxWidthRatio?: number;
};

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 260;

/// <summary>
/// Horizontal split layout with a draggable divider to resize the sidebar panel.
/// </summary>
export function ResizableSplit({
  main,
  sidebar,
  storageKey = "cm-sidebar-width",
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  maxWidth,
  maxWidthRatio = 0.5,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : defaultWidth;
    return Number.isFinite(parsed) ? parsed : defaultWidth;
  });
  const draggingRef = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const clampWidth = useCallback(
    (next: number) => {
      const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
      const ratioCap = containerWidth * maxWidthRatio;
      const cap = maxWidth != null ? Math.min(maxWidth, ratioCap) : ratioCap;
      return Math.min(cap, Math.max(minWidth, next));
    },
    [maxWidth, maxWidthRatio, minWidth],
  );

  useEffect(() => {
    setWidth((current) => clampWidth(current));
  }, [clampWidth]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setWidth((current) => clampWidth(current));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampWidth]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) {
        return;
      }
      const bounds = containerRef.current.getBoundingClientRect();
      const next = bounds.right - event.clientX;
      setWidth(clampWidth(next));
    };

    const handlePointerUp = () => {
      if (!draggingRef.current) {
        return;
      }
      draggingRef.current = false;
      document.body.classList.remove("resizing-sidebar");
      localStorage.setItem(storageKey, String(widthRef.current));
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [clampWidth, storageKey]);

  const startResize = () => {
    draggingRef.current = true;
    document.body.classList.add("resizing-sidebar");
  };

  return (
    <div className="resizable-split" ref={containerRef}>
      <div className="resizable-main">{main}</div>
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={(event) => {
          event.preventDefault();
          startResize();
        }}
      />
      <aside className="resizable-sidebar" style={{ width }}>
        {sidebar}
      </aside>
    </div>
  );
}
