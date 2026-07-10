import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, PanelRight, X } from "lucide-react";
import { clampSizeToViewport, clampToViewport, CLAMP_MARGIN } from "../lib/clampToViewport";
import { campaignKey } from "../lib/campaignStore";

export type WindowPos = { x: number; y: number };

// Shared z-order stack for all open windows (module-level so windows rendered
// anywhere in the tree stack correctly against each other).
const zStack = new Map<string, number>();
let zCounter = 40;

function bringToFront(id: string): number {
  zCounter += 1;
  zStack.set(id, zCounter);
  return zCounter;
}

function isTopmost(id: string): boolean {
  let topId: string | null = null;
  let topZ = -1;
  for (const [key, z] of zStack) {
    if (z > topZ) {
      topZ = z;
      topId = key;
    }
  }
  return topId === id;
}

// Geometry is namespaced per campaign (`cm:{roomId}:win:{id}`) so each campaign keeps its own
// window layout; falls back to the pre-namespacing global key for a one-time migration.
const positionKey = (roomId: string, id: string) => campaignKey(roomId, `win:${id}`);
const legacyPositionKey = (id: string) => `cm-window-pos:${id}`;

/** Window geometry; h === null means "auto height" (content-sized, CSS-capped). */
type WindowGeom = { x: number; y: number; w: number; h: number | null };

function loadStoredGeom(roomId: string, id: string): Partial<WindowGeom> | null {
  try {
    const raw = localStorage.getItem(positionKey(roomId, id)) ?? localStorage.getItem(legacyPositionKey(id));
    if (!raw) {
      return null;
    }
    // Tolerates the pre-resize {x, y} shape — w/h simply stay at their defaults.
    const parsed = JSON.parse(raw) as Partial<WindowGeom>;
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return {
        x: parsed.x,
        y: parsed.y,
        w: typeof parsed.w === "number" ? parsed.w : undefined,
        h: typeof parsed.h === "number" ? parsed.h : undefined,
      };
    }
  } catch {
    // Ignore corrupt storage; fall back to the default geometry.
  }
  return null;
}

function storeGeom(roomId: string, id: string, geom: WindowGeom) {
  try {
    localStorage.setItem(positionKey(roomId, id), JSON.stringify(geom));
  } catch {
    // Storage full/unavailable — geometry simply won't persist.
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

const clampNum = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type FloatingWindowProps = {
  /** Stable id — used for z-ordering and the persisted geometry. */
  id: string;
  /** Campaign id — geometry is remembered per campaign. */
  roomId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Initial position when no stored geometry exists. */
  defaultPos: (viewportWidth: number, viewportHeight: number) => WindowPos;
  width?: number;
  /** Initial height when no stored geometry exists. Omit for auto (content-sized) height. */
  height?: number;
  /** Content-driven minimum size for resizing. */
  minWidth?: number;
  minHeight?: number;
  /** When set, shows a "return to dock" button in the title bar. */
  onDock?: () => void;
};

/// <summary>
/// A draggable, resizable floating window over the map: title-bar drag,
/// resize handles on every edge/corner, maximize/restore, click-to-front
/// z-ordering, Esc closes the topmost window, and geometry remembered per id.
/// The whole window always stays on-screen (clampToViewport, rule #7);
/// double-clicking the title bar resets to the default position and size.
/// </summary>
export function FloatingWindow({
  id,
  roomId,
  title,
  onClose,
  children,
  defaultPos,
  width = 340,
  height,
  minWidth = 240,
  minHeight = 140,
  onDock,
}: FloatingWindowProps) {
  const [geom, setGeom] = useState<WindowGeom>(() => {
    const stored = loadStoredGeom(roomId, id);
    const def = defaultPos(window.innerWidth, window.innerHeight);
    const w = clampSizeToViewport({ w: stored?.w ?? width, h: 1 }).w;
    const pos = clampToViewport(
      { x: stored?.x ?? def.x, y: stored?.y ?? def.y },
      // Height isn't known until first paint; the mount effect re-clamps with it.
      { w, h: minHeight },
    );
    // A concrete initial height keeps the window a fixed size (content scrolls inside)
    // instead of auto-fitting each child's content height; `null` = legacy auto height.
    return { x: pos.x, y: pos.y, w, h: stored?.h ?? height ?? null };
  });
  const [maximized, setMaximized] = useState(false);
  const [z, setZ] = useState(() => bringToFront(id));
  const rootRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<WindowPos | null>(null);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    start: { x: number; y: number; w: number; h: number };
  } | null>(null);

  useEffect(() => {
    return () => {
      zStack.delete(id);
    };
  }, [id]);

  const measuredHeight = useCallback(
    () => rootRef.current?.offsetHeight ?? geom.h ?? minHeight,
    [geom.h, minHeight],
  );

  /** Full whole-window clamp: size down to the viewport, then position inside it. */
  const clampGeom = useCallback(
    (g: WindowGeom): WindowGeom => {
      const h = g.h ?? measuredHeight();
      const size = clampSizeToViewport({ w: g.w, h });
      const pos = clampToViewport({ x: g.x, y: g.y }, size);
      return { x: pos.x, y: pos.y, w: size.w, h: g.h === null ? null : size.h };
    },
    [measuredHeight],
  );

  // Clamp with the real rendered height once mounted…
  useLayoutEffect(() => {
    setGeom((current) => clampGeom(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // …and never strand (or overflow) the window when the browser resizes.
  useEffect(() => {
    const onResize = () => setGeom((current) => clampGeom(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampGeom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopmost(id) && !isTypingTarget(event.target)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id, onClose]);

  const persist = useCallback(
    (g: WindowGeom) => {
      storeGeom(roomId, id, g);
    },
    [roomId, id],
  );

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || maximized) {
        return;
      }
      dragOffsetRef.current = { x: event.clientX - geom.x, y: event.clientY - geom.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [geom.x, geom.y, maximized],
  );

  const onDragMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const offset = dragOffsetRef.current;
      if (!offset) {
        return;
      }
      setGeom((current) =>
        clampGeom({ ...current, x: event.clientX - offset.x, y: event.clientY - offset.y }),
      );
    },
    [clampGeom],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragOffsetRef.current) {
        return;
      }
      dragOffsetRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setGeom((current) => {
        persist(current);
        return current;
      });
    },
    [persist],
  );

  const startResize = useCallback(
    (dir: ResizeDir) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || maximized) {
        return;
      }
      event.stopPropagation();
      resizeRef.current = {
        dir,
        startX: event.clientX,
        startY: event.clientY,
        start: { x: geom.x, y: geom.y, w: geom.w, h: geom.h ?? measuredHeight() },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [geom, maximized, measuredHeight],
  );

  const onResizeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const r = resizeRef.current;
      if (!r) {
        return;
      }
      const dx = event.clientX - r.startX;
      const dy = event.clientY - r.startY;
      let { x, y, w, h } = r.start;
      if (r.dir.includes("e")) {
        w = clampNum(r.start.w + dx, minWidth, window.innerWidth - x - CLAMP_MARGIN);
      }
      if (r.dir.includes("w")) {
        const next = clampNum(r.start.w - dx, minWidth, r.start.x + r.start.w - CLAMP_MARGIN);
        x = r.start.x + (r.start.w - next);
        w = next;
      }
      if (r.dir.includes("s")) {
        h = clampNum(r.start.h + dy, minHeight, window.innerHeight - y - CLAMP_MARGIN);
      }
      if (r.dir.includes("n")) {
        const next = clampNum(r.start.h - dy, minHeight, r.start.y + r.start.h - CLAMP_MARGIN);
        y = r.start.y + (r.start.h - next);
        h = next;
      }
      setGeom({ x, y, w, h });
    },
    [minHeight, minWidth],
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizeRef.current) {
        return;
      }
      resizeRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setGeom((current) => {
        persist(current);
        return current;
      });
    },
    [persist],
  );

  /** Double-click on the title bar (not its buttons): default position + size. */
  const resetGeom = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }
      setMaximized(false);
      const def = defaultPos(window.innerWidth, window.innerHeight);
      const next = clampGeom({ x: def.x, y: def.y, w: width, h: null });
      setGeom(next);
      persist(next);
    },
    [clampGeom, defaultPos, persist, width],
  );

  const style: React.CSSProperties = maximized
    ? {
        left: CLAMP_MARGIN,
        top: CLAMP_MARGIN,
        width: `calc(100vw - ${CLAMP_MARGIN * 2}px)`,
        height: `calc(100vh - ${CLAMP_MARGIN * 2}px)`,
        maxHeight: "none",
        zIndex: z,
      }
    : {
        left: geom.x,
        top: geom.y,
        width: geom.w,
        zIndex: z,
        ...(geom.h !== null ? { height: geom.h, maxHeight: "none" } : null),
      };

  return (
    <div
      ref={rootRef}
      className={`window${maximized ? " window--maximized" : ""}`}
      style={style}
      onPointerDownCapture={() => setZ(bringToFront(id))}
    >
      {/* The visual chrome + content clip live on this inner wrapper, so a sheet's page
          rail (portaled in as a `.window-siderail` sibling) can protrude OUTSIDE the
          window over the tabletop without breaking the window's rounding/resize. */}
      <div className="window-inner">
        <div
          className="window-header"
          onPointerDown={startDrag}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetGeom}
        >
          <span className="window-title">{title}</span>
          <span className="row" style={{ gap: "0.15rem" }}>
            {onDock ? (
              <button
                className="btn-ghost icon-btn"
                title="Return to sidebar"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onDock}
              >
                <PanelRight size={14} strokeWidth={2.2} />
              </button>
            ) : null}
            <button
              className="btn-ghost icon-btn"
              title={maximized ? "Restore" : "Maximize"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setMaximized((current) => !current)}
            >
              {maximized ? <Minimize2 size={14} strokeWidth={2.2} /> : <Maximize2 size={14} strokeWidth={2.2} />}
            </button>
            <button
              className="btn-ghost icon-btn"
              title="Close"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onClose}
            >
              <X size={14} strokeWidth={2.2} />
            </button>
          </span>
        </div>
        <div className="window-body">{children}</div>
      </div>
      {maximized
        ? null
        : RESIZE_DIRS.map((dir) => (
            <div
              key={dir}
              className={`win-rs win-rs--${dir}`}
              onPointerDown={startResize(dir)}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          ))}
    </div>
  );
}
