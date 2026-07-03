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

/// <summary>Shared ruler visual: line, endpoints, and a distance/name tag.</summary>
export function RulerShape({
  scene,
  points,
  color,
  name,
}: {
  scene: Scene;
  points: number[];
  color: string;
  name?: string;
}) {
  if (points.length < 4) {
    return null;
  }
  const endX = points[points.length - 2];
  const endY = points[points.length - 1];
  const label = `${name ? `${name} — ` : ""}${formatRulerDistance(scene, points)}`;
  const labelW = label.length * 7.2 + 12;
  return (
    <Group listening={false}>
      <Line points={points} stroke={color} strokeWidth={2} dash={[8, 6]} />
      <Circle x={points[0]} y={points[1]} radius={4} fill={color} />
      <Circle x={endX} y={endY} radius={4} fill={color} />
      <Rect
        x={endX + 10}
        y={endY - 12}
        width={labelW}
        height={22}
        cornerRadius={5}
        fill="rgba(10,12,16,0.85)"
        stroke={color}
        strokeWidth={1}
      />
      <Text x={endX + 16} y={endY - 7} text={label} fontSize={12} fill="#e6e6e8" />
    </Group>
  );
}

export const measureTool: MapTool = {
  id: "measure",
  label: "Measure",
  icon: "📏",
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
    return <RulerShape scene={rt.scene} points={d.points} color="#7cc4ff" />;
  },
};
