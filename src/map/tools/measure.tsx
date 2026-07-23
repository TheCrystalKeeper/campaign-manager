import { Ruler } from "lucide-react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import type { Scene } from "../../lib/types";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Ruler: press-drag to measure from the press point; the ruler is relayed live to
/// every other client (transient MEASURE messages — never GameState) and lingers ~2s
/// after release. Distance uses 5e Chebyshev counting (a diagonal costs 1 square).
/// </summary>

export type MeasureDraft = {
  /** Flat [x0,y0,x1,y1] world coords. */
  points: number[];
  /** Released: lingering before it clears. */
  done: boolean;
};

const RELAY_MS = 40;
const LINGER_MS = 2000;

let lastRelay = 0;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

function relay(rt: ToolRuntime, points: number[] | null, force = false) {
  const now = Date.now();
  if (!force && points !== null && now - lastRelay < RELAY_MS) {
    return;
  }
  lastRelay = now;
  rt.send({ type: "MEASURE", sceneId: rt.scene.id, points });
}

/// <summary>5e distance for a ruler path: squares via Chebyshev, then feet.</summary>
export function formatRulerDistance(scene: Scene, points: number[]): string {
  let squares = 0;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const dx = Math.abs(points[i + 2] - points[i]);
    const dy = Math.abs(points[i + 3] - points[i + 1]);
    squares += Math.max(dx, dy) / Math.max(scene.gridSize, 1);
  }
  const rounded = Math.round(squares * 2) / 2;
  const feet = Math.round(rounded * scene.feetPerSquare);
  return `${feet} ft (${rounded} sq)`;
}

/// <summary>Shared ruler visual: line, endpoints, and a distance/name tag. Decorations
/// (stroke, endpoints, tag) are counter-scaled by the live viewport scale so they hold a
/// constant, readable on-screen size at any zoom — only the line's endpoints track world
/// coordinates. The tag lives in a group inverse-scaled at the ruler end, which also lands
/// its text at a 1:1 raster (crisp) regardless of zoom.</summary>
export function RulerShape({
  scene,
  points,
  color,
  name,
  scale = 1,
}: {
  scene: Scene;
  points: number[];
  color: string;
  name?: string;
  /** Live world→screen viewport scale; decorations divide by it to stay screen-constant. */
  scale?: number;
}) {
  if (points.length < 4) {
    return null;
  }
  // Inverse of the viewport zoom: multiply screen-px sizes by this to draw them in world px.
  const s = 1 / (scale > 0 ? scale : 1);
  const endX = points[points.length - 2];
  const endY = points[points.length - 1];
  const label = `${name ? `${name} — ` : ""}${formatRulerDistance(scene, points)}`;
  const boxH = 26;
  const padX = 10;
  const labelW = label.length * 8.4 + padX * 2;
  return (
    <Group listening={false}>
      <Line points={points} stroke={color} strokeWidth={2.5 * s} dash={[9 * s, 6 * s]} />
      <Circle x={points[0]} y={points[1]} radius={5 * s} fill={color} />
      <Circle x={endX} y={endY} radius={5 * s} fill={color} />
      {/* Tag anchored at the ruler end, inverse-scaled into screen space so its box + text
          hold a constant size (and crisp 1:1 text) no matter the zoom. */}
      <Group x={endX} y={endY} scaleX={s} scaleY={s} listening={false}>
        <Rect
          x={12}
          y={-boxH / 2}
          width={labelW}
          height={boxH}
          cornerRadius={7}
          fill="rgba(10,12,16,0.85)"
          stroke={color}
          strokeWidth={1.5}
        />
        <Text x={12 + padX} y={-7} text={label} fontSize={14} fill="#e6e6e8" />
      </Group>
    </Group>
  );
}

export const measureTool: MapTool = {
  id: "measure",
  label: "Measure",
  icon: <Ruler size={17} strokeWidth={2.2} />,
  hotkey: "m",
  cursor: "crosshair",
  onDown: (event, rt) => {
    if (lingerTimer) {
      clearTimeout(lingerTimer);
      lingerTimer = null;
    }
    rt.setDraft({
      points: [event.world.x, event.world.y, event.world.x, event.world.y],
      done: false,
    } satisfies MeasureDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as MeasureDraft | null;
    if (!draft || draft.done) {
      return;
    }
    const points = [draft.points[0], draft.points[1], event.world.x, event.world.y];
    rt.setDraft({ points, done: false } satisfies MeasureDraft);
    relay(rt, points);
  },
  onUp: (_event, rt) => {
    const draft = rt.draft as MeasureDraft | null;
    if (!draft || draft.done) {
      return;
    }
    relay(rt, draft.points, true);
    rt.setDraft({ ...draft, done: true } satisfies MeasureDraft);
    lingerTimer = setTimeout(() => {
      lingerTimer = null;
      rt.setDraft(null);
      relay(rt, null, true);
    }, LINGER_MS);
  },
  renderDraft: (draft, rt) => {
    const d = draft as MeasureDraft | null;
    if (!d) {
      return null;
    }
    return <RulerShape scene={rt.scene} points={d.points} color="#7cc4ff" scale={rt.viewportScale} />;
  },
};
