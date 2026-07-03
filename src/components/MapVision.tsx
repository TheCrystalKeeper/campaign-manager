import { memo, useMemo } from "react";
import { Circle, Group, Layer, Line, Rect } from "react-konva";
import type Konva from "konva";
import type { Light, Scene, Token } from "../lib/types";
import { computeVisibility, wallsToSegments, type Point } from "../lib/visibility";

/// <summary>
/// Phase 6 dynamic vision + light editing. Two Konva layers:
/// - `VisionMaskLayer` — a darkness sheet above the tokens, erased (destination-out)
///   inside each viewer token's line-of-sight polygon where its darkvision or a light
///   reaches. Sitting above tokens, it also hides tokens standing in the dark.
/// - `WallsLightsEditor` — the DM's wall/door lines and light markers, interactive only
///   while the matching tool is active.
/// </summary>

/** Builds a Konva clip path from a visibility polygon (world coords). */
function polygonClip(poly: Point[]): (ctx: Konva.Context) => void {
  return (ctx) => {
    ctx.beginPath();
    if (poly.length > 0) {
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i += 1) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
    }
    ctx.closePath();
  };
}

export const VisionMaskLayer = memo(function VisionMaskLayer({
  scene,
  tokens,
  ftToPx,
}: {
  scene: Scene;
  /** The viewer's vision-enabled tokens on this scene. */
  tokens: Token[];
  /** World px per foot (scene.gridSize / feetPerSquare). */
  ftToPx: number;
}) {
  const segments = useMemo(() => wallsToSegments(scene.walls), [scene.walls]);
  const enabledLights = useMemo(() => scene.lights.filter((light) => light.enabled), [scene.lights]);
  // A box big enough to contain every reveal circle anywhere on the map, so a token's LOS
  // polygon (which its reveals are clipped to) covers the whole visible-from-token area.
  const halfExtent = Math.hypot(scene.width, scene.height) + 20;

  // LOS-gated (user's choice): a viewer only sees within its own line of sight. Recompute
  // the sweep only when a viewer token moves or the walls change (MapCanvas re-renders
  // often), so key off a stable signature.
  const tokenKey = tokens
    .map((t) => `${t.id}:${Math.round(t.x)}:${Math.round(t.y)}:${t.vision?.rangeFt ?? 0}`)
    .join("|");
  const polys = useMemo(
    () => tokens.map((t) => computeVisibility({ x: t.x, y: t.y }, segments, halfExtent)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokenKey, segments, halfExtent],
  );

  return (
    <Layer listening={false}>
      <Rect x={-2000} y={-2000} width={scene.width + 4000} height={scene.height + 4000} fill="#04050a" />
      {tokens.map((token, index) => {
        const poly = polys[index];
        if (!poly || poly.length < 3) {
          return null;
        }
        const darkvisionR = (token.vision?.rangeFt ?? 0) * ftToPx;
        // Within this viewer's line of sight: its darkvision circle ∪ every lit area.
        return (
          <Group key={token.id} clipFunc={polygonClip(poly)}>
            {darkvisionR > 0 ? (
              <Circle
                x={token.x}
                y={token.y}
                radius={darkvisionR}
                fill="#000"
                globalCompositeOperation="destination-out"
              />
            ) : null}
            {enabledLights.map((light) => (
              <Circle
                key={light.id}
                x={light.x}
                y={light.y}
                radius={light.dimR * ftToPx}
                fill="#000"
                globalCompositeOperation="destination-out"
              />
            ))}
          </Group>
        );
      })}
    </Layer>
  );
});

/// <summary>
/// Per-enabled-light wall-clipped coverage polygon (its LOS ∩ dim radius). Memoized on a
/// (lights, walls) signature — the sweep is the expensive bit.
/// </summary>
function useLightCoverage(scene: Scene, ftToPx: number): Array<{ light: Light; poly: Point[] }> {
  const segments = useMemo(() => wallsToSegments(scene.walls), [scene.walls]);
  const enabledLights = useMemo(() => scene.lights.filter((light) => light.enabled), [scene.lights]);
  const key = enabledLights
    .map((l) => `${l.id}:${Math.round(l.x)}:${Math.round(l.y)}:${l.dimR}`)
    .join("|");
  return useMemo(
    () =>
      enabledLights.map((light) => ({
        light,
        poly: computeVisibility({ x: light.x, y: light.y }, segments, light.dimR * ftToPx + scene.gridSize),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, segments, ftToPx, scene.gridSize],
  );
}

/// <summary>
/// The DM's dynamic-lighting overview (shown when a scene has dynamic lighting on and the
/// DM is NOT previewing the player view): the map is dimmed and every light's wall-clipped
/// pool — plus any vision token's darkvision — is cut fully bright, so the DM immediately
/// sees which areas their lights illuminate. Unlike the player mask this is NOT gated by a
/// token's line of sight; it's the omniscient "here's my lighting" view.
/// </summary>
export const DmLightingOverlay = memo(function DmLightingOverlay({
  scene,
  tokens,
  ftToPx,
}: {
  scene: Scene;
  /** Vision-enabled tokens on the scene (for darkvision pools). */
  tokens: Token[];
  ftToPx: number;
}) {
  const coverage = useLightCoverage(scene, ftToPx);
  const segments = useMemo(() => wallsToSegments(scene.walls), [scene.walls]);
  const halfExtent = Math.hypot(scene.width, scene.height) + 20;
  const tokenKey = tokens
    .map((t) => `${t.id}:${Math.round(t.x)}:${Math.round(t.y)}:${t.vision?.rangeFt ?? 0}`)
    .join("|");
  const tokenPolys = useMemo(
    () => tokens.map((t) => computeVisibility({ x: t.x, y: t.y }, segments, halfExtent)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokenKey, segments, halfExtent],
  );

  return (
    <Layer listening={false}>
      {/* Dim (not black) so the DM still sees the whole map faintly. */}
      <Rect
        x={-2000}
        y={-2000}
        width={scene.width + 4000}
        height={scene.height + 4000}
        fill="#04050a"
        opacity={0.62}
      />
      {coverage.map(({ light, poly }) =>
        poly.length < 3 ? null : (
          <Group key={light.id} clipFunc={polygonClip(poly)}>
            <Circle
              x={light.x}
              y={light.y}
              radius={light.dimR * ftToPx}
              fill="#000"
              globalCompositeOperation="destination-out"
            />
          </Group>
        ),
      )}
      {tokens.map((token, index) => {
        const poly = tokenPolys[index];
        const darkvisionR = (token.vision?.rangeFt ?? 0) * ftToPx;
        if (!poly || poly.length < 3 || darkvisionR <= 0) {
          return null;
        }
        return (
          <Group key={token.id} clipFunc={polygonClip(poly)}>
            <Circle
              x={token.x}
              y={token.y}
              radius={darkvisionR}
              fill="#000"
              globalCompositeOperation="destination-out"
            />
          </Group>
        );
      })}
    </Layer>
  );
});

export const WallsLightsEditor = memo(function WallsLightsEditor({
  scene,
  ftToPx,
  wallsActive,
  lightsActive,
  onDeleteWall,
  onToggleDoor,
  onMoveLight,
  onDeleteLight,
}: {
  scene: Scene;
  ftToPx: number;
  wallsActive: boolean;
  lightsActive: boolean;
  onDeleteWall: (id: string) => void;
  onToggleDoor: (id: string) => void;
  onMoveLight: (light: Light) => void;
  onDeleteLight: (id: string) => void;
}) {
  return (
    <Layer listening={wallsActive || lightsActive}>
      {scene.walls.map((wall) => {
        const isDoor = wall.kind === "door";
        const open = isDoor && wall.open;
        const stroke = isDoor ? (open ? "#8ce99a" : "#e0a458") : "#8fb7ff";
        return (
          <Line
            key={wall.id}
            name="map-handle"
            points={[wall.x1, wall.y1, wall.x2, wall.y2]}
            stroke={stroke}
            strokeWidth={isDoor ? 4 : 3}
            opacity={open ? 0.55 : 0.9}
            dash={open ? [10, 8] : undefined}
            hitStrokeWidth={wallsActive ? 16 : 0}
            listening={wallsActive}
            onClick={() => {
              if (isDoor) {
                onToggleDoor(wall.id);
              }
            }}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              onDeleteWall(wall.id);
            }}
          />
        );
      })}

      {scene.lights.map((light) => (
        <Group
          key={light.id}
          x={light.x}
          y={light.y}
          draggable={lightsActive}
          onDragEnd={(e) => onMoveLight({ ...light, x: e.target.x(), y: e.target.y() })}
          onContextMenu={(e) => {
            e.evt.preventDefault();
            onDeleteLight(light.id);
          }}
        >
          {/* Faint reach rings so the DM sees a light's coverage. */}
          <Circle
            radius={light.brightR * ftToPx}
            stroke="rgba(255,209,102,0.35)"
            strokeWidth={1}
            listening={false}
          />
          <Circle
            radius={light.dimR * ftToPx}
            stroke="rgba(255,209,102,0.18)"
            strokeWidth={1}
            dash={[8, 8]}
            listening={false}
          />
          <Circle
            name="map-handle"
            radius={9}
            fill={light.enabled ? "#ffd166" : "#7a7a7a"}
            stroke="#1a1408"
            strokeWidth={1.5}
            hitStrokeWidth={lightsActive ? 14 : 0}
          />
        </Group>
      ))}
    </Layer>
  );
});
