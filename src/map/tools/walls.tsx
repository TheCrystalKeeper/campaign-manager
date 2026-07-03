import { Line } from "react-konva";
import type { Wall } from "../../lib/types";
import type { MapTool, ToolPoint, ToolRuntime } from "./types";

/// <summary>
/// Walls & doors tool (DM, Phase 6): drag to draw a sight-blocking segment.
/// **Shift-drag draws a door** (openable, blocks only while closed). Endpoints snap to
/// grid intersections when snap is on. Deleting a wall / toggling a door happens by
/// clicking the rendered segments (handled in MapCanvas), not through this tool.
/// </summary>

type WallDraft = { x0: number; y0: number; x1: number; y1: number; door: boolean };

/** Snap a point to the nearest grid intersection (corner), honoring the grid offset. */
function snapCorner(rt: ToolRuntime, x: number, y: number): ToolPoint {
  if (!rt.snap || rt.scene.gridSize <= 0) {
    return { x, y };
  }
  const g = rt.scene.gridSize;
  return {
    x: Math.round((x - rt.scene.gridOffsetX) / g) * g + rt.scene.gridOffsetX,
    y: Math.round((y - rt.scene.gridOffsetY) / g) * g + rt.scene.gridOffsetY,
  };
}

export const wallsTool: MapTool = {
  id: "walls",
  label: "Walls & doors",
  icon: "🧱",
  hotkey: "w",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    const p = snapCorner(rt, event.world.x, event.world.y);
    // The toolbar sets the default kind; Shift flips to the other kind for a quick one-off.
    const door = rt.wallKind === "door" ? !event.shiftKey : event.shiftKey;
    rt.setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, door } satisfies WallDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as WallDraft | null;
    if (!draft) {
      return;
    }
    const p = snapCorner(rt, event.world.x, event.world.y);
    rt.setDraft({ ...draft, x1: p.x, y1: p.y });
  },
  onUp: (_event, rt) => {
    const draft = rt.draft as WallDraft | null;
    rt.setDraft(null);
    if (!draft || Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0) < 5) {
      return; // too short to be a real segment
    }
    const wall: Wall = {
      id: `wall-${crypto.randomUUID().slice(0, 8)}`,
      x1: draft.x0,
      y1: draft.y0,
      x2: draft.x1,
      y2: draft.y1,
      kind: draft.door ? "door" : "wall",
    };
    rt.send({ type: "SET_WALLS", sceneId: rt.scene.id, walls: [...rt.scene.walls, wall] });
  },
  renderDraft: (draft) => {
    const d = draft as WallDraft | null;
    if (!d) {
      return null;
    }
    return (
      <Line
        points={[d.x0, d.y0, d.x1, d.y1]}
        stroke={d.door ? "#c9a36b" : "#7cc4ff"}
        strokeWidth={3}
        dash={d.door ? [10, 7] : undefined}
        listening={false}
      />
    );
  },
};
