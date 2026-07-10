import { Pencil } from "lucide-react";
import { Line } from "react-konva";
import { MAX_ANNOTATION_POINTS } from "../../lib/types";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Freehand drawing. Strokes are point-decimated and capped, then committed as an
/// ADD_ANNOTATION on release. Player strokes fade server-side (~10s); DM strokes
/// persist until erased (right-click in draw mode, or Clear all).
/// </summary>

export type DrawDraft = {
  points: number[];
};

function commit(rt: ToolRuntime, points: number[]) {
  if (points.length < 4) {
    return;
  }
  rt.send({
    type: "ADD_ANNOTATION",
    sceneId: rt.scene.id,
    annotation: {
      id: `ann-${crypto.randomUUID().slice(0, 8)}`,
      authorId: rt.yourPlayerId ?? "unknown", // server re-stamps this
      kind: "stroke",
      points,
      color: rt.drawColor,
      width: rt.drawWidth,
      createdAt: Date.now(),
      ephemeral: !rt.isDm, // server forces true for players regardless
    },
  });
}

export const drawTool: MapTool = {
  id: "draw",
  label: "Draw",
  icon: <Pencil size={17} strokeWidth={2.2} />,
  hotkey: "d",
  cursor: "crosshair",
  onDown: (event, rt) => {
    rt.setDraft({ points: [event.world.x, event.world.y] } satisfies DrawDraft);
  },
  onMove: (event, rt) => {
    const draft = rt.draft as DrawDraft | null;
    if (!draft) {
      return;
    }
    const pts = draft.points;
    const lastX = pts[pts.length - 2];
    const lastY = pts[pts.length - 1];
    // Decimate: skip samples closer than ~1/6 of a grid cell to the previous point.
    const minDist = Math.max(rt.scene.gridSize / 6, 4);
    if (Math.hypot(event.world.x - lastX, event.world.y - lastY) < minDist) {
      return;
    }
    const points = [...pts, event.world.x, event.world.y];
    if (points.length >= MAX_ANNOTATION_POINTS) {
      commit(rt, points);
      rt.setDraft(null);
      return;
    }
    rt.setDraft({ points } satisfies DrawDraft);
  },
  onUp: (_event, rt) => {
    const draft = rt.draft as DrawDraft | null;
    if (!draft) {
      return;
    }
    commit(rt, draft.points);
    rt.setDraft(null);
  },
  renderDraft: (draft, rt) => {
    const d = draft as DrawDraft | null;
    if (!d || d.points.length < 4) {
      return null;
    }
    return (
      <Line
        points={d.points}
        stroke={rt.drawColor}
        strokeWidth={rt.drawWidth}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
    );
  },
};
