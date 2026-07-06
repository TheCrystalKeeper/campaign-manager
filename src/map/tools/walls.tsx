import { Line } from "react-konva";
import { WALL_BRUSH_COLORS, wallFromBrush, type Wall } from "../../lib/types";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Walls & doors tool (DM, Phase 6.9b) — modeless. Click empty space to chain wall segments (each
/// completed segment commits immediately, so the chain is individually undoable); a press-drag-release
/// makes a single segment. Endpoints snap to nearby wall endpoints then the micro/grid snap (Shift =
/// precise). Right-click or Esc ends the chain (handled in MapCanvas). Selecting / moving / configuring
/// existing walls happens on the rendered handles (see `WallNode` in MapVision).
/// </summary>

type Pt = { x: number; y: number };
type WallDraft = { last: Pt | null; down: Pt | null; preview: Pt | null };

/** px: down≈up is a click (chain vertex); a larger delta is a drag (single segment). */
const CLICK_TOL = 6;

/** Build + send one wall segment for the current brush. */
function commitSegment(rt: ToolRuntime, a: Pt, b: Pt): void {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1) {
    return; // degenerate
  }
  const wall: Wall = {
    id: `wall-${crypto.randomUUID().slice(0, 8)}`,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    ...wallFromBrush(rt.wallBrush),
  };
  rt.send({ type: "ADD_WALL", sceneId: rt.scene.id, wall });
}

export const wallsTool: MapTool = {
  id: "walls",
  label: "Walls & doors",
  icon: "🧱",
  hotkey: "w",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    const p = rt.snapWallPoint(event.world.x, event.world.y, { free: event.shiftKey });
    const prev = rt.draft as WallDraft | null;
    rt.setDraft({ last: prev?.last ?? null, down: p, preview: p } satisfies WallDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as WallDraft | null;
    if (!draft) {
      return;
    }
    rt.setDraft({
      ...draft,
      preview: rt.snapWallPoint(event.world.x, event.world.y, { free: event.shiftKey }),
    });
  },
  onUp: (event, rt) => {
    const draft = rt.draft as WallDraft | null;
    if (!draft) {
      return;
    }
    const up = rt.snapWallPoint(event.world.x, event.world.y, { free: event.shiftKey });
    const down = draft.down ?? up;
    const dragged = Math.hypot(up.x - down.x, up.y - down.y) > CLICK_TOL;
    if (draft.last === null) {
      if (dragged) {
        // Press-drag-release: commit one segment, then keep chaining from its end.
        commitSegment(rt, down, up);
        rt.setDraft({ last: up, down: null, preview: up } satisfies WallDraft);
      } else {
        // First click starts the chain.
        rt.setDraft({ last: down, down: null, preview: down } satisfies WallDraft);
      }
      return;
    }
    // Extend the chain: commit last→up, continue from up.
    commitSegment(rt, draft.last, up);
    rt.setDraft({ last: up, down: null, preview: up } satisfies WallDraft);
  },
  renderDraft: (draft, rt) => {
    const d = draft as WallDraft | null;
    if (!d || !d.preview) {
      return null;
    }
    // While actively pressing/dragging (`down` set), show the segment SOLID in the wall's color so
    // you see the wall as you draw it — from the last chain vertex if any, else the press point.
    if (d.down) {
      const a = d.last ?? d.down;
      return (
        <Line
          points={[a.x, a.y, d.preview.x, d.preview.y]}
          stroke={WALL_BRUSH_COLORS[rt.wallBrush]}
          strokeWidth={4}
          listening={false}
        />
      );
    }
    // Between clicks in a chain: a dotted "next segment" preview from the last placed point.
    if (d.last) {
      return (
        <Line
          points={[d.last.x, d.last.y, d.preview.x, d.preview.y]}
          stroke="#7cc4ff"
          strokeWidth={3}
          dash={[8, 6]}
          listening={false}
        />
      );
    }
    return null;
  },
};
