import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clampCropRect,
  iconCropToRect,
  rectToIconCrop,
  type CropRect,
  type IconCrop,
} from "../lib/types";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Corners are dragged to resize (aspect-locked); the box body is dragged to move. */
type DragMode = "move" | "nw" | "ne" | "sw" | "se";
const CORNERS: Exclude<DragMode, "move">[] = ["nw", "ne", "sw", "se"];
const ZOOM_STEP = 1.05;

/// <summary>
/// A centered, fixed (non-movable, non-resizable) modal for cropping a portrait or item
/// icon. Shows the FULL image with a draggable/resizable crop box overlaid; everything
/// outside the box is dimmed. The box is aspect-locked to `frameAspect` and maps to the
/// existing `IconCrop` (focal point + zoom) model, so nothing about how crops are stored
/// or rendered changes — Apply just emits a new `IconCrop`. Drag the box to pan, drag a
/// corner or scroll to zoom.
/// </summary>
export function ImageCropModal({
  src,
  crop,
  frameAspect,
  title = "Crop image",
  onApply,
  onClose,
}: {
  src: string;
  crop: IconCrop;
  frameAspect: number;
  title?: string;
  onApply: (crop: IconCrop) => void;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  // Tagged with the src it measured, not cleared by an effect on [src]: cropping an image
  // that's already on screen means the browser has it cached, so `load` lands before the
  // first effect runs and a reset-in-effect wiped the size — leaving the modal permanently
  // at `ready === false` (invisible image, no crop box). Mismatch re-measures instead.
  const [measured, setMeasured] = useState({ src: "", w: 0, h: 0 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<CropRect | null>(null);
  const dragRef = useRef<{ mode: DragMode; px: number; py: number; rect0: CropRect } | null>(null);

  // A new source re-measures simply by no longer matching what was measured; the box stays
  // hidden until then (it only renders when `ready`) and the effect below re-seeds it.
  const natural = measured.src === src ? measured : { w: 0, h: 0 };
  const ready = natural.w > 0 && natural.h > 0;
  const imgAspect = ready ? natural.w / natural.h : 1;

  // Once the natural size is known, size the stage to the *contained* image (so the <img>
  // fills it 100%×100% and box fractions map linearly to stage pixels) and seed the box
  // from the incoming crop. Keyed on the image load only — later `crop` changes must not
  // yank the box mid-edit.
  useLayoutEffect(() => {
    if (!ready) return;
    const maxW = Math.min(window.innerWidth * 0.9, 640);
    const maxH = window.innerHeight * 0.65;
    const scale = Math.min(maxW / natural.w, maxH / natural.h);
    setStage({ w: Math.round(natural.w * scale), h: Math.round(natural.h * scale) });
    setRect(iconCropToRect(crop, natural.w / natural.h, frameAspect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, natural.w, natural.h, frameAspect]);

  // Esc closes — the modal is exclusive, so no topmost/typing guards needed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Scroll to zoom about the box centre. Bound natively (not via React's onWheel) so the
  // listener is non-passive and can preventDefault the page scroll.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setRect((cur) => {
        if (!cur) return cur;
        const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
        const constrainByHeight = imgAspect >= frameAspect;
        const ratio = frameAspect / imgAspect;
        const cx = cur.left + cur.width / 2;
        const cy = cur.top + cur.height / 2;
        const size = (constrainByHeight ? cur.height : cur.width) * factor;
        const width = constrainByHeight ? size * ratio : size;
        const height = constrainByHeight ? size : size / ratio;
        return clampCropRect({ left: cx - width / 2, top: cy - height / 2, width, height }, imgAspect, frameAspect);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [imgAspect, frameAspect]);

  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { mode, px: e.clientX, py: e.clientY, rect0: rect };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || stage.w === 0 || stage.h === 0) return;
    const dxN = (e.clientX - d.px) / stage.w;
    const dyN = (e.clientY - d.py) / stage.h;
    const r0 = d.rect0;
    if (d.mode === "move") {
      setRect(clampCropRect({ ...r0, left: r0.left + dxN, top: r0.top + dyN }, imgAspect, frameAspect));
      return;
    }
    // Resize: the corner opposite the dragged handle stays anchored; the box keeps aspect.
    const west = d.mode === "nw" || d.mode === "sw";
    const north = d.mode === "nw" || d.mode === "ne";
    const anchorX = west ? r0.left + r0.width : r0.left;
    const anchorY = north ? r0.top + r0.height : r0.top;
    const movingX = clamp01((west ? r0.left : r0.left + r0.width) + dxN);
    const movingY = clamp01((north ? r0.top : r0.top + r0.height) + dyN);
    const constrainByHeight = imgAspect >= frameAspect;
    const ratio = frameAspect / imgAspect;
    const size = constrainByHeight ? Math.abs(movingY - anchorY) : Math.abs(movingX - anchorX);
    const width = constrainByHeight ? size * ratio : size;
    const height = constrainByHeight ? size : size / ratio;
    const left = movingX >= anchorX ? anchorX : anchorX - width;
    const top = movingY >= anchorY ? anchorY : anchorY - height;
    setRect(clampCropRect({ left, top, width, height }, imgAspect, frameAspect));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    stageRef.current?.releasePointerCapture?.(e.pointerId);
  };

  const apply = () => {
    if (!rect) return;
    onApply(rectToIconCrop(rect, imgAspect, frameAspect));
    onClose();
  };

  const box = rect
    ? {
        left: `${rect.left * stage.w}px`,
        top: `${rect.top * stage.h}px`,
        width: `${rect.width * stage.w}px`,
        height: `${rect.height * stage.h}px`,
      }
    : null;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack image-crop-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div
          ref={stageRef}
          className="crop-stage"
          style={ready ? { width: stage.w, height: stage.h } : { width: 320, height: 240 }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            style={{ opacity: ready ? 1 : 0 }}
            onLoad={(e) =>
              setMeasured({ src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
          {ready && box ? (
            <div className="crop-box" style={box} onPointerDown={startDrag("move")}>
              {CORNERS.map((c) => (
                <div key={c} className={`crop-handle crop-handle--${c}`} onPointerDown={startDrag(c)} />
              ))}
            </div>
          ) : (
            <span className="crop-loading">Loading…</span>
          )}
        </div>
        <p className="crop-hint">Drag the box to move · drag a corner or scroll to zoom</p>
        <div className="crop-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!ready || !rect} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
