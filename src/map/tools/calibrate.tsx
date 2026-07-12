import { Crosshair } from "lucide-react";
import { Circle, Group, Rect, Text } from "react-konva";
import type { Scene } from "../../lib/types";
import type { MapTool } from "./types";

/// <summary>
/// Grid calibration gesture (DM). Two modes chosen in the tool's options popup:
///   • "adjust" (default) — direct manipulation via grid POINTS. Hover near any grid intersection
///     and a handle circle pops up there; drag it to resize the grid. The FIRST diagonal of the drag
///     picks the pinned corner — the diagonal cell corner you drag TOWARD (drag a point up-right and
///     the corner up-right of it pins); it then stays locked for the rest of the drag, so drag away to
///     grow / back toward it to shrink without the anchor flipping. Drag anywhere ELSE (away from a
///     point) to slide the whole grid. No button switching.
///   • "box" — drag a fresh box over exactly one map square to set the grid size + offset from
///     scratch. Handy for an initial calibration when the grid is way off.
/// Both preview the whole grid live (MapCanvas) and commit one `UPDATE_SCENE` on release.
/// Numeric fine-tuning lives in the Scene panel.
/// </summary>

/** Box mode: the drag rectangle (kept square — a grid cell is). */
type BoxDraft = { mode: "box"; x0: number; y0: number; x1: number; y1: number };
/** Adjust/move: the drag origin + running delta (grid slides; MapCanvas previews it). */
type MoveDraft = { mode: "move"; startX: number; startY: number; dx: number; dy: number };
/** Adjust/hover: a handle popped up at grid intersection (x,y) — the "grab me to resize" affordance. */
type HoverDraft = { mode: "hover"; x: number; y: number };
/**
 * Adjust/resize: the grabbed grid point (px,py) + the cell size at grab (g0). Until `locked`, the
 * anchor is undecided; on the first clear diagonal drag we pick the pinned corner (ox,oy) + the
 * drag-direction signs (sx,sy) and LOCK them for the rest of the gesture — only `size` tracks the
 * cursor after that.
 */
type ResizeDraft = {
  mode: "resize";
  px: number;
  py: number;
  g0: number;
  locked: boolean;
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  size: number;
};
type CalibrateDraft = BoxDraft | MoveDraft | HoverDraft | ResizeDraft;

/** Smallest cell the gestures will commit (matches the numeric input's floor). */
const MIN_CELL = 10;
/** A press/hover within this many SCREEN px of a grid point grabs it to resize (else: move). */
const HANDLE_HIT_PX = 16;
/** Diagonal drag (SCREEN px) needed before the resize anchor is chosen + locked. */
const DIR_LOCK_PX = 6;
/** Handle-circle radius, in screen px (kept constant across zoom). */
const HANDLE_PX = 7;

const mod = (value: number, m: number) => ((value % m) + m) % m;

/** The grid intersection nearest a world point (+ whether it's on the visible grid and how far). */
function nearestGridPoint(scene: Scene, wx: number, wy: number) {
  const g = scene.gridSize;
  const ix = Math.round((wx - scene.gridOffsetX) / g) * g + scene.gridOffsetX;
  const iy = Math.round((wy - scene.gridOffsetY) / g) * g + scene.gridOffsetY;
  const within = ix >= -0.5 && ix <= scene.width + 0.5 && iy >= -0.5 && iy <= scene.height + 0.5;
  return { ix, iy, dist: Math.hypot(wx - ix, wy - iy), within };
}

/** Square cell size from the pinned corner (ox,oy) to the cursor — dominant axis, floored at MIN_CELL. */
function sizeFrom(ox: number, oy: number, cx: number, cy: number) {
  return Math.max(Math.round(Math.max(Math.abs(cx - ox), Math.abs(cy - oy))), MIN_CELL);
}

/**
 * Advance a resize drag toward cursor (cx,cy). The anchor is chosen ONCE — the first time the cursor
 * has moved a clear diagonal (DIR_LOCK_PX) from the grabbed point (px,py) — as the grid point one
 * original cell (g0) away in the SAME direction as the drag (the diagonal corner you're pulling
 * toward), then LOCKED for the rest of the gesture. The old code recomputed the anchor every move, so
 * it flipped across the point whenever the cursor crossed back and the cell could never shrink. Once
 * locked, only `size` follows the cursor: drag away from the anchor to grow, back toward it to shrink.
 */
function resizeStep(draft: ResizeDraft, cx: number, cy: number, scale: number): ResizeDraft {
  if (!draft.locked) {
    const lockDist = DIR_LOCK_PX / Math.max(scale, 0.0001);
    if (Math.hypot(cx - draft.px, cy - draft.py) < lockDist) {
      return draft; // not enough movement yet to read a direction — hold at the original size
    }
    const sx = cx - draft.px >= 0 ? 1 : -1;
    const sy = cy - draft.py >= 0 ? 1 : -1;
    const ox = draft.px + sx * draft.g0;
    const oy = draft.py + sy * draft.g0;
    return { ...draft, locked: true, sx, sy, ox, oy, size: sizeFrom(ox, oy, cx, cy) };
  }
  return { ...draft, size: sizeFrom(draft.ox, draft.oy, cx, cy) };
}

/** A pop-up grab handle at a grid point (screen-constant radius). */
function PointHandle({ x, y, scale }: { x: number; y: number; scale: number }) {
  const r = HANDLE_PX / Math.max(scale, 0.0001);
  return (
    <Circle x={x} y={y} radius={r} fill="rgba(233,193,118,0.55)" stroke="#ffe0a3" strokeWidth={2 / Math.max(scale, 0.0001)} listening={false} />
  );
}

export const calibrateTool: MapTool = {
  id: "calibrate",
  label: "Calibrate grid",
  icon: <Crosshair size={17} strokeWidth={2.2} />,
  hotkey: "g",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    if (rt.calibrateMode === "box") {
      rt.setDraft({ mode: "box", x0: event.world.x, y0: event.world.y, x1: event.world.x, y1: event.world.y } satisfies BoxDraft);
      return;
    }
    // Adjust: a press on (near) a grid point starts a resize; anywhere else starts a move.
    const g = rt.scene.gridSize;
    if (g > 0) {
      const { ix, iy, dist, within } = nearestGridPoint(rt.scene, event.world.x, event.world.y);
      const thr = HANDLE_HIT_PX / Math.max(rt.viewportScale, 0.0001);
      if (within && dist <= thr) {
        // Grab the point; the anchor/direction is chosen on the first diagonal drag (see resizeStep)
        // and then locked, so it can't flip back and forth mid-drag. Start held at the current size
        // (ox,oy default to the grabbed grid point — neutral until a direction locks in).
        rt.setDraft({ mode: "resize", px: ix, py: iy, g0: g, locked: false, sx: 1, sy: 1, ox: ix, oy: iy, size: g } satisfies ResizeDraft);
        return;
      }
    }
    rt.setDraft({ mode: "move", startX: event.world.x, startY: event.world.y, dx: 0, dy: 0 } satisfies MoveDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as CalibrateDraft | null;
    if (draft?.mode === "move") {
      rt.setDraft({ ...draft, dx: event.world.x - draft.startX, dy: event.world.y - draft.startY });
      return;
    }
    if (draft?.mode === "resize") {
      rt.setDraft(resizeStep(draft, event.world.x, event.world.y, rt.viewportScale));
      return;
    }
    if (draft?.mode === "box") {
      // The box selection is always a square (a grid cell IS one) — follow the dominant axis.
      const dx = event.world.x - draft.x0;
      const dy = event.world.y - draft.y0;
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      rt.setDraft({ ...draft, x1: draft.x0 + (dx < 0 ? -side : side), y1: draft.y0 + (dy < 0 ? -side : side) });
      return;
    }
    // No active drag: in adjust mode, pop a handle up at the nearest grid point when the cursor is
    // near one (so the DM can grab it to resize). Only update on change, to avoid re-render churn.
    if (rt.calibrateMode !== "adjust" || rt.scene.gridSize <= 0) {
      if (draft) rt.setDraft(null);
      return;
    }
    const { ix, iy, dist, within } = nearestGridPoint(rt.scene, event.world.x, event.world.y);
    const thr = HANDLE_HIT_PX / Math.max(rt.viewportScale, 0.0001);
    if (within && dist <= thr) {
      if (!(draft?.mode === "hover" && draft.x === ix && draft.y === iy)) {
        rt.setDraft({ mode: "hover", x: ix, y: iy } satisfies HoverDraft);
      }
    } else if (draft) {
      rt.setDraft(null);
    }
  },
  onLeave: (rt) => {
    // Clear a resting hover handle when the pointer leaves the stage; a mid-drag draft (move/resize/
    // box) survives so a brief exit doesn't abort the gesture.
    if ((rt.draft as CalibrateDraft | null)?.mode === "hover") {
      rt.setDraft(null);
    }
  },
  onUp: (event, rt) => {
    const draft = rt.draft as CalibrateDraft | null;
    if (draft?.mode === "resize") {
      const next = resizeStep(draft, event.world.x, event.world.y, rt.viewportScale);
      rt.setDraft(null);
      if (!next.locked || next.size === rt.scene.gridSize) {
        return; // a click / no committed direction, or no size change — nothing to do
      }
      // Keep the pinned diagonal corner a grid corner so the grid stays where it was anchored.
      rt.send({
        type: "UPDATE_SCENE",
        scene: { ...rt.scene, gridSize: next.size, gridOffsetX: mod(next.ox, next.size), gridOffsetY: mod(next.oy, next.size), showGrid: true },
      });
      return;
    }
    if (draft?.mode === "move") {
      const g = rt.scene.gridSize;
      rt.setDraft(null);
      if (g <= 0) {
        return;
      }
      const dx = event.world.x - draft.startX;
      const dy = event.world.y - draft.startY;
      // A near-zero drag is just a click — don't nudge the grid by a stray pixel.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return;
      }
      rt.send({
        type: "UPDATE_SCENE",
        scene: { ...rt.scene, gridOffsetX: mod(rt.scene.gridOffsetX + dx, g), gridOffsetY: mod(rt.scene.gridOffsetY + dy, g), showGrid: true },
      });
      return;
    }
    if (draft?.mode === "box") {
      rt.setDraft(null);
      const side = Math.abs(draft.x1 - draft.x0); // square by construction
      if (side < 8) {
        return; // too small to be one square
      }
      const gridSize = Math.max(Math.round(side), MIN_CELL);
      const originX = Math.min(draft.x0, draft.x1);
      const originY = Math.min(draft.y0, draft.y1);
      rt.send({
        type: "UPDATE_SCENE",
        scene: { ...rt.scene, gridSize, gridOffsetX: mod(originX, gridSize), gridOffsetY: mod(originY, gridSize), showGrid: true },
      });
    }
    // hover / null: nothing to commit.
  },
  renderDraft: (draft, rt) => {
    const d = draft as CalibrateDraft | null;
    const scale = rt.viewportScale;
    if (!d) {
      return null;
    }
    if (d.mode === "box") {
      return (
        <Rect
          x={Math.min(d.x0, d.x1)}
          y={Math.min(d.y0, d.y1)}
          width={Math.abs(d.x1 - d.x0)}
          height={Math.abs(d.y1 - d.y0)}
          stroke="#e9c176"
          strokeWidth={2}
          dash={[6, 4]}
          fill="rgba(233,193,118,0.12)"
          listening={false}
        />
      );
    }
    if (d.mode === "hover") {
      // The handle that "pops up" at the grid point under the cursor.
      return <PointHandle x={d.x} y={d.y} scale={scale} />;
    }
    if (d.mode === "move") {
      // The whole grid previews sliding (MapCanvas) — no overlay needed.
      return null;
    }
    // Resize. Before a direction locks in, just show the grabbed handle — no anchor chosen yet.
    if (!d.locked) {
      return <PointHandle x={d.px} y={d.py} scale={scale} />;
    }
    // Highlight the cell at the new size, pinned at the diagonal corner (ox,oy) the drag points toward,
    // mark that pivot, and show the dragged corner + a px readout. The dragged corner sits on the side
    // OPPOSITE the anchor; the full grid previews at the new size beneath.
    const s = Math.max(scale, 0.0001);
    const cellX = d.sx > 0 ? d.ox - d.size : d.ox;
    const cellY = d.sy > 0 ? d.oy - d.size : d.oy;
    const dragX = d.ox - d.sx * d.size;
    const dragY = d.oy - d.sy * d.size;
    return (
      <Group listening={false}>
        <Rect x={cellX} y={cellY} width={d.size} height={d.size} stroke="#e9c176" strokeWidth={2 / s} dash={[6 / s, 4 / s]} fill="rgba(233,193,118,0.15)" />
        <Circle x={d.ox} y={d.oy} radius={(HANDLE_PX * 0.6) / s} fill="#6f5116" stroke="#ffe0a3" strokeWidth={1 / s} />
        <Circle x={dragX} y={dragY} radius={HANDLE_PX / s} fill="#ffe0a3" stroke="#6f5116" strokeWidth={1.5 / s} />
        <Text x={cellX + 6 / s} y={cellY - 20 / s} text={`${Math.round(d.size)} px`} fontSize={13 / s} fontStyle="bold" fill="#ffe0a3" shadowColor="#000" shadowBlur={4 / s} />
      </Group>
    );
  },
};
