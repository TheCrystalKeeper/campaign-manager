import { useEffect, useRef, useState, type ReactNode } from "react";
import { type IconCrop } from "../lib/types";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/// <summary>
/// Shows an image fitted into a frame without stretching (it always covers the frame),
/// positioned by a focal point (crop.x / crop.y, 0..1) and scaled by crop.zoom. When
/// `editable`, drag the image to reposition it (zoom lives in the host's crop modal) —
/// changes flow through `onChange`. Read-only just renders the cropped view. Reused for
/// character portraits and item images.
/// </summary>
export function CroppableImage({
  src,
  crop,
  editable = false,
  onChange,
  className,
  alt = "",
  fallback,
}: {
  src: string;
  crop: IconCrop;
  editable?: boolean;
  onChange?: (crop: IconCrop) => void;
  className?: string;
  alt?: string;
  /** Shown when the image fails to load (e.g. a deleted file) instead of a broken-image icon. */
  fallback?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  // Both are tagged with the src they describe rather than being cleared by an effect on
  // [src]: an image the browser already has cached fires `load` before the first effect gets
  // to run, so a reset-in-effect wiped the size that had just arrived and pinned `ready` false
  // forever — the shimmer never cleared, and showed through any image with transparency.
  // Tagging invalidates them by mismatch instead, which no ordering can get wrong.
  const [measured, setMeasured] = useState({ src: "", w: 0, h: 0 });
  const [errorSrc, setErrorSrc] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Track the frame's pixel size so we can size the image to cover it.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new source re-measures simply by no longer matching what was measured.
  const natural = measured.src === src ? measured : { w: 0, h: 0 };
  const errored = errorSrc === src;

  const ready = natural.w > 0 && natural.h > 0 && frame.w > 0 && frame.h > 0;
  // Cover the frame at zoom 1, then apply zoom; the image box keeps its natural aspect so
  // it never stretches. The focal point pans within whatever overflows the frame.
  const cover = ready ? Math.max(frame.w / natural.w, frame.h / natural.h) : 0;
  const dispW = natural.w * cover * crop.zoom;
  const dispH = natural.h * cover * crop.zoom;
  const ovX = Math.max(0, dispW - frame.w);
  const ovY = Math.max(0, dispH - frame.h);
  const left = -ovX * crop.x;
  const top = -ovY * crop.y;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || !onChange) return;
    e.preventDefault();
    frameRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !onChange) return;
    // Dragging the image one overflow-width moves the focal point across its full range;
    // dragging right reveals more of the left (a lower x).
    const nx = ovX > 0 ? clamp01(d.x - (e.clientX - d.px) / ovX) : 0.5;
    const ny = ovY > 0 ? clamp01(d.y - (e.clientY - d.py) / ovY) : 0.5;
    onChange({ ...crop, x: nx, y: ny });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    frameRef.current?.releasePointerCapture?.(e.pointerId);
  };

  // A missing/deleted image shows the caller's fallback (e.g. a name-initial dot) rather than
  // the browser's broken-image glyph; with no fallback, an empty frame keeps the layout.
  if (errored) {
    return fallback !== undefined ? (
      <>{fallback}</>
    ) : (
      <div className={`croppable ${className ?? ""}`} style={{ position: "relative", overflow: "hidden" }} />
    );
  }

  return (
    <div
      ref={frameRef}
      className={`croppable ${className ?? ""}`}
      style={{ position: "relative", overflow: "hidden" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Skeleton shimmer while the portrait is still decoding (progressive first-load), removed
          once it's measured/ready. The <img> is transparent until then, so the shimmer shows. */}
      {src && !ready ? <div className="skeleton-shimmer" aria-hidden /> : null}
      <img
        src={src}
        alt={alt}
        draggable={false}
        // Long actor/NPC lists render one of these per row: lazy + async decode keeps opening a
        // panel from downloading and decoding every portrait at once (below-fold ones wait until
        // scrolled into view). The sheet's single visible portrait loads immediately regardless.
        loading="lazy"
        decoding="async"
        onError={() => setErrorSrc(src)}
        onLoad={(e) =>
          setMeasured({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
        }
        style={{
          position: "absolute",
          width: ready ? `${dispW}px` : "100%",
          height: ready ? `${dispH}px` : "100%",
          left: ready ? `${left}px` : 0,
          top: ready ? `${top}px` : 0,
          maxWidth: "none",
          objectFit: "cover",
          userSelect: "none",
          cursor: editable ? (dragging ? "grabbing" : "grab") : "default",
        }}
      />
    </div>
  );
}
