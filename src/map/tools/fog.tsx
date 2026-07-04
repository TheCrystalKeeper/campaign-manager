import { Circle, Line } from "react-konva";
import { MAX_FOG_BRUSH_POINTS } from "../../lib/types";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Fog brush (DM): paint freehand to reveal fog — or, with the toolbar's Cover mode,
/// to paint fog back in. A plain click lays a single dab (circle). Strokes are
/// decimated and capped like draw strokes; hitting the cap commits and continues a
/// fresh stroke. Fog on/off, brush size, Invert (start-clear), and Reset live in the
/// toolbar's fog options.
/// </summary>

type FogDraft = {
  /** Committed samples (decimated). Empty = hover-only draft (brush-size preview ring). */
  points: number[];
  /** The current cursor, kept as a trailing point so the preview tracks it smoothly. */
  live: [number, number];
};

/** Only "cover" is ever sent — absent mode means reveal (matches the sanitizer). */
function modeField(rt: ToolRuntime): { mode: "cover" } | Record<string, never> {
  return rt.fogMode === "cover" ? { mode: "cover" } : {};
}

function commitStroke(rt: ToolRuntime, points: number[]) {
  if (points.length === 2) {
    // A click-dab: a single circle of the brush radius.
    rt.send({
      type: "FOG_REVEAL",
      sceneId: rt.scene.id,
      shape: { kind: "circle", x: points[0], y: points[1], r: rt.fogBrushR, ...modeField(rt) },
    });
    return;
  }
  if (points.length < 4) {
    return;
  }
  rt.send({
    type: "FOG_REVEAL",
    sceneId: rt.scene.id,
    shape: { kind: "brush", points, r: rt.fogBrushR, ...modeField(rt) },
  });
}

export const fogTool: MapTool = {
  id: "fog",
  label: "Fog brush",
  icon: "🌫",
  hotkey: "f",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    rt.setDraft({
      points: [event.world.x, event.world.y],
      live: [event.world.x, event.world.y],
    } satisfies FogDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as FogDraft | null;
    if (!draft || draft.points.length === 0) {
      // Not painting: keep a hover-only draft so the brush-size ring previews at the cursor.
      rt.setDraft({ points: [], live: [event.world.x, event.world.y] } satisfies FogDraft);
      return;
    }
    const pts = draft.points;
    const lastX = pts[pts.length - 2];
    const lastY = pts[pts.length - 1];
    // Commit a new sample only past the decimation step, but ALWAYS move the live
    // endpoint so the preview follows the cursor smoothly (no chunky jumps).
    const minDist = Math.max(rt.fogBrushR / 3, rt.scene.gridSize / 6);
    const live: [number, number] = [event.world.x, event.world.y];
    if (Math.hypot(event.world.x - lastX, event.world.y - lastY) < minDist) {
      rt.setDraft({ points: pts, live } satisfies FogDraft);
      return;
    }
    const points = [...pts, event.world.x, event.world.y];
    if (points.length >= MAX_FOG_BRUSH_POINTS) {
      // Cap hit mid-stroke: commit and keep painting from here (draw-tool idiom).
      commitStroke(rt, points);
      rt.setDraft({ points: [event.world.x, event.world.y], live } satisfies FogDraft);
      return;
    }
    rt.setDraft({ points, live } satisfies FogDraft);
  },
  onUp: (event, rt) => {
    const draft = rt.draft as FogDraft | null;
    rt.setDraft(null);
    if (!draft) {
      return;
    }
    // End the stroke exactly where released.
    const pts = draft.points;
    const lastX = pts[pts.length - 2];
    const lastY = pts[pts.length - 1];
    const points =
      pts.length >= 2 && (event.world.x !== lastX || event.world.y !== lastY)
        ? [...pts, event.world.x, event.world.y].slice(0, MAX_FOG_BRUSH_POINTS)
        : pts;
    commitStroke(rt, points);
  },
  onLeave: (rt) => {
    // Clear the hover ring when the cursor leaves the board; a mid-drag stroke survives.
    const draft = rt.draft as FogDraft | null;
    if (draft && draft.points.length === 0) {
      rt.setDraft(null);
    }
  },
  renderDraft: (draft, rt) => {
    const d = draft as FogDraft | null;
    if (!d) {
      return null;
    }
    const color = rt.fogMode === "cover" ? "#3a3f4a" : "#9ad1ff";
    // Preview follows the cursor: committed samples plus the live endpoint.
    const preview = [...d.points, d.live[0], d.live[1]];
    return (
      <>
        {preview.length >= 4 ? (
          <Line
            points={preview}
            stroke={color}
            strokeWidth={rt.fogBrushR * 2}
            lineCap="round"
            lineJoin="round"
            opacity={0.35}
            listening={false}
          />
        ) : null}
        {/* Brush cursor ring at the live point. */}
        <Circle
          x={d.live[0]}
          y={d.live[1]}
          radius={rt.fogBrushR}
          stroke={color}
          strokeWidth={1.5}
          dash={[5, 4]}
          opacity={0.8}
          listening={false}
        />
      </>
    );
  },
};
