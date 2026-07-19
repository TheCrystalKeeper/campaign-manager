import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Path,
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
  type FogShape,
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
  downscaleImageCached,
  imageScaleBucket,
  loadImageForCanvas,
  snapFontSize,
  tokenRadius,
} from "../lib/sceneUtils";
import {
  bumpStageSmoothing,
  getRenderPixelRatio,
  subscribeRenderPixelRatio,
} from "../lib/renderQuality";
import type { MeasureEvent, TemplateEvent, TokenDragEvent } from "../hooks/useGameRoom";
import type { History } from "../lib/history";
import { deriveBoardColor, DEFAULT_BOARD_BG } from "../lib/boardBackdrop";
import { clampMove, movementSegments } from "../lib/visibility";
import { toolsForRole } from "../map/tools/registry";
import { useKeybinds } from "../lib/useKeybinds";
import { matchesBinding, physicalKey, type KeybindId } from "../lib/keybinds";
import { selectTool } from "../map/tools/select";
import { LIGHT_PRESETS, type LightPreset } from "../map/tools/lights";
import { RulerShape } from "../map/tools/measure";
import { TEMPLATE_COLOR, TemplateShapeView } from "../map/tools/template";
import {
  applyLift,
  applyStaticLift,
  beginLift,
  createLiftState,
  liftSettled,
  reducedMotionNow,
  resetLift,
  stepLift,
  type TokenLiftState,
} from "../map/tokenLift";
import { commitPin, updatePin, movePin, PinMarker, PinNoteEditor, type PinDraft } from "../map/tools/pin";
import type { CalibrateMode, ToolPointerEvent, ToolRuntime } from "../map/tools/types";
import { MapToolbar } from "./MapToolbar";
import { FogLayer } from "./MapFog";
import { computeVisiblePointIds, computeVisibleTokenIds, DmLightingOverlay, DoorLayer, LightTintLayer, VisionMaskLayer, WallsLightsEditor } from "./MapVision";
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

/** Live token-drag relay: sender throttle (~25Hz, matches the ruler relay). */
const TOKEN_DRAG_RELAY_MS = 40;
/** Receiver position-lerp rate (s^-1): ~95% caught up to the streamed position in ~165ms. */
const REMOTE_SMOOTH = 18;
/** Drop a remote-drag session whose frames stopped arriving (disconnect / dropped clear frame). */
const REMOTE_STALE_MS = 2500;
/** Reconcile fallback when the drag-end echo doesn't move the token (wall-rejected / same cell). */
const REMOTE_SETTLE_FALLBACK_MS = 600;
/** Stable empty set for the "no remote drags in flight" state (avoids needless re-renders). */
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

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

/** Tracks the OS `prefers-reduced-motion` setting (live), for surfacing the animation-override hint. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
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

/** Token HP-bar thickness (px, unscaled). The gap below the token stays fixed; the values
 *  text and name label sit below the bar, so both offsets are derived from this. */
const HP_BAR_HEIGHT = 8;
/** Gap between the token edge and the top of the HP bar. */
const HP_BAR_TOP_GAP = 3;
/** HP-bar width as a fraction of the token diameter — kept narrower than the token so it reads
 *  as a floating gauge rather than underlining the whole footprint. Bar stays centered. */
const HP_BAR_WIDTH_FRAC = 0.72;

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
  /** Live token-drag relay subscription (transient TOKEN_DRAG messages). */
  subscribeTokenDrag: (listener: (event: TokenDragEvent) => void) => () => void;
  /** Per-client: show other players' tokens sliding live while they drag (default on). */
  showLiveDrags: boolean;
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
  /** Whether the right dock panel is expanded — offsets the floating light/wall config panel. */
  dockOpen?: boolean;
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
/// Live render metrics for nodes inside the Stage: the viewport scale and the canvas pixel
/// ratio. Provided INSIDE the Stage (react-konva does not bridge outer React context across
/// the Stage boundary) so token/pin/annotation nodes can size their image caches and snap
/// their text to the device pixel grid. Changes on every zoom tick — only non-memoized
/// consumers should subscribe (the memoized vision/wall layers stay off this on purpose).
/// </summary>
const MapRenderCtx = createContext<{ scale: number; pixelRatio: number }>({
  scale: 1,
  pixelRatio: 1,
});

/**
 * A Konva Text whose font size is snapped so glyphs rasterize at a whole number of device
 * pixels at the current zoom (see `snapFontSize`) — canvas text at fractional effective sizes
 * smears its grayscale anti-aliasing and reads as blurry at most zoom levels.
 */
function CrispText({ fontSize = 12, ...rest }: ComponentProps<typeof Text>) {
  const { scale, pixelRatio } = useContext(MapRenderCtx);
  return <Text {...rest} fontSize={snapFontSize(fontSize, scale, pixelRatio)} />;
}

/** Supersample factor for pre-shrunk image caches: a ~1:1 copy drawn with smoothing at a
 *  subpixel position looks soft, so render at 2× and let the final draw downsample cleanly. */
const SUPERSAMPLE = 2;

/// <summary>
/// A token portrait pre-shrunk (high-quality, stepped) to roughly its on-screen size so
/// Konva doesn't downsample a big upload into a tiny token in one soft, low-quality pass.
/// Sized for the CURRENT zoom (quantized to √2 buckets via `imageScaleBucket`), so the final
/// draw's downscale ratio stays within ~2–2.8× at every zoom level — sizing for max zoom
/// instead left a zoom-independent ~(4/scale):1 single-pass minification that blurred every
/// token at normal zoom regardless of token size. Re-shrinks only when the zoom crosses a
/// bucket, and `downscaleImageCached` makes revisited buckets free.
/// Returns the original element when it's already small enough.
/// </summary>
function useCrispImage(
  img: HTMLImageElement | null,
  radius: number,
): HTMLImageElement | HTMLCanvasElement | null {
  const { scale, pixelRatio } = useContext(MapRenderCtx);
  // Target the token's on-screen size at the bucketed zoom × SUPERSAMPLE. Cover-fit crops to
  // the shorter image side, so also scale by the aspect ratio to keep that side well-resolved.
  // Round UP to a 64px step: `ceil` never undershoots (nearest could land below and upscale →
  // blur); the step keeps small radius tweaks from churning the cached copy.
  const bucket = imageScaleBucket(scale);
  const aspect = img ? (img.naturalWidth || img.width) / (img.naturalHeight || img.height) : 1;
  const longSide = Number.isFinite(aspect) && aspect > 0 ? Math.max(aspect, 1 / aspect) : 1;
  const maxSide = Math.min(
    2048,
    Math.max(128, Math.ceil((radius * 2 * bucket * pixelRatio * longSide * SUPERSAMPLE) / 64) * 64),
  );
  return useMemo(() => (img ? downscaleImageCached(img, maxSide) : null), [img, maxSide]);
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

/** Picks readable ink for text drawn over an arbitrary token fill color — colors range from
 *  deep reds to near-white (see TOKEN_COLORS / the free-form color picker) — via the sRGB
 *  relative-luminance threshold used for WCAG contrast. */
function readableTextColor(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "#e6e6e8";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.5 ? "#1c1a18" : "#e6e6e8";
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
  label,
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
  /** Token name; when there's no portrait, its capitalized first letter fills the shape as a
   *  placeholder instead of a bare color swatch. */
  label?: string;
}) {
  if (!img) {
    const initial = label?.trim().charAt(0).toUpperCase();
    return (
      <>
        <TokenShapePrimitive shape={shape} radius={radius} fill={fill} stroke={stroke} strokeWidth={strokeWidth} glow={glow} />
        {initial ? (
          <CrispText
            text={initial}
            fontSize={radius * 1.1}
            fontFamily="Alegreya"
            fontStyle="bold"
            fill={readableTextColor(fill)}
            align="center"
            width={radius * 4}
            offsetX={radius * 2}
            y={-radius * 0.55}
            listening={false}
          />
        ) : null}
      </>
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

/** Live Konva nodes a mounted TokenNode exposes to the board, so a remote drag can move the real
 *  token imperatively (and drive its lift/wobble) without walking the stage. */
type TokenNodeHandle = {
  group: Konva.Group;
  lift: Konva.Group;
  shadow: Konva.Node | null;
  radius: number;
};

/** An in-flight remote drag the receiver is mirroring onto a real token node. */
type RemoteDrag = {
  /** Latest streamed world position we're easing the node toward. */
  targetX: number;
  targetY: number;
  /** Last frame timestamp (for the stale prune). */
  at: number;
  /** Lift/wobble springs, driven by the node's interpolated motion. */
  lift: TokenLiftState;
  /** Reduced-motion receiver: lerp position but skip the springs (still show a static shadow). */
  reduced: boolean;
  /** Clear frame seen — now reconciling with the authoritative STATE echo. */
  ended: boolean;
  endedAt: number;
  /** token.x/y captured when the drag ended, to detect whether the echo actually moved it. */
  baseX: number;
  baseY: number;
};

const TokenNode = memo(function TokenNode({
  token,
  imageUrl,
  imageCrop,
  concealedPortrait,
  concealBadge,
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
  onDragActive,
  onDragFrame,
  onNodeRef,
  onHover,
}: {
  token: GameState["tokens"][number];
  /** Portrait to render on the token (resolved live from the linked sheet). */
  imageUrl: string | null;
  /** Crop of that portrait/item icon, so the token follows the same framing as the sheet. */
  imageCrop?: IconCrop;
  /** Player view of a portrait-concealed token: no art, a "?" glyph over the shape fill. */
  concealedPortrait?: boolean;
  /** DM indicator that this token's name and/or portrait is concealed from players. */
  concealBadge?: boolean;
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
  onSelect?: (token: GameState["tokens"][number]) => void;
  /** Double-click: open the linked sheet (character or item). */
  onOpenSheet?: (token: GameState["tokens"][number]) => void;
  onMove: (token: GameState["tokens"][number], x: number, y: number) => void;
  /** Rotate handle (selected + controllable): commit a new facing on pointer-up. */
  onRotate?: (token: GameState["tokens"][number], facing: number) => void;
  /** Fires true when a real move-drag starts, false when it ends — lets the board hide the
   *  duplicate above-darkness name label for this token while it's being dragged. */
  onDragActive?: (token: GameState["tokens"][number], active: boolean) => void;
  /** Streams the live drag position (world coords) to the board for relaying; null on drag end. */
  onDragFrame?: (token: GameState["tokens"][number], pos: { x: number; y: number } | null) => void;
  /** Registers/unregisters this token's live Konva nodes so remote drags can move it imperatively. */
  onNodeRef?: (tokenId: string, handle: TokenNodeHandle | null) => void;
  /** Mirrors the node's hover state up to the board (powers the X-to-delete hotkey). */
  onHover?: (token: GameState["tokens"][number], hovered: boolean) => void;
}) {
  const img = useImage(imageUrl);
  // Render a crisp, size-appropriate copy so large uploads don't look soft in a small token.
  const crispImg = useCrispImage(img, radius);
  const groupRef = useRef<Konva.Group>(null);
  // Pick-up/wobble/drop animation nodes: `liftRef` is an inner group holding every visual child
  // (so scaling/tilting it never fights Konva's drag-managed x/y on the outer group), `shadowRef`
  // is the ground shadow that separates beneath the token as it rises. Driven imperatively by an
  // rAF loop — never React state — per PERFORMANCE_PLAN.md.
  const liftRef = useRef<Konva.Group>(null);
  const shadowRef = useRef<Konva.Circle>(null);
  const liftStateRef = useRef<TokenLiftState | null>(null);
  if (liftStateRef.current === null) liftStateRef.current = createLiftState();
  const liftRafRef = useRef(0);
  const liftPrevTsRef = useRef(0);
  const rotatingRef = useRef(false);
  const [dragFacing, setDragFacing] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  // True only while THIS client is actively lifting the token (drag). Flipped once at
  // drag start/end (not per frame), it shrinks + fades the resting drop shadow so a lifted
  // mini casts a smaller, fainter shadow than one sitting on the table.
  const [dragging, setDragging] = useState(false);
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
        onRotate(token, final);
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

  // Imperatively drive the pick-up/wobble/drop springs on the inner group. One rAF loop runs from
  // drag-start until the token has fully settled after release; an idle token schedules nothing.
  const runLiftLoop = () => {
    if (liftRafRef.current) return; // already running
    liftPrevTsRef.current = 0;
    const state = liftStateRef.current!;
    const tick = (ts: number) => {
      const group = groupRef.current;
      const lift = liftRef.current;
      if (!group || !lift) {
        liftRafRef.current = 0;
        return;
      }
      const prev = liftPrevTsRef.current || ts;
      liftPrevTsRef.current = ts;
      stepLift(state, (ts - prev) / 1000, group.x(), group.y());
      applyLift(state, lift, shadowRef.current, radius);
      lift.getLayer()?.batchDraw();
      if (state.lifted || !liftSettled(state)) {
        liftRafRef.current = requestAnimationFrame(tick);
      } else {
        resetLift(state, lift, shadowRef.current);
        lift.getLayer()?.batchDraw();
        liftRafRef.current = 0;
      }
    };
    liftRafRef.current = requestAnimationFrame(tick);
  };

  /** Pointer-down on a real move-drag: lift the token off the table. */
  const startLift = () => {
    const group = groupRef.current;
    const lift = liftRef.current;
    if (!group || !lift) return;
    setDragging(true);
    const state = liftStateRef.current!;
    if (reducedMotionNow()) {
      // A still affordance, no motion: pop to a small lifted pose and stop.
      if (liftRafRef.current) {
        cancelAnimationFrame(liftRafRef.current);
        liftRafRef.current = 0;
      }
      state.lifted = true;
      applyStaticLift(lift, shadowRef.current, radius, true);
      lift.getLayer()?.batchDraw();
      return;
    }
    beginLift(state, group.x(), group.y());
    runLiftLoop();
  };

  /** Drag released: drop the token back down (the loop eases it and stops itself once settled). */
  const endLift = () => {
    setDragging(false);
    const state = liftStateRef.current!;
    state.lifted = false;
    const lift = liftRef.current;
    if (reducedMotionNow()) {
      if (liftRafRef.current) {
        cancelAnimationFrame(liftRafRef.current);
        liftRafRef.current = 0;
      }
      if (lift) {
        applyStaticLift(lift, shadowRef.current, radius, false);
        lift.getLayer()?.batchDraw();
      }
      return;
    }
    runLiftLoop(); // resume if the loop stalled; it now eases down and stops once settled
  };

  // Cancel any in-flight animation frame if the token unmounts mid-drag/settle.
  useEffect(
    () => () => {
      if (liftRafRef.current) cancelAnimationFrame(liftRafRef.current);
    },
    [],
  );

  // Publish this token's live Konva nodes so a remote drag can move it imperatively (Feature B).
  useEffect(() => {
    const group = groupRef.current;
    const lift = liftRef.current;
    if (!group || !lift || !onNodeRef) return;
    onNodeRef(token.id, { group, lift, shadow: shadowRef.current, radius });
    return () => onNodeRef(token.id, null);
  }, [token.id, radius, onNodeRef]);

  const dead = hp !== null && hp.max > 0 && hp.current <= 0;
  const showBar = hp !== null && hp.max > 0;
  const ratio = showBar ? Math.min(Math.max(hp.current / hp.max, 0), 1) : 0;
  const hpBarWidth = radius * 2 * HP_BAR_WIDTH_FRAC;
  const hpBarX = -hpBarWidth / 2;
  const badges = token.conditions
    .map((id) => CONDITION_EMOJI.get(id))
    .filter(Boolean) as string[];
  const badgeText =
    badges.length > 4 ? `${badges.slice(0, 4).join("")}+${badges.length - 4}` : badges.join("");

  return (
    <Group
      ref={groupRef}
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={token.hidden ? 0.4 : dead ? 0.55 : 1}
      onClick={() => {
        if (rotatingRef.current) return; // a rotate gesture, not a select
        onSelect?.(token);
      }}
      onTap={() => onSelect?.(token)}
      onMouseEnter={() => {
        setHovered(true);
        onHover?.(token, true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHover?.(token, false);
      }}
      onDblClick={() => onOpenSheet?.(token)}
      onDblTap={() => onOpenSheet?.(token)}
      onDragStart={(e) => {
        // Shift-drag draws a pointer arrow; grabbing the facing arrow rotates instead of moving.
        if (e.evt.shiftKey || rotatingRef.current) {
          e.target.stopDrag();
          return;
        }
        // A real move begins: let the board suppress the duplicate above-darkness name label,
        // which is pinned to the (not-yet-updated) React position and would otherwise trail.
        onDragActive?.(token, true);
        startLift();
      }}
      onDragMove={(e) => {
        // Stream the live position so other clients can mirror the drag (board throttles it).
        onDragFrame?.(token, { x: e.target.x(), y: e.target.y() });
      }}
      onDragEnd={(e) => {
        onDragActive?.(token, false);
        onDragFrame?.(token, null); // clear frame: tells receivers to reconcile with the echo
        onMove(token, e.target.x(), e.target.y());
        endLift();
      }}
    >
      {/* Ground shadow: stays on the table (outside the lift group) and separates down-right from
          the token as it rises. A radial-gradient fill, not Konva shadowBlur (which would re-blur
          the whole token every frame). Hidden until a lift begins. */}
      <Circle
        ref={shadowRef}
        visible={false}
        listening={false}
        radius={radius * 1.05}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndRadius={radius * 1.05}
        fillRadialGradientColorStops={[0, "rgba(0,0,0,1)", 0.6, "rgba(0,0,0,0.55)", 1, "rgba(0,0,0,0)"]}
      />
      {/* Every visual child lives in this inner group so the lift/wobble transform (scale, tilt,
          rise offset) applies to the whole miniature without touching the outer group's
          Konva-drag-managed x/y. */}
      <Group ref={liftRef} name="token-lift">
      {/* Resting drop shadow: a soft, faded halo cast from a stroke-only copy of the token's own
          silhouette — follows the shape (circle/square/diamond/…) and falls off gently. Lives
          INSIDE the lift group as the bottom-most child so it wobbles/rises glued beneath the
          token and never gets uncovered as the mini tilts on drag. Stroke-only (NO fill) on
          purpose: a filled disc would show through transparent cutout art as a hard black shape;
          the thin caster ring hides under the token edge and only its blurred shadow spills out.
          While the mini is lifted (dragging) the wrapper shrinks + fades it, so a placed token
          casts a fuller shadow than one being carried. */}
      <Group
        listening={false}
        opacity={dragging ? 0.5 : 1}
        scaleX={dragging ? 0.7 : 1}
        scaleY={dragging ? 0.7 : 1}
      >
        <TokenShapePrimitive
          shape={shape}
          radius={radius * 0.9}
          stroke="#000000"
          strokeWidth={radius * 0.13}
          glow={{
            shadowColor: "#000000",
            shadowBlur: radius * 0.5,
            shadowOffsetX: radius * 0.06,
            shadowOffsetY: radius * 0.18,
            shadowOpacity: 0.5,
            shadowForStrokeEnabled: true,
          }}
        />
      </Group>
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
          label={concealedPortrait ? undefined : token.label}
        />
      )}
      {concealedPortrait ? (
        // Player view of concealed art: a big "?" over the plain shape fill.
        <CrispText
          text="?"
          fontSize={radius * 1.1}
          fill="#e6e6e8"
          align="center"
          width={radius * 4}
          offsetX={radius * 2}
          y={-radius * 0.55}
          listening={false}
        />
      ) : null}
      {dead ? (
        <CrispText
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
        <CrispText
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
            x={hpBarX}
            y={radius + HP_BAR_TOP_GAP}
            width={hpBarWidth}
            height={HP_BAR_HEIGHT}
            cornerRadius={HP_BAR_HEIGHT / 2}
            fill="rgba(0,0,0,0.6)"
            listening={false}
          />
          <Rect
            x={hpBarX}
            y={radius + HP_BAR_TOP_GAP}
            width={hpBarWidth * ratio}
            height={HP_BAR_HEIGHT}
            cornerRadius={HP_BAR_HEIGHT / 2}
            fill={hpBarColor(ratio)}
            listening={false}
          />
          {showHpValues ? (
            <CrispText
              text={`${hp.current}/${hp.max}`}
              fontSize={Math.max(8, radius * 0.45)}
              fill="#e6e6e8"
              align="center"
              width={radius * 4}
              offsetX={radius * 2}
              y={radius + HP_BAR_TOP_GAP + HP_BAR_HEIGHT + 1}
              listening={false}
            />
          ) : null}
        </>
      ) : null}
      {concealBadge ? (
        // DM indicator: this token's name/portrait shows as "???"/"?" to players.
        <Group x={-radius * 0.72} y={-radius * 0.72} listening={false}>
          <Circle radius={Math.max(7, radius * 0.28)} fill="rgba(8,10,16,0.85)" stroke="#00000088" strokeWidth={1} />
          <CrispText
            text="?"
            fontSize={Math.max(8, radius * 0.32)}
            fill="#e6e6e8"
            align="center"
            width={radius}
            offsetX={radius / 2}
            offsetY={Math.max(8, radius * 0.32) / 2}
            listening={false}
          />
        </Group>
      ) : null}
      {token.hidden ? (
        // Eye-off badge: unambiguous "players can't see this" marker on top of the ghost
        // opacity. Hidden tokens never reach player clients (server-stripped), so this
        // only ever renders for the DM.
        <Group x={radius * 0.72} y={-radius * 0.72} listening={false}>
          <Circle radius={Math.max(7, radius * 0.28)} fill="rgba(8,10,16,0.85)" stroke="#00000088" strokeWidth={1} />
          <Path
            data="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2L22 22"
            stroke="#e6e6e8"
            strokeWidth={2}
            lineCap="round"
            lineJoin="round"
            scaleX={(Math.max(7, radius * 0.28) * 1.4) / 24}
            scaleY={(Math.max(7, radius * 0.28) * 1.4) / 24}
            offsetX={12}
            offsetY={12}
          />
        </Group>
      ) : null}
      <TokenNameLabel token={token} radius={radius} showBar={showBar} showHpValues={showHpValues} />
      </Group>
    </Group>
  );
});

/**
 * A token's name caption, positioned relative to the token's center (0,0). Rendered inside the
 * token itself AND — for tokens revealed by dynamic lighting — again in a top layer above the
 * darkness mask (see `visibleTokenIds`), so a lit token's name is always fully legible instead of
 * being swallowed by the surrounding dark. The two draws sit at identical coords, so the bright
 * copy simply overlays the masked one.
 */
function TokenNameLabel({
  token,
  radius,
  showBar,
  showHpValues,
}: {
  token: GameState["tokens"][number];
  radius: number;
  showBar: boolean;
  showHpValues: boolean;
}) {
  const labelY = radius + (showBar ? HP_BAR_TOP_GAP + HP_BAR_HEIGHT + 2 : 2);
  return (
    <CrispText
      text={token.label}
      // Gentle slope + cap: names stay readable on tiny tokens without ballooning on huge
      // ones (a 4-cell giant's caption shouldn't be 4x a Medium creature's).
      fontSize={Math.min(20, Math.max(11, 10 + radius * 0.18))}
      fill="#e6e6e8"
      // Soft dark halo so light names stay legible over bright map areas.
      shadowColor="#000000"
      shadowBlur={4}
      shadowOpacity={0.8}
      shadowOffsetY={1}
      align="center"
      width={radius * 4}
      offsetX={radius * 2}
      y={labelY + (showHpValues && showBar ? Math.max(8, radius * 0.45) + 1 : 0)}
      listening={false}
    />
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
  subscribeTokenDrag,
  showLiveDrags,
  snap,
  onToggleSnap,
  hotkeysEnabled = true,
  embedded = false,
  history,
  dockOpen = false,
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { width: stageW, height: stageH } = useElementSize(rootRef);
  // Konva canvases default to imageSmoothingQuality "low", which visibly softens downscaled
  // images (token portraits, the map) even at normal zoom. Bump them all to "high". Crucially
  // this must include the STAGE's shared buffer canvas: a token has fill + stroke, so Konva
  // draws it through the buffer (then composites) — that's where its portrait is downsampled.
  // Runs after EVERY render (no dep array): canvas resizes and pixel-ratio changes reset
  // context state, and conditionally-mounted layers (vision mask, light tint, …) arrive with
  // fresh "low"-quality canvases the old resize-only effect never revisited. The bump reads
  // live context state, so a no-op pass costs a few property reads.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage && bumpStageSmoothing(stage)) {
      stage.batchDraw();
    }
  });
  const scene = state.scenes.find((item) => item.id === sceneId) ?? state.scenes[0];
  const mapImg = useImage(scene?.mapUrl ?? null);
  const sceneWalls = scene?.walls;

  // Board backdrop: the DM's explicit color, else a very dark tone derived from
  // the map image's average color (cached per URL — see boardBackdrop.ts).
  const [derivedBoardColor, setDerivedBoardColor] = useState<string>(DEFAULT_BOARD_BG);
  useEffect(() => {
    if (scene?.boardBgColor) {
      return; // explicit color wins — skip the sampling work entirely
    }
    let alive = true;
    void deriveBoardColor(scene?.mapUrl ?? null).then((color) => {
      if (alive) {
        setDerivedBoardColor(color);
      }
    });
    return () => {
      alive = false;
    };
  }, [scene?.mapUrl, scene?.boardBgColor]);
  const boardBgColor = scene?.boardBgColor || derivedBoardColor;

  // Optional backdrop image, rendered at full resolution with a real GPU blur (CSS
  // filter). The backdrop div is screen-fixed and static — it never carries the viewport
  // transform — so the browser rasterizes the blur once and composites it; panning/zooming
  // the map never re-blurs it. The div is scaled up so the blur's transparent edge-fade is
  // pushed off-screen, leaving only fully-covered interior visible.
  const backdropUrl = scene?.boardBgImageUrl ?? null;
  const backdropBlurPx = (scene?.boardBgBlur ?? 12) * 2;
  const backdropScale = 1 + Math.min(0.3, backdropBlurPx / 260);
  // The canvas pixel ratio (devicePixelRatio, or ≥2 with the hi-res setting) — reactive so
  // toggling hi-res re-sizes image caches and re-snaps text without a remount.
  const renderRatio = useSyncExternalStore(subscribeRenderPixelRatio, getRenderPixelRatio);
  /** Zoom quantized to √2 buckets — image caches re-size only when this crosses a step. */
  const zoomBucket = imageScaleBucket(viewport.scale);
  // The map background pre-shrunk for the current zoom bucket, exactly like token portraits
  // (`useCrispImage`): zoomed out, Konva otherwise minifies the full-resolution upload in one
  // soft/aliased pass. Returns the original image while it's already ≤ the target size, so at
  // near/full zoom this costs nothing.
  const crispMapImg = useMemo(() => {
    if (!mapImg || !scene) return null;
    const worldSide = Math.max(scene.width, scene.height);
    const maxSide = Math.ceil((worldSide * zoomBucket * renderRatio * SUPERSAMPLE) / 64) * 64;
    return downscaleImageCached(mapImg, maxSide);
  }, [mapImg, scene, zoomBucket, renderRatio]);
  /** Context payload for in-Stage consumers (text snapping + token image caches). */
  const renderCtx = useMemo(
    () => ({ scale: viewport.scale, pixelRatio: renderRatio }),
    [viewport.scale, renderRatio],
  );

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
  /** Fog tool: freehand brush vs a rectangle / lasso / polygon-lasso area selection. */
  const [fogShape, setFogShape] = useState<FogShape>("brush");
  /** Walls tool: what a fresh segment is drawn as (modeless — no Draw/Select toggle). */
  const [wallBrush, setWallBrush] = useState<WallBrush>("normal");
  /** Selected wall ids + which wall's config panel is open. */
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [editingWallId, setEditingWallId] = useState<string | null>(null);
  /** The wall currently under the cursor — lets X/Delete remove it without selecting first. */
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null);
  /** Token under the cursor (DM only) — powers the X-to-delete-token hotkey. */
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);

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
  /**
   * X / Delete: if hovering a wall that ISN'T part of the current selection, delete just that one
   * (no click-to-select needed first). Otherwise fall back to deleting the whole selection — so
   * hovering a wall that IS selected still removes the entire multi-selection, as expected.
   */
  const deleteHoveredOrSelectedWalls = useCallback(() => {
    if (hoveredWallId && !selectedWallIds.includes(hoveredWallId)) {
      send({ type: "REMOVE_WALL", sceneId, wallId: hoveredWallId });
      setHoveredWallId(null);
      return;
    }
    deleteSelectedWalls();
  }, [hoveredWallId, selectedWallIds, send, sceneId, deleteSelectedWalls]);
  /** DM sets a door's exact state (right-click a door glyph to lock/unlock). */
  const onSetDoorState = useCallback(
    (id: string, state: WallDoorState) => send({ type: "SET_DOOR_STATE", sceneId, wallId: id, state }),
    [send, sceneId],
  );
  // Clear wall selection / config when leaving the walls tool or changing scene.
  useEffect(() => {
    setSelectedWallIds([]);
    setEditingWallId(null);
    setHoveredWallId(null);
  }, [activeToolId, sceneId]);
  // Safety net: if the hovered wall was removed some other way (right-click, config panel), drop
  // the stale hover id rather than letting a later X delete a wall that no longer exists.
  useEffect(() => {
    if (hoveredWallId && !(sceneWalls ?? []).some((w) => w.id === hoveredWallId)) {
      setHoveredWallId(null);
    }
  }, [sceneWalls, hoveredWallId]);
  /** Movement-blocking wall segments for the token-drag collision test. */
  const movementSegs = useMemo(() => movementSegments(sceneWalls ?? []), [sceneWalls]);
  /** Lights tool: which preset a freshly placed light uses. */
  const [lightPreset, setLightPreset] = useState<LightPreset>("torch");
  /** Which light's config panel is open (double-click a light marker). */
  const [editingLightId, setEditingLightId] = useState<string | null>(null);
  // Close the light config panel the moment lighting mode is exited (tool switch, Esc, hotkey
  // toggle, …) — it's only meaningful while placing/editing lights, and left open it just
  // covers the map with a stale panel.
  useEffect(() => {
    if (activeToolId !== "lights") setEditingLightId(null);
  }, [activeToolId]);
  /** DM-local darkness while dragging the slider (before it's committed to the scene). */
  const [darknessDraft, setDarknessDraft] = useState<number | null>(null);
  /** Client toggle: run per-frame light animations (off = low-end escape hatch). */
  const [lightAnimations, setLightAnimations] = useState(() =>
    readCampaignFlag(state.roomId, "light-anim", true, "lightAnimations"),
  );
  /** OS reduce-motion — the ✨ toggle overrides it, so the toolbar shows a hint when both are on. */
  const prefersReducedMotion = usePrefersReducedMotion();
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
  /** Calibrate tool: the direct-manipulation gizmo (move + resize), or the box-a-cell gesture. */
  const [calibrateMode, setCalibrateMode] = useState<CalibrateMode>("adjust");
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

  // Which tokens the current viewer actually SEES — the single source of truth for both the
  // token sprites and the name labels drawn above the darkness mask (so an unseen NPC neither
  // renders nor leaks its name). Computed up here — BEFORE the `!scene` guard below — so the
  // hook count stays stable across renders. `null` unless the board is dark: the player/preview
  // view exposes a strict LOS-lit subset; the DM's own overview is omniscient. Overrides union
  // in on top of the vision test: PC tokens always render (the mask dims them naturally),
  // `dmVisibility: "always"` force-shows to everyone, and `revealTo` force-shows to specific
  // players (ignored in the DM's 👁 preview, which impersonates a generic player). Bucketed on
  // an ambient-lit boolean so a day↔night tween doesn't rerun the LOS sweep every frame;
  // `state.tokens`/`state.scenes` deps keep it off the pan/zoom path.
  const ambientLit = 1 - displayDarkness > 0.12;
  const visibleTokenIds = useMemo<Set<string> | null>(() => {
    const sc = state.scenes.find((item) => item.id === sceneId) ?? state.scenes[0];
    if (!sc || sc.globalIllumination) return null; // lit board: everything shows
    const scTokens = state.tokens.filter((t) => t.sceneId === sc.id);
    if (isDm && !visionPreview) return new Set(scTokens.map((t) => t.id)); // DM overview: all
    const viewers = scTokens.filter(
      (t) => t.vision?.enabled && (isDm ? visionPreview : t.ownerPlayerId === yourPlayerId),
    );
    const ftToPx = sc.gridSize / Math.max(sc.feetPerSquare, 1);
    const ids = computeVisibleTokenIds(sc, viewers, scTokens, ftToPx, ambientLit ? 0 : 1);
    for (const t of scTokens) {
      if (
        t.kind === "player" ||
        t.dmVisibility === "always" ||
        (!isDm && t.revealTo !== undefined && t.revealTo.includes(yourPlayerId ?? ""))
      ) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [state.scenes, state.tokens, sceneId, isDm, yourPlayerId, visionPreview, ambientLit]);

  // The token currently being move-dragged, so the above-darkness label layer can skip its
  // SECOND (bright) copy of that token's name. That copy is positioned from React state, which
  // doesn't update mid-drag (moves are server-authoritative, applied on echo) — so without this
  // it trails behind the live in-token label as a duplicate. Suppression is held past dragEnd
  // (see `settleDrag`) until the committed position lands in state, so the copy never flashes
  // back at the stale spot before the round-trip completes.
  const [draggingLabelId, setDraggingLabelId] = useState<string | null>(null);
  const dragSettleRef = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const setTokenDragActive = useCallback(
    (id: string, active: boolean) => {
      if (active) {
        if (dragSettleRef.current) {
          clearTimeout(dragSettleRef.current.timer);
          dragSettleRef.current = null;
        }
        setDraggingLabelId(id);
        return;
      }
      // Drag ended: keep suppressing until the token's state position changes (the echo arrived)
      // or a short fallback elapses (covers a no-op move that lands exactly where it started).
      const current = state.tokens.find((t) => t.id === id);
      const timer = setTimeout(() => {
        dragSettleRef.current = null;
        setDraggingLabelId((cur) => (cur === id ? null : cur));
      }, 600);
      dragSettleRef.current = { id, x: current?.x ?? 0, y: current?.y ?? 0, timer };
    },
    [state.tokens],
  );
  // Clear the post-drag suppression the moment the dragged token's committed position lands in
  // state (in-token + bright copies now agree), so the bright label returns without a stale flash.
  useEffect(() => {
    const pending = dragSettleRef.current;
    if (!pending) return;
    const token = state.tokens.find((t) => t.id === pending.id);
    if (token && (token.x !== pending.x || token.y !== pending.y)) {
      clearTimeout(pending.timer);
      dragSettleRef.current = null;
      setDraggingLabelId((cur) => (cur === pending.id ? null : cur));
    }
  }, [state.tokens]);
  useEffect(() => () => {
    if (dragSettleRef.current) clearTimeout(dragSettleRef.current.timer);
  }, []);

  // Which door icons are visible to the current viewer: same "at least a little lit" rule as
  // token labels, so a door isn't spottable through fog of war. `null` = show every door (lit
  // board, or the DM's own omniscient overview — not previewing as a player).
  const visibleDoorIds = useMemo<Set<string> | null>(() => {
    const sc = state.scenes.find((item) => item.id === sceneId) ?? state.scenes[0];
    if (!sc || sc.globalIllumination) return null;
    if (isDm && !visionPreview) return null; // DM overview: every door visible
    const doors = sc.walls.filter((w) => w.door && w.door !== "none");
    if (doors.length === 0) return null;
    const scTokens = state.tokens.filter((t) => t.sceneId === sc.id);
    const viewers = scTokens.filter(
      (t) => t.vision?.enabled && (isDm ? visionPreview : t.ownerPlayerId === yourPlayerId),
    );
    const ftToPx = sc.gridSize / Math.max(sc.feetPerSquare, 1);
    // Probe each door's two FACES (midpoint nudged out along the wall normal), never the
    // midpoint itself: a CLOSED door is a blocking segment, so its midpoint lies exactly ON
    // the viewer's LOS-polygon boundary and on the clip edge of any light behind it — the
    // point test fails and the glyph a player just clicked shut would vanish, leaving the
    // door stuck closed. Seeing either face means seeing the door.
    const points: Array<{ id: string; x: number; y: number }> = [];
    for (const d of doors) {
      const mx = (d.x1 + d.x2) / 2;
      const my = (d.y1 + d.y2) / 2;
      const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1;
      const off = Math.min(10, sc.gridSize * 0.2);
      const nx = (-(d.y2 - d.y1) / len) * off;
      const ny = ((d.x2 - d.x1) / len) * off;
      points.push({ id: `${d.id}|a`, x: mx + nx, y: my + ny });
      points.push({ id: `${d.id}|b`, x: mx - nx, y: my - ny });
    }
    const litFaces = computeVisiblePointIds(sc, viewers, points, ftToPx, ambientLit ? 0 : 1);
    return new Set([...litFaces].map((id) => id.slice(0, -2)));
  }, [state.scenes, state.tokens, sceneId, isDm, yourPlayerId, visionPreview, ambientLit]);

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

  // Live keyboard shortcuts (tool letters, rotate/delete/visibility, clone) — the keydown handler
  // below matches against these so the Keybinds settings page can remap them.
  const keybinds = useKeybinds();

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
      // Clone the selected walls (default Ctrl/Cmd+D).
      if (
        matchesBinding(event, keybinds.cloneSelection) &&
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
      // Escape always resets the active tool to Select (kept fixed — it's the universal cancel key).
      if (event.key === "Escape") {
        setActiveToolId("select");
        setDraft(null);
        return;
      }
      const isDelete =
        matchesBinding(event, keybinds.deleteToken) ||
        event.key === "Delete" ||
        event.key === "Backspace";
      // Delete removes the selected wall(s), or — with nothing selected — whichever wall the
      // cursor is hovering (no click-to-select needed first).
      if (activeToolId === "walls" && (selectedWallIds.length > 0 || hoveredWallId) && isDelete) {
        event.preventDefault();
        deleteHoveredOrSelectedWalls();
        return;
      }
      // Delete over a token (DM): remove the TOKEN only — the linked character/item
      // record survives in its directory. Undoable via Ctrl+Z / the toolbar buttons.
      if (isDm && hoveredTokenId && isDelete) {
        event.preventDefault();
        send({ type: "REMOVE_TOKEN", tokenId: hoveredTokenId });
        setHoveredTokenId(null);
        return;
      }
      // Toggle the hovered token's player-visibility (DM, default H). The DM keeps seeing it
      // ghosted with an eye-off badge; players' copies vanish/return. Undoable.
      if (isDm && hoveredTokenId && matchesBinding(event, keybinds.toggleVisibility)) {
        const tok = state.tokens.find((item) => item.id === hoveredTokenId);
        if (tok) {
          event.preventDefault();
          send({ type: "UPDATE_TOKEN", token: { ...tok, hidden: !tok.hidden } });
        }
        return;
      }
      // Rotate the selected token's facing: the bound keys ([ / ]) nudge 15°, Shift makes it 45°.
      // Matched on the physical key (ignoring Shift's printed variant) so Shift+[ still rotates.
      if (selectedTokenId) {
        const pk = physicalKey(event);
        const ccw = pk === keybinds.rotateCcw.key;
        const cw = pk === keybinds.rotateCw.key;
        if (ccw || cw) {
          const tok = state.tokens.find((item) => item.id === selectedTokenId);
          if (tok && (isDm || tok.ownerPlayerId === yourPlayerId)) {
            const step = event.shiftKey ? 45 : 15;
            const dir = ccw ? -1 : 1;
            const next = (((tok.facing ?? 0) + dir * step) % 360 + 360) % 360;
            onMoveToken(tok.id, tok.x, tok.y, next);
            event.preventDefault();
          }
          return;
        }
      }
      const tool = availableTools.find((item) =>
        matchesBinding(event, keybinds[`tool.${item.id}` as KeybindId]),
      );
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
    hoveredWallId,
    hoveredTokenId,
    send,
    onCloneWalls,
    deleteHoveredOrSelectedWalls,
    keybinds,
  ]);

  // A live calibrate drag previews the grid it's about to commit: "move" slides the offset, "resize"
  // changes the cell size (pinned at the grabbed corner). Reduced to effective size/offset scalars so
  // the grid memo below recomputes only when the grid actually changes — not on every frame of some
  // other tool's draft (measure, wall chain, …).
  const calPreview =
    activeToolId === "calibrate"
      ? (draft as { mode?: string; dx?: number; dy?: number; ox?: number; oy?: number; size?: number } | null)
      : null;
  const calMoving = calPreview?.mode === "move";
  const calResizing = calPreview?.mode === "resize";
  const gridPreviewing = Boolean(calMoving || calResizing);
  const baseGridSize = scene?.gridSize ?? 0;
  const modInto = (value: number, m: number) => (m > 0 ? ((value % m) + m) % m : 0);
  const previewGridSize =
    calResizing && baseGridSize > 0 ? Math.max(Math.round(calPreview?.size ?? baseGridSize), 1) : baseGridSize;
  const previewOffsetX = calResizing
    ? modInto(calPreview?.ox ?? 0, previewGridSize)
    : (scene?.gridOffsetX ?? 0) + (calMoving ? calPreview?.dx ?? 0 : 0);
  const previewOffsetY = calResizing
    ? modInto(calPreview?.oy ?? 0, previewGridSize)
    : (scene?.gridOffsetY ?? 0) + (calMoving ? calPreview?.dy ?? 0 : 0);

  // The grid covers the visible VIEWPORT (not just the map rect), so panning past the map
  // edge still shows squares — the tabletop feels endless. The covered cell range is
  // quantized to 8-cell blocks (±1 block pad) and fed to the memo as four ints, so panning
  // within a block recomputes nothing; only crossing a block boundary rebuilds the lines.
  const GRID_BLOCK = 8;
  const gridViewScale = viewport.scale > 0 ? viewport.scale : 1;
  const gridCellSpan = previewGridSize > 0 ? previewGridSize * GRID_BLOCK : 1;
  const gridBx0 = Math.floor((0 - viewport.x) / gridViewScale / gridCellSpan) - 1;
  const gridBy0 = Math.floor((0 - viewport.y) / gridViewScale / gridCellSpan) - 1;
  const gridBx1 = Math.ceil((stageW - viewport.x) / gridViewScale / gridCellSpan) + 1;
  const gridBy1 = Math.ceil((stageH - viewport.y) / gridViewScale / gridCellSpan) + 1;

  const gridLines = useMemo(() => {
    const lines: number[][] = [];
    if (!scene || previewGridSize <= 0) {
      return lines;
    }
    // While calibrating by drag, force the grid visible even if Show grid is off, so there's
    // something to align against.
    if (!scene.showGrid && !gridPreviewing) {
      return lines;
    }
    const gridSize = previewGridSize;
    // Cap the line count (extreme zoom-out / tiny cells): shrink the covered range
    // symmetrically toward the view center instead of blanking the grid outright.
    const MAX_LINES_PER_AXIS = 400;
    const clampAxis = (b0: number, b1: number): [number, number] => {
      if ((b1 - b0) * GRID_BLOCK <= MAX_LINES_PER_AXIS) {
        return [b0, b1];
      }
      const mid = (b0 + b1) / 2;
      const half = MAX_LINES_PER_AXIS / GRID_BLOCK / 2;
      return [Math.floor(mid - half), Math.ceil(mid + half)];
    };
    const [bx0, bx1] = clampAxis(gridBx0, gridBx1);
    const [by0, by1] = clampAxis(gridBy0, gridBy1);
    const x0 = bx0 * GRID_BLOCK * gridSize + previewOffsetX;
    const x1 = bx1 * GRID_BLOCK * gridSize + previewOffsetX;
    const y0 = by0 * GRID_BLOCK * gridSize + previewOffsetY;
    const y1 = by1 * GRID_BLOCK * gridSize + previewOffsetY;
    for (let cx = bx0 * GRID_BLOCK; cx <= bx1 * GRID_BLOCK; cx++) {
      const x = cx * gridSize + previewOffsetX;
      lines.push([x, y0, x, y1]);
    }
    for (let cy = by0 * GRID_BLOCK; cy <= by1 * GRID_BLOCK; cy++) {
      const y = cy * gridSize + previewOffsetY;
      lines.push([x0, y, x1, y]);
    }
    return lines;
  }, [scene, previewGridSize, previewOffsetX, previewOffsetY, gridPreviewing, gridBx0, gridBy0, gridBx1, gridBy1]);

  // Tokens on the active scene, memoized so a pan/zoom (which changes only the viewport, not
  // token state) doesn't hand the memoized vision layers a fresh array reference every frame —
  // the reference change alone would defeat their `memo` and re-run the layer bodies per frame.
  const sceneTokens = useMemo(
    () => state.tokens.filter((token) => token.sceneId === scene?.id),
    [state.tokens, scene?.id],
  );
  // The viewer's vision-enabled tokens reveal the dark. Players use their own tokens; the DM
  // sees everything unless previewing (then all vision tokens reveal).
  const viewerVisionTokens = useMemo(
    () =>
      sceneTokens.filter(
        (token) =>
          token.vision?.enabled && (isDm ? visionPreview : token.ownerPlayerId === yourPlayerId),
      ),
    [sceneTokens, isDm, visionPreview, yourPlayerId],
  );
  const sceneVisionTokens = useMemo(
    () => sceneTokens.filter((token) => token.vision?.enabled),
    [sceneTokens],
  );

  // Stable dispatchers for the memoized <TokenNode>s. A ref holds the latest (often unstable)
  // callbacks + derived board data so each dispatcher keeps a constant identity — otherwise
  // every render would hand tokens fresh closures and defeat their `memo` on pan/zoom.
  const tokenCbRef = useRef<{
    onSelectToken?: (id: string | null) => void;
    onOpenTokenSheet?: (token: GameState["tokens"][number]) => void;
    onMoveToken: (id: string, x: number, y: number, facing?: number) => void;
    setTokenDragActive: (id: string, active: boolean) => void;
    setHoveredTokenId: (updater: (current: string | null) => string | null) => void;
    isDm: boolean;
    wallsBlockMovement: boolean;
    movementSegs: ReturnType<typeof movementSegments>;
    snapPoint: (x: number, y: number) => { x: number; y: number };
  }>(null!);
  const handleTokenSelect = useCallback(
    (token: GameState["tokens"][number]) => tokenCbRef.current.onSelectToken?.(token.id),
    [],
  );
  const handleTokenOpenSheet = useCallback(
    (token: GameState["tokens"][number]) => tokenCbRef.current.onOpenTokenSheet?.(token),
    [],
  );
  const handleTokenDragActive = useCallback(
    (token: GameState["tokens"][number], active: boolean) =>
      tokenCbRef.current.setTokenDragActive(token.id, active),
    [],
  );
  const handleTokenHover = useCallback(
    (token: GameState["tokens"][number], hovered: boolean) =>
      tokenCbRef.current.setHoveredTokenId((current) =>
        hovered ? token.id : current === token.id ? null : current,
      ),
    [],
  );
  const handleTokenRotate = useCallback(
    (token: GameState["tokens"][number], facing: number) =>
      tokenCbRef.current.onMoveToken(token.id, token.x, token.y, facing),
    [],
  );
  const handleTokenMove = useCallback(
    (token: GameState["tokens"][number], x: number, y: number) => {
      const cb = tokenCbRef.current;
      const snapped = cb.snapPoint(x, y);
      // Players can't drag a token through a movement-blocking wall; the DM bypasses.
      // A rejected move sends the OLD position so the server echo snaps the node back.
      const target =
        !cb.isDm && cb.wallsBlockMovement
          ? clampMove({ x: token.x, y: token.y }, snapped, cb.movementSegs)
          : snapped;
      cb.onMoveToken(token.id, target.x, target.y);
    },
    [],
  );

  // ─── Live token-drag broadcasting (Feature B) ──────────────────────────────────────────────
  // Refs that mirror the current props so the once-created relay callbacks below never go stale.
  const stateRef = useRef(state);
  stateRef.current = state;
  const showLiveDragsRef = useRef(showLiveDrags);
  showLiveDragsRef.current = showLiveDrags;

  // Sender: stream the dragged position, throttled to ~25Hz (null = drag end, sent immediately).
  // One pointer drags one token at a time, so a single throttle gate is enough.
  const dragRelayRef = useRef(0);
  const handleTokenDragFrame = useCallback(
    (token: GameState["tokens"][number], pos: { x: number; y: number } | null) => {
      if (pos === null) {
        dragRelayRef.current = 0;
        send({ type: "TOKEN_DRAG", tokenId: token.id, pos: null });
        return;
      }
      const now = Date.now();
      if (now - dragRelayRef.current < TOKEN_DRAG_RELAY_MS) return;
      dragRelayRef.current = now;
      send({ type: "TOKEN_DRAG", tokenId: token.id, pos });
    },
    [send],
  );

  // A live registry of each mounted token's Konva nodes, so a remote drag can move the real node
  // imperatively (no stage walking, no duplicated "ghost" token).
  const tokenNodesRef = useRef(new Map<string, TokenNodeHandle>());
  const handleTokenNodeRef = useCallback((tokenId: string, handle: TokenNodeHandle | null) => {
    if (handle) tokenNodesRef.current.set(tokenId, handle);
    else tokenNodesRef.current.delete(tokenId);
  }, []);

  // Receiver: mirror other clients' streamed drags onto the real token node (position lerp + the
  // same lift/wobble springs), reconciling with the authoritative STATE echo once the drag ends.
  const remoteDragsRef = useRef(new Map<string, RemoteDrag>());
  const remoteRafRef = useRef(0);
  const [remoteDragIds, setRemoteDragIds] = useState<ReadonlySet<string>>(EMPTY_ID_SET);
  const syncRemoteIds = useCallback(() => {
    const sessions = remoteDragsRef.current;
    setRemoteDragIds(sessions.size === 0 ? EMPTY_ID_SET : new Set(sessions.keys()));
  }, []);

  const runRemoteDragLoop = useCallback(() => {
    if (remoteRafRef.current) return;
    let prevTs = 0;
    const tick = (ts: number) => {
      const dt = prevTs ? (ts - prevTs) / 1000 : 0;
      prevTs = ts;
      const sessions = remoteDragsRef.current;
      const now = Date.now();
      let idsChanged = false;
      let layer: Konva.Layer | null = null;
      for (const [tokenId, entry] of sessions) {
        const handle = tokenNodesRef.current.get(tokenId);
        // Node unmounted (scene switch / token removed) or a local drag took over → drop it.
        if (!handle || handle.group.isDragging()) {
          sessions.delete(tokenId);
          idsChanged = true;
          continue;
        }
        const group = handle.group;
        // No clear frame arrived (sender disconnected / dropped frames) → treat as ended.
        if (!entry.ended && now - entry.at > REMOTE_STALE_MS) {
          entry.ended = true;
          entry.endedAt = now;
          entry.lift.lifted = false;
          const tok = stateRef.current.tokens.find((t) => t.id === tokenId);
          entry.baseX = tok?.x ?? group.x();
          entry.baseY = tok?.y ?? group.y();
        }
        if (!entry.ended) {
          // Ease toward the streamed position (movement is real info — applies even under reduced
          // motion). react-konva won't fight this: token.x/y hasn't changed (no echo mid-drag).
          const k = 1 - Math.exp(-REMOTE_SMOOTH * dt);
          group.x(group.x() + (entry.targetX - group.x()) * k);
          group.y(group.y() + (entry.targetY - group.y()) * k);
        }
        if (entry.reduced) {
          applyStaticLift(handle.lift, handle.shadow, handle.radius, !entry.ended);
        } else {
          stepLift(entry.lift, dt, group.x(), group.y());
          applyLift(entry.lift, handle.lift, handle.shadow, handle.radius);
        }
        layer = handle.lift.getLayer();
        if (entry.ended) {
          const tok = stateRef.current.tokens.find((t) => t.id === tokenId);
          const echoMoved = !!tok && (tok.x !== entry.baseX || tok.y !== entry.baseY);
          const animDone = entry.reduced || liftSettled(entry.lift);
          if (animDone && (echoMoved || now - entry.endedAt > REMOTE_SETTLE_FALLBACK_MS)) {
            // A same-cell / wall-rejected echo doesn't change token.x/y, so react-konva's
            // non-strict prop diff won't reset the node — snap it to authority ourselves.
            if (tok) group.position({ x: tok.x, y: tok.y });
            if (entry.reduced) applyStaticLift(handle.lift, handle.shadow, handle.radius, false);
            else resetLift(entry.lift, handle.lift, handle.shadow);
            sessions.delete(tokenId);
            idsChanged = true;
          }
        }
      }
      layer?.batchDraw();
      if (idsChanged) syncRemoteIds();
      remoteRafRef.current = sessions.size > 0 ? requestAnimationFrame(tick) : 0;
    };
    remoteRafRef.current = requestAnimationFrame(tick);
  }, [syncRemoteIds]);

  useEffect(() => {
    return subscribeTokenDrag((event) => {
      if (!showLiveDragsRef.current) return; // this viewer opted out of live drags
      const sessions = remoteDragsRef.current;
      if (event.pos) {
        let entry = sessions.get(event.tokenId);
        if (!entry) {
          entry = {
            targetX: event.pos.x,
            targetY: event.pos.y,
            at: Date.now(),
            lift: createLiftState(),
            reduced: reducedMotionNow(),
            ended: false,
            endedAt: 0,
            baseX: 0,
            baseY: 0,
          };
          const handle = tokenNodesRef.current.get(event.tokenId);
          if (handle) {
            entry.lift.prevX = handle.group.x();
            entry.lift.prevY = handle.group.y();
          }
          entry.lift.lifted = true;
          sessions.set(event.tokenId, entry);
          syncRemoteIds();
        } else {
          entry.targetX = event.pos.x;
          entry.targetY = event.pos.y;
          entry.at = Date.now();
          entry.ended = false;
          entry.lift.lifted = true;
        }
        runRemoteDragLoop();
      } else {
        const entry = sessions.get(event.tokenId);
        if (entry && !entry.ended) {
          entry.ended = true;
          entry.endedAt = Date.now();
          entry.lift.lifted = false;
          const tok = stateRef.current.tokens.find((t) => t.id === event.tokenId);
          const handle = tokenNodesRef.current.get(event.tokenId);
          entry.baseX = tok?.x ?? handle?.group.x() ?? entry.targetX;
          entry.baseY = tok?.y ?? handle?.group.y() ?? entry.targetY;
          runRemoteDragLoop();
        }
      }
    });
  }, [subscribeTokenDrag, runRemoteDragLoop, syncRemoteIds]);

  // Viewer disabled live drags mid-session: restore every mirrored node to its authoritative
  // position and end the sessions (the loop stops itself once the map empties).
  useEffect(() => {
    if (showLiveDrags) return;
    for (const [tokenId, entry] of remoteDragsRef.current) {
      const handle = tokenNodesRef.current.get(tokenId);
      const tok = stateRef.current.tokens.find((t) => t.id === tokenId);
      if (handle) {
        if (tok) handle.group.position({ x: tok.x, y: tok.y });
        resetLift(entry.lift, handle.lift, handle.shadow);
        handle.lift.getLayer()?.batchDraw();
      }
    }
    remoteDragsRef.current.clear();
    setRemoteDragIds(EMPTY_ID_SET);
  }, [showLiveDrags]);

  useEffect(
    () => () => {
      if (remoteRafRef.current) cancelAnimationFrame(remoteRafRef.current);
    },
    [],
  );

  if (!scene) {
    return <div className={`map-root${embedded ? " map-root--embedded" : ""}`} ref={rootRef} />;
  }

  const activeTool =
    availableTools.find((tool) => tool.id === activeToolId) ?? selectTool;
  const toolActive = activeTool.id !== "select";
  // Existing pins stay grabbable/editable during play: the DM can move & edit them in select
  // mode exactly as in the pin tool — the only thing select mode won't do is drop a fresh pin on
  // an empty-space click (that still needs the pin tool). Pins are DM-only, so gate on isDm.
  const pinsInteractive = activeTool.id === "pin" || (isDm && activeTool.id === "select");

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
    fogShape,
    wallBrush,
    snapWallPoint,
    lightRadii: LIGHT_PRESETS[lightPreset],
    templateKind,
    templatePin,
    calibrateMode,
    viewportScale: viewport.scale,
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

  // Keep the token-dispatcher ref current so the stable dispatchers (defined above the early
  // return) always act on the latest callbacks + board data without changing identity.
  tokenCbRef.current = {
    onSelectToken,
    onOpenTokenSheet,
    onMoveToken,
    setTokenDragActive,
    setHoveredTokenId,
    isDm,
    wallsBlockMovement: scene.wallsBlockMovement !== false,
    movementSegs,
    snapPoint,
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
      handler({ world: pos, shiftKey: Boolean(e.evt.shiftKey), buttons: e.evt.buttons ?? 0 }, runtime);
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

  const currentTurnTokenId =
    state.combat?.entries[state.combat.turnIndex]?.tokenId ?? null;

  // ---- Dynamic vision (Phase 6) ----
  const ftToPx = scene.gridSize / Math.max(scene.feetPerSquare, 1);
  const wallsActive = activeTool.id === "walls";
  const lightsActive = activeTool.id === "lights";
  // Dynamic lighting off = the scene is dark. Players (and the DM's 👁 preview) get the
  // strict LOS-gated mask; the DM's own view instead gets a dimmed "here's my lighting"
  // overlay so lights are visibly working during setup without needing a token.
  // (viewerVisionTokens / sceneVisionTokens are memoized above the early return.)
  const dark = !scene.globalIllumination;
  const maskActive = dark && (!isDm || visionPreview);
  const dmLightingActive = dark && isDm && !visionPreview;
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
    // Alt+scroll while the fog brush is active resizes the brush instead of zooming.
    if (activeTool.id === "fog" && fogShape === "brush" && e.evt.altKey) {
      e.evt.preventDefault();
      const dir = e.evt.deltaY > 0 ? -1 : 1;
      // Match the toolbar slider's [0.15, 3] range; ~0.1 cell per notch, snapped to its 0.05 step.
      setFogBrushScale((s) => Math.min(3, Math.max(0.15, Math.round((s + dir * 0.1) * 20) / 20)));
      return;
    }
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

  // Pinned template annotations the current user may clear (DM: all; player: own).
  // The color+kind fallback catches templates pinned before `origin` existed.
  const clearableTemplateAnns = scene.annotations.filter(
    (a) =>
      (a.origin === "template" || (a.kind === "stroke" && a.color === TEMPLATE_COLOR)) &&
      (isDm || a.authorId === yourPlayerId),
  );
  const clearTemplates = () => {
    for (const a of clearableTemplateAnns) {
      send({ type: "REMOVE_ANNOTATION", sceneId: scene.id, annotationId: a.id });
    }
  };

  // Calibrate "adjust" cursor: a resize cursor while a grid-point handle is hovered/dragged (so it
  // reads as grabbable), else the move cursor (drag anywhere else slides the grid).
  const calibrateDraftMode = (draft as { mode?: string } | null)?.mode;
  const rootCursor = !toolActive
    ? undefined
    : activeTool.id === "calibrate" && calibrateMode === "adjust"
      ? calibrateDraftMode === "hover" || calibrateDraftMode === "resize"
        ? "nwse-resize"
        : "move"
      : activeTool.cursor;

  return (
    <div
      className={`map-root${embedded ? " map-root--embedded" : ""}`}
      ref={rootRef}
      style={{ backgroundColor: boardBgColor, ...(rootCursor ? { cursor: rootCursor } : {}) }}
      // Right-click is a game gesture here (delete wall/light, etc.) — never the browser's
      // save/copy/inspect menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      {backdropUrl ? (
        <div
          className="map-backdrop"
          style={{
            backgroundImage: `url("${backdropUrl}")`,
            filter: backdropBlurPx > 0 ? `blur(${backdropBlurPx}px)` : undefined,
            transform: `scale(${backdropScale})`,
          }}
          aria-hidden
        />
      ) : null}
      {/* Skeleton shimmer over the scene rect while the map image decodes (progressive load).
          Positioned in screen coords from the viewport; removed the instant the map is ready. */}
      {scene.mapUrl && !mapImg ? (
        <div
          className="skeleton-shimmer map-loading-shimmer"
          aria-hidden
          style={{
            left: Math.round(viewport.x),
            top: Math.round(viewport.y),
            width: Math.round(scene.width * viewport.scale),
            height: Math.round(scene.height * viewport.scale),
          }}
        />
      ) : null}
      <Stage
        ref={stageRef}
        width={stageW}
        height={stageH}
        // Pan snapped to the DEVICE pixel grid: a fractional stage translation shifts every
        // crisp edge (grid lines, walls, snapped text) onto pixel boundaries' fractions and
        // smears them. Sub-half-pixel correction — invisible during drags.
        x={Math.round(viewport.x * renderRatio) / renderRatio}
        y={Math.round(viewport.y * renderRatio) / renderRatio}
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
          // Right-click cancels an in-progress fog polygon-lasso (finish with dbl-click / start vertex).
          if (activeTool.id === "fog" && (draft as { shape?: string } | null)?.shape === "polygon") {
            e.evt.preventDefault();
            setDraft(null);
          }
        }}
        onDblClick={(e) => {
          if (toolActive && activeTool.onDblClick) {
            const pos = stageRef.current?.getRelativePointerPosition();
            if (pos) {
              activeTool.onDblClick(
                { world: pos, shiftKey: Boolean(e.evt.shiftKey), buttons: e.evt.buttons ?? 0 },
                runtime,
              );
            }
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
          // Clicking an existing wall/light marker or map pin interacts with it
          // (drag/toggle/delete/edit) rather than placing a new one underneath.
          if (typeof e.target?.hasName === "function" && e.target.hasName("map-handle")) {
            return;
          }
          if (toolActive && e.evt.button === 0) {
            // Capture the pointer for the whole gesture: moves/ups keep routing to the canvas
            // even when the cursor crosses the dock, toolbar, window edge, or any overlay —
            // without this, a boundary crossing mid-stroke silently ends (or strands) the drag.
            if (e.evt.pointerId !== undefined) {
              try {
                (e.evt.target as Element | null)?.setPointerCapture?.(e.evt.pointerId);
              } catch {
                // Capture is best-effort (the pointer may already be gone) — never break the tool.
              }
            }
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
          // already left-only, so gate onUp to match. And if the left button is still physically
          // held (buttons bit 0 set), this "up" is spurious — swallowing it keeps a held brush
          // stroke alive instead of committing and resetting it mid-drag.
          if (toolActive && e.evt.button === 0 && !((e.evt.buttons ?? 0) & 1)) {
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
        <MapRenderCtx.Provider value={renderCtx}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.backgroundColor} />
          {crispMapImg ? (
            // ROTATE_SCENE only rotates geometry — the stored image is untouched, so the
            // image node alone is drawn rotated (its local width/height are the image's
            // pre-rotation dims, positioned so the turned rect lands exactly on the
            // scene rect at the origin).
            (scene.mapRotation ?? 0) === 0 ? (
              <KonvaImage image={crispMapImg} x={0} y={0} width={scene.width} height={scene.height} />
            ) : (
              <KonvaImage
                image={crispMapImg}
                rotation={scene.mapRotation}
                x={scene.mapRotation === 270 ? 0 : scene.width}
                y={scene.mapRotation === 90 ? 0 : scene.height}
                width={scene.mapRotation === 180 ? scene.width : scene.height}
                height={scene.mapRotation === 180 ? scene.height : scene.width}
              />
            )
          ) : null}
        </Layer>

        {/* Colored-light tint (coloration pass): its canvas is CSS-blended (default screen)
            directly over the MAP ART ONLY — below the grid, annotations, token art, and
            name labels, so UI elements stay crisp and untinted. Below fog + the darkness
            mask, so hidden areas still cover it. Blend "none" = fog-of-war only (no tint). */}
        {(maskActive || dmLightingActive) && scene.lightBlendMode !== "none" ? (
          <LightTintLayer scene={scene} ftToPx={ftToPx} animationsEnabled={lightAnimations} />
        ) : null}

        {/* Grid: above the light tint, under tokens. */}
        <Layer listening={false}>
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
        </Layer>

        <Layer listening={activeTool.id === "select"}>
          {sceneTokens.map((token) => {
            // Darkness gate: tokens the viewer can't see (out of LOS/light/darkvision, no
            // override) don't render at all — not merely dimmed by the mask.
            if (visibleTokenIds && !visibleTokenIds.has(token.id)) return null;
            const draggable =
              isDm || (token.ownerPlayerId === yourPlayerId && state.playersCanMove !== false);
            // Prefer the linked sheet's portrait so uploads/changes reflect live;
            // fall back to the token's own snapshot, then its color.
            const linkedSheetId = token.sheetId ?? token.ownerPlayerId;
            const sheet = linkedSheetId ? state.sheets[linkedSheetId] : undefined;
            const linkedItem = token.itemId ? state.items[token.itemId] : undefined;
            // Concealed art: the server already withholds the URLs from players; this
            // client-side gate also covers sheet portraits players legitimately know
            // (revealed identity) that the DM still concealed on THIS token.
            const concealedPortrait = Boolean(token.portraitConcealed) && !isDm;
            // The crop belongs to whichever source supplies the image: the sheet portrait, else
            // the item icon it mirrors. A standalone token image has no crop → centered.
            const imageUrl = concealedPortrait
              ? null
              : sheet?.data.iconUrl ?? linkedItem?.iconUrl ?? token.imageUrl ?? null;
            const imageCrop = sheet?.data.iconUrl
              ? sheet.data.iconCrop
              : linkedItem?.iconUrl
                ? linkedItem.iconCrop
                : DEFAULT_ICON_CROP;
            const sheetHp = sheet?.data.hp;
            // A bar shows when the token's own HP display is on, or the DM's "show all health
            // bars" toggle is on — for the DM and players alike, so the DM sees exactly what the
            // table sees. (Redaction keeps hp available to players for those same tokens.)
            const hp = sheetHp && (token.showHp !== "none" || state.showAllTokenHp) ? sheetHp : null;
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
                imageUrl={imageUrl}
                imageCrop={imageCrop}
                concealedPortrait={concealedPortrait}
                concealBadge={isDm && Boolean(token.nameConcealed || token.portraitConcealed)}
                controllerColor={controllerColor}
                shapeDefaults={state.tokenShapeDefaults}
                radius={radius}
                draggable={draggable}
                selected={selectedTokenId === token.id}
                isCurrentTurn={currentTurnTokenId === token.id}
                hp={hp}
                showHpValues={token.showHp === "values"}
                onSelect={handleTokenSelect}
                onOpenSheet={handleTokenOpenSheet}
                onMove={handleTokenMove}
                onRotate={draggable ? handleTokenRotate : undefined}
                onDragActive={handleTokenDragActive}
                onDragFrame={draggable ? handleTokenDragFrame : undefined}
                onNodeRef={handleTokenNodeRef}
                onHover={isDm ? handleTokenHover : undefined}
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

        {/* Annotations (draw strokes + pointer arrows): ABOVE fog and the darkness mask —
            they're live communication (someone pointing at the board), not world objects, so
            lighting/fog must never swallow them. (The server already strips dmOnly ones from
            player state, so nothing secret can show through.) Erasable (right-click) while the
            draw or pin tool is active; pins get their own layer further up. */}
        <Layer listening={activeTool.id === "draw" || activeTool.id === "pin"}>
          {scene.annotations.map((annotation) =>
            // Our own just-committed arrow is hidden until the preview hands off to it; pins
            // render in the dedicated top layer instead of here.
            annotation.id === pendingArrowId || annotation.kind === "pin" ? null : annotation.kind === "arrow" ? (
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

        {/* Token names for revealed tokens, drawn ABOVE the darkness mask so a lit token's name
            is always fully legible (the in-token label underneath, if any, is darkened/hidden by
            the mask). Rendered only while the board is dark; the bright copy overlays the masked
            one at the same coords. */}
        {visibleTokenIds ? (
          <Layer listening={false}>
            {sceneTokens.map((token) => {
              if (!visibleTokenIds.has(token.id)) return null;
              // Skip the bright copy for a token being dragged — locally, or by a remote player we're
              // mirroring: the in-token label carries it live meanwhile, so the two never separate
              // into a trailing duplicate pinned to the not-yet-updated React position.
              if (token.id === draggingLabelId || remoteDragIds.has(token.id)) return null;
              const linkedSheetId = token.sheetId ?? token.ownerPlayerId;
              const sheet = linkedSheetId ? state.sheets[linkedSheetId] : undefined;
              const sheetHp = sheet?.data.hp;
              const hp = sheetHp && (token.showHp !== "none" || state.showAllTokenHp) ? sheetHp : null;
              const showBar = hp !== null && hp.max > 0;
              const radius = tokenRadius(scene.gridSize, token.size ?? state.defaultTokenSize ?? 1);
              return (
                <Group key={token.id} x={token.x} y={token.y} opacity={token.hidden ? 0.4 : 1} listening={false}>
                  <TokenNameLabel
                    token={token}
                    radius={radius}
                    showBar={showBar}
                    showHpValues={token.showHp === "values"}
                  />
                </Group>
              );
            })}
          </Layer>
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
            onHoverWall={setHoveredWallId}
            snapWallPoint={snapWallPoint}
            onMoveLight={onMoveLight}
            onDeleteLight={onDeleteLight}
            onConfigureLight={onConfigureLight}
          />
        ) : null}

        {/* Door controls (all clients — players open unlocked doors; secret doors DM-only). */}
        {scene.walls.some((w) => w.door && w.door !== "none") ? (
          <DoorLayer
            scene={scene}
            isDm={isDm}
            interactive={activeTool.id === "select"}
            visibleDoorIds={visibleDoorIds}
            onToggleDoor={onToggleDoor}
            onSetDoorState={onSetDoorState}
          />
        ) : null}

        {/* Map pins (DM-only): drawn ABOVE tokens, walls, lights, fog, and doors so the DM's
            markers are never hidden behind them. Interactive (edit/move/erase) with the pin
            tool; erasable with the draw tool too, matching the other annotations. */}
        <Layer listening={activeTool.id === "draw" || pinsInteractive}>
          {scene.annotations.map((annotation) =>
            annotation.kind === "pin" ? (
              <AnnotationNode
                key={annotation.id}
                annotation={annotation}
                now={fadeClock}
                onErase={() => eraseAnnotation(annotation)}
                onEdit={
                  pinsInteractive
                    ? () =>
                        setDraft({
                          x: annotation.x ?? 0,
                          y: annotation.y ?? 0,
                          id: annotation.id,
                          text: annotation.text ?? "",
                        } satisfies PinDraft)
                    : undefined
                }
                onMove={
                  pinsInteractive
                    ? (x, y) => movePin(runtime, annotation.id, x, y)
                    : undefined
                }
              />
            ) : null,
          )}
        </Layer>

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
        </MapRenderCtx.Provider>
      </Stage>

      {pinsInteractive && draft ? (
        (() => {
          const pin = draft as PinDraft;
          return (
            <PinNoteEditor
              key={pin.id ?? "new"}
              x={viewport.x + pin.x * viewport.scale + 12 * viewport.scale}
              y={viewport.y + pin.y * viewport.scale - 10 * viewport.scale}
              initialText={pin.text ?? ""}
              onCommit={(text: string) => {
                // `id` set → editing an existing pin in place; otherwise a fresh drop.
                if (pin.id) {
                  updatePin(runtime, pin.id, text);
                } else {
                  commitPin(runtime, pin, text);
                }
                setDraft(null);
              }}
              onCancel={() => setDraft(null)}
            />
          );
        })()
      ) : null}

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
        templatePinCount={clearableTemplateAnns.length}
        onClearTemplates={clearTemplates}
        calibrateMode={calibrateMode}
        onCalibrateMode={setCalibrateMode}
        fogEnabled={scene.fog.enabled}
        onToggleFog={() => send({ type: "FOG_SET", sceneId: scene.id, enabled: !scene.fog.enabled })}
        onResetFog={() => send({ type: "FOG_RESET", sceneId: scene.id })}
        fogMode={fogMode}
        onFogMode={setFogMode}
        fogShape={fogShape}
        onFogShape={(shape) => {
          setFogShape(shape);
          setDraft(null); // drop any in-progress selection when switching shape
        }}
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
        reducedMotion={prefersReducedMotion}
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
        <div className={`map-light-config${dockOpen ? " map-light-config--dock-open" : ""}`}>
          <LightConfigPanel
            light={editingLight}
            onChange={onMoveLight}
            onDelete={() => onDeleteLight(editingLight.id)}
            onClose={() => setEditingLightId(null)}
          />
        </div>
      ) : null}

      {isDm && editingWall ? (
        <div className={`map-light-config${dockOpen ? " map-light-config--dock-open" : ""}`}>
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
  onEdit,
  onMove,
}: {
  annotation: Annotation;
  now: number;
  onErase: () => void;
  /** Pin-only: opens the note editor (provided only when the pin tool is active). */
  onEdit?: () => void;
  /** Pin-only: commits a drag-to-move to a new world position (pin tool active only). */
  onMove?: (x: number, y: number) => void;
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
        <CrispText
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
      return <PinNode annotation={annotation} onErase={onErase} onEdit={onEdit} onMove={onMove} />;
  }
}

/// <summary>
/// A committed map pin: the shared teardrop glyph (tip anchored under its world point) plus an
/// optional note label. Editing/moving is enabled only while the pin tool is active (the
/// onEdit/onMove handlers are supplied then). Interactions:
///   • drag the marker → move the pin (onDragStart vetoes a drag that began on the label);
///   • click the note label, or double-click the marker → open the note editor;
///   • right-click → erase.
/// The marker/label shapes carry the "map-handle" name so the stage skips placing a fresh pin
/// when one is grabbed (same pattern as wall/light handles). Hover brightens the pin and swaps
/// the cursor: a text I-beam over the note, a move/grab cursor over the draggable marker.
/// </summary>
function PinNode({
  annotation,
  onErase,
  onEdit,
  onMove,
}: {
  annotation: Annotation;
  onErase: () => void;
  onEdit?: () => void;
  onMove?: (x: number, y: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const editable = Boolean(onEdit);
  // Records whether the in-flight drag began on the marker (vs the label), so onDragStart can
  // veto a label drag — grabbing the note text should edit, not move.
  const grabbedMarker = useRef(false);
  const setCursor = (e: Konva.KonvaEventObject<Event>, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) {
      container.style.cursor = cursor;
    }
  };
  const highlight = hovered && editable;
  return (
    <Group
      x={annotation.x ?? 0}
      y={annotation.y ?? 0}
      draggable={editable}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        onErase();
      }}
      onMouseDown={(e) => {
        grabbedMarker.current = e.target.hasName?.("pin-marker") ?? false;
      }}
      onDragStart={(e) => {
        // Only a grab on the marker moves the pin; a drag that began on the note label is a
        // mis-grab (the label is for editing) — cancel it so the pin stays put.
        if (!grabbedMarker.current) {
          e.target.stopDrag();
        }
      }}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        onMove?.(e.target.x(), e.target.y());
      }}
      onClick={(e) => {
        // Clicking the note label edits it; a plain marker click is reserved for drag / dbl-click.
        if (e.target.hasName?.("pin-label")) {
          onEdit?.();
        }
      }}
      onDblClick={() => onEdit?.()}
      onDblTap={() => onEdit?.()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={(e) => {
        setHovered(false);
        // Clear the override so the active tool's cursor (crosshair) shows through again.
        setCursor(e, "");
      }}
      onMouseOver={(e) => {
        // Cursor depends on the sub-part under the pointer: an I-beam over the editable note,
        // a move cursor over the draggable marker.
        if (!editable) {
          return;
        }
        setCursor(e, e.target.hasName?.("pin-label") ? "text" : "move");
      }}
    >
      <PinMarker highlighted={highlight} />
      {annotation.text ? (
        // Label sits just right of the (scaled) head, vertically centered on it.
        <>
          <Rect
            name="map-handle pin-label"
            x={15}
            y={-35}
            width={annotation.text.length * 7 + 12}
            height={20}
            cornerRadius={4}
            fill="rgba(10,12,16,0.85)"
            stroke={highlight ? "#ffe0a3" : annotation.color}
            strokeWidth={1}
          />
          <CrispText name="map-handle pin-label" x={20} y={-31} text={annotation.text} fontSize={12} fill="#e6e6e8" />
        </>
      ) : null}
    </Group>
  );
}
