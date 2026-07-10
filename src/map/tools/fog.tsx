import { CloudFog } from "lucide-react";
import { Circle, Line, Rect } from "react-konva";
import { MAX_FOG_BRUSH_POINTS, MAX_FOG_POLY_POINTS } from "../../lib/types";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Fog tool (DM). Four shapes, chosen in the toolbar's fog options:
///   • brush   — paint freehand to reveal fog (or, in Cover mode, paint it back in). A plain
///               click lays a single dab; strokes are decimated + capped like draw strokes.
///   • rect    — drag a rectangle; releasing applies fog to the box (Photoshop marquee).
///   • lasso   — drag a freehand outline; releasing closes + fills the loop.
///   • polygon — click to drop vertices; finish by clicking the first vertex, double-clicking,
///               or right-click/Esc to cancel.
/// Every shape honours the Cover/Reveal mode: reveal cuts fog away, cover paints it back.
/// </summary>

// Draft is discriminated by `shape`; fog is the sole consumer of `rt.draft`.
type BrushDraft = { shape: "brush"; points: number[]; live: ToolPointTuple };
type RectDraft = { shape: "rect"; start: ToolPointTuple; live: ToolPointTuple };
type LassoDraft = { shape: "lasso"; points: number[]; live: ToolPointTuple };
type PolyDraft = { shape: "polygon"; points: number[]; live: ToolPointTuple; nearStart: boolean };
type FogDraft = BrushDraft | RectDraft | LassoDraft | PolyDraft;
type ToolPointTuple = [number, number];

/** Only "cover" is ever sent — absent mode means reveal (matches the sanitizer). */
function modeField(rt: ToolRuntime): { mode: "cover" } | Record<string, never> {
  return rt.fogMode === "cover" ? { mode: "cover" } : {};
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
/** How close to the first vertex a click must land to close a polygon (world px). */
const closeRadius = (rt: ToolRuntime) => Math.max(rt.scene.gridSize * 0.35, 8);
/** Clicks within this of the last vertex are ignored (also swallows a double-click's 2nd click). */
const dedupeRadius = (rt: ToolRuntime) => Math.max(rt.scene.gridSize * 0.1, 3);

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

function commitRect(rt: ToolRuntime, start: ToolPointTuple, end: ToolPointTuple) {
  const x = Math.min(start[0], end[0]);
  const y = Math.min(start[1], end[1]);
  const w = Math.abs(end[0] - start[0]);
  const h = Math.abs(end[1] - start[1]);
  if (w < 2 || h < 2) {
    return; // a click without a drag — nothing to select
  }
  rt.send({
    type: "FOG_REVEAL",
    sceneId: rt.scene.id,
    shape: { kind: "rect", x, y, w, h, ...modeField(rt) },
  });
}

function commitPoly(rt: ToolRuntime, points: number[]) {
  const pts = points.slice(0, MAX_FOG_POLY_POINTS);
  if (pts.length < 6) {
    return; // need at least 3 vertices for an area
  }
  rt.send({
    type: "FOG_REVEAL",
    sceneId: rt.scene.id,
    shape: { kind: "poly", points: pts, ...modeField(rt) },
  });
}

/** Small dots marking each placed polygon vertex. */
function vertexDots(points: number[], color: string) {
  const dots = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    dots.push(
      <Circle
        key={i}
        x={points[i]}
        y={points[i + 1]}
        radius={3}
        fill={color}
        listening={false}
      />,
    );
  }
  return dots;
}

export const fogTool: MapTool = {
  id: "fog",
  label: "Fog",
  icon: <CloudFog size={17} strokeWidth={2.2} />,
  hotkey: "f",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    const { x, y } = event.world;
    if (rt.fogShape === "rect") {
      rt.setDraft({ shape: "rect", start: [x, y], live: [x, y] } satisfies RectDraft);
      return;
    }
    if (rt.fogShape === "lasso") {
      rt.setDraft({ shape: "lasso", points: [x, y], live: [x, y] } satisfies LassoDraft);
      return;
    }
    if (rt.fogShape === "polygon") {
      const d = rt.draft as FogDraft | null;
      const poly = d && d.shape === "polygon" ? d : null;
      if (!poly) {
        rt.setDraft({ shape: "polygon", points: [x, y], live: [x, y], nearStart: false } satisfies PolyDraft);
        return;
      }
      const pts = poly.points;
      // Click near the first vertex closes the loop.
      if (pts.length >= 6 && dist(x, y, pts[0], pts[1]) <= closeRadius(rt)) {
        commitPoly(rt, pts);
        rt.setDraft(null);
        return;
      }
      // Swallow a click on top of the last vertex (incl. a double-click's second click).
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      if (dist(x, y, lastX, lastY) <= dedupeRadius(rt)) {
        rt.setDraft({ ...poly, live: [x, y] });
        return;
      }
      rt.setDraft({ ...poly, points: [...pts, x, y], live: [x, y] });
      return;
    }
    // brush
    rt.setDraft({ shape: "brush", points: [x, y], live: [x, y] } satisfies BrushDraft);
  },
  onMove: (event, rt) => {
    const { x, y } = event.world;
    const d = rt.draft as FogDraft | null;

    if (rt.fogShape === "brush") {
      if (!d || d.shape !== "brush" || d.points.length === 0) {
        // Not painting: keep a hover-only draft so the brush-size ring previews at the cursor.
        rt.setDraft({ shape: "brush", points: [], live: [x, y] } satisfies BrushDraft);
        return;
      }
      const pts = d.points;
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      // Commit a new sample only past the decimation step, but ALWAYS move the live endpoint
      // so the preview follows the cursor smoothly (no chunky jumps).
      const minDist = Math.max(rt.fogBrushR / 3, rt.scene.gridSize / 6);
      const live: ToolPointTuple = [x, y];
      if (dist(x, y, lastX, lastY) < minDist) {
        rt.setDraft({ ...d, live });
        return;
      }
      const points = [...pts, x, y];
      if (points.length >= MAX_FOG_BRUSH_POINTS) {
        // Cap hit mid-stroke: commit and keep painting from here (draw-tool idiom).
        commitStroke(rt, points);
        rt.setDraft({ shape: "brush", points: [x, y], live } satisfies BrushDraft);
        return;
      }
      rt.setDraft({ ...d, points, live });
      return;
    }

    if (d?.shape === "rect") {
      rt.setDraft({ ...d, live: [x, y] });
      return;
    }
    if (d?.shape === "lasso") {
      // Freehand: decimate-append while dragging.
      const pts = d.points;
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      const minDist = Math.max(rt.scene.gridSize / 8, 4);
      if (dist(x, y, lastX, lastY) < minDist || pts.length >= MAX_FOG_POLY_POINTS) {
        rt.setDraft({ ...d, live: [x, y] });
        return;
      }
      rt.setDraft({ ...d, points: [...pts, x, y], live: [x, y] });
      return;
    }
    if (d?.shape === "polygon") {
      // Rubber-band the next edge; flag when the cursor is over the close target.
      const nearStart =
        d.points.length >= 6 && dist(x, y, d.points[0], d.points[1]) <= closeRadius(rt);
      rt.setDraft({ ...d, live: [x, y], nearStart });
      return;
    }
    // rect/lasso hovering with no draft → nothing to preview.
  },
  onUp: (event, rt) => {
    const { x, y } = event.world;
    const d = rt.draft as FogDraft | null;
    if (!d) {
      return;
    }
    if (d.shape === "rect") {
      rt.setDraft(null);
      commitRect(rt, d.start, [x, y]);
      return;
    }
    if (d.shape === "lasso") {
      rt.setDraft(null);
      commitPoly(rt, [...d.points, x, y]);
      return;
    }
    if (d.shape === "brush") {
      rt.setDraft(null);
      const pts = d.points;
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      const points =
        pts.length >= 2 && (x !== lastX || y !== lastY)
          ? [...pts, x, y].slice(0, MAX_FOG_BRUSH_POINTS)
          : pts;
      commitStroke(rt, points);
      return;
    }
    // polygon: click-based — the draft persists across clicks, so onUp is a no-op.
  },
  onDblClick: (_event, rt) => {
    const d = rt.draft as FogDraft | null;
    if (d?.shape === "polygon" && d.points.length >= 6) {
      commitPoly(rt, d.points);
      rt.setDraft(null);
    }
  },
  onLeave: (rt) => {
    // Clear the hover ring when the cursor leaves the board; a mid-drag / in-progress
    // selection (rect/lasso/polygon) survives so it isn't lost by a stray exit.
    const draft = rt.draft as FogDraft | null;
    if (draft && draft.shape === "brush" && draft.points.length === 0) {
      rt.setDraft(null);
    }
  },
  renderDraft: (draft, rt) => {
    const d = draft as FogDraft | null;
    if (!d) {
      return null;
    }
    const color = rt.fogMode === "cover" ? "#3a3f4a" : "#9ad1ff";
    const fill = rt.fogMode === "cover" ? "rgba(58,63,74,0.25)" : "rgba(154,209,255,0.22)";

    if (d.shape === "rect") {
      const x = Math.min(d.start[0], d.live[0]);
      const y = Math.min(d.start[1], d.live[1]);
      return (
        <Rect
          x={x}
          y={y}
          width={Math.abs(d.live[0] - d.start[0])}
          height={Math.abs(d.live[1] - d.start[1])}
          fill={fill}
          stroke={color}
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      );
    }
    if (d.shape === "lasso") {
      const preview = [...d.points, d.live[0], d.live[1]];
      return (
        <Line
          points={preview}
          closed
          fill={fill}
          stroke={color}
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
      );
    }
    if (d.shape === "polygon") {
      const preview = [...d.points, d.live[0], d.live[1]];
      return (
        <>
          <Line
            points={preview}
            closed
            fill={fill}
            stroke={color}
            strokeWidth={1.5}
            dash={[6, 4]}
            listening={false}
          />
          {vertexDots(d.points, color)}
          {/* Start vertex: grows into a filled dot when the cursor is close enough to close. */}
          <Circle
            x={d.points[0]}
            y={d.points[1]}
            radius={d.nearStart ? 7 : 4}
            stroke={color}
            strokeWidth={d.nearStart ? 2.5 : 1.5}
            fill={d.nearStart ? color : "transparent"}
            listening={false}
          />
        </>
      );
    }

    // brush
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
