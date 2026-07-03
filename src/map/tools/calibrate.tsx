import { Rect } from "react-konva";
import type { MapTool } from "./types";

/// <summary>
/// Grid calibration gesture (DM): drag a box over exactly ONE map square — the grid
/// size becomes the box size and the grid offset aligns to the box origin. Numeric
/// fine-tuning lives in the Scene panel.
/// </summary>

type CalibrateDraft = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export const calibrateTool: MapTool = {
  id: "calibrate",
  label: "Calibrate grid",
  icon: "🎯",
  hotkey: "g",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    rt.setDraft({
      x0: event.world.x,
      y0: event.world.y,
      x1: event.world.x,
      y1: event.world.y,
    } satisfies CalibrateDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as CalibrateDraft | null;
    if (!draft) {
      return;
    }
    // The selection is always a square (a grid cell IS one) — follow the dominant axis.
    const dx = event.world.x - draft.x0;
    const dy = event.world.y - draft.y0;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    rt.setDraft({
      ...draft,
      x1: draft.x0 + (dx < 0 ? -side : side),
      y1: draft.y0 + (dy < 0 ? -side : side),
    });
  },
  onUp: (_event, rt) => {
    const draft = rt.draft as CalibrateDraft | null;
    rt.setDraft(null);
    if (!draft) {
      return;
    }
    const side = Math.abs(draft.x1 - draft.x0); // square by construction
    if (side < 8) {
      return; // too small to be one square
    }
    const gridSize = Math.max(Math.round(side), 10);
    const originX = Math.min(draft.x0, draft.x1);
    const originY = Math.min(draft.y0, draft.y1);
    const mod = (value: number) => ((value % gridSize) + gridSize) % gridSize;
    rt.send({
      type: "UPDATE_SCENE",
      scene: {
        ...rt.scene,
        gridSize,
        gridOffsetX: mod(originX),
        gridOffsetY: mod(originY),
        showGrid: true,
      },
    });
  },
  renderDraft: (draft) => {
    const d = draft as CalibrateDraft | null;
    if (!d) {
      return null;
    }
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
  },
};
