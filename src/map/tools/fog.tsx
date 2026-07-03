import { Circle, Rect } from "react-konva";
import type { FogReveal } from "../../lib/types";
import type { MapTool } from "./types";

/// <summary>
/// Manual fog reveals (DM): drag a rectangle to reveal an area (Shift-drag for a
/// circle from the press point). Enable/reset fog from the toolbar's fog controls.
/// </summary>

type FogDraft = {
  shape: "rect" | "circle";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export const fogTool: MapTool = {
  id: "fog",
  label: "Fog reveal",
  icon: "🌫",
  hotkey: "f",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    rt.setDraft({
      shape: event.shiftKey ? "circle" : "rect",
      x0: event.world.x,
      y0: event.world.y,
      x1: event.world.x,
      y1: event.world.y,
    } satisfies FogDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as FogDraft | null;
    if (!draft) {
      return;
    }
    rt.setDraft({ ...draft, x1: event.world.x, y1: event.world.y });
  },
  onUp: (_event, rt) => {
    const draft = rt.draft as FogDraft | null;
    rt.setDraft(null);
    if (!draft) {
      return;
    }
    let shape: FogReveal | null = null;
    if (draft.shape === "circle") {
      const r = Math.hypot(draft.x1 - draft.x0, draft.y1 - draft.y0);
      if (r > 4) {
        shape = { kind: "circle", x: draft.x0, y: draft.y0, r };
      }
    } else {
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      if (w > 4 && h > 4) {
        shape = {
          kind: "rect",
          x: Math.min(draft.x0, draft.x1),
          y: Math.min(draft.y0, draft.y1),
          w,
          h,
        };
      }
    }
    if (shape) {
      rt.send({ type: "FOG_REVEAL", sceneId: rt.scene.id, shape });
    }
  },
  renderDraft: (draft) => {
    const d = draft as FogDraft | null;
    if (!d) {
      return null;
    }
    if (d.shape === "circle") {
      return (
        <Circle
          x={d.x0}
          y={d.y0}
          radius={Math.hypot(d.x1 - d.x0, d.y1 - d.y0)}
          stroke="#9ad1ff"
          strokeWidth={2}
          dash={[6, 4]}
          fill="rgba(154,209,255,0.12)"
          listening={false}
        />
      );
    }
    return (
      <Rect
        x={Math.min(d.x0, d.x1)}
        y={Math.min(d.y0, d.y1)}
        width={Math.abs(d.x1 - d.x0)}
        height={Math.abs(d.y1 - d.y0)}
        stroke="#9ad1ff"
        strokeWidth={2}
        dash={[6, 4]}
        fill="rgba(154,209,255,0.12)"
        listening={false}
      />
    );
  },
};
