import { memo } from "react";
import { Circle, Layer, Line, Rect } from "react-konva";
import type { Scene } from "../lib/types";

/** Fog fill — base sheet and cover-mode shapes must match exactly. */
const FOG_COLOR = "#05060a";
/** How much the DM sees through fog (0 = opaque, 1 = clear). */
const DM_FOG_ALPHA = 0.5;
const PAD = 10000;

/// <summary>
/// Manual fog of war, in ONE Konva layer at full opacity. Shapes composite in
/// painter's order (reveal = destination-out, cover = normal fill; base sheet unless
/// inverted) so overlaps are FLATTENED at full alpha — identical whether shapes overlap
/// or not. The DM's see-through is then a single trailing full-scene `destination-out`
/// rect that halves the whole flattened result uniformly (applying opacity to the Layer
/// instead would dim each child independently and make overlaps compound). Memoized so a
/// fog brush stroke — which only mutates the tool's draft, not `scene.fog` — never
/// re-diffs the committed shapes.
/// </summary>
export const FogLayer = memo(function FogLayer({ scene, isDm }: { scene: Scene; isDm: boolean }) {
  if (!scene.fog.enabled) {
    return null;
  }
  return (
    <Layer listening={false}>
      {!scene.fog.inverted ? (
        <Rect
          x={-PAD}
          y={-PAD}
          width={scene.width + PAD * 2}
          height={scene.height + PAD * 2}
          fill={FOG_COLOR}
        />
      ) : null}
      {scene.fog.reveals.map((shape, index) => {
        const cover = shape.mode === "cover";
        const op = cover ? "source-over" : "destination-out";
        const fill = cover ? FOG_COLOR : "#000";
        if (shape.kind === "rect") {
          return (
            <Rect
              key={index}
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              fill={fill}
              globalCompositeOperation={op}
            />
          );
        }
        if (shape.kind === "circle") {
          return (
            <Circle
              key={index}
              x={shape.x}
              y={shape.y}
              radius={shape.r}
              fill={fill}
              globalCompositeOperation={op}
            />
          );
        }
        return (
          <Line
            key={index}
            points={shape.points}
            stroke={fill}
            strokeWidth={shape.r * 2}
            lineCap="round"
            lineJoin="round"
            globalCompositeOperation={op}
          />
        );
      })}
      {/* DM see-through: uniformly halve the flattened fog's alpha in one pass. */}
      {isDm ? (
        <Rect
          x={-PAD}
          y={-PAD}
          width={scene.width + PAD * 2}
          height={scene.height + PAD * 2}
          fill="#000"
          opacity={DM_FOG_ALPHA}
          globalCompositeOperation="destination-out"
        />
      ) : null}
    </Layer>
  );
});
