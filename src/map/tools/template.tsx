import { Shapes } from "lucide-react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import type { Scene, TemplateShape } from "../../lib/types";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Measurement templates (Phase 7): drag from an origin to size a circle / cone / line /
/// rectangle area. Relayed live to every other client (transient TEMPLATE messages — never
/// GameState) and lingering ~2s after release. With "pin" on, the shape is instead committed
/// as a stroke annotation (persistent for the DM, fading for players).
/// </summary>

export type TemplateDraft = { shape: TemplateShape; done: boolean };

const RELAY_MS = 40;
const LINGER_MS = 2000;
/** Dotted outline for template shapes (matches the measure ruler's dash). */
const TEMPLATE_DASH = [8, 6];

let lastRelay = 0;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

function relay(rt: ToolRuntime, shape: TemplateShape | null, force = false) {
  const now = Date.now();
  if (!force && shape !== null && now - lastRelay < RELAY_MS) {
    return;
  }
  lastRelay = now;
  rt.send({ type: "TEMPLATE", sceneId: rt.scene.id, shape });
}

function dist(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

/** Feet label for a template's primary dimension. */
function templateLabel(scene: Scene, shape: TemplateShape): string {
  const ft = (px: number) => Math.round((px / Math.max(scene.gridSize, 1)) * scene.feetPerSquare);
  const [x0, y0, x1, y1] = shape.points;
  switch (shape.kind) {
    case "circle":
      return `${ft(dist(x0, y0, x1, y1))} ft radius`;
    case "cone":
    case "line":
      return `${ft(dist(x0, y0, x1, y1))} ft`;
    case "rect":
      return `${ft(Math.abs(x1 - x0))} × ${ft(Math.abs(y1 - y0))} ft`;
  }
}

/**
 * The world-space outline points of a template (flat x,y) — a closed loop used both to draw
 * the dotted outline and to pin the shape as a stroke annotation. `bandWidth` is the line
 * template's width (one grid square); it's ignored by the other kinds.
 */
export function templateOutline(shape: TemplateShape, bandWidth = 0): number[] {
  const [x0, y0, x1, y1] = shape.points;
  if (shape.kind === "circle") {
    const r = dist(x0, y0, x1, y1);
    const pts: number[] = [];
    for (let i = 0; i <= 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(x0 + r * Math.cos(a), y0 + r * Math.sin(a));
    }
    return pts;
  }
  if (shape.kind === "rect") {
    return [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
  }
  // Unit vector perpendicular to the drag direction, for the cone's far edge / line's sides.
  const len = dist(x0, y0, x1, y1) || 1;
  const px = -(y1 - y0) / len;
  const py = (x1 - x0) / len;
  if (shape.kind === "cone") {
    const hw = len / 2;
    return [x0, y0, x1 + px * hw, y1 + py * hw, x1 - px * hw, y1 - py * hw, x0, y0];
  }
  // line: a band `bandWidth` wide, as a closed rectangle down the drag axis.
  const hw = bandWidth / 2;
  return [
    x0 + px * hw, y0 + py * hw,
    x1 + px * hw, y1 + py * hw,
    x1 - px * hw, y1 - py * hw,
    x0 - px * hw, y0 - py * hw,
    x0 + px * hw, y0 + py * hw,
  ];
}

/// <summary>Shared template visual (draft + remote): the shape outline + a size tag.</summary>
export function TemplateShapeView({
  scene,
  shape,
  color,
  name,
}: {
  scene: Scene;
  shape: TemplateShape;
  color: string;
  name?: string;
}) {
  const [x0, y0, x1, y1] = shape.points;
  const fill = `${color}22`;
  const label = `${name ? `${name} — ` : ""}${templateLabel(scene, shape)}`;
  const labelW = label.length * 7.2 + 12;
  let body: React.ReactNode = null;

  if (shape.kind === "circle") {
    body = <Circle x={x0} y={y0} radius={dist(x0, y0, x1, y1)} fill={fill} stroke={color} strokeWidth={2} dash={TEMPLATE_DASH} />;
  } else if (shape.kind === "rect") {
    body = (
      <Rect
        x={Math.min(x0, x1)}
        y={Math.min(y0, y1)}
        width={Math.abs(x1 - x0)}
        height={Math.abs(y1 - y0)}
        fill={fill}
        stroke={color}
        strokeWidth={2}
        dash={TEMPLATE_DASH}
      />
    );
  } else if (shape.kind === "cone") {
    body = <Line points={templateOutline(shape)} closed fill={fill} stroke={color} strokeWidth={2} dash={TEMPLATE_DASH} />;
  } else {
    // line: a one-square-wide band drawn as a closed rectangle, so it has a dotted outline
    // and translucent fill just like the other shapes.
    body = (
      <Line points={templateOutline(shape, scene.gridSize)} closed fill={fill} stroke={color} strokeWidth={2} dash={TEMPLATE_DASH} />
    );
  }

  return (
    <Group listening={false}>
      {body}
      <Rect x={x1 + 10} y={y1 - 12} width={labelW} height={22} cornerRadius={5} fill="rgba(10,12,16,0.85)" stroke={color} strokeWidth={1} />
      <Text x={x1 + 16} y={y1 - 7} text={label} fontSize={12} fill="#e6e6e8" />
    </Group>
  );
}

const TEMPLATE_COLOR = "#7cc4ff";

export const templateTool: MapTool = {
  id: "template",
  label: "Template",
  icon: <Shapes size={17} strokeWidth={2.2} />,
  hotkey: "t",
  cursor: "crosshair",
  onDown: (event, rt) => {
    if (lingerTimer) {
      clearTimeout(lingerTimer);
      lingerTimer = null;
    }
    rt.setDraft({
      shape: { kind: rt.templateKind, points: [event.world.x, event.world.y, event.world.x, event.world.y] },
      done: false,
    } satisfies TemplateDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as TemplateDraft | null;
    if (!draft || draft.done) {
      return;
    }
    const p = draft.shape.points;
    const shape: TemplateShape = { kind: rt.templateKind, points: [p[0], p[1], event.world.x, event.world.y] };
    rt.setDraft({ shape, done: false } satisfies TemplateDraft);
    relay(rt, shape);
  },
  onUp: (_event, rt) => {
    const draft = rt.draft as TemplateDraft | null;
    if (!draft || draft.done) {
      return;
    }
    // Pin: commit as a stroke annotation (the server persists DM strokes, fades player ones).
    if (rt.templatePin && dist(draft.shape.points[0], draft.shape.points[1], draft.shape.points[2], draft.shape.points[3]) > 4) {
      rt.send({
        type: "ADD_ANNOTATION",
        sceneId: rt.scene.id,
        annotation: {
          id: `ann-${crypto.randomUUID().slice(0, 8)}`,
          authorId: rt.yourPlayerId ?? "dm",
          kind: "stroke",
          points: templateOutline(draft.shape, rt.scene.gridSize),
          color: TEMPLATE_COLOR,
          width: 2,
          createdAt: Date.now(),
          ephemeral: false,
        },
      });
      relay(rt, null, true);
      rt.setDraft(null);
      return;
    }
    relay(rt, draft.shape, true);
    rt.setDraft({ ...draft, done: true } satisfies TemplateDraft);
    lingerTimer = setTimeout(() => {
      lingerTimer = null;
      rt.setDraft(null);
      relay(rt, null, true);
    }, LINGER_MS);
  },
  renderDraft: (draft, rt) => {
    const d = draft as TemplateDraft | null;
    if (!d) {
      return null;
    }
    return <TemplateShapeView scene={rt.scene} shape={d.shape} color={TEMPLATE_COLOR} />;
  },
};
