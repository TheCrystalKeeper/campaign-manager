import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Group, Label, Layer, Line, Rect, Tag, Text, Wedge } from "react-konva";
import type Konva from "konva";
import { matchWallPreset, type Light, type Scene, type Token, type Wall } from "../lib/types";
import { computeVisibility, wallsToSegments, type Point } from "../lib/visibility";

/// <summary>
/// Phase 6 dynamic vision + Phase 6.6 lighting revamp. Two Konva layers:
/// - `VisionMaskLayer` — a darkness sheet above the tokens, erased (destination-out)
///   inside each viewer token's line-of-sight polygon where its darkvision or a light
///   reaches. Sitting above tokens, it also hides tokens standing in the dark.
/// - `WallsLightsEditor` — the DM's wall/door lines and light markers, interactive only
///   while the matching tool is active.
///
/// Phase 6.6: light reveals are radial GRADIENTS (smooth bright→dim→dark falloff) instead
/// of hard circles, honour a light's color/emission-angle/animation, and the scene has a
/// continuous 0..1 darkness level (day↔night) rather than a binary on/off.
/// </summary>

/**
 * dragBoundFunc for ring resize handles: pins the node at its parent group's position so a
 * "drag" never moves the ring — we read the pointer's distance from center instead.
 */
function pinToParentCenter(this: Konva.Node): Konva.Vector2d {
  return this.getParent()!.getAbsolutePosition();
}

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

/**
 * Clip to the UNION of several polygons (multiple subpaths + nonzero winding — the sweep
 * outputs consistently-wound polys, so overlaps union rather than cancel).
 */
function polygonsClip(polys: Point[][]): (ctx: Konva.Context) => void {
  return (ctx) => {
    ctx.beginPath();
    for (const poly of polys) {
      if (poly.length < 3) continue;
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i += 1) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.closePath();
    }
  };
}

// ---------------------------------------------------------------------------
// Phase 6.6 lighting helpers (pure — no per-frame allocation beyond small arrays)
// ---------------------------------------------------------------------------

/** Parses #rgb / #rrggbb (falls back to null so an unparseable color just skips its tint). */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Radial-gradient prop bundle shared by the erase and tint passes (Circle & Wedge). */
function radialFill(radiusPx: number, stops: Array<number | string>) {
  return {
    fillRadialGradientStartPoint: { x: 0, y: 0 },
    fillRadialGradientStartRadius: 0,
    fillRadialGradientEndPoint: { x: 0, y: 0 },
    fillRadialGradientEndRadius: radiusPx,
    fillRadialGradientColorStops: stops,
  };
}

/**
 * Erase stops for a `destination-out` reveal. Source alpha = how much darkness is removed:
 * 1 (fully lit) through the bright core, then — with gradual illumination — a smoothstep
 * ramp to 0 (dark) at the dim edge. The eased intermediate stops matter: a plateau kinking
 * into a linear fade produces a visible mach-band ring at the bright radius.
 * `peak` (≤1) lets an animation dim the whole light.
 */
function eraseStops(brightFrac: number, gradual: boolean, peak: number) {
  const a = clamp01(peak);
  const at = (alpha: number) => `rgba(0,0,0,${(a * alpha).toFixed(3)})`;
  const bf = Math.min(Math.max(brightFrac, 0), 0.98);
  if (!gradual) {
    return [0, at(1), 0.985, at(1), 1, "rgba(0,0,0,0)"];
  }
  // smoothstep(1→0) over the bright→dim span.
  const span = (f: number) => bf + (1 - bf) * f;
  return [
    0, at(1),
    bf, at(1),
    span(0.25), at(0.84),
    span(0.5), at(0.5),
    span(0.75), at(0.16),
    1, "rgba(0,0,0,0)",
  ];
}

/**
 * Color stops for the tint pass: a CONTINUOUS falloff from a hot center — deliberately NOT
 * the erase's flat plateau. Constant alpha across the bright radius reads as a muddy colored
 * disc; light glows from its source.
 */
function tintStops(
  rgb: { r: number; g: number; b: number },
  brightFrac: number,
  gradual: boolean,
  strength: number,
) {
  const a = clamp01(strength);
  const at = (alpha: number) => `rgba(${rgb.r},${rgb.g},${rgb.b},${(a * alpha).toFixed(3)})`;
  const clear = `rgba(${rgb.r},${rgb.g},${rgb.b},0)`;
  const bf = Math.min(Math.max(brightFrac, 0), 0.98);
  if (!gradual) {
    return [0, at(1), 0.985, at(1), 1, clear];
  }
  const span = (f: number) => bf + (1 - bf) * f;
  return [
    0, at(1),
    bf * 0.55, at(0.8),
    bf, at(0.55),
    span(0.35), at(0.26),
    span(0.7), at(0.09),
    1, clear,
  ];
}

/** Per-frame radius/brightness modulation for a light's animation (cheap trig, no sweep). */
function animModulation(light: Light, time: number): { radiusMul: number; peak: number } {
  const a = light.animation;
  if (!a || a.type === "none" || time === 0) return { radiusMul: 1, peak: 1 };
  const speed = a.speed ?? 1;
  const intensity = a.intensity ?? 0.5;
  const t = time * speed;
  if (a.type === "pulse") {
    // Slow breathe: radius & brightness swell together.
    const s = Math.sin(t * 2) * 0.5 + 0.5; // 0..1
    return { radiusMul: 1 - 0.3 * intensity * (1 - s), peak: 1 - 0.4 * intensity * (1 - s) };
  }
  // Flicker (torch/candle): summed incommensurate sines → pseudo-random jitter in ~[-1,1].
  const f = Math.sin(t * 11) * 0.5 + Math.sin(t * 17.3) * 0.3 + Math.sin(t * 29.7) * 0.2;
  return {
    radiusMul: 1 + 0.1 * intensity * f,
    peak: Math.min(1, 1 - 0.3 * intensity * (0.5 - 0.5 * f)),
  };
}

/** True if any enabled light on the scene wants to animate. */
function sceneHasAnimatedLight(scene: Scene): boolean {
  return scene.lights.some(
    (l) => l.enabled && l.animation && l.animation.type !== "none" && (l.animation.speed ?? 1) > 0,
  );
}

/**
 * A wall-clock time (seconds) that ticks ~30fps ONLY while `active`, and never while the OS
 * asks to reduce motion — idle/animation-free scenes schedule no frames at all.
 */
function useAnimationClock(active: boolean): number {
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const frame = 1000 / 30;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      if (now - last >= frame) {
        last = now;
        setTime(now / 1000);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return time;
}

/**
 * The reveal shape(s) for one light: a `destination-out` gradient (bright→dim→dark falloff),
 * plus — when the light has a color — an additive tint gradient of the same shape. Renders a
 * `Wedge` for directed lights (emission angle < 360) and a `Circle` otherwise.
 */
function LightReveal({ light, ftToPx, time }: { light: Light; ftToPx: number; time: number }) {
  const { radiusMul, peak } = animModulation(light, time);
  const dimPx = Math.max(0, light.dimR * ftToPx * radiusMul);
  if (dimPx <= 0) return null;
  const brightFrac = light.dimR > 0 ? Math.min(light.brightR / light.dimR, 1) : 1;
  const gradual = light.gradual !== false;
  const angle = light.angle ?? 360;
  const fill = radialFill(dimPx, eraseStops(brightFrac, gradual, peak));
  // A Wedge for directed lights, a Circle for full-circle ones — same gradient either way.
  // Color tint is NOT drawn here: it lives in LightTintLayer (a separate canvas composited
  // with a real CSS blend mode), so light color blends with the art instead of painting over it.
  return angle < 360 ? (
    <Wedge
      x={light.x}
      y={light.y}
      radius={dimPx}
      angle={angle}
      rotation={(light.rotation ?? 0) - angle / 2}
      globalCompositeOperation="destination-out"
      {...fill}
    />
  ) : (
    <Circle
      x={light.x}
      y={light.y}
      radius={dimPx}
      globalCompositeOperation="destination-out"
      {...fill}
    />
  );
}

/** Resolves the scene's effective darkness (0 day … 1 dark), migrating the legacy boolean. */
function sceneDarkness(scene: Scene, override?: number): number {
  if (override !== undefined) return clamp01(override);
  if (scene.darkness !== undefined) return clamp01(scene.darkness);
  return scene.globalIllumination ? 0 : 1;
}

export const VisionMaskLayer = memo(function VisionMaskLayer({
  scene,
  tokens,
  ftToPx,
  darkness,
  animationsEnabled = true,
}: {
  scene: Scene;
  /** The viewer's vision-enabled tokens on this scene. */
  tokens: Token[];
  /** World px per foot (scene.gridSize / feetPerSquare). */
  ftToPx: number;
  /** Displayed ambient darkness 0..1 (tweened by MapCanvas for smooth day↔night). */
  darkness?: number;
  /** Client toggle (low-end escape hatch): when false, no per-frame light animation. */
  animationsEnabled?: boolean;
}) {
  const segments = useMemo(() => wallsToSegments(scene.walls, "sight", ftToPx), [scene.walls, ftToPx]);
  const coverage = useLightCoverage(scene, ftToPx);
  const time = useAnimationClock(animationsEnabled && sceneHasAnimatedLight(scene));
  const dark = sceneDarkness(scene, darkness);
  const ambientReveal = 1 - dark; // how much the map shows in a viewer's LOS before lights
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
  const visiblePolys = useMemo(() => polys.filter((p) => p && p.length >= 3), [polys]);

  return (
    <Layer listening={false}>
      <Rect x={-2000} y={-2000} width={scene.width + 4000} height={scene.height + 4000} fill="#04050a" />
      {/* Ambient + lit areas: erased ONCE inside the UNION of all viewer LOS polygons.
          (The old per-token replay compounded destination-out in the falloff fringe —
          (1-a)^N with N vision tokens — so player pools rendered fatter/brighter than the
          DM's view of the same lights.) Each light is additionally clipped to its own
          wall coverage, so a lamp no longer shines through a wall between it and the area
          it lights — matching the DM overlay's geometry exactly. */}
      {visiblePolys.length > 0 ? (
        <Group clipFunc={polygonsClip(visiblePolys)}>
          {ambientReveal > 0.001 ? (
            <Rect
              x={-2000}
              y={-2000}
              width={scene.width + 4000}
              height={scene.height + 4000}
              fill="#000"
              opacity={ambientReveal}
              globalCompositeOperation="destination-out"
            />
          ) : null}
          {coverage.map(({ light, poly }) =>
            poly.length < 3 ? null : (
              <Group key={light.id} clipFunc={polygonClip(poly)}>
                <LightReveal light={light} ftToPx={ftToPx} time={time} />
              </Group>
            ),
          )}
        </Group>
      ) : null}
      {/* Darkvision: per token, clipped to that token's OWN line of sight. */}
      {tokens.map((token, index) => {
        const poly = polys[index];
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
              globalCompositeOperation="destination-out"
              {...radialFill(darkvisionR, eraseStops(0.75, true, 1))}
            />
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
  const segments = useMemo(() => wallsToSegments(scene.walls, "light", ftToPx), [scene.walls, ftToPx]);
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
/// Phase 6.6b coloration pass (modeled on Foundry's illumination/coloration buffer split):
/// colored lights draw their tint gradients into THIS dedicated layer, whose canvas element
/// is composited over the scene with a real CSS mix-blend-mode (default "screen" ≈ Foundry's
/// Adaptive Luminance). Mounted above tokens but BELOW fog and the darkness mask, so hidden
/// areas still cover it. Uncolored lights render nothing here.
/// </summary>
export const LightTintLayer = memo(function LightTintLayer({
  scene,
  ftToPx,
  animationsEnabled = true,
}: {
  scene: Scene;
  ftToPx: number;
  animationsEnabled?: boolean;
}) {
  const layerRef = useRef<Konva.Layer>(null);
  const blendMode = scene.lightBlendMode ?? "screen";
  const coverage = useLightCoverage(scene, ftToPx);
  const coloredLights = coverage.filter(({ light }) => light.color && hexToRgb(light.color));
  const time = useAnimationClock(
    animationsEnabled &&
      coloredLights.some(
        ({ light }) =>
          light.animation && light.animation.type !== "none" && (light.animation.speed ?? 1) > 0,
      ),
  );

  // The whole point: blend this layer's canvas against everything painted beneath it.
  // ("none" = fog-of-war only; MapCanvas doesn't mount us then, but guard anyway.)
  useEffect(() => {
    const el = layerRef.current?.getCanvas()._canvas;
    if (el) {
      el.style.mixBlendMode = blendMode === "none" ? "" : blendMode;
    }
    return () => {
      if (el) {
        el.style.mixBlendMode = "";
      }
    };
  }, [blendMode]);

  return (
    <Layer ref={layerRef} listening={false}>
      {coloredLights.map(({ light, poly }) => {
        if (poly.length < 3) return null;
        const rgb = hexToRgb(light.color!);
        if (!rgb) return null;
        const { radiusMul, peak } = animModulation(light, time);
        const dimPx = Math.max(0, light.dimR * ftToPx * radiusMul);
        const strength = (light.colorIntensity ?? 0.5) * peak;
        if (dimPx <= 0 || strength <= 0.01) return null;
        const brightFrac = light.dimR > 0 ? Math.min(light.brightR / light.dimR, 1) : 1;
        const angle = light.angle ?? 360;
        const fill = radialFill(dimPx, tintStops(rgb, brightFrac, light.gradual !== false, strength));
        return (
          <Group key={light.id} clipFunc={polygonClip(poly)}>
            {angle < 360 ? (
              <Wedge
                x={light.x}
                y={light.y}
                radius={dimPx}
                angle={angle}
                rotation={(light.rotation ?? 0) - angle / 2}
                {...fill}
              />
            ) : (
              <Circle x={light.x} y={light.y} radius={dimPx} {...fill} />
            )}
          </Group>
        );
      })}
    </Layer>
  );
});

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
  darkness,
  animationsEnabled = true,
}: {
  scene: Scene;
  /** Vision-enabled tokens on the scene (for darkvision pools). */
  tokens: Token[];
  ftToPx: number;
  /** Displayed ambient darkness 0..1 (tweened by MapCanvas for smooth day↔night). */
  darkness?: number;
  /** Client toggle (low-end escape hatch): when false, no per-frame light animation. */
  animationsEnabled?: boolean;
}) {
  const coverage = useLightCoverage(scene, ftToPx);
  const segments = useMemo(() => wallsToSegments(scene.walls, "sight", ftToPx), [scene.walls, ftToPx]);
  const time = useAnimationClock(animationsEnabled && sceneHasAnimatedLight(scene));
  // Keep the DM's map readable during setup: dim scales with darkness but never fully blacks out.
  const baseOpacity = Math.min(0.62, sceneDarkness(scene, darkness));
  const halfExtent = Math.hypot(scene.width, scene.height) + 20;
  const tokenKey = tokens
    .map((t) => `${t.id}:${Math.round(t.x)}:${Math.round(t.y)}:${t.vision?.rangeFt ?? 0}`)
    .join("|");
  const tokenPolys = useMemo(
    () => tokens.map((t) => computeVisibility({ x: t.x, y: t.y }, segments, halfExtent)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokenKey, segments, halfExtent],
  );

  if (baseOpacity <= 0.001) return null;

  return (
    <Layer listening={false}>
      {/* Dim (not black) so the DM still sees the whole map faintly. */}
      <Rect
        x={-2000}
        y={-2000}
        width={scene.width + 4000}
        height={scene.height + 4000}
        fill="#04050a"
        opacity={baseOpacity}
      />
      {coverage.map(({ light, poly }) =>
        poly.length < 3 ? null : (
          <Group key={light.id} clipFunc={polygonClip(poly)}>
            <LightReveal light={light} ftToPx={ftToPx} time={time} />
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
              globalCompositeOperation="destination-out"
              {...radialFill(darkvisionR, eraseStops(0.75, true, 1))}
            />
          </Group>
        );
      })}
    </Layer>
  );
});

/** Endpoint-dot color (Foundry uses a uniform gold); selected/hovered walls glow orange. */
const WALL_DOT_COLOR = "#ffce3a";
const WALL_SELECT_COLOR = "#ff922b";

/**
 * Stroke color + dash for a wall, by door state or matched channel preset. Palette matches
 * FoundryVTT's walls layer (confirmed with the user).
 */
function wallVisual(wall: Wall): { color: string; dash?: number[] } {
  if (wall.door && wall.door !== "none") {
    if (wall.door === "secret") return { color: "#d048d0", dash: [4, 4] }; // magenta
    if (wall.state === "open") return { color: "#7bd88f", dash: [10, 8] }; // green
    if (wall.state === "locked") return { color: "#ff6b6b" }; // red
    return { color: "#5b9bf0" }; // closed door — blue (per the reference screenshot)
  }
  switch (matchWallPreset(wall)) {
    case "terrain":
      return { color: "#81b90c", dash: [7, 6] }; // lime green
    case "invisible":
      return { color: "#5bc8e6", dash: [2, 6] }; // cyan
    case "ethereal":
      return { color: "#b98cf0", dash: [10, 6] }; // purple
    case "window":
      return { color: "#c7d8ff", dash: [12, 4] }; // pale blue
    case "normal":
      return { color: "#f2e9a0" }; // light yellow
    default:
      return { color: "#ced4da" }; // custom
  }
}

/** Midpoint→normal arrow pointing to a one-way wall's OCCLUDED side (matches visibility.ts). */
function oneWayArrow(wall: Wall, len: number): number[] | null {
  if (!wall.dir || wall.dir === "both") return null;
  const mx = (wall.x1 + wall.x2) / 2;
  const my = (wall.y1 + wall.y2) / 2;
  const sx = wall.x2 - wall.x1;
  const sy = wall.y2 - wall.y1;
  const L = Math.hypot(sx, sy) || 1;
  // (-sy, sx) points to the cross>0 ("left") blocking side; flip for "right".
  const nx = (wall.dir === "left" ? -sy : sy) / L;
  const ny = (wall.dir === "left" ? sx : -sx) / L;
  return [mx, my, mx + nx * len, my + ny * len];
}

export type WallSelectMods = { additive?: boolean; contiguous?: boolean };

/**
 * One wall in the modeless DM editor (Phase 6.9b). Whenever the tool is `interactive` (active and not
 * mid-chain) it shows draggable endpoint dots + a draggable body: grab a dot to move an endpoint, grab
 * the line to move the whole wall (auto-selecting it, or dragging the whole selection). Click selects
 * (Shift adds, Alt selects the connected run); hover highlights. Commits once per gesture. `offset` is
 * the live body-drag delta applied to OTHER selected walls so a whole run moves together.
 */
function WallNode({
  wall,
  selected,
  active,
  interactive,
  offset,
  onSelect,
  onConfigure,
  onDelete,
  onUpdate,
  onBodyDragMove,
  onBodyMove,
  snapWallPoint,
}: {
  wall: Wall;
  selected: boolean;
  /** The wall tool is active — show endpoint dots (even mid-chain, where they're non-interactive). */
  active: boolean;
  /** Active AND not mid-chain — walls respond to select/drag/config/delete. */
  interactive: boolean;
  offset?: { dx: number; dy: number };
  onSelect: (id: string, mods: WallSelectMods) => void;
  onConfigure: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (wall: Wall) => void;
  onBodyDragMove: (id: string, dx: number, dy: number) => void;
  onBodyMove: (id: string, dx: number, dy: number) => void;
  snapWallPoint: (x: number, y: number, opts?: { excludeId?: string; free?: boolean }) => Point;
}) {
  const [endpointDrag, setEndpointDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const off = offset ?? { dx: 0, dy: 0 };
  const w: Wall = endpointDrag
    ? { ...wall, ...endpointDrag }
    : { ...wall, x1: wall.x1 + off.dx, y1: wall.y1 + off.dy, x2: wall.x2 + off.dx, y2: wall.y2 + off.dy };
  const vis = wallVisual(wall);
  const isDoor = wall.door !== undefined && wall.door !== "none";
  const arrow = oneWayArrow(w, 18);
  const hot = hovered && interactive;
  const stroke = selected ? WALL_SELECT_COLOR : vis.color;
  const lineWidth = (selected ? 6 : isDoor ? 5 : 4) + (hot && !selected ? 1 : 0);
  const dotR = selected ? 9 : hot ? 8 : 6;
  const dotFill = selected || hot ? WALL_SELECT_COLOR : WALL_DOT_COLOR;
  const glow = selected
    ? { shadowColor: WALL_SELECT_COLOR, shadowBlur: 12, shadowOpacity: 0.9 }
    : hot
      ? { shadowColor: vis.color, shadowBlur: 6, shadowOpacity: 0.85 }
      : {};
  const mods = (e: Konva.KonvaEventObject<MouseEvent>): WallSelectMods => ({
    additive: e.evt.shiftKey,
    contiguous: e.evt.altKey,
  });

  const endpoint = (which: "a" | "b") => ({
    name: "map-handle",
    draggable: interactive,
    hitStrokeWidth: 14,
    onMouseEnter: () => interactive && setHovered(true),
    onMouseLeave: () => setHovered(false),
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => interactive && onSelect(wall.id, mods(e)),
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      if (!selected) onSelect(wall.id, {});
      setEndpointDrag({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 });
    },
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      const p = snapWallPoint(e.target.x(), e.target.y(), { excludeId: wall.id, free: e.evt.shiftKey });
      e.target.position(p);
      setEndpointDrag((cur) => {
        const b = cur ?? { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 };
        return which === "a" ? { ...b, x1: p.x, y1: p.y } : { ...b, x2: p.x, y2: p.y };
      });
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      setEndpointDrag((cur) => {
        if (cur) onUpdate({ ...wall, ...cur });
        return null;
      });
    },
  });

  return (
    <Group
      draggable={interactive}
      onMouseEnter={() => interactive && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={(e) => {
        if (e.target !== e.currentTarget) return; // endpoint drags cancelBubble; ignore any stray
        if (!selected) onSelect(wall.id, {});
      }}
      onDragMove={(e) => {
        if (e.target !== e.currentTarget) return;
        onBodyDragMove(wall.id, e.target.x(), e.target.y());
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        const dx = e.target.x();
        const dy = e.target.y();
        e.target.position({ x: 0, y: 0 });
        if (dx !== 0 || dy !== 0) onBodyMove(wall.id, dx, dy);
        else onBodyDragMove(wall.id, 0, 0); // no-op drag → clear any reported offset
      }}
      onClick={(e) => interactive && onSelect(wall.id, mods(e))}
      onDblClick={() => interactive && onConfigure(wall.id)}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        if (interactive) onDelete(wall.id);
      }}
    >
      <Line
        points={[w.x1, w.y1, w.x2, w.y2]}
        stroke={stroke}
        strokeWidth={lineWidth}
        dash={vis.dash}
        opacity={selected || hot ? 1 : 0.9}
        name="map-handle"
        listening={interactive}
        hitStrokeWidth={interactive ? 16 : 0}
        {...glow}
      />
      {arrow ? (
        <Arrow points={arrow} stroke={stroke} fill={stroke} strokeWidth={2} pointerLength={6} pointerWidth={6} listening={false} />
      ) : null}
      {active ? (
        <>
          <Circle
            x={w.x1}
            y={w.y1}
            radius={dotR}
            fill={dotFill}
            stroke="#1a1408"
            strokeWidth={1.5}
            listening={interactive}
            {...(interactive ? endpoint("a") : {})}
          />
          <Circle
            x={w.x2}
            y={w.y2}
            radius={dotR}
            fill={dotFill}
            stroke="#1a1408"
            strokeWidth={1.5}
            listening={interactive}
            {...(interactive ? endpoint("b") : {})}
          />
        </>
      ) : null}
    </Group>
  );
}

/// <summary>
/// Clickable door glyphs at door midpoints, shown to ALL clients (players open doors as they
/// explore). Secret doors render only for the DM. Left-click toggles open/closed; the DM right-clicks
/// to lock/unlock. The server enforces locked/secret.
/// </summary>
export const DoorLayer = memo(function DoorLayer({
  scene,
  isDm,
  onToggleDoor,
  onSetDoorState,
}: {
  scene: Scene;
  isDm: boolean;
  onToggleDoor: (id: string) => void;
  onSetDoorState: (id: string, state: "closed" | "open" | "locked") => void;
}) {
  const doors = scene.walls.filter(
    (w) => w.door && w.door !== "none" && (isDm || w.door !== "secret"),
  );
  if (doors.length === 0) return null;
  return (
    <Layer>
      {doors.map((d) => {
        const mx = (d.x1 + d.x2) / 2;
        const my = (d.y1 + d.y2) / 2;
        const color =
          d.door === "secret"
            ? "#d048d0"
            : d.state === "open"
              ? "#7bd88f"
              : d.state === "locked"
                ? "#ff6b6b"
                : "#5b9bf0";
        return (
          <Group
            key={d.id}
            x={mx}
            y={my}
            name="map-handle"
            onClick={() => onToggleDoor(d.id)}
            onTap={() => onToggleDoor(d.id)}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              // DM right-click toggles the lock; players can't lock/unlock.
              if (isDm) onSetDoorState(d.id, d.state === "locked" ? "closed" : "locked");
            }}
          >
            <Circle
              radius={10}
              fill="#1a1408"
              opacity={d.state === "open" ? 0.6 : 0.85}
              stroke={color}
              strokeWidth={2}
              hitStrokeWidth={6}
            />
            <Text
              text={d.state === "locked" ? "🔒" : "🚪"}
              fontSize={11}
              width={20}
              height={20}
              offsetX={10}
              offsetY={10}
              align="center"
              verticalAlign="middle"
              listening={false}
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
  chainActive,
  showWalls,
  lightsActive,
  selectedWallIds,
  onSelectWall,
  onDeleteWall,
  onUpdateWall,
  onUpdateWalls,
  onConfigureWall,
  snapWallPoint,
  onMoveLight,
  onDeleteLight,
  onConfigureLight,
}: {
  scene: Scene;
  ftToPx: number;
  wallsActive: boolean;
  /** A chain draw is in progress — walls go inert so clicks land as chain vertices. */
  chainActive: boolean;
  /** DM toggle: render wall lines while the walls tool is NOT active (always shown when it is). */
  showWalls: boolean;
  lightsActive: boolean;
  selectedWallIds: string[];
  onSelectWall: (id: string, mods: WallSelectMods) => void;
  onDeleteWall: (id: string) => void;
  onUpdateWall: (wall: Wall) => void;
  onUpdateWalls: (walls: Wall[]) => void;
  onConfigureWall: (id: string) => void;
  snapWallPoint: (x: number, y: number, opts?: { excludeId?: string; free?: boolean }) => Point;
  onMoveLight: (light: Light) => void;
  onDeleteLight: (id: string) => void;
  /** Open the per-light config panel (double-click). */
  onConfigureLight?: (light: Light) => void;
}) {
  // Hover hint: shows the "double-click / right-click / drag" affordances above a marker.
  const [hoveredLightId, setHoveredLightId] = useState<string | null>(null);
  // Live ring-resize draft: radii shown while dragging a reach ring; committed on release.
  const [resize, setResize] = useState<{ id: string; brightR: number; dimR: number } | null>(null);
  // Live body-drag delta so a whole multi-selection visibly moves together (not just on release).
  const [bodyDrag, setBodyDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  // Modeless (Phase 6.9b): walls are selectable/draggable whenever the tool is active and we're not
  // mid-chain (so chain clicks land as vertices instead of grabbing a wall).
  const interactive = wallsActive && !chainActive;
  const selectedSet = useMemo(() => new Set(selectedWallIds), [selectedWallIds]);
  const onBodyDragMove = (id: string, dx: number, dy: number) =>
    setBodyDrag(dx === 0 && dy === 0 ? null : { id, dx, dy });
  const commitBodyMove = (id: string, dx: number, dy: number) => {
    setBodyDrag(null);
    if (selectedSet.has(id) && selectedSet.size > 1) {
      const moved = scene.walls
        .filter((wall) => selectedSet.has(wall.id))
        .map((wall) => ({ ...wall, x1: wall.x1 + dx, y1: wall.y1 + dy, x2: wall.x2 + dx, y2: wall.y2 + dy }));
      onUpdateWalls(moved);
    } else {
      const wall = scene.walls.find((item) => item.id === id);
      if (wall) {
        onUpdateWall({ ...wall, x1: wall.x1 + dx, y1: wall.y1 + dy, x2: wall.x2 + dx, y2: wall.y2 + dy });
      }
    }
  };

  // Wall lines render while the tool is active (for editing) OR when the DM's "show walls" toggle
  // is on; hidden otherwise so the board isn't cluttered during play.
  const wallsVisible = wallsActive || showWalls;

  return (
    <Layer listening={wallsActive || lightsActive}>
      {wallsVisible
        ? scene.walls.map((wall) => (
            <WallNode
              key={wall.id}
              wall={wall}
              selected={selectedSet.has(wall.id)}
              active={wallsActive}
              interactive={interactive}
              offset={
                bodyDrag && bodyDrag.id !== wall.id && selectedSet.has(wall.id)
                  ? { dx: bodyDrag.dx, dy: bodyDrag.dy }
                  : undefined
              }
              onSelect={onSelectWall}
              onConfigure={onConfigureWall}
              onDelete={onDeleteWall}
              onUpdate={onUpdateWall}
              onBodyDragMove={onBodyDragMove}
              onBodyMove={commitBodyMove}
              snapWallPoint={snapWallPoint}
            />
          ))
        : null}

      {scene.lights.map((light) => {
        const angle = light.angle ?? 360;
        // Radii come from the live resize draft while a ring is being dragged.
        const shown = resize?.id === light.id ? resize : light;
        const dimPx = shown.dimR * ftToPx;
        const brightPx = shown.brightR * ftToPx;
        const directed = angle < 360;
        const wedgeRot = (light.rotation ?? 0) - angle / 2;
        // Neutral gold so the rings read as edit-UI, not as part of the light itself.
        const ringStroke = "#ffd166";

        // Ring drag = resize: the ring is pinned in place (dragBoundFunc) and we read the
        // pointer's distance from the light center instead, snapped to 5 ft.
        const ringResizeProps = (kind: "bright" | "dim") => ({
          name: "map-handle", // the stage's tool handler skips map-handles (no new light placed)
          draggable: true,
          dragBoundFunc: pinToParentCenter,
          hitStrokeWidth: 12,
          onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            setResize({ id: light.id, brightR: light.brightR, dimR: light.dimR });
          },
          onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            const p = e.target.getStage()?.getRelativePointerPosition();
            if (!p) return;
            const ft = Math.round(Math.hypot(p.x - light.x, p.y - light.y) / ftToPx / 5) * 5;
            setResize(
              kind === "bright"
                ? { id: light.id, brightR: Math.max(0, ft), dimR: Math.max(light.dimR, ft) }
                : { id: light.id, brightR: light.brightR, dimR: Math.max(5, light.brightR, ft) },
            );
          },
          onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            e.target.position({ x: 0, y: 0 });
            if (resize && resize.id === light.id) {
              onMoveLight({ ...light, brightR: resize.brightR, dimR: resize.dimR });
            }
            setResize(null);
          },
        });

        return (
          <Group
            key={light.id}
            x={light.x}
            y={light.y}
            draggable={lightsActive}
            onMouseEnter={() => lightsActive && setHoveredLightId(light.id)}
            onMouseLeave={() => setHoveredLightId((id) => (id === light.id ? null : id))}
            onDragEnd={(e) => {
              // Ring drags bubble here too — only commit a MOVE for the group itself.
              if (e.target !== e.currentTarget) return;
              onMoveLight({ ...light, x: e.target.x(), y: e.target.y() });
            }}
            onDblClick={() => onConfigureLight?.(light)}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              onDeleteLight(light.id);
            }}
          >
            {/* Reach rings (or wedges): coverage feedback + drag-to-resize handles —
                only while the lights tool is active (otherwise they read as a rendering
                artifact: a mystery outline around every light). Solid = bright radius,
                dashed = dim radius. */}
            {lightsActive ? (
              directed ? (
                <>
                  <Wedge
                    radius={brightPx}
                    angle={angle}
                    rotation={wedgeRot}
                    stroke={ringStroke}
                    strokeWidth={1}
                    opacity={0.35}
                    {...ringResizeProps("bright")}
                  />
                  <Wedge
                    radius={dimPx}
                    angle={angle}
                    rotation={wedgeRot}
                    stroke={ringStroke}
                    strokeWidth={1}
                    opacity={0.18}
                    dash={[8, 8]}
                    {...ringResizeProps("dim")}
                  />
                </>
              ) : (
                <>
                  <Circle
                    radius={brightPx}
                    stroke={ringStroke}
                    strokeWidth={1}
                    opacity={0.35}
                    {...ringResizeProps("bright")}
                  />
                  <Circle
                    radius={dimPx}
                    stroke={ringStroke}
                    strokeWidth={1}
                    opacity={0.18}
                    dash={[8, 8]}
                    {...ringResizeProps("dim")}
                  />
                </>
              )
            ) : null}
            <Circle
              name="map-handle"
              radius={9}
              fill={light.enabled ? (light.color ?? "#ffd166") : "#7a7a7a"}
              stroke="#1a1408"
              strokeWidth={1.5}
              hitStrokeWidth={lightsActive ? 14 : 0}
            />
            {resize?.id === light.id ? (
              <Label y={-30} offsetX={60} listening={false}>
                <Tag fill="#1a1408" opacity={0.92} cornerRadius={3} />
                <Text
                  text={`${resize.brightR} / ${resize.dimR} ft`}
                  fontSize={11}
                  padding={5}
                  fill="#ffd166"
                  width={120}
                  align="center"
                />
              </Label>
            ) : hoveredLightId === light.id ? (
              <Label y={-42} offsetX={112} listening={false}>
                <Tag fill="#1a1408" opacity={0.92} cornerRadius={3} />
                <Text
                  text={"Dbl-click: edit · R-click: delete\nDrag: move · Drag a ring: resize"}
                  fontSize={11}
                  padding={5}
                  fill="#ffd166"
                  width={224}
                  align="center"
                />
              </Label>
            ) : null}
          </Group>
        );
      })}
    </Layer>
  );
});
