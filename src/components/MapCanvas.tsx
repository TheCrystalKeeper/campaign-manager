import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  RegularPolygon,
  Stage,
  Text,
} from "react-konva";
import type Konva from "konva";
import {
  ANNOTATION_FADE_MS,
  CONDITIONS,
  DEFAULT_ICON_CROP,
  DEFAULT_TOKEN_SHAPES,
  playerTokenColorForSlot,
  type Annotation,
  type ClientMessage,
  type GameState,
  type HitPoints,
  type IconCrop,
  type Light,
  type TemplateKind,
  type TemplateShape,
  type TokenShape,
  type Viewport,
  type Wall,
  type WallBrush,
  type WallDoorState,
  WALL_SNAP_SUBDIVISIONS,
} from "../lib/types";
import {
  clampViewportScale,
  downscaleImage,
  loadImageForCanvas,
  MAX_VIEWPORT_SCALE,
  tokenRadius,
} from "../lib/sceneUtils";
import type { MeasureEvent, TemplateEvent } from "../hooks/useGameRoom";
import type { History } from "../lib/history";
import { clampMove, movementSegments } from "../lib/visibility";
import { toolsForRole } from "../map/tools/registry";
import { selectTool } from "../map/tools/select";
import { LIGHT_PRESETS, type LightPreset } from "../map/tools/lights";
import { RulerShape } from "../map/tools/measure";
import { TemplateShapeView } from "../map/tools/template";
import type { ToolPointerEvent, ToolRuntime } from "../map/tools/types";
import { MapToolbar } from "./MapToolbar";
import { FogLayer } from "./MapFog";
import { DmLightingOverlay, DoorLayer, LightTintLayer, VisionMaskLayer, WallsLightsEditor } from "./MapVision";
import { LightConfigPanel } from "./LightConfigPanel";
import { WallConfigPanel } from "./WallConfigPanel";
import { readCampaignFlag, writeCampaignFlag } from "../lib/campaignStore";
import {
  annotationOpacity,
  annotationPathLength,
  appendAnnotationSample,
  appendDraftAnnotationSample,
  buildAnnotationDraftPreview,
  isAnnotationAtMaxPoints,
  trimAnnotationPoints,
  ANNOTATION_MIN_LENGTH,
} from "../lib/mapAnnotation";

/** The classic pointer-arrow palette (dark outline + cream fill), from the v1 system. */
const ARROW_COLOR = "#f0e6d2";

/** A scene's effective darkness 0..1, migrating the legacy `globalIllumination` boolean. */
function sceneDarkness(scene: { darkness?: number; globalIllumination: boolean }): number {
  if (scene.darkness !== undefined) return Math.min(Math.max(scene.darkness, 0), 1);
  return scene.globalIllumination ? 0 : 1;
}

/**
 * Eases a displayed value toward `target`, scheduling frames only while they differ — so a
 * settled value costs nothing. Drives the smooth day↔night darkness transition for everyone.
 * When `snapKey` changes (scene id — i.e. join or scene switch) the value jumps instantly to
 * `target` with no animation, so darkness/fog loads in place rather than flashing the map.
 */
function useEased(target: number, snapKey: string, rate = 2.5): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const snapRef = useRef(snapKey);
  if (snapRef.current !== snapKey) {
    // Set-during-render (guarded) — React re-renders with the snapped value before painting.
    snapRef.current = snapKey;
    valueRef.current = target;
    setValue(target);
  }
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const diff = target - valueRef.current;
      if (Math.abs(diff) < 0.002) {
        valueRef.current = target;
        setValue(target);
        return;
      }
      valueRef.current += diff * Math.min(1, rate * dt);
      setValue(valueRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, rate]);
  return value;
}

/** One remote client's live ruler, kept until cleared or stale (~2.5s). */
type RemoteRuler = {
  points: number[];
  name: string;
  color: string;
  sceneId: string;
  at: number;
};

type RemoteTemplate = {
  shape: TemplateShape;
  name: string;
  color: string;
  sceneId: string;
  at: number;
};

const CURRENT_TURN_COLOR = "#e9c176";

const CONDITION_EMOJI = new Map<string, string>(
  CONDITIONS.map((condition) => [condition.id, condition.emoji]),
);

function hpBarColor(ratio: number): string {
  if (ratio > 0.5) return "#7bc488";
  if (ratio > 0.25) return "#e5a34a";
  return "#e5686b";
}

type MapCanvasProps = {
  state: GameState;
  sceneId: string;
  isDm: boolean;
  yourPlayerId: string | null;
  viewport: Viewport;
  /** Provided for the DM (pan/zoom enabled); omitted for players (read-only mirror). */
  onViewportChange?: (viewport: Viewport) => void;
  onMoveToken: (tokenId: string, x: number, y: number, facing?: number) => void;
  onSelectToken?: (tokenId: string | null) => void;
  /** Double-click a token: open its linked sheet (character or item). */
  onOpenTokenSheet?: (token: GameState["tokens"][number]) => void;
  selectedTokenId?: string | null;
  /** When set, the next map click places a token at the returned world coords. */
  onPlaceToken?: (x: number, y: number) => void;
  /** Room send — map tools commit their work as ordinary room messages. */
  send: (message: ClientMessage) => void;
  /** Live-ruler relay subscription (transient MEASURE messages). */
  subscribeMeasure: (listener: (event: MeasureEvent) => void) => () => void;
  /** Live area-template relay subscription (transient TEMPLATE messages). */
  subscribeTemplate: (listener: (event: TemplateEvent) => void) => () => void;
  /** Per-client snap-to-grid — owned by App (settings + the toolbar 🧲 share it). */
  snap: boolean;
  onToggleSnap: () => void;
  /**
   * Gates the window-level tool hotkeys (V/M/D/…): with two canvases mounted
   * (board + scene editor), only the visible one may listen. Default true.
   */
  hotkeysEnabled?: boolean;
  /** Scene-editor mode: the canvas fills its host element instead of the window. */
  embedded?: boolean;
  /** DM undo/redo for map/token edits — renders the ↶/↷ rail buttons when present. */
  history?: History;
};

/// <summary>
/// Loads an image URL into an HTMLImageElement for Konva, or null while loading.
/// </summary>
function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let active = true;
    loadImageForCanvas(url)
      .then((loaded) => {
        if (active) setImg(loaded);
      })
      .catch(() => {
        if (active) setImg(null);
      });
    return () => {
      active = false;
    };
  }, [url]);
  return img;
}

/// <summary>
/// A token portrait pre-shrunk (high-quality, stepped) to roughly its on-screen size so
/// Konva doesn't downsample a big upload into a tiny token in one soft, low-quality pass.
/// Sized for the largest it can appear (token diameter × max zoom × device pixels) and
/// capped, so it stays crisp all the way to max zoom without re-rendering as you zoom.
/// Returns the original element when it's already small enough.
/// </summary>
function useCrispImage(
  img: HTMLImageElement | null,
  radius: number,
): HTMLImageElement | HTMLCanvasElement | null {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // Target the token's largest on-screen size × a SUPERSAMPLE factor: a ~1:1 copy drawn with
  // smoothing at a subpixel position looks soft, so we render at 2× and let it downsample to
  // a clean, sharp result. Cover-fit crops to the shorter image side, so also scale by the
  // aspect ratio to keep that side well-resolved. Round UP to a 64px step: `ceil` never
  // undershoots (nearest could land below and upscale → blur); the step keeps small radius
  // tweaks from churning the cached copy.
  const SUPERSAMPLE = 2;
  const aspect = img ? (img.naturalWidth || img.width) / (img.naturalHeight || img.height) : 1;
  const longSide = Number.isFinite(aspect) && aspect > 0 ? Math.max(aspect, 1 / aspect) : 1;
  const maxSide = Math.min(
    2048,
    Math.max(128, Math.ceil((radius * 2 * MAX_VIEWPORT_SCALE * dpr * longSide * SUPERSAMPLE) / 64) * 64),
  );
  return useMemo(() => (img ? downscaleImage(img, maxSide) : null), [img, maxSide]);
}

/// <summary>
/// Tracks the size of the canvas host element (ResizeObserver) so the Konva stage
/// fills it. On the board the host is fixed/inset-0 (== window size); embedded in
/// the scene editor it is the editor box. Guards the initial 0×0 pre-measure.
/// </summary>
function useElementSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/// <summary>
/// A single token: colored circle with optional portrait image, label, and
/// combat state — current-turn ring, HP bar (from the linked sheet), condition
/// badges, and a desaturated skull overlay at 0 HP.
/// </summary>
/** Konva sides for the RegularPolygon token shapes (square uses a Rect instead). */
const TOKEN_POLY_SIDES: Partial<Record<TokenShape, number>> = {
  diamond: 4,
  triangle: 3,
  hexagon: 6,
  octagon: 8,
};

/** Traces a token shape's outline into a Konva context — used to clip the portrait to it. */
function clipTokenShape(ctx: Konva.Context, shape: TokenShape, radius: number) {
  if (shape === "circle") {
    ctx.arc(0, 0, radius, 0, Math.PI * 2, false);
    return;
  }
  if (shape === "square") {
    const s = radius;
    const r = radius * 0.14; // rounded corners, matching the Rect outline
    ctx.moveTo(-s + r, -s);
    ctx.arcTo(s, -s, s, s, r);
    ctx.arcTo(s, s, -s, s, r);
    ctx.arcTo(-s, s, -s, -s, r);
    ctx.arcTo(-s, -s, s, -s, r);
    ctx.closePath();
    return;
  }
  const sides = TOKEN_POLY_SIDES[shape] ?? 6;
  for (let i = 0; i < sides; i += 1) {
    const a = (i * 2 * Math.PI) / sides; // Konva RegularPolygon: first vertex at top
    const x = radius * Math.sin(a);
    const y = -radius * Math.cos(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The token silhouette as a Konva primitive: solid `fill` when given, else stroke-only. */
function TokenShapePrimitive({
  shape,
  radius,
  fill,
  stroke,
  strokeWidth,
  glow,
}: {
  shape: TokenShape;
  radius: number;
  fill?: string;
  stroke: string;
  strokeWidth: number;
  glow?: Record<string, unknown>;
}) {
  const common = { stroke, strokeWidth, ...(fill ? { fill } : {}), ...(glow ?? {}) };
  if (shape === "square") {
    return (
      <Rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} cornerRadius={radius * 0.14} {...common} />
    );
  }
  if (shape === "circle") {
    return <Circle radius={radius} {...common} />;
  }
  return <RegularPolygon sides={TOKEN_POLY_SIDES[shape] ?? 6} radius={radius} {...common} />;
}

/**
 * Renders a token's silhouette: a solid-color shape, or — for framed image tokens — the
 * portrait cover-fitted and clipped to the shape, with the outline drawn on top. Uses a
 * clipped `KonvaImage` (drawImage: crisp, honors high-quality smoothing, preserves aspect)
 * rather than a fill pattern, which stretched non-square images and sampled at low quality.
 */
function TokenShapeNode({
  shape,
  radius,
  img,
  crop,
  fill,
  stroke,
  strokeWidth,
  glow,
}: {
  shape: TokenShape;
  radius: number;
  img: HTMLImageElement | HTMLCanvasElement | null | undefined;
  /** Focal point + zoom shared with the linked portrait/item icon, so the token follows the
   *  same crop the user set on the sheet. Undefined ⇒ centered cover-fit. */
  crop?: IconCrop;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Soft white hover/selection glow (Phase 7f): Konva shadow props, or none. */
  glow?: Record<string, unknown>;
}) {
  if (!img) {
    return (
      <TokenShapePrimitive shape={shape} radius={radius} fill={fill} stroke={stroke} strokeWidth={strokeWidth} glow={glow} />
    );
  }
  // Cover-fit the shape's bounding square preserving aspect (overflow clipped), then apply the
  // portrait's zoom and focal point exactly like CroppableImage: the focal (fx,fy) picks which
  // part of the overflow shows — fx=fy=0.5 centers, matching the sheet portrait.
  const size = radius * 2;
  const aspect = img.width / img.height;
  const zoom = crop?.zoom ?? 1;
  const fx = crop?.x ?? 0.5;
  const fy = crop?.y ?? 0.5;
  const coverW = (aspect >= 1 ? size * aspect : size) * zoom;
  const coverH = (aspect >= 1 ? size : size / aspect) * zoom;
  const x = -size / 2 - (coverW - size) * fx;
  const y = -size / 2 - (coverH - size) * fy;
  return (
    <>
      <Group clipFunc={(ctx) => clipTokenShape(ctx, shape, radius)}>
        <KonvaImage image={img} width={coverW} height={coverH} x={x} y={y} />
      </Group>
      {/* Outline + glow on top; no fill so the clipped portrait shows through. */}
      <TokenShapePrimitive shape={shape} radius={radius} stroke={stroke} strokeWidth={strokeWidth} glow={glow} />
    </>
  );
}

/** Eases a 0..1 value toward `target` over a few frames — drives the token hover/select
 *  glow so it fades in/out instead of snapping. */
function useGlowFade(target: number): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const next = valueRef.current + (target - valueRef.current) * 0.25;
      if (Math.abs(target - next) < 0.01) {
        setValue(target);
        return;
      }
      setValue(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

function TokenNode({
  token,
  imageUrl,
  imageCrop,
  controllerColor,
  shapeDefaults,
  radius,
  draggable,
  selected,
  isCurrentTurn,
  hp,
  showHpValues,
  onSelect,
  onOpenSheet,
  onMove,
  onRotate,
}: {
  token: GameState["tokens"][number];
  /** Portrait to render on the token (resolved live from the linked sheet). */
  imageUrl: string | null;
  /** Crop of that portrait/item icon, so the token follows the same framing as the sheet. */
  imageCrop?: IconCrop;
  /** When an NPC/enemy is controlled by a player ("mind control"), the controller's colour —
   *  drawn as a dashed ring so it's clear the token isn't DM-only. Null when not applicable. */
  controllerColor?: string | null;
  /** Per-group default shapes; used when the token has no explicit `shape`. */
  shapeDefaults: GameState["tokenShapeDefaults"];
  radius: number;
  draggable: boolean;
  selected: boolean;
  isCurrentTurn: boolean;
  /** HP to display under the token, or null to show no bar. */
  hp: HitPoints | null;
  showHpValues: boolean;
  onSelect?: () => void;
  /** Double-click: open the linked sheet (character or item). */
  onOpenSheet?: () => void;
  onMove: (x: number, y: number) => void;
  /** Rotate handle (selected + controllable): commit a new facing on pointer-up. */
  onRotate?: (facing: number) => void;
}) {
  const img = useImage(imageUrl);
  // Render a crisp, size-appropriate copy so large uploads don't look soft in a small token.
  const crispImg = useCrispImage(img, radius);
  const groupRef = useRef<Konva.Group>(null);
  const rotatingRef = useRef(false);
  const [dragFacing, setDragFacing] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const canRotate = Boolean(onRotate);
  const facingDeg = dragFacing ?? token.facing ?? 0;
  const shape = token.shape ?? (shapeDefaults ?? DEFAULT_TOKEN_SHAPES)[token.kind];
  // How far the token's silhouette reaches from center: the square spans the full diameter
  // (corners at radius·√2, outside the circle); every other shape sits within `radius`. The
  // facing arrow is offset past this so it never overlaps the token.
  const reach = shape === "square" ? radius * Math.SQRT2 : radius;
  // A soft white glow around the token (and its arrow) when hovered or selected — eased
  // in/out so it fades rather than snapping. Applies to every token kind, items included.
  const glow = useGlowFade(hovered || selected ? 1 : 0);
  const glowShadow =
    glow > 0.01
      ? {
          shadowColor: "#ffffff",
          shadowBlur: 9 * glow,
          shadowOpacity: 0.5 * glow,
          shadowForStrokeEnabled: true,
        }
      : undefined;
  // Once a committed rotation is echoed back by the server, drop the local preview so we
  // follow authoritative state again. We hold it (rather than clearing on pointer-up) so
  // the arrow never flashes to the pre-rotation facing during the round-trip. The angle
  // threshold ignores unrelated broadcasts that still carry the old facing (race guard).
  useEffect(() => {
    if (dragFacing === null || rotatingRef.current) return;
    const serverDeg = token.facing ?? 0;
    const diff = Math.abs(((serverDeg - dragFacing + 540) % 360) - 180);
    if (diff < 0.5) setDragFacing(null);
  }, [token, dragFacing]);
  // Creatures show a facing indicator; it's visible to everyone once a facing is set, and
  // to controllers (DM / owner) even before — so it can always be grabbed to rotate. Items
  // never show it. (No selection/double-click needed: the arrow itself is the handle.)
  const showArrow = token.kind !== "item" && (token.facing !== undefined || canRotate);

  // Facing indicator, drawn pointing UP (the wrapping Group rotates it by `facingDeg`):
  // a wide arrowhead flowing into two tapering fins that hug the rim on each side, set off
  // the token by a small gap. Traced as ONE continuous closed outline so it fills + strokes
  // as a single shape (no internal seams): tip → right base → right fin (out then back) →
  // inner arc under the head → left fin (in then out) → back to the tip.
  const arrowPoints = useMemo(() => {
    const gap = radius * 0.14;
    const R = reach + gap; // inner radius, offset past the token's silhouette
    const finW = radius * 0.28; // fin thickness at the mouth
    const finTipW = radius * 0.09; // fin thickness at the far end (blunt, not tapered to 0)
    const baseR = R + finW; // arrowhead base / fin outer radius at the mouth
    const up = -Math.PI / 2;
    const arrowH = radius * 0.38; // tip length beyond baseR (smaller arrowhead)
    const arrowAng = 0.26; // half-angle of the arrowhead base
    const spread = 1.02; // how far each fin sweeps around the rim (shorter = smaller arc)
    const steps = 14;
    const P = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
    const finAngle = (dir: number, s: number) => up + dir * (arrowAng + (spread - arrowAng) * s);
    const outerR = (s: number) => baseR + (R + finTipW - baseR) * s; // taper mouth → blunt tip
    const pts: Array<[number, number]> = [];
    pts.push([0, -(baseR + arrowH)]); // 1. tip
    pts.push(P(up + arrowAng, baseR)); // 2. right base corner
    for (let i = 1; i <= steps; i += 1) pts.push(P(finAngle(1, i / steps), outerR(i / steps))); // 3. right outer → blunt tip
    for (let i = steps; i >= 0; i -= 1) pts.push(P(finAngle(1, i / steps), R)); // 4. right inner ← back (blunt cap first)
    for (let i = 1; i < steps; i += 1) pts.push(P(up + arrowAng - 2 * arrowAng * (i / steps), R)); // 5. inner arc under the head
    for (let i = 0; i <= steps; i += 1) pts.push(P(finAngle(-1, i / steps), R)); // 6. left inner → far tip
    for (let i = steps; i >= 0; i -= 1) pts.push(P(finAngle(-1, i / steps), outerR(i / steps))); // 7. left outer ← back (blunt cap first)
    return pts.flat();
  }, [radius, reach]);

  /** Grab the arrow and drag to rotate: live preview, commit on pointer-up (never per-frame). */
  const startRotate = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!onRotate) return;
    e.cancelBubble = true; // don't select or drag the token underneath
    rotatingRef.current = true;
    const grp = groupRef.current;
    const stage = grp?.getStage();
    if (!grp || !stage) return;
    const container = stage.container();
    const degAt = (clientX: number, clientY: number, shiftKey: boolean) => {
      const rect = container.getBoundingClientRect();
      const local = grp
        .getAbsoluteTransform()
        .copy()
        .invert()
        .point({ x: clientX - rect.left, y: clientY - rect.top });
      let deg = (Math.atan2(local.x, -local.y) * 180) / Math.PI;
      deg = ((deg % 360) + 360) % 360;
      return shiftKey ? (Math.round(deg / 45) * 45) % 360 : deg;
    };
    const onMove = (ev: PointerEvent) => setDragFacing(degAt(ev.clientX, ev.clientY, ev.shiftKey));
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragFacing((cur) => {
        if (cur === null) return null;
        const final = degAt(ev.clientX, ev.clientY, ev.shiftKey);
        onRotate(final);
        // Keep showing the committed angle until the server echoes it back (the reconcile
        // effect clears it). Snapping to null here would flash the OLD token.facing for one
        // frame during the round-trip, then jump forward — the clunky bounce.
        return final;
      });
      // Clear after the token's click/dragEnd have fired so neither treats this as a move.
      setTimeout(() => {
        rotatingRef.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const dead = hp !== null && hp.max > 0 && hp.current <= 0;
  const showBar = hp !== null && hp.max > 0;
  const ratio = showBar ? Math.min(Math.max(hp.current / hp.max, 0), 1) : 0;
  const badges = token.conditions
    .map((id) => CONDITION_EMOJI.get(id))
    .filter(Boolean) as string[];
  const badgeText =
    badges.length > 4 ? `${badges.slice(0, 4).join("")}+${badges.length - 4}` : badges.join("");
  const labelY = radius + (showBar ? 9 : 2);

  return (
    <Group
      ref={groupRef}
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={token.hidden ? 0.4 : dead ? 0.55 : 1}
      onClick={() => {
        if (rotatingRef.current) return; // a rotate gesture, not a select
        onSelect?.();
      }}
      onTap={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDblClick={onOpenSheet}
      onDblTap={onOpenSheet}
      onDragStart={(e) => {
        // Shift-drag draws a pointer arrow; grabbing the facing arrow rotates instead of moving.
        if (e.evt.shiftKey || rotatingRef.current) {
          e.target.stopDrag();
        }
      }}
      onDragEnd={(e) => onMove(e.target.x(), e.target.y())}
    >
      {isCurrentTurn ? (
        <Circle radius={radius + 4} stroke={CURRENT_TURN_COLOR} strokeWidth={2.5} listening={false} />
      ) : null}
      {controllerColor ? (
        // A player controls this NPC ("mind control"): a dashed ring in their colour so it
        // reads as player-controlled rather than a DM-only token.
        <Circle
          radius={reach + 6}
          stroke={controllerColor}
          strokeWidth={2}
          dash={[5, 4]}
          opacity={0.9}
          listening={false}
        />
      ) : null}
      {showArrow ? (
        // Facing indicator: one continuous shape — an arrowhead flanked by two rim-hugging
        // fins — drawn pointing up and rotated by facing. It's a single closed outline (no
        // internal seams). Controllable tokens can grab it directly to rotate (no
        // selection/double-click needed); others see it read-only.
        <Group
          rotation={facingDeg}
          listening={canRotate}
          onMouseEnter={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = "grab";
          }}
          onMouseLeave={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = "";
          }}
          onMouseDown={startRotate}
          onTouchStart={startRotate}
        >
          <Line
            points={arrowPoints}
            closed
            fill={token.color}
            stroke="#00000088"
            strokeWidth={Math.max(1, radius * 0.05)}
            {...(glowShadow ?? {})}
          />
        </Group>
      ) : null}
      {crispImg && token.imageFit === "raw" ? (
        // Raw image token: the bare picture, no shape frame — just a soft white glow halo
        // that fades in on hover/select.
        <KonvaImage
          image={crispImg}
          width={radius * 2}
          height={radius * 2}
          offsetX={radius}
          offsetY={radius}
          {...(glowShadow ?? {})}
        />
      ) : (
        <TokenShapeNode
          shape={shape}
          radius={radius}
          img={crispImg}
          crop={imageCrop}
          fill={token.color}
          stroke={img ? token.color : "#00000066"}
          strokeWidth={2}
          glow={glowShadow}
        />
      )}
      {dead ? (
        <Text
          text="💀"
          fontSize={radius * 1.1}
          align="center"
          width={radius * 4}
          offsetX={radius * 2}
          y={-radius * 0.55}
          listening={false}
        />
      ) : null}
      {badgeText ? (
        <Text
          text={badgeText}
          fontSize={Math.max(9, radius * 0.55)}
          align="center"
          width={radius * 6}
          offsetX={radius * 3}
          y={-radius - Math.max(12, radius * 0.7)}
          listening={false}
        />
      ) : null}
      {showBar ? (
        <>
          <Rect
            x={-radius}
            y={radius + 3}
            width={radius * 2}
            height={4}
            cornerRadius={2}
            fill="rgba(0,0,0,0.6)"
            listening={false}
          />
          <Rect
            x={-radius}
            y={radius + 3}
            width={radius * 2 * ratio}
            height={4}
            cornerRadius={2}
            fill={hpBarColor(ratio)}
            listening={false}
          />
          {showHpValues ? (
            <Text
              text={`${hp.current}/${hp.max}`}
              fontSize={Math.max(8, radius * 0.45)}
              fill="#e6e6e8"
              align="center"
              width={radius * 4}
              offsetX={radius * 2}
              y={radius + 8}
              listening={false}
            />
          ) : null}
        </>
      ) : null}
      <Text
        text={token.label}
        fontSize={Math.max(10, radius * 0.7)}
        fill="#e6e6e8"
        align="center"
        width={radius * 4}
        offsetX={radius * 2}
        y={labelY + (showHpValues && showBar ? Math.max(8, radius * 0.45) + 1 : 0)}
        listening={false}
      />
    </Group>
  );
}

/// <summary>
/// Full-bleed tactical map: single background image, grid, and tokens. The DM pans/zooms
/// (broadcast to players); players render the shared viewport read-only but can drag their
/// own token.
/// </summary>
export function MapCanvas({
  state,
  sceneId,
  isDm,
  yourPlayerId,
  viewport,
  onViewportChange,
  onMoveToken,
  onSelectToken,
  onOpenTokenSheet,
  selectedTokenId,
  onPlaceToken,
  send,
  subscribeMeasure,
  subscribeTemplate,
  snap,
  onToggleSnap,
  hotkeysEnabled = true,
  embedded = false,
  history,
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { width: stageW, height: stageH } = useElementSize(rootRef);
  // Konva canvases default to imageSmoothingQuality "low", which visibly softens downscaled
  // images (token portraits, the map) even at normal zoom. Bump them all to "high". Crucially
  // this must include the STAGE's shared buffer canvas: a token has fill + stroke, so Konva
  // draws it through the buffer (then composites) — that's where its portrait is downsampled.
  // A canvas resize resets context state, so re-apply whenever the stage size changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const bump = (canvas: { getContext?: () => unknown } | null | undefined) => {
      const ctx = (canvas?.getContext?.() as { _context?: CanvasRenderingContext2D } | undefined)
        ?._context;
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
      }
    };
    for (const layer of stage.getLayers()) bump(layer.getCanvas());
    bump((stage as unknown as { bufferCanvas?: { getContext?: () => unknown } }).bufferCanvas);
    stage.batchDraw();
  }, [stageW, stageH]);
  const scene = state.scenes.find((item) => item.id === sceneId) ?? state.scenes[0];
  const mapImg = useImage(scene?.mapUrl ?? null);
  const sceneWalls = scene?.walls;

  // Stable wall/light editor callbacks so the memoized WallsLightsEditor layer bails
  // during (heavy) fog-brush strokes when a scene has many walls/lights.
  const onDeleteWall = useCallback(
    (id: string) => send({ type: "REMOVE_WALL", sceneId, wallId: id }),
    [send, sceneId],
  );
  const onUpdateWall = useCallback(
    (wall: Wall) => send({ type: "UPDATE_WALL", sceneId, wall }),
    [send, sceneId],
  );
  const onUpdateWalls = useCallback(
    (walls: Wall[]) => send({ type: "UPDATE_WALLS", sceneId, walls }),
    [send, sceneId],
  );
  const onToggleDoor = useCallback(
    (id: string) => send({ type: "TOGGLE_DOOR", sceneId, wallId: id }),
    [send, sceneId],
  );
  const onMoveLight = useCallback(
    (light: Light) => send({ type: "UPDATE_LIGHT", sceneId, light }),
    [send, sceneId],
  );
  const onDeleteLight = useCallback(
    (id: string) => send({ type: "REMOVE_LIGHT", sceneId, lightId: id }),
    [send, sceneId],
  );
  const onConfigureLight = useCallback((light: Light) => setEditingLightId(light.id), []);

  const canControlView = Boolean(onViewportChange);
  const placing = Boolean(onPlaceToken);

  // ---- Map tools (Phase 5): active tool, its transient draft, per-client options ----
  const [activeToolId, setActiveToolId] = useState("select");
  const [draft, setDraft] = useState<unknown>(null);
  const [drawColor, setDrawColor] = useState("#ffd166");
  const [drawWidth, setDrawWidth] = useState(4);
  /** Fog brush: paint direction + size (radius = gridSize × scale). */
  const [fogMode, setFogMode] = useState<"reveal" | "cover">("reveal");
  const [fogBrushScale, setFogBrushScale] = useState(0.75);
  /** Walls tool: what a fresh segment is drawn as (modeless — no Draw/Select toggle). */
  const [wallBrush, setWallBrush] = useState<WallBrush>("normal");
  /** Selected wall ids + which wall's config panel is open. */
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [editingWallId, setEditingWallId] = useState<string | null>(null);

  /**
   * Snap a world point for wall placement/editing: first to a nearby existing endpoint (so chains
   * join gap-free), else — unless `free` (Shift) — to the grid corner (🧲 Force-snap) or the micro
   * sub-grid (default).
   */
  const snapWallPoint = useCallback(
    (x: number, y: number, opts?: { excludeId?: string; free?: boolean }): { x: number; y: number } => {
      const walls = sceneWalls ?? [];
      const g = scene?.gridSize ?? 0;
      const thr = Math.max(g * 0.35, 8);
      let best: { x: number; y: number } | null = null;
      let bestD = thr;
      for (const w of walls) {
        if (w.id === opts?.excludeId) continue;
        for (const p of [
          { x: w.x1, y: w.y1 },
          { x: w.x2, y: w.y2 },
        ]) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
      if (best) return best;
      if (opts?.free || !scene || g <= 0) return { x, y };
      // 🧲 Force-snap → grid corners; otherwise micro-snap to the sub-grid.
      const step = snap ? g : g / WALL_SNAP_SUBDIVISIONS;
      return {
        x: Math.round((x - scene.gridOffsetX) / step) * step + scene.gridOffsetX,
        y: Math.round((y - scene.gridOffsetY) / step) * step + scene.gridOffsetY,
      };
    },
    [sceneWalls, scene, snap],
  );
  /** Ids of walls transitively joined to `startId` at shared endpoints (Alt-select a run). */
  const contiguousWallIds = useCallback(
    (startId: string): string[] => {
      const walls = sceneWalls ?? [];
      const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`; // ~0.5px
      const byPoint = new Map<string, string[]>();
      for (const w of walls) {
        for (const k of [key(w.x1, w.y1), key(w.x2, w.y2)]) {
          (byPoint.get(k) ?? byPoint.set(k, []).get(k)!).push(w.id);
        }
      }
      const wallById = new Map(walls.map((w) => [w.id, w]));
      const seen = new Set<string>([startId]);
      const queue = [startId];
      while (queue.length) {
        const w = wallById.get(queue.shift()!);
        if (!w) continue;
        for (const k of [key(w.x1, w.y1), key(w.x2, w.y2)]) {
          for (const id of byPoint.get(k) ?? []) {
            if (!seen.has(id)) {
              seen.add(id);
              queue.push(id);
            }
          }
        }
      }
      return [...seen];
    },
    [sceneWalls],
  );
  /** Click-select a wall: Alt = its whole connected run, Shift = add/remove, else replace. */
  const onSelectWall = useCallback(
    (id: string, mods: { additive?: boolean; contiguous?: boolean }) => {
      const ids = mods.contiguous ? contiguousWallIds(id) : [id];
      setSelectedWallIds((cur) => {
        if (mods.additive) return Array.from(new Set([...cur, ...ids]));
        if (mods.contiguous) return ids;
        return cur.includes(id) && cur.length === 1 ? cur : [id];
      });
    },
    [contiguousWallIds],
  );
  const onConfigureWall = useCallback((id: string) => setEditingWallId(id), []);
  /** Apply a config-panel field patch to the edited wall (or the whole multi-selection). */
  const applyWallPatch = useCallback(
    (patch: Partial<Wall>) => {
      const walls = sceneWalls ?? [];
      const primary = editingWallId ? walls.find((w) => w.id === editingWallId) : null;
      if (!primary) return;
      const ids =
        selectedWallIds.length > 1 && selectedWallIds.includes(primary.id)
          ? selectedWallIds
          : [primary.id];
      const targets = walls.filter((w) => ids.includes(w.id));
      if (targets.length <= 1) {
        onUpdateWall({ ...primary, ...patch });
      } else {
        onUpdateWalls(targets.map((w) => ({ ...w, ...patch })));
      }
    },
    [sceneWalls, editingWallId, selectedWallIds, onUpdateWall, onUpdateWalls],
  );
  /** Delete the edited wall (or the whole multi-selection) from the config panel. */
  const deleteEditingWalls = useCallback(() => {
    if (!editingWallId) return;
    const ids =
      selectedWallIds.length > 1 && selectedWallIds.includes(editingWallId)
        ? selectedWallIds
        : [editingWallId];
    for (const id of ids) send({ type: "REMOVE_WALL", sceneId, wallId: id });
    setSelectedWallIds([]);
    setEditingWallId(null);
  }, [editingWallId, selectedWallIds, send, sceneId]);
  /** Clone the selected walls half a cell down-right and select the clones. */
  const onCloneWalls = useCallback(() => {
    const sel = (sceneWalls ?? []).filter((w) => selectedWallIds.includes(w.id));
    if (sel.length === 0) return;
    const off = (scene?.gridSize ?? 50) / 2;
    const clones: Wall[] = sel.map((w) => ({
      ...w,
      id: `wall-${crypto.randomUUID().slice(0, 8)}`,
      x1: w.x1 + off,
      y1: w.y1 + off,
      x2: w.x2 + off,
      y2: w.y2 + off,
    }));
    onUpdateWalls(clones);
    setSelectedWallIds(clones.map((w) => w.id));
  }, [sceneWalls, selectedWallIds, scene, onUpdateWalls]);
  /** Delete every selected wall (X / Delete). */
  const deleteSelectedWalls = useCallback(() => {
    if (selectedWallIds.length === 0) return;
    for (const id of selectedWallIds) send({ type: "REMOVE_WALL", sceneId, wallId: id });
    setSelectedWallIds([]);
    setEditingWallId(null);
  }, [selectedWallIds, send, sceneId]);
  /** DM sets a door's exact state (right-click a door glyph to lock/unlock). */
  const onSetDoorState = useCallback(
    (id: string, state: WallDoorState) => send({ type: "SET_DOOR_STATE", sceneId, wallId: id, state }),
    [send, sceneId],
  );
  // Clear wall selection / config when leaving the walls tool or changing scene.
  useEffect(() => {
    setSelectedWallIds([]);
    setEditingWallId(null);
  }, [activeToolId, sceneId]);
  /** Movement-blocking wall segments for the token-drag collision test. */
  const movementSegs = useMemo(() => movementSegments(sceneWalls ?? []), [sceneWalls]);
  /** Lights tool: which preset a freshly placed light uses. */
  const [lightPreset, setLightPreset] = useState<LightPreset>("torch");
  /** Which light's config panel is open (double-click a light marker). */
  const [editingLightId, setEditingLightId] = useState<string | null>(null);
  /** DM-local darkness while dragging the slider (before it's committed to the scene). */
  const [darknessDraft, setDarknessDraft] = useState<number | null>(null);
  /** Client toggle: run per-frame light animations (off = low-end escape hatch). */
  const [lightAnimations, setLightAnimations] = useState(() =>
    readCampaignFlag(state.roomId, "light-anim", true, "lightAnimations"),
  );
  /** DM toggle: show wall lines while NOT in the walls tool (always shown while editing). */
  const [showWalls, setShowWalls] = useState(() =>
    readCampaignFlag(state.roomId, "show-walls", true, "showWalls"),
  );
  /** DM-only: preview dynamic vision as a player would see it. */
  const [visionPreview, setVisionPreview] = useState(false);
  const [rulers, setRulers] = useState<Record<string, RemoteRuler>>({});
  const [templates, setTemplates] = useState<Record<string, RemoteTemplate>>({});
  /** Templates tool: which shape to draw, and whether to pin it as an annotation. */
  const [templateKind, setTemplateKind] = useState<TemplateKind>("circle");
  const [templatePin, setTemplatePin] = useState(false);
  /** Active middle-mouse pan: pointer start + the viewport frozen at press. */
  const panRef = useRef<{ x: number; y: number; vp: Viewport } | null>(null);

  // ---- Ambient darkness 0..1 + smooth day↔night tween (Phase 6.6) ----
  const committedDarkness = scene ? sceneDarkness(scene) : 0;
  const sliderDarkness = darknessDraft ?? committedDarkness;
  // Snap (no ease) when the scene identity changes — joining a room or switching scenes loads
  // the darkness state instantly instead of animating in from a lit first frame (which flashed
  // the whole map before the darkness/fog settled). Same-scene changes (day/night) still ease.
  const displayDarkness = useEased(sliderDarkness, scene?.id ?? "none");
  // Drop the DM's local draft once the committed value catches up (post round-trip).
  useEffect(() => {
    if (darknessDraft !== null && Math.abs(committedDarkness - darknessDraft) < 0.005) {
      setDarknessDraft(null);
    }
  }, [committedDarkness, darknessDraft]);
  const commitDarkness = useCallback(
    (value: number) => {
      if (!scene) return;
      const darknessLevel = Math.min(Math.max(value, 0), 1);
      setDarknessDraft(darknessLevel);
      send({ type: "UPDATE_SCENE", scene: { ...scene, darkness: darknessLevel } });
    },
    [send, scene],
  );
  const toggleLightAnimations = useCallback(() => {
    setLightAnimations((on) => {
      writeCampaignFlag(state.roomId, "light-anim", !on);
      return !on;
    });
  }, [state.roomId]);
  const toggleShowWalls = useCallback(() => {
    setShowWalls((on) => {
      writeCampaignFlag(state.roomId, "show-walls", !on);
      return !on;
    });
  }, [state.roomId]);

  // ---- Shift-drag pointer arrow (always available; fades ~10s, like v1) ----
  const [shiftHeld, setShiftHeld] = useState(false);
  const [arrowDraft, setArrowDraft] = useState<number[] | null>(null);
  /** Id of our just-committed arrow: its server echo is hidden while the preview shows. */
  const [pendingArrowId, setPendingArrowId] = useState<string | null>(null);
  const drawingArrow = useRef(false);
  const arrowSparse = useRef<number[]>([]); // sparse, networked
  const arrowDense = useRef<number[]>([]); // dense, local preview
  const arrowGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Removed arrows fade out client-side (a "ghost") over ANNOTATION_FADE_MS — smooth and
  // immediate regardless of why the server dropped them (cap or end-of-life TTL).
  const [ghosts, setGhosts] = useState<Array<{ id: string; points: number[]; removedAt: number }>>([]);
  const prevArrowsRef = useRef<{ sceneId: string; ids: Map<string, number[]> }>({
    sceneId: "",
    ids: new Map(),
  });
  // Repaint clock that drives fades (ghost arrows, ephemeral strokes, live draft).
  const [fadeClock, setFadeClock] = useState(() => Date.now());

  const playersCanDraw = state.playersCanDraw;

  // Track Shift so the stage stops panning while an arrow is being drawn.
  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftHeld(event.type === "keydown");
      }
    };
    const clear = () => setShiftHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Other clients' live rulers arrive over the transient relay.
  useEffect(() => {
    return subscribeMeasure((event) => {
      setRulers((current) => {
        const next = { ...current };
        if (!event.points) {
          delete next[event.clientId];
        } else {
          next[event.clientId] = {
            points: event.points,
            name: event.name,
            color: event.color,
            sceneId: event.sceneId,
            at: Date.now(),
          };
        }
        return next;
      });
    });
  }, [subscribeMeasure]);

  // Prune rulers whose clear frame never arrived (disconnects, dropped frames).
  useEffect(() => {
    const timer = setInterval(() => {
      setRulers((current) => {
        const cutoff = Date.now() - 2500;
        const keep = Object.entries(current).filter(([, ruler]) => ruler.at >= cutoff);
        return keep.length === Object.keys(current).length
          ? current
          : Object.fromEntries(keep);
      });
      setTemplates((current) => {
        const cutoff = Date.now() - 2500;
        const keep = Object.entries(current).filter(([, tpl]) => tpl.at >= cutoff);
        return keep.length === Object.keys(current).length ? current : Object.fromEntries(keep);
      });
    }, 800);
    return () => clearInterval(timer);
  }, []);

  // Other clients' live area templates arrive over the same transient relay.
  useEffect(() => {
    return subscribeTemplate((event) => {
      setTemplates((current) => {
        const next = { ...current };
        if (!event.shape) {
          delete next[event.clientId];
        } else {
          next[event.clientId] = {
            shape: event.shape,
            name: event.name,
            color: event.color,
            sceneId: event.sceneId,
            at: Date.now(),
          };
        }
        return next;
      });
    });
  }, [subscribeTemplate]);

  // Snapshot removed arrows as fading "ghosts" so they fade out instead of popping.
  const sceneAnnotationsForGhosts = scene?.annotations;
  const currentSceneId = scene?.id ?? "";
  useEffect(() => {
    const current = new Map<string, number[]>();
    for (const annotation of sceneAnnotationsForGhosts ?? []) {
      if (annotation.kind === "arrow") {
        current.set(annotation.id, annotation.points ?? []);
      }
    }
    const prev = prevArrowsRef.current;
    if (prev.sceneId === currentSceneId) {
      const removed = [...prev.ids]
        .filter(([id]) => !current.has(id))
        .map(([id, points]) => ({ id, points, removedAt: Date.now() }));
      if (removed.length > 0) {
        setGhosts((g) => [...g, ...removed.filter((r) => !g.some((x) => x.id === r.id))]);
      }
    } else {
      setGhosts([]); // scene change — drop stale ghosts, don't animate
    }
    prevArrowsRef.current = { sceneId: currentSceneId, ids: current };
  }, [currentSceneId, sceneAnnotationsForGhosts]);

  // Ticks the fade clock while anything is fading (ghosts, ephemeral strokes, or a draft).
  const hasEphemeral = (scene?.annotations ?? []).some((annotation) => annotation.ephemeral);
  useEffect(() => {
    if (!hasEphemeral && !arrowDraft && ghosts.length === 0) {
      return;
    }
    const timer = setInterval(() => setFadeClock(Date.now()), 40);
    return () => clearInterval(timer);
  }, [hasEphemeral, arrowDraft, ghosts.length]);

  // Drop ghosts once their fade completes.
  useEffect(() => {
    if (ghosts.length === 0) {
      return;
    }
    const alive = ghosts.filter((g) => fadeClock - g.removedAt < ANNOTATION_FADE_MS);
    if (alive.length !== ghosts.length) {
      setGhosts(alive);
    }
  }, [fadeClock, ghosts]);

  // Hand off preview → committed arrow: once our echo lands, drop the local preview and
  // reveal the server copy in one swap, so only ever one arrow is on screen.
  const sceneAnnotations = scene?.annotations;
  useEffect(() => {
    if (!pendingArrowId) {
      return;
    }
    if ((sceneAnnotations ?? []).some((annotation) => annotation.id === pendingArrowId)) {
      if (arrowGraceRef.current) {
        clearTimeout(arrowGraceRef.current);
        arrowGraceRef.current = null;
      }
      setArrowDraft(null);
      setPendingArrowId(null);
    }
  }, [pendingArrowId, sceneAnnotations]);

  // Tools available to this client (players lose Draw unless the DM enabled it).
  const availableTools = useMemo(
    () => toolsForRole(isDm).filter((tool) => tool.id !== "draw" || isDm || playersCanDraw),
    [isDm, playersCanDraw],
  );

  // If the active tool becomes unavailable (DM revoked drawing), fall back to select.
  useEffect(() => {
    if (!availableTools.some((tool) => tool.id === activeToolId)) {
      setActiveToolId("select");
      setDraft(null);
    }
  }, [availableTools, activeToolId]);

  // Tool hotkeys (V/M/D/G/F/W/L, Esc = back to select) — ignored while typing, and
  // gated off entirely when this canvas isn't the visible one (board under a page).
  useEffect(() => {
    if (!hotkeysEnabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      // Ctrl/Cmd+D clones the selected walls.
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "d" &&
        activeToolId === "walls" &&
        selectedWallIds.length > 0
      ) {
        event.preventDefault();
        onCloneWalls();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key === "Escape") {
        setActiveToolId("select");
        setDraft(null);
        return;
      }
      // X / Delete removes the selected wall(s) (walls tool).
      if (
        activeToolId === "walls" &&
        selectedWallIds.length > 0 &&
        (event.key === "x" || event.key === "X" || event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        deleteSelectedWalls();
        return;
      }
      // Rotate the selected token's facing: [ / ] nudge 15°, { / } (shift) 45°.
      if (
        selectedTokenId &&
        (event.key === "[" || event.key === "]" || event.key === "{" || event.key === "}")
      ) {
        const tok = state.tokens.find((item) => item.id === selectedTokenId);
        if (tok && (isDm || tok.ownerPlayerId === yourPlayerId)) {
          const step = event.key === "{" || event.key === "}" ? 45 : 15;
          const dir = event.key === "[" || event.key === "{" ? -1 : 1;
          const next = (((tok.facing ?? 0) + dir * step) % 360 + 360) % 360;
          onMoveToken(tok.id, tok.x, tok.y, next);
          event.preventDefault();
        }
        return;
      }
      const tool = availableTools.find((item) => item.hotkey === event.key.toLowerCase());
      if (tool) {
        setActiveToolId(tool.id);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    availableTools,
    hotkeysEnabled,
    selectedTokenId,
    state.tokens,
    isDm,
    yourPlayerId,
    onMoveToken,
    activeToolId,
    selectedWallIds,
    onCloneWalls,
    deleteSelectedWalls,
  ]);

  const gridLines = useMemo(() => {
    const lines: number[][] = [];
    if (!scene || !scene.showGrid || scene.gridSize <= 0) {
      return lines;
    }
    const { width, height, gridSize, gridOffsetX, gridOffsetY } = scene;
    if (width / gridSize + height / gridSize > 600) {
      return lines; // guard against pathological grid counts
    }
    const startX = ((gridOffsetX % gridSize) + gridSize) % gridSize;
    const startY = ((gridOffsetY % gridSize) + gridSize) % gridSize;
    for (let x = startX; x <= width; x += gridSize) {
      lines.push([x, 0, x, height]);
    }
    for (let y = startY; y <= height; y += gridSize) {
      lines.push([0, y, width, y]);
    }
    return lines;
  }, [scene]);

  if (!scene) {
    return <div className={`map-root${embedded ? " map-root--embedded" : ""}`} ref={rootRef} />;
  }

  const activeTool =
    availableTools.find((tool) => tool.id === activeToolId) ?? selectTool;
  const toolActive = activeTool.id !== "select";

  const fogBrushR = scene.gridSize * fogBrushScale;

  const runtime: ToolRuntime = {
    scene,
    isDm,
    yourPlayerId,
    send,
    draft,
    setDraft,
    drawColor,
    drawWidth,
    snap,
    fogMode,
    fogBrushR,
    wallBrush,
    snapWallPoint,
    lightRadii: LIGHT_PRESETS[lightPreset],
    templateKind,
    templatePin,
  };

  // A wall chain is being drawn (walls tool + a placed first vertex) — walls go inert so the next
  // click lands as a chain vertex instead of grabbing an existing wall.
  const chainActive = activeTool.id === "walls" && Boolean((draft as { last?: unknown } | null)?.last);

  /** Snaps a world point to the nearest grid cell center when snap is on. */
  const snapPoint = (x: number, y: number): { x: number; y: number } => {
    if (!snap || scene.gridSize <= 0) {
      return { x, y };
    }
    const g = scene.gridSize;
    return {
      x: Math.floor((x - scene.gridOffsetX) / g) * g + scene.gridOffsetX + g / 2,
      y: Math.floor((y - scene.gridOffsetY) / g) * g + scene.gridOffsetY + g / 2,
    };
  };

  /** Routes a stage pointer event to the active tool in world coordinates. */
  const toolPointer =
    (handler?: (event: ToolPointerEvent, rt: ToolRuntime) => void) =>
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      if (!handler) {
        return;
      }
      const pos = stageRef.current?.getRelativePointerPosition();
      if (!pos) {
        return;
      }
      handler({ world: pos, shiftKey: Boolean(e.evt.shiftKey) }, runtime);
    };

  const eraseAnnotation = (annotation: Annotation) => {
    if (!isDm && annotation.authorId !== yourPlayerId) {
      return;
    }
    send({ type: "REMOVE_ANNOTATION", sceneId: scene.id, annotationId: annotation.id });
  };

  /**
   * Middle-mouse pan: independent of Konva's draggable (left button only), so it works
   * for everyone and even while a tool is active. Rides window listeners.
   */
  const startMiddlePan = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!onViewportChange) {
      return;
    }
    e.evt.preventDefault(); // suppress browser middle-click autoscroll
    panRef.current = { x: e.evt.clientX, y: e.evt.clientY, vp: viewport };
    const onMove = (ev: PointerEvent) => {
      const start = panRef.current;
      if (!start) {
        return;
      }
      onViewportChange({
        x: start.vp.x + (ev.clientX - start.x),
        y: start.vp.y + (ev.clientY - start.y),
        scale: start.vp.scale,
      });
    };
    const onUp = () => {
      panRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---- Shift-drag pointer arrow: begin / extend / commit ----
  const arrowWorld = () => stageRef.current?.getRelativePointerPosition() ?? null;

  const startArrow = () => {
    const p = arrowWorld();
    if (!p) {
      return;
    }
    if (arrowGraceRef.current) {
      clearTimeout(arrowGraceRef.current);
      arrowGraceRef.current = null;
    }
    setPendingArrowId(null); // reveal any previous arrow still mid-handoff
    drawingArrow.current = true;
    arrowSparse.current = [p.x, p.y];
    arrowDense.current = [p.x, p.y];
    setArrowDraft([p.x, p.y]);
  };

  const extendArrow = () => {
    const p = arrowWorld();
    if (!p) {
      return;
    }
    const atMax = isAnnotationAtMaxPoints(arrowSparse.current);
    if (!atMax) {
      const next = appendAnnotationSample(arrowSparse.current, p.x, p.y);
      if (next.length !== arrowSparse.current.length) {
        arrowSparse.current = trimAnnotationPoints(next);
      }
      arrowDense.current = appendDraftAnnotationSample(arrowDense.current, p.x, p.y);
    }
    setArrowDraft(
      buildAnnotationDraftPreview(arrowSparse.current, arrowDense.current, p.x, p.y, atMax),
    );
  };

  const commitArrow = () => {
    if (!drawingArrow.current) {
      return;
    }
    drawingArrow.current = false;
    const p = arrowWorld();
    // Always include the exact release point (minDistance 1) so the committed arrow is
    // the same length as the preview — sparse sampling alone could stop up to 48px short.
    const points = p
      ? trimAnnotationPoints(appendAnnotationSample(arrowSparse.current, p.x, p.y, 1))
      : arrowSparse.current;
    arrowSparse.current = [];
    arrowDense.current = [];
    if (annotationPathLength(points) < ANNOTATION_MIN_LENGTH) {
      setArrowDraft(null);
      return;
    }
    const id = `arw-${crypto.randomUUID().slice(0, 8)}`;
    send({
      type: "ADD_ANNOTATION",
      sceneId: scene.id,
      annotation: {
        id,
        authorId: yourPlayerId ?? "dm",
        kind: "arrow",
        points,
        color: ARROW_COLOR,
        width: 3,
        createdAt: Date.now(),
        ephemeral: true,
      },
    });
    // Keep showing the preview and hide the incoming server echo until they can swap in
    // one paint (the effect above), so a shorter duplicate never overlaps the original.
    setArrowDraft(points);
    setPendingArrowId(id);
    if (arrowGraceRef.current) {
      clearTimeout(arrowGraceRef.current);
    }
    arrowGraceRef.current = setTimeout(() => {
      setArrowDraft(null);
      setPendingArrowId(null);
      arrowGraceRef.current = null;
    }, 1500);
  };

  /** True when a shift-drag pointer arrow should start (select mode, left button). */
  // The shift-drag pointer arrow: DM always; players only when the DM allows it.
  const canPoint = isDm || state.playersCanPoint !== false;
  const arrowGestureArmed = (e: Konva.KonvaEventObject<PointerEvent>) =>
    canPoint && !toolActive && !placing && e.evt.button === 0 && e.evt.shiftKey;

  const sceneTokens = state.tokens.filter((token) => token.sceneId === scene.id);
  const currentTurnTokenId =
    state.combat?.entries[state.combat.turnIndex]?.tokenId ?? null;

  // ---- Dynamic vision (Phase 6) ----
  const ftToPx = scene.gridSize / Math.max(scene.feetPerSquare, 1);
  const wallsActive = activeTool.id === "walls";
  const lightsActive = activeTool.id === "lights";
  // The viewer's vision-enabled tokens on this scene reveal the dark. Players use their
  // own tokens; the DM sees everything unless previewing (then all vision tokens reveal).
  const viewerVisionTokens = sceneTokens.filter(
    (token) =>
      token.vision?.enabled &&
      (isDm ? visionPreview : token.ownerPlayerId === yourPlayerId),
  );
  // Dynamic lighting off = the scene is dark. Players (and the DM's 👁 preview) get the
  // strict LOS-gated mask; the DM's own view instead gets a dimmed "here's my lighting"
  // overlay so lights are visibly working during setup without needing a token.
  const dark = !scene.globalIllumination;
  const maskActive = dark && (!isDm || visionPreview);
  const dmLightingActive = dark && isDm && !visionPreview;
  const sceneVisionTokens = sceneTokens.filter((token) => token.vision?.enabled);
  const hasVisionTokens = sceneVisionTokens.length > 0;
  const editingLight = editingLightId
    ? scene.lights.find((l) => l.id === editingLightId) ?? null
    : null;
  const editingWall = editingWallId ? scene.walls.find((w) => w.id === editingWallId) ?? null : null;
  // The config-panel edit applies to the whole selection when the edited wall is part of it.
  const wallConfigCount =
    editingWall && selectedWallIds.length > 1 && selectedWallIds.includes(editingWall.id)
      ? selectedWallIds.length
      : 1;

  const emitViewportFromStage = () => {
    const stage = stageRef.current;
    if (!stage || !onViewportChange) return;
    onViewportChange({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!canControlView || !onViewportChange) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const oldScale = viewport.scale;
    const worldX = (pointer.x - viewport.x) / oldScale;
    const worldY = (pointer.y - viewport.y) / oldScale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = clampViewportScale(oldScale * (direction > 0 ? 1.1 : 1 / 1.1));
    onViewportChange({
      scale: newScale,
      x: pointer.x - worldX * newScale,
      y: pointer.y - worldY * newScale,
    });
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (toolActive || drawingArrow.current || arrowDraft) {
      return; // tools/arrow own the pointer; don't deselect/place underneath them
    }
    if (placing) {
      const point = stageRef.current?.getRelativePointerPosition();
      if (point && onPlaceToken) {
        const snapped = snapPoint(point.x, point.y);
        onPlaceToken(snapped.x, snapped.y);
      }
      return;
    }
    if (e.target === e.target.getStage()) {
      onSelectToken?.(null);
    }
  };

  // Shift disables the pan-drag so a shift-drag draws an arrow instead of panning.
  const stageDraggable = canControlView && !placing && !toolActive && !shiftHeld;
  const sceneRulers = Object.entries(rulers).filter(
    ([, ruler]) => ruler.sceneId === scene.id,
  );
  const sceneTemplates = Object.entries(templates).filter(
    ([, tpl]) => tpl.sceneId === scene.id,
  );

  return (
    <div
      className={`map-root${embedded ? " map-root--embedded" : ""}`}
      ref={rootRef}
      style={toolActive ? { cursor: activeTool.cursor } : undefined}
      // Right-click is a game gesture here (delete wall/light, etc.) — never the browser's
      // save/copy/inspect menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={stageW}
        height={stageH}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={stageDraggable}
        onDragMove={emitViewportFromStage}
        onDragEnd={emitViewportFromStage}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onContextMenu={(e) => {
          // Right-click while drawing a wall chain ends the chain (like Esc) WITHOUT deleting the
          // wall just placed. Handled on contextmenu (not pointerdown) so the chain is still active
          // here — walls stay non-interactive, so this right-click can't also trigger a wall delete.
          if (chainActive) {
            e.evt.preventDefault();
            setDraft(null);
          }
        }}
        onPointerDown={(e) => {
          if (e.evt.button === 1) {
            startMiddlePan(e);
            return;
          }
          if (arrowGestureArmed(e)) {
            e.evt.preventDefault();
            startArrow();
            return;
          }
          // Clicking an existing wall/light marker interacts with it (drag/toggle/delete)
          // rather than placing a new one underneath.
          if (typeof e.target?.hasName === "function" && e.target.hasName("map-handle")) {
            return;
          }
          if (toolActive && e.evt.button === 0) {
            toolPointer(activeTool.onDown)(e);
          }
        }}
        onPointerMove={(e) => {
          if (drawingArrow.current) {
            extendArrow();
            return;
          }
          if (toolActive) {
            toolPointer(activeTool.onMove)(e);
          }
        }}
        onPointerUp={(e) => {
          if (drawingArrow.current) {
            commitArrow();
            return;
          }
          // Only the LEFT button commits a tool gesture — a right-click's pointerup must not
          // finish a wall segment (it should only end the chain via onContextMenu). onDown is
          // already left-only, so gate onUp to match.
          if (toolActive && e.evt.button === 0) {
            toolPointer(activeTool.onUp)(e);
          }
        }}
        onPointerLeave={() => {
          if (drawingArrow.current) {
            commitArrow();
            return;
          }
          if (toolActive) {
            activeTool.onLeave?.(runtime);
          }
        }}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.backgroundColor} />
          {mapImg ? (
            <KonvaImage image={mapImg} x={0} y={0} width={scene.width} height={scene.height} />
          ) : null}
        </Layer>

        {/* Colored-light tint (coloration pass): its canvas is CSS-blended (default screen)
            directly over the MAP ART ONLY — below the grid, annotations, token art, and
            name labels, so UI elements stay crisp and untinted. Below fog + the darkness
            mask, so hidden areas still cover it. Blend "none" = fog-of-war only (no tint). */}
        {(maskActive || dmLightingActive) && scene.lightBlendMode !== "none" ? (
          <LightTintLayer scene={scene} ftToPx={ftToPx} animationsEnabled={lightAnimations} />
        ) : null}

        {/* Grid + annotations: above the light tint, under tokens; annotations erasable
            (right-click) while the draw tool is active. */}
        <Layer listening={activeTool.id === "draw"}>
          {gridLines.map((points, index) => (
            <Line
              key={index}
              points={points}
              stroke={scene.gridColor}
              opacity={scene.gridOpacity}
              strokeWidth={1}
              listening={false}
            />
          ))}
          {scene.annotations.map((annotation) =>
            // Our own just-committed arrow is hidden until the preview hands off to it.
            annotation.id === pendingArrowId ? null : annotation.kind === "arrow" ? (
              // Solid while it exists; a client-local ghost fades it out on removal.
              <MapAnnotationArrow key={annotation.id} points={annotation.points ?? []} opacity={1} />
            ) : (
              <AnnotationNode
                key={annotation.id}
                annotation={annotation}
                now={fadeClock}
                onErase={() => eraseAnnotation(annotation)}
              />
            ),
          )}
        </Layer>

        <Layer listening={activeTool.id === "select"}>
          {sceneTokens.map((token) => {
            const draggable =
              isDm || (token.ownerPlayerId === yourPlayerId && state.playersCanMove !== false);
            // Prefer the linked sheet's portrait so uploads/changes reflect live;
            // fall back to the token's own snapshot, then its color.
            const linkedSheetId = token.sheetId ?? token.ownerPlayerId;
            const sheet = linkedSheetId ? state.sheets[linkedSheetId] : undefined;
            const linkedItem = token.itemId ? state.items[token.itemId] : undefined;
            // The crop belongs to whichever source supplies the image: the sheet portrait, else
            // the item icon it mirrors. A standalone token image has no crop → centered.
            const imageCrop = sheet?.data.iconUrl
              ? sheet.data.iconCrop
              : linkedItem?.iconUrl && linkedItem.iconUrl === token.imageUrl
                ? linkedItem.iconCrop
                : DEFAULT_ICON_CROP;
            const sheetHp = sheet?.data.hp;
            // DM always sees bars; players only when the DM turned the display on.
            // (Redaction keeps hp available for showHp tokens even on hidden sheets.)
            const hp = sheetHp && (isDm || token.showHp !== "none") ? sheetHp : null;
            const radius = tokenRadius(scene.gridSize, token.size ?? state.defaultTokenSize ?? 1);
            // A player controlling an NPC/enemy (not their own PC) → show their colour as a
            // ring so the "mind control" is visible; a real PC already uses the player's colour.
            const controllerColor =
              token.kind !== "player" && token.ownerPlayerId
                ? playerTokenColorForSlot(token.ownerPlayerId, state.playerSlots)
                : null;
            return (
              <TokenNode
                key={token.id}
                token={token}
                imageUrl={sheet?.data.iconUrl ?? token.imageUrl ?? null}
                imageCrop={imageCrop}
                controllerColor={controllerColor}
                shapeDefaults={state.tokenShapeDefaults}
                radius={radius}
                draggable={draggable}
                selected={selectedTokenId === token.id}
                isCurrentTurn={currentTurnTokenId === token.id}
                hp={hp}
                showHpValues={token.showHp === "values"}
                onSelect={() => onSelectToken?.(token.id)}
                onOpenSheet={() => onOpenTokenSheet?.(token)}
                onMove={(x, y) => {
                  const snapped = snapPoint(x, y);
                  // Players can't drag a token through a movement-blocking wall; the DM bypasses.
                  // A rejected move sends the OLD position so the server echo snaps the node back.
                  const target =
                    !isDm && scene.wallsBlockMovement !== false
                      ? clampMove({ x: token.x, y: token.y }, snapped, movementSegs)
                      : snapped;
                  onMoveToken(token.id, target.x, target.y);
                }}
                onRotate={draggable ? (facing) => onMoveToken(token.id, token.x, token.y, facing) : undefined}
              />
            );
          })}
        </Layer>

        {/* Manual fog of war (memoized so brush strokes don't re-diff committed shapes). */}
        <FogLayer scene={scene} isDm={isDm} />

        {/* Dynamic vision: a darkness sheet above tokens (also hides tokens in the dark),
            erased inside each viewer token's line of sight where light/darkvision reach. */}
        {maskActive ? (
          <VisionMaskLayer
            scene={scene}
            tokens={viewerVisionTokens}
            ftToPx={ftToPx}
            darkness={displayDarkness}
            animationsEnabled={lightAnimations}
          />
        ) : null}

        {/* DM dynamic-lighting overview: dimmed map with lit pools cut bright. */}
        {dmLightingActive ? (
          <DmLightingOverlay
            scene={scene}
            tokens={sceneVisionTokens}
            ftToPx={ftToPx}
            darkness={displayDarkness}
            animationsEnabled={lightAnimations}
          />
        ) : null}

        {/* DM wall/door lines + light markers; interactive only with the matching tool. */}
        {isDm && (scene.walls.length > 0 || scene.lights.length > 0 || wallsActive || lightsActive) ? (
          <WallsLightsEditor
            scene={scene}
            ftToPx={ftToPx}
            wallsActive={wallsActive}
            chainActive={chainActive}
            showWalls={showWalls}
            lightsActive={lightsActive}
            selectedWallIds={selectedWallIds}
            onSelectWall={onSelectWall}
            onDeleteWall={onDeleteWall}
            onUpdateWall={onUpdateWall}
            onUpdateWalls={onUpdateWalls}
            onConfigureWall={onConfigureWall}
            snapWallPoint={snapWallPoint}
            onMoveLight={onMoveLight}
            onDeleteLight={onDeleteLight}
            onConfigureLight={onConfigureLight}
          />
        ) : null}

        {/* Door controls (all clients — players open unlocked doors; secret doors DM-only). */}
        {scene.walls.some((w) => w.door && w.door !== "none") ? (
          <DoorLayer scene={scene} isDm={isDm} onToggleDoor={onToggleDoor} onSetDoorState={onSetDoorState} />
        ) : null}

        {/* Topmost overlay: everyone's live rulers + templates + the active tool's draft. */}
        <Layer listening={false}>
          {sceneRulers.map(([clientId, ruler]) => (
            <RulerShape
              key={clientId}
              scene={scene}
              points={ruler.points}
              color={ruler.color}
              name={ruler.name}
            />
          ))}
          {sceneTemplates.map(([clientId, tpl]) => (
            <TemplateShapeView key={clientId} scene={scene} shape={tpl.shape} color={tpl.color} name={tpl.name} />
          ))}
          {ghosts.map((g) => (
            <MapAnnotationArrow
              key={`ghost-${g.id}`}
              points={g.points}
              opacity={Math.max(0, Math.min(1, 1 - (fadeClock - g.removedAt) / ANNOTATION_FADE_MS))}
            />
          ))}
          {arrowDraft && arrowDraft.length >= 4 ? (
            <MapAnnotationArrow points={arrowDraft} opacity={1} />
          ) : null}
          {activeTool.renderDraft?.(draft, runtime)}
        </Layer>
      </Stage>

      <MapToolbar
        isDm={isDm}
        tools={availableTools}
        activeToolId={activeTool.id}
        onSelectTool={(id) => {
          setActiveToolId(id);
          setDraft(null);
        }}
        snap={snap}
        onToggleSnap={onToggleSnap}
        drawColor={drawColor}
        onDrawColor={setDrawColor}
        drawWidth={drawWidth}
        onDrawWidth={setDrawWidth}
        templateKind={templateKind}
        onTemplateKind={setTemplateKind}
        templatePin={templatePin}
        onToggleTemplatePin={() => setTemplatePin((v) => !v)}
        fogEnabled={scene.fog.enabled}
        onToggleFog={() => send({ type: "FOG_SET", sceneId: scene.id, enabled: !scene.fog.enabled })}
        onResetFog={() => send({ type: "FOG_RESET", sceneId: scene.id })}
        fogMode={fogMode}
        onFogMode={setFogMode}
        fogBrushScale={fogBrushScale}
        onFogBrushScale={setFogBrushScale}
        fogInverted={scene.fog.inverted}
        onToggleFogInverted={() =>
          send({
            type: "FOG_SET",
            sceneId: scene.id,
            enabled: scene.fog.enabled,
            inverted: !scene.fog.inverted,
          })
        }
        onClearAnnotations={() => send({ type: "CLEAR_ANNOTATIONS", sceneId: scene.id })}
        playersCanDraw={playersCanDraw}
        onTogglePlayersCanDraw={() =>
          send({ type: "SET_PLAYERS_CAN_DRAW", enabled: !playersCanDraw })
        }
        globalIllumination={scene.globalIllumination}
        onToggleGlobalIllumination={() => {
          const next = !scene.globalIllumination;
          // Toggling the master switch snaps darkness to the matching extreme (🌙 Dynamic =
          // fully dark, ☀ Fully lit = day); the slider then fine-tunes within dynamic mode.
          send({
            type: "UPDATE_SCENE",
            scene: { ...scene, globalIllumination: next, darkness: next ? 0 : 1 },
          });
        }}
        darkness={sliderDarkness}
        onDarknessInput={setDarknessDraft}
        onDarknessCommit={commitDarkness}
        lightAnimations={lightAnimations}
        onToggleLightAnimations={toggleLightAnimations}
        lightBlendMode={scene.lightBlendMode ?? "screen"}
        onLightBlendMode={(mode) =>
          send({ type: "UPDATE_SCENE", scene: { ...scene, lightBlendMode: mode } })
        }
        visionPreview={visionPreview}
        onToggleVisionPreview={() => setVisionPreview((v) => !v)}
        wallBrush={wallBrush}
        onWallBrush={setWallBrush}
        showWalls={showWalls}
        onToggleShowWalls={toggleShowWalls}
        wallCount={scene.walls.length}
        wallSelectionCount={selectedWallIds.length}
        onCloneWalls={onCloneWalls}
        onClearWalls={() => send({ type: "SET_WALLS", sceneId: scene.id, walls: [] })}
        wallsBlockMovement={scene.wallsBlockMovement !== false}
        onToggleWallsBlockMovement={() =>
          send({
            type: "UPDATE_SCENE",
            scene: { ...scene, wallsBlockMovement: scene.wallsBlockMovement === false },
          })
        }
        lightPreset={lightPreset}
        onLightPreset={setLightPreset}
        lightCount={scene.lights.length}
        onClearLights={() => send({ type: "UPDATE_SCENE", scene: { ...scene, lights: [] } })}
        hasVisionTokens={hasVisionTokens}
        history={history}
      />

      {isDm && editingLight ? (
        <div className="map-light-config">
          <LightConfigPanel
            light={editingLight}
            onChange={onMoveLight}
            onDelete={() => onDeleteLight(editingLight.id)}
            onClose={() => setEditingLightId(null)}
          />
        </div>
      ) : null}

      {isDm && editingWall ? (
        <div className="map-light-config">
          <WallConfigPanel
            wall={editingWall}
            selectionCount={wallConfigCount}
            onChange={applyWallPatch}
            onDelete={deleteEditingWalls}
            onClose={() => setEditingWallId(null)}
          />
        </div>
      ) : null}

      {!scene.mapUrl ? <div className="map-empty">No map image for “{scene.name}”</div> : null}
    </div>
  );
}

/// <summary>
/// The dotted pointer arrow (recovered from v1): a dark dashed outline under a cream
/// dashed arrow with a smooth (tension) curve. Non-interactive — it just points and fades.
/// </summary>
function MapAnnotationArrow({ points, opacity }: { points: number[]; opacity: number }) {
  if (opacity <= 0 || points.length < 4) {
    return null;
  }
  return (
    <>
      <Arrow
        points={points}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        stroke="rgba(8, 6, 5, 0.95)"
        fill="rgba(8, 6, 5, 0.95)"
        strokeWidth={6}
        pointerLength={14}
        pointerWidth={12}
        opacity={opacity}
        dash={[10, 6]}
        listening={false}
      />
      <Arrow
        points={points}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        stroke={ARROW_COLOR}
        fill={ARROW_COLOR}
        strokeWidth={3}
        pointerLength={12}
        pointerWidth={10}
        opacity={opacity}
        dash={[10, 6]}
        listening={false}
      />
    </>
  );
}

/// <summary>
/// Renders one committed annotation. Strokes get a wide hit area so right-click
/// erasing works while the draw tool is active (authorization enforced server-side;
/// the client also checks in `eraseAnnotation`). Ephemeral strokes fade with age.
/// </summary>
function AnnotationNode({
  annotation,
  now,
  onErase,
}: {
  annotation: Annotation;
  now: number;
  onErase: () => void;
}) {
  const opacity = annotation.ephemeral ? annotationOpacity(annotation.createdAt, now) : 1;
  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    onErase();
  };
  switch (annotation.kind) {
    case "stroke":
      return (
        <Line
          points={annotation.points ?? []}
          stroke={annotation.color}
          strokeWidth={annotation.width}
          lineCap="round"
          lineJoin="round"
          opacity={opacity}
          hitStrokeWidth={14}
          onContextMenu={onContextMenu}
        />
      );
    case "rect":
      return (
        <Rect
          x={annotation.x ?? 0}
          y={annotation.y ?? 0}
          width={annotation.w ?? 0}
          height={annotation.h ?? 0}
          stroke={annotation.color}
          strokeWidth={annotation.width}
          opacity={opacity}
          onContextMenu={onContextMenu}
        />
      );
    case "circle":
      return (
        <Circle
          x={annotation.x ?? 0}
          y={annotation.y ?? 0}
          radius={Math.max(annotation.w ?? 0, 1)}
          stroke={annotation.color}
          strokeWidth={annotation.width}
          opacity={opacity}
          onContextMenu={onContextMenu}
        />
      );
    case "text":
      return (
        <Text
          x={annotation.x ?? 0}
          y={annotation.y ?? 0}
          text={annotation.text ?? ""}
          fontSize={Math.max(annotation.width * 5, 14)}
          fill={annotation.color}
          opacity={opacity}
          onContextMenu={onContextMenu}
        />
      );
    case "pin":
      return (
        <Group x={annotation.x ?? 0} y={annotation.y ?? 0} onContextMenu={onContextMenu}>
          <Text text="📍" fontSize={24} offsetX={12} offsetY={24} />
          {annotation.text ? (
            <>
              <Rect x={12} y={-10} width={annotation.text.length * 7 + 12} height={20} cornerRadius={4} fill="rgba(10,12,16,0.85)" stroke={annotation.color} strokeWidth={1} />
              <Text x={17} y={-6} text={annotation.text} fontSize={12} fill="#e6e6e8" />
            </>
          ) : null}
        </Group>
      );
  }
}
