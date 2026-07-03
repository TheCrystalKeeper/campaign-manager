import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const WIDTH_KEY = "cm-page-roster-w";
const MIN_W = 220;
const MAX_W = 640;
const DEFAULT_W = 340;

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(Math.max(n, MIN_W), MAX_W);
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_W;
}

/// <summary>
/// Shared layout for the DM prep pages (Players / NPCs / Scenes): a roster
/// column on the left, a draggable divider, and a wide scrolling main area.
/// The roster width persists per-device; the main area is a CSS size container,
/// so a full-size CharacterSheet inside goes multi-column like a wide window.
/// </summary>
export function PageShell({ roster, children }: { roster: ReactNode; children: ReactNode }) {
  const [width, setWidth] = useState(loadWidth);
  const draggingRef = useRef(false);

  const onHandleDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onHandleMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    // The roster hugs the left edge, so its width is just the pointer's X.
    setWidth(Math.min(Math.max(event.clientX, MIN_W), MAX_W));
  }, []);

  const onHandleUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setWidth((current) => {
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(current)));
      } catch {
        // width just won't persist
      }
      return current;
    });
  }, []);

  // Clamp down if the window shrinks below the saved roster width.
  useEffect(() => {
    const onResize = () =>
      setWidth((current) => Math.min(current, Math.max(MIN_W, window.innerWidth - 320)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <>
      <aside className="page-roster" style={{ width }}>
        {roster}
      </aside>
      <div
        className="page-resize"
        title="Drag to resize"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      />
      <main className="page-main">{children}</main>
    </>
  );
}
