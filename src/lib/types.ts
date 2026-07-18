import type { CampaignManifest } from "./campaignManifest";
import type { DiceTrack, DieSpec, WorldPoint } from "./dice3d";

export type Role = "dm" | "player";

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

/**
 * A drawn map annotation. The Draw tool creates "stroke" (DM-persistent / player-fading);
 * the shift-drag pointer gesture creates "arrow" (always ephemeral, dashed, arrowhead).
 * rect/circle/text render but have no tool yet.
 */
export type Annotation = {
  id: string;
  /** playerId or "dm" — authors (and the DM) may remove their own. */
  authorId: string;
  /** "pin" is a DM map note (📍 + text) — persistent, optionally DM-only (Phase 7). */
  kind: "stroke" | "arrow" | "rect" | "circle" | "text" | "pin";
  /** Flat [x0,y0,x1,y1,…] world coords for strokes/arrows. */
  points?: number[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  color: string;
  width: number;
  createdAt: number;
  /** Auto-removed by the server ~10s after creation. Forced true for players. */
  ephemeral: boolean;
  /** DM-only: stripped from player frames by redactStateFor (map pins). */
  dmOnly?: boolean;
  /** Set on pinned area templates so the template panel's Clear can target only them. */
  origin?: "template";
};

/**
 * A fog-of-war shape (world coords), applied in painter's order over the base:
 * `mode` absent/"reveal" cuts fog away, "cover" paints fog back in. Sanitizers only
 * ever EMIT `mode: "cover"` (reveal stays implicit) to keep persisted shapes small.
 */
export type FogReveal =
  | { kind: "rect"; x: number; y: number; w: number; h: number; mode?: "reveal" | "cover" }
  | { kind: "circle"; x: number; y: number; r: number; mode?: "reveal" | "cover" }
  /** Freehand brush stroke: flat [x0,y0,x1,y1,…]; stroke width = 2r, round caps. */
  | { kind: "brush"; points: number[]; r: number; mode?: "reveal" | "cover" }
  /** Filled selection polygon (rectangle-drag / lasso / polygon-lasso): flat [x0,y0,…], auto-closed. */
  | { kind: "poly"; points: number[]; mode?: "reveal" | "cover" };

/** Which fog paint/selection shape the DM's fog tool uses (client-only, not persisted). */
export type FogShape = "brush" | "rect" | "lasso" | "polygon";

export type SceneFog = {
  enabled: boolean;
  reveals: FogReveal[];
  /** false = map starts fully covered (reveals cut); true = starts clear (cover paints fog in). */
  inverted: boolean;
};

/**
 * Per-channel restriction (Phase 6.9, Foundry-style):
 * - `none` — passes freely (channel ignores this wall).
 * - `normal` — fully blocks.
 * - `limited` — "terrain" semantics: sight/light passes ONE limited wall but is blocked by a
 *   second limited (or any normal) wall behind it. For movement, `limited` is treated as `normal`.
 * - `proximity` — "window": blocks only when the source is BEYOND the wall's `threshold` distance
 *   (sight/light only; movement treats it as a normal block). Binary — no attenuation yet.
 */
export const WALL_RESTRICTIONS = ["none", "normal", "limited", "proximity"] as const;
export type WallRestriction = (typeof WALL_RESTRICTIONS)[number];

/** One-way occlusion: `both` sides, or only when the source is on the wall's `left`/`right`
 *  (by endpoint winding — see `visibility.ts`). */
export const WALL_DIRS = ["both", "left", "right"] as const;
export type WallDir = (typeof WALL_DIRS)[number];

/** Door role. `secret` looks like a plain wall to players (client-side appearance gating). */
export const WALL_DOORS = ["none", "door", "secret"] as const;
export type WallDoor = (typeof WALL_DOORS)[number];

/** Door state. `locked` blocks player toggling until a DM unlocks. New doors start `closed`. */
export const WALL_DOOR_STATES = ["closed", "open", "locked"] as const;
export type WallDoorState = (typeof WALL_DOOR_STATES)[number];

/** Named presets over the channels; `custom` = manually tuned channels. */
export const WALL_PRESET_IDS = ["normal", "terrain", "invisible", "ethereal", "window", "custom"] as const;
export type WallPreset = (typeof WALL_PRESET_IDS)[number];

/**
 * A wall segment. `sight`/`light`/`move` are INDEPENDENT restriction channels; the named
 * `preset` is only a UI tag — the channels are authoritative. Doors are walls with a `door`
 * role + `state`; an open door lets every channel through (see `wallsToSegments`/`movementSegments`).
 */
export type Wall = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Occludes token line-of-sight. */
  sight: WallRestriction;
  /** Occludes light propagation (independent of sight). */
  light: WallRestriction;
  /** Blocks token movement (`limited` treated as `normal` for collision). */
  move: WallRestriction;
  /** One-way occlusion; default `both`. */
  dir?: WallDir;
  /** Door role; default `none`. */
  door?: WallDoor;
  /** Door state; default `closed`. Only meaningful when `door !== "none"`. */
  state?: WallDoorState;
  /** Proximity range in FEET for `proximity` channels (window walls). Default ~10. */
  threshold?: number;
  /** UI tag only — channels are authoritative. */
  preset?: WallPreset;
};

/** Micro-snap: each grid cell subdivides into this many steps when placing wall endpoints. */
export const WALL_SNAP_SUBDIVISIONS = 8;

/** Preset → channel bundle (single source of truth for the config panel + toolbar). */
export const WALL_PRESETS: Record<
  Exclude<WallPreset, "custom">,
  Pick<Wall, "sight" | "light" | "move" | "dir">
> = {
  normal: { sight: "normal", light: "normal", move: "normal", dir: "both" }, // solid wall
  terrain: { sight: "limited", light: "limited", move: "none", dir: "both" }, // foliage/fog: see past one
  invisible: { sight: "none", light: "none", move: "normal", dir: "both" }, // glass: blocks movement only
  ethereal: { sight: "normal", light: "normal", move: "none", dir: "both" }, // curtain: blocks senses only
  window: { sight: "proximity", light: "proximity", move: "normal", dir: "both" }, // see/light through only up close
};

/** Default proximity range (feet) a freshly drawn window wall gets. */
export const DEFAULT_WALL_THRESHOLD = 10;

/** What the walls tool draws — a channel preset or a plain door. */
export const WALL_BRUSHES = ["normal", "terrain", "invisible", "ethereal", "window", "door"] as const;
export type WallBrush = (typeof WALL_BRUSHES)[number];

/** Display color per brush (mirrors `wallVisual` in MapVision — used by the draw preview). */
export const WALL_BRUSH_COLORS: Record<WallBrush, string> = {
  normal: "#f2e9a0",
  terrain: "#81b90c",
  invisible: "#5bc8e6",
  ethereal: "#b98cf0",
  window: "#c7d8ff",
  door: "#5b9bf0",
};

/** Channel/door fields for a freshly drawn wall of the given brush (merged onto endpoints). */
export function wallFromBrush(
  brush: WallBrush,
): Pick<Wall, "sight" | "light" | "move" | "dir" | "door" | "state" | "preset" | "threshold"> {
  if (brush === "door") {
    return { ...WALL_PRESETS.normal, door: "door", state: "closed" };
  }
  if (brush === "window") {
    return { ...WALL_PRESETS.window, preset: "window", threshold: DEFAULT_WALL_THRESHOLD };
  }
  return { ...WALL_PRESETS[brush], preset: brush };
}

/** Which preset a wall's channels match (for the config panel's preset dropdown), or "custom". */
export function matchWallPreset(wall: Pick<Wall, "sight" | "light" | "move" | "dir">): WallPreset {
  for (const id of ["normal", "terrain", "invisible", "ethereal", "window"] as const) {
    const p = WALL_PRESETS[id];
    if (
      p.sight === wall.sight &&
      p.light === wall.light &&
      p.move === wall.move &&
      (p.dir ?? "both") === (wall.dir ?? "both")
    ) {
      return id;
    }
  }
  return "custom";
}

/**
 * How the colored-light tint layer composites over the scene (CSS mix-blend-mode values).
 * Screen ≈ Foundry's default "Adaptive Luminance": brightens + tints while preserving the
 * underlying art. plus-lighter = Add (Glow). "none" disables the tint entirely — lights
 * then only carve visibility out of the darkness (fog-of-war only).
 */
export const LIGHT_BLEND_MODES = [
  "screen",
  "overlay",
  "soft-light",
  "multiply",
  "plus-lighter",
  "none",
] as const;
export type LightBlendMode = (typeof LIGHT_BLEND_MODES)[number];

/** Per-light animation (Phase 6.6). Only runs while the light is enabled + type !== "none". */
export type LightAnimation = {
  type: "none" | "flicker" | "pulse";
  /** Cycle speed multiplier (0 = frozen). Default 1. */
  speed?: number;
  /** How pronounced the effect is (0..1). Default 0.5. */
  intensity?: number;
};

/** A light source. Radii are in FEET (converted to world px via the scene grid). */
export type Light = {
  id: string;
  x: number;
  y: number;
  /** Bright-light radius (fully lit). */
  brightR: number;
  /** Dim-light radius (outer reach); should be ≥ brightR. */
  dimR: number;
  color?: string;
  enabled: boolean;
  /** Strength of the color tint (0..1). Default 0.5. Only used when `color` is set. */
  colorIntensity?: number;
  /** Emission angle in degrees (default 360 = full circle). <360 makes a directed wedge. */
  angle?: number;
  /** Rotation of the emission wedge, degrees (default 0). Only visible when angle < 360. */
  rotation?: number;
  /** Gradual illumination: smooth bright→dim→dark falloff (default true). Off = hard edge. */
  gradual?: boolean;
  animation?: LightAnimation;
};

export const MAX_SCENE_ANNOTATIONS = 200;
export const MAX_ANNOTATION_POINTS = 240; // flat x,y numbers → 120 sampled points
export const EPHEMERAL_ANNOTATION_TTL_MS = 10_000;
/** How long an annotation fades out (client-local ghost fade after it's removed). */
export const ANNOTATION_FADE_MS = 600;
/** Live pointer arrows one author may have at once — older ones fade first. */
export const MAX_POINTER_ARROWS_PER_AUTHOR = 5;
export const MAX_FOG_REVEALS = 300;
/** Flat x,y numbers per fog brush stroke (120 samples) — 300×240 ≈ 580KB worst case. A longer
 *  stroke halves the mid-drag cap commits, and each commit round-trips a full STATE echo that
 *  re-renders the whole board — the churn that made held brush drags stutter. */
export const MAX_FOG_BRUSH_POINTS = 240;
/** Flat x,y numbers per fog selection polygon (lasso/polygon); freehand lassos need more vertices. */
export const MAX_FOG_POLY_POINTS = 512;
export const MAX_MEASURE_NUMBERS = 48; // flat x,y numbers → 24 ruler points

/**
 * A spell/area measurement template (Phase 7). Transient — relayed like MEASURE, never
 * in GameState (unless the drafter "pins" it, which commits a stroke annotation instead).
 * `points` are flat world coords; their meaning depends on `kind`:
 * - circle: [cx, cy, edgeX, edgeY] (radius = distance)
 * - cone:   [ox, oy, tipX, tipY]  (direction + length; 5e cone width = length)
 * - line:   [ox, oy, endX, endY]  (drawn as a 1-square-wide band)
 * - rect:   [x0, y0, x1, y1]      (opposite corners)
 */
export const TEMPLATE_KINDS = ["circle", "cone", "line", "rect"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type TemplateShape = { kind: TemplateKind; points: number[] };
/** Max absolute world coordinate accepted on a template (guards degenerate/huge shapes). */
export const MAX_TEMPLATE_EXTENT = 20000;
export const MAX_WALLS = 600;
export const MAX_LIGHTS = 50;

/// <summary>
/// A scene is a single background map image (drawn at world origin) plus a grid,
/// annotations, and manual fog-of-war.
/// </summary>
export type Scene = {
  id: string;
  name: string;
  mapUrl: string | null;
  width: number;
  height: number;
  /**
   * How the background image is rotated when drawn (degrees CW). Absent = 0. Set by
   * ROTATE_SCENE, which also swaps width/height and rotates all scene geometry — only
   * the image node needs this at render time.
   */
  mapRotation?: 90 | 180 | 270;
  gridSize: number;
  /** Grid origin offset (world px) so the grid can align to commercial maps. */
  gridOffsetX: number;
  gridOffsetY: number;
  /** Real-world feet per grid square (5e default 5). */
  feetPerSquare: number;
  gridColor: string;
  gridOpacity: number;
  showGrid: boolean;
  backgroundColor: string;
  defaultViewport: Viewport;
  /** DM strokes persist; player strokes are ephemeral. Capped server-side. */
  annotations: Annotation[];
  fog: SceneFog;
  /** Phase 6 dynamic vision: sight-blocking walls/doors. */
  walls: Wall[];
  /**
   * Phase 6.9: when true, movement-restricting walls block token drags/moves (players only —
   * the DM always bypasses). Default true. The DM can toggle it per scene from the walls toolbar.
   */
  wallsBlockMovement?: boolean;
  /** Phase 6 dynamic vision: light sources. */
  lights: Light[];
  /** When true (default), the scene is lit everywhere — the vision pass is skipped. */
  globalIllumination: boolean;
  /**
   * Ambient darkness level, 0 (full day) … 1 (full dark). Phase 6.6. Drives the darkness
   * overlay opacity when dynamic lighting is on. Migrated from `globalIllumination` when absent.
   */
  darkness?: number;
  /** How colored-light tint composites over the scene (default "screen"). Phase 6.6b. */
  lightBlendMode?: LightBlendMode;
  /**
   * Board backdrop (Phase 8): the tabletop AROUND the map. null = auto, a very
   * dark tone derived from the map image's average color.
   */
  boardBgColor?: string | null;
  /** Optional backdrop image behind the map (rendered pre-blurred, viewport-filling). */
  boardBgImageUrl?: string | null;
  /** Backdrop image blur strength 0–30 (default 12). */
  boardBgBlur?: number;
  /**
   * Multi-scene viewing (Phase B): when true, players may switch to this scene from
   * their scene strip even while another scene is live. Default false — nothing changes
   * until the DM opens a scene up. The ACTIVE scene is always player-visible regardless.
   */
  playerVisible?: boolean;
};

/** Handout library size cap (URLs + names only, so this stays tiny on the wire). */
export const MAX_HANDOUTS = 100;

/// <summary>
/// A handout is a DM-shared image (letter, portrait, vista) players can be shown and —
/// once granted — re-open later from the Handouts panel. Separate lifecycle from scenes:
/// no grid, tokens, or fog. `visibleTo` is the durable per-player grant; the ephemeral
/// "look at this now" pop is a transient HANDOUT_SHOW push, never state.
/// </summary>
export type Handout = {
  id: string;
  name: string;
  /** Public URL (library asset under tokens/) — never a data URL (sanitized ≤600 chars). */
  imageUrl: string | null;
  /** Natural pixel size captured at upload; absent for library picks (client measures on load). */
  width?: number;
  height?: number;
  /** Who may (re)open it from the panel: "all", or player slot ids. [] = DM-only. */
  visibleTo: "all" | string[];
  createdAt: number;
};

/** Token groups. "item" = a catalog object dropped on the board (Phase 6.7). */
export type TokenKind = "player" | "enemy" | "item";

/** How a token's HP (from its linked sheet) is shown to players. DM always sees bars. */
export type TokenHpDisplay = "none" | "bar" | "values";

/** Token silhouette (Phase 6.7). Unset on a token = use the group default. */
export const TOKEN_SHAPES = ["circle", "square", "diamond", "triangle", "hexagon", "octagon"] as const;
export type TokenShape = (typeof TOKEN_SHAPES)[number];

export type Token = {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  label: string;
  color: string;
  kind: TokenKind;
  imageUrl: string | null;
  ownerPlayerId: string | null;
  /** Linked sheet. Player tokens auto-link to their owner's PC sheet. */
  sheetId: string | null;
  /** Active condition ids from CONDITIONS. */
  conditions: string[];
  showHp: TokenHpDisplay;
  /** DM-hidden: stripped from player frames entirely; DM sees it ghosted. */
  hidden?: boolean;
  /** DM-concealed identity: players see "???" as the label (server-rewritten). */
  nameConcealed?: boolean;
  /** DM-concealed art: players get imageUrl null + a "?" glyph (server-stripped). */
  portraitConcealed?: boolean;
  /**
   * Darkness visibility override (enemy/item tokens, client-enforced): absent = "auto"
   * (each viewer's vision/lights/LOS decide), "always" = rendered for everyone even in
   * the dark (the mask still dims it naturally).
   */
  dmVisibility?: "always";
  /** Player ids force-shown this token in the dark even when their vision fails (auto mode). */
  revealTo?: string[];
  /** Phase 6 vision: this token sees in the dark up to `rangeFt` (0 = only lit areas). */
  vision?: TokenVision;
  /** Silhouette override (Phase 6.7); unset falls back to the group's default shape. */
  shape?: TokenShape;
  /** For image tokens: "framed" clips the image in the shape, "raw" shows the bare image. */
  imageFit?: "framed" | "raw";
  /** For "item" tokens: the catalog item this represents (double-click → Item Sheet). */
  itemId?: string | null;
  /** Size in grid cells (diameter). Unset → the scene/campaign default. 1 = Medium. */
  size?: number;
  /**
   * Heading in degrees (0 = up/north, clockwise). Absent = no facing arrow. Phase 7.
   * Shares the heading with Phase 6's directional-vision wedge.
   */
  facing?: number;
};

/** Named token sizes (grid cells across). Used by the size pickers. */
export const TOKEN_SIZES = [
  { id: "tiny", label: "Tiny", cells: 0.5 },
  { id: "medium", label: "Medium", cells: 1 },
  { id: "large", label: "Large", cells: 2 },
  { id: "huge", label: "Huge", cells: 3 },
  { id: "gargantuan", label: "Gargantuan", cells: 4 },
] as const;
export const DEFAULT_TOKEN_SIZE = 1;
export const clampTokenSize = (n: number) => Math.min(Math.max(n, 0.25), 10);

/** Human label for a token size in cells, e.g. "Medium · 1×" or "1.5×". */
export function tokenSizeLabel(cells: number): string {
  const named = TOKEN_SIZES.find((s) => s.cells === cells);
  const mult = `${Number.isInteger(cells) ? cells : cells.toFixed(2)}×`;
  return named ? `${named.label} · ${mult}` : mult;
}

/** Per-group default token shape (Phase 6.7). */
export type TokenShapeDefaults = { player: TokenShape; enemy: TokenShape; item: TokenShape };
export const DEFAULT_TOKEN_SHAPES: TokenShapeDefaults = {
  player: "circle",
  enemy: "circle",
  item: "diamond",
};

export type TokenVision = {
  enabled: boolean;
  /** Darkvision range in feet; 0 = sees lit areas only. */
  rangeFt: number;
};

export const CONDITIONS = [
  { id: "blinded", label: "Blinded", emoji: "🙈" },
  { id: "charmed", label: "Charmed", emoji: "💘" },
  { id: "deafened", label: "Deafened", emoji: "🙉" },
  { id: "exhaustion", label: "Exhaustion", emoji: "🥵" },
  { id: "frightened", label: "Frightened", emoji: "😱" },
  { id: "grappled", label: "Grappled", emoji: "✊" },
  { id: "incapacitated", label: "Incapacitated", emoji: "😵" },
  { id: "invisible", label: "Invisible", emoji: "👻" },
  { id: "paralyzed", label: "Paralyzed", emoji: "⚡" },
  { id: "petrified", label: "Petrified", emoji: "🗿" },
  { id: "poisoned", label: "Poisoned", emoji: "🤢" },
  { id: "prone", label: "Prone", emoji: "🛌" },
  { id: "restrained", label: "Restrained", emoji: "⛓️" },
  { id: "stunned", label: "Stunned", emoji: "💫" },
  { id: "unconscious", label: "Unconscious", emoji: "💤" },
  { id: "concentrating", label: "Concentrating", emoji: "🎯" },
] as const;

const CONDITION_IDS = new Set<string>(CONDITIONS.map((condition) => condition.id));

/** One combatant in the initiative order. */
export type CombatEntry = {
  id: string;
  tokenId: string | null;
  sheetId: string | null;
  name: string;
  /** null until rolled — unrolled entries sort last with a "waiting" badge. */
  initiative: number | null;
  /** Tiebreaker: higher DEX score acts first on equal initiative. */
  dexScore: number;
  hasRolled: boolean;
  /** Masked to "???" for players (hidden tokens, Phase 5). */
  hidden?: boolean;
};

export type CombatState = {
  round: number;
  turnIndex: number;
  entries: CombatEntry[];
};

export type HitPoints = { current: number; max: number; temp?: number };

/**
 * Directory folder. Flat for now. `kind` is the tree it belongs to:
 * - "actor" — the Actors sidebar (PCs + NPCs combined roster)
 * - "npc"   — the NPCs page's own tree (independent from the Actors sidebar)
 * - "item"  — the Items directory (shared by the Items sidebar and Items page)
 */
export type Folder = {
  id: string;
  name: string;
  kind: "actor" | "npc" | "item";
  /** Manual ordering among sibling folders (fractional insertion); unset sorts last by name. */
  sortOrder?: number;
};

/** Item Sheet categories & rarities (Phase 6.7). */
export const ITEM_TYPES = [
  "weapon",
  "armor",
  "consumable",
  "gear",
  "treasure",
  "tool",
  "wondrous",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "very-rare",
  "legendary",
  "artifact",
] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/**
 * How an uploaded image is fitted into a frame: a focal point (`x`,`y` in 0..1) plus a
 * `zoom` (≥1). The image always covers the frame (no stretch); the focal point pans it and
 * zoom scales it. Default is centered at 1× (plain cover).
 */
export type IconCrop = { x: number; y: number; zoom: number };
export const DEFAULT_ICON_CROP: IconCrop = { x: 0.5, y: 0.5, zoom: 1 };
export const MAX_ICON_ZOOM = 4;

export function normalizeIconCrop(crop: unknown): IconCrop {
  const c = (crop ?? {}) as Partial<IconCrop>;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    x: num(c.x, 0.5, 0, 1),
    y: num(c.y, 0.5, 0, 1),
    zoom: num(c.zoom, 1, 1, MAX_ICON_ZOOM),
  };
}

/**
 * Portraits and item icons render into a square frame, so the crop UI locks its
 * box to a 1:1 aspect. (Kept as a constant so the frame CSS, the modal, and the
 * conversion helpers below all agree on the same target aspect.)
 */
export const PORTRAIT_ASPECT = 1;

/**
 * A crop selection expressed as a rectangle over the *full* image, in normalized
 * (0..1) image coordinates. This is the shape the crop modal manipulates; it maps
 * bijectively to `IconCrop` (focal point + zoom) via the helpers below, so nothing
 * about how the crop is stored or rendered changes.
 */
export type CropRect = { left: number; top: number; width: number; height: number };

const clampRange = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Forward transform: `IconCrop` → the crop rectangle the modal displays over the
 * full image. Mirrors `CroppableImage`'s cover-fit math: `cover = max(fw/nw, fh/nh)`,
 * so the frame shows a window whose normalized size is `1/zoom` on the axis that
 * constrains the cover, and less on the other axis. `imgAspect = naturalW/naturalH`,
 * `frameAspect = frameW/frameH`.
 */
export function iconCropToRect(crop: IconCrop, imgAspect: number, frameAspect: number): CropRect {
  if (!Number.isFinite(imgAspect) || imgAspect <= 0 || !Number.isFinite(frameAspect) || frameAspect <= 0)
    return { left: 0, top: 0, width: 1, height: 1 };
  const c = normalizeIconCrop(crop);
  const constrainByHeight = imgAspect >= frameAspect;
  const width = constrainByHeight ? frameAspect / imgAspect / c.zoom : 1 / c.zoom;
  const height = constrainByHeight ? 1 / c.zoom : imgAspect / frameAspect / c.zoom;
  return {
    left: c.x * (1 - width),
    top: c.y * (1 - height),
    width,
    height,
  };
}

/**
 * Inverse transform: a crop rectangle → `IconCrop`. `zoom` comes from the box size on
 * the cover-constraining axis; the focal point is the box position within the pan range
 * (`1 - boxSize`), falling back to centered (0.5) when that axis fills the frame.
 */
export function rectToIconCrop(rect: CropRect, imgAspect: number, frameAspect: number): IconCrop {
  if (!Number.isFinite(imgAspect) || imgAspect <= 0 || !Number.isFinite(frameAspect) || frameAspect <= 0)
    return { ...DEFAULT_ICON_CROP };
  const constrainByHeight = imgAspect >= frameAspect;
  const constrainSize = constrainByHeight ? rect.height : rect.width;
  const zoom = clampRange(constrainSize > 0 ? 1 / constrainSize : 1, 1, MAX_ICON_ZOOM);
  const eps = 1e-6;
  const x = rect.width < 1 - eps ? clampRange(rect.left / (1 - rect.width), 0, 1) : 0.5;
  const y = rect.height < 1 - eps ? clampRange(rect.top / (1 - rect.height), 0, 1) : 0.5;
  return { x, y, zoom };
}

/**
 * Snap an arbitrary (possibly off-aspect or out-of-bounds) rectangle back to a valid crop:
 * lock it to the frame aspect, keep the cover-constraining axis within `[1/MAX_ICON_ZOOM, 1]`
 * (so zoom stays in `[1, MAX_ICON_ZOOM]`), and clamp the box inside the image. Used after
 * every drag/resize/zoom interaction in the modal.
 */
export function clampCropRect(rect: CropRect, imgAspect: number, frameAspect: number): CropRect {
  if (!Number.isFinite(imgAspect) || imgAspect <= 0 || !Number.isFinite(frameAspect) || frameAspect <= 0)
    return { left: 0, top: 0, width: 1, height: 1 };
  const constrainByHeight = imgAspect >= frameAspect;
  const ratio = frameAspect / imgAspect; // width / height for an aspect-locked box
  const minSize = 1 / MAX_ICON_ZOOM;
  let width: number;
  let height: number;
  if (constrainByHeight) {
    height = clampRange(rect.height, minSize, 1);
    width = height * ratio;
  } else {
    width = clampRange(rect.width, minSize, 1);
    height = width / ratio;
  }
  return {
    left: clampRange(rect.left, 0, 1 - width),
    top: clampRange(rect.top, 0, 1 - height),
    width,
    height,
  };
}

/** A catalog item (DM-side library). Dragging one onto a sheet copies its name. */
export type ItemRecord = {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  iconCrop: IconCrop;
  folderId: string | null;
  /** Manual directory ordering (fractional insertion); unset sorts last by name. */
  sortOrder?: number;
  /** Item Sheet fields (Phase 6.7), all optional for back-compat. */
  type?: ItemType;
  rarity?: ItemRarity;
  quantity?: number;
  weight?: number;
  /** Free-form worth, e.g. "5000 gp". */
  value?: string;
  attunement?: boolean;
  /** Weapon damage expression, e.g. "1d6+3" (Phase 7). */
  damage?: string;
  /** Damage type, e.g. "slashing". */
  damageType?: string;
  /** Free-form properties/tags (e.g. "Finesse", "Two-Handed"). */
  properties?: string[];
  /** Whether this item can be equipped (weapons/armor). */
  equippable?: boolean;
  /** Attack roll bonus for weapons. */
  toHit?: number;
};

/** Inventory row category (Phase 7) — drives the grouped Inventory tables. */
export const INVENTORY_CATEGORIES = ["weapon", "equipment", "consumable", "loot"] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/**
 * One row of a sheet's inventory (Phase 7 v2). Rows are SELF-CONTAINED display copies —
 * the item catalog is DM-only redacted, so a player's rows must carry their own
 * name/weight/price/damage. `itemId` is a DM-side catalog link only.
 */
export type InventoryEntry = {
  /** Stable row key (expand/drag/favorites). Legacy rows backfilled `inv-${index}`. */
  id: string;
  itemId: string | null;
  name: string;
  qty: number;
  note: string;
  category: InventoryCategory;
  /** Per-unit weight (lb). */
  weight?: number;
  /** Free-form price, e.g. "5 gp". */
  price?: string;
  charges?: { current: number; max: number };
  equipped?: boolean;
  attuned?: boolean;
  /** Weapon-ish: an equipped row with `damage` surfaces as a derived attack row. */
  toHit?: number;
  damage?: string;
  damageType?: string;
  /** Auto to-hit ability (see AttackEntry.toHitAbility). */
  toHitAbility?: string;
  /** Melee/ranged tag — routes the global weapon attack/damage trait bonuses. */
  range?: "melee" | "ranged";
  /** Expand-body text. */
  description?: string;
};

/** A PC attack or NPC action row (shared model). */
export type AttackEntry = {
  id: string;
  name: string;
  toHit: number;
  damage: string;
  damageType?: string;
  uses?: { current: number; max: number };
  /** Subtitle / expand body, e.g. "Natural · Action". */
  notes?: string;
  itemId?: string | null;
  /**
   * Auto to-hit (rules engine, PC): an ability id ("str"/"dex"/…) or "spell" (the
   * spellcasting ability). When set, to-hit derives as mod + prof and the manual
   * `toHit` is ignored. Unset = manual to-hit (NPC actions, homebrew).
   */
  toHitAbility?: string;
  /** Melee/ranged tag — routes the global weapon attack/damage trait bonuses. */
  range?: "melee" | "ranged";
};

/** A class/species feature or feat row. */
export type FeatureEntry = {
  id: string;
  name: string;
  source: "class" | "species" | "feat" | "other";
  uses?: { current: number; max: number };
  recovery?: "sr" | "lr";
  description: string;
};

/** A spell row (manual — no derived slot math). */
export type SpellEntry = {
  id: string;
  name: string;
  /** 0 = cantrip … 9. */
  level: number;
  components?: string;
  time?: string;
  range?: string;
  target?: string;
  /** Damage/heal expression. */
  roll?: string;
  prepared?: boolean;
  description?: string;
};

/** A passive/active effect row. */
export type EffectEntry = {
  id: string;
  name: string;
  source?: string;
  enabled: boolean;
  description?: string;
};

/** A tool proficiency row. */
export type ToolEntry = { id: string; name: string; abilityId?: string; mod: number };

/** Generates a stable client-side row id, e.g. "inv-1a2b3c4d". */
export function rowId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Builds a new inventory row with defaults (Phase 7). */
export function createInventoryRow(partial: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: rowId("inv"),
    itemId: null,
    name: "New item",
    qty: 1,
    note: "",
    category: "equipment",
    ...partial,
  };
}

/** Maps a catalog item's `type` to the inventory table category it lands in. */
export function inventoryCategoryForItemType(type: ItemType | undefined): InventoryCategory {
  switch (type) {
    case "weapon":
      return "weapon";
    case "consumable":
      return "consumable";
    case "treasure":
      return "loot";
    default:
      return "equipment";
  }
}

/**
 * Builds a self-contained inventory row from a catalog item (drop-onto-sheet). Copies
 * display fields so the row survives catalog deletion and player redaction.
 */
export function inventoryRowFromItem(item: ItemRecord): InventoryEntry {
  return createInventoryRow({
    itemId: item.id,
    name: item.name,
    qty: 1,
    category: inventoryCategoryForItemType(item.type),
    ...(typeof item.weight === "number" ? { weight: item.weight } : {}),
    ...(item.value ? { price: item.value } : {}),
    ...(item.damage ? { damage: item.damage } : {}),
    ...(item.damageType ? { damageType: item.damageType } : {}),
    ...(typeof item.toHit === "number" ? { toHit: item.toHit } : {}),
    ...(item.equippable ? { equipped: false } : {}),
  });
}

/**
 * One class a character has levels in (multiclassing). The `isFirstClass` entry was
 * taken at character level 1 — it gets the full starting proficiencies; classes added
 * later grant only the smaller multiclass set. Exactly one entry carries the flag.
 */
export type ClassEntry = {
  id: string;
  className: string;
  subclassName: string;
  /** Levels in THIS class (1..20); the sheet's `level` is the sum across entries. */
  level: number;
  isFirstClass: boolean;
};

export const MAX_CLASSES = 5;

/** A class resource chip (name + current/max). */
export type ResourceEntry = { id: string; name: string; current: number; max: number };

/** Coin purse. */
export type Currency = { cp: number; sp: number; ep: number; gp: number; pp: number };

/** Death-save tracker: filled success/failure slots (0..3 each). PC-only. */
export type DeathSaves = { successes: number; failures: number };

/** Hit-dice pool (die is free text, e.g. "d8"). */
export type HitDice = { current: number; max: number; die: string };

/**
 * Caster progression for auto spell-slot maximums (rules engine): full (wizard/cleric…),
 * half (paladin/ranger), third (eldritch knight), pact (warlock — slots refresh on short
 * rest). "none" keeps slot maximums manual.
 */
export const CASTER_TYPES = ["none", "full", "half", "third", "pact"] as const;
export type CasterType = (typeof CASTER_TYPES)[number];

/**
 * Spellcasting numbers. When `abilityId` is set on a PC sheet the rules engine derives
 * attack/DC (8 + prof + mod) and `attackBonus`/`saveDc` become the manual fallback used
 * while it's unset (and always on NPCs).
 */
export type Spellcasting = {
  abilityId: string;
  attackBonus: number;
  saveDc: number;
  casterType: CasterType;
};

export type CharacterSheet = {
  characterName: string;
  playerName: string;
  characterClass: string;
  subclass: string;
  /**
   * Multiclassing (empty = derive from characterClass/level). When non-empty this is
   * authoritative: the normalizer syncs `characterClass`/`subclass` from the first-class
   * entry, and with 2+ entries `level` becomes the sum of per-class levels.
   */
  classes: ClassEntry[];
  level: number;
  xp: number;
  race: string;
  /** Background (Priest, Acolyte …). */
  background: string;
  /** Creature type line, e.g. "Humanoid" / "Construct". */
  creatureType: string;
  /** Challenge rating (NPC). "" for PCs. */
  cr: string;
  /** Source ref, e.g. "MM pg. 19". */
  source: string;
  /** Original class for multiclassing (Special Traits page). */
  originalClass: string;
  alignment: string;
  size: string;
  age: string;
  height: string;
  weight: string;
  eyes: string;
  skin: string;
  hair: string;
  /** Biography detail fields (Phase 7). */
  faith: string;
  gender: string;
  ideals: string;
  bonds: string;
  flaws: string;
  personality: string;
  appearance: string;
  backstoryPersonality: string;
  notes: string;
  inventory: InventoryEntry[];
  iconUrl: string | null;
  iconCrop: IconCrop;
  /** Combat block (game-loop resources kept outside the sheet template). */
  hp: HitPoints;
  ac: number;
  initiative: number;
  /** Walking speed (ft). */
  speed: number;
  proficiencyBonus: number;
  deathSaves: DeathSaves;
  hitDice: HitDice;
  /** Free-form senses line, e.g. "Blindsight 60 ft, Passive Perception 6". */
  senses: string;
  resources: ResourceEntry[];
  /** Player-entered ability scores keyed by AbilityDef.id (e.g. 16). */
  abilityScores: Record<string, number>;
  /** Manual modifiers added to each skill, keyed by DerivedStatDef.id. */
  skillMods: Record<string, number>;
  /** Manual modifiers added to each saving throw, keyed by DerivedStatDef.id. */
  saveMods: Record<string, number>;
  /** Proficiency dots per skill: 0 none / 1 proficient / 2 expertise (display-only). */
  skillProfs: Record<string, number>;
  /** Proficiency dots per save: 0 none / 1 proficient (display-only). */
  saveProfs: Record<string, number>;
  tools: ToolEntry[];
  languages: string[];
  weaponProfs: string[];
  armorProfs: string[];
  resistances: string[];
  immunities: string[];
  conditionImmunities: string[];
  vulnerabilities: string[];
  currency: Currency;
  /** Manual carry capacity (lb); carried weight is a client-side display sum. */
  carryCapacity: number;
  carryMultiplier: number;
  attunementMax: number;
  attacks: AttackEntry[];
  features: FeatureEntry[];
  spells: SpellEntry[];
  /** Spell slots per level, keys "1".."9". */
  spellSlots: Record<string, { current: number; max: number }>;
  spellcasting: Spellcasting;
  effects: EffectEntry[];
  /** Feat/species-trait toggle + numeric-override map (defs live client-side). */
  traits: Record<string, boolean | number>;
  /** Favorited action/item ids, e.g. "item:<id>". */
  favorites: string[];
  /**
   * Per-stat manual overrides (rules engine). Keyed by override key ("prof", "init",
   * "skill-stealth", "save-dex", "spell-dc", "spell-attack", "carry-capacity",
   * "hit-dice-max"); a present key replaces that stat's derived value verbatim.
   * Empty = fully automatic. PC-only — the engine is off for NPC sheets.
   */
  overrides: Record<string, number>;
};

export type AbilityDef = {
  id: string;
  name: string;
  abbr: string;
};

/// <summary>
/// A skill or saving throw definition. Tagged union on `mode` so new computation
/// modes (e.g. a future "formula") can be added without reworking call sites.
/// </summary>
export type DerivedStatDef =
  | { id: string; name: string; mode: "ability"; abilityId: string }
  | { id: string; name: string; mode: "constant" };

export type SheetTemplate = {
  abilities: AbilityDef[];
  skills: DerivedStatDef[];
  saves: DerivedStatDef[];
};

type LegacyCharacterSheet = Partial<CharacterSheet> & {
  name?: string;
  species?: string;
  campaign?: string;
  deityPatron?: string;
  pronouns?: string;
  portraitUrl?: string | null;
  backstory?: string;
  personalityTraits?: string;
  allies?: string;
  treasureGoals?: string;
};

/** The reveal/collapse granularity of a character sheet. */
export type SheetSectionId =
  | "identity"
  | "combat"
  | "abilities"
  | "saves"
  | "skills"
  | "inventory"
  | "features"
  | "spells"
  | "effects"
  | "traits"
  | "biography"
  | "notes";

export const SHEET_SECTIONS: Array<{ id: SheetSectionId; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "combat", label: "Combat" },
  { id: "abilities", label: "Abilities" },
  { id: "saves", label: "Saving throws" },
  { id: "skills", label: "Skills" },
  { id: "inventory", label: "Inventory" },
  { id: "features", label: "Features" },
  { id: "spells", label: "Spells" },
  { id: "effects", label: "Effects" },
  { id: "traits", label: "Special traits" },
  { id: "biography", label: "Biography" },
  { id: "notes", label: "Notes" },
];

/**
 * Which CharacterSheet fields belong to each section — drives server-side redaction.
 * INVARIANT: every CharacterSheet key must appear in EXACTLY ONE section (a unit test
 * guards this). A field missing from every section vanishes for players via the
 * redaction copy-loop; a field in two sections is ambiguous.
 */
export const SHEET_SECTION_FIELDS: Record<SheetSectionId, Array<keyof CharacterSheet>> = {
  identity: [
    "characterName",
    "playerName",
    "characterClass",
    "subclass",
    "classes",
    "level",
    "xp",
    "race",
    "background",
    "creatureType",
    "cr",
    "source",
    "originalClass",
    "iconUrl",
    "iconCrop",
  ],
  combat: [
    "hp",
    "ac",
    "initiative",
    "speed",
    "proficiencyBonus",
    "deathSaves",
    "hitDice",
    "senses",
    "resources",
  ],
  abilities: ["abilityScores"],
  saves: ["saveMods", "saveProfs"],
  skills: [
    "skillMods",
    "skillProfs",
    "tools",
    "languages",
    "weaponProfs",
    "armorProfs",
    "resistances",
    "immunities",
    "conditionImmunities",
    "vulnerabilities",
  ],
  inventory: ["inventory", "currency", "carryCapacity", "carryMultiplier", "attunementMax"],
  features: ["features", "attacks"],
  spells: ["spells", "spellSlots", "spellcasting"],
  effects: ["effects"],
  traits: ["traits", "favorites", "overrides"],
  biography: [
    "alignment",
    "size",
    "age",
    "height",
    "weight",
    "eyes",
    "skin",
    "hair",
    "faith",
    "gender",
    "ideals",
    "bonds",
    "flaws",
    "personality",
    "appearance",
    "backstoryPersonality",
  ],
  notes: ["notes"],
};

export type SheetKind = "pc" | "npc";

/// <summary>
/// A first-class sheet entity. PC sheets keep id === slotId; NPC sheets are
/// DM-created and hidden from players section-by-section until revealed.
/// Multiple tokens may share one sheet (six goblins, one stat block).
/// </summary>
export type SheetRecord = {
  id: string;
  kind: SheetKind;
  ownerSlotId: string | null;
  data: CharacterSheet;
  /** Per-section player visibility. PC sheets are always fully revealed. */
  revealed: Record<SheetSectionId, boolean>;
  /** Actors-sidebar folder ("actor" tree), or null for the root. */
  folderId: string | null;
  /** Manual ordering in the Actors sidebar (fractional insertion); unset sorts last by name. */
  sortOrder?: number;
  /** NPCs-page folder ("npc" tree) — independent from the Actors sidebar. NPC sheets only. */
  npcFolderId?: string | null;
  /** Manual ordering in the NPCs page. */
  npcSortOrder?: number;
  /** Set only on outbound copies whose hidden sections were stripped server-side. */
  redacted?: boolean;
};

export function createRevealedFlags(value: boolean): Record<SheetSectionId, boolean> {
  const flags = {} as Record<SheetSectionId, boolean>;
  for (const section of SHEET_SECTIONS) {
    flags[section.id] = value;
  }
  return flags;
}

export function createPcSheetRecord(slotId: string, name: string): SheetRecord {
  return {
    id: slotId,
    kind: "pc",
    ownerSlotId: slotId,
    data: createDefaultSheet(name),
    revealed: createRevealedFlags(true),
    folderId: null,
  };
}

export function createNpcSheetRecord(id: string, name: string): SheetRecord {
  return {
    id,
    kind: "npc",
    ownerSlotId: null,
    data: createDefaultSheet(name),
    revealed: createRevealedFlags(false),
    folderId: null,
  };
}

/// <summary>
/// Normalizes a persisted sheet record: fills missing reveal flags and forces
/// PC sheets fully revealed. Preserves the outbound `redacted` marker so the
/// client can render hidden sections honestly instead of as zero-filled data.
/// </summary>
export function normalizeSheetRecord(
  record: Partial<SheetRecord> & { id: string },
  fallbackName: string,
): SheetRecord {
  const kind: SheetKind = record.kind === "npc" ? "npc" : "pc";
  const revealed = createRevealedFlags(kind === "pc");
  if (kind === "npc" && record.revealed && typeof record.revealed === "object") {
    for (const section of SHEET_SECTIONS) {
      revealed[section.id] = Boolean(record.revealed[section.id]);
    }
  }
  return {
    id: record.id,
    kind,
    ownerSlotId: kind === "pc" ? (record.ownerSlotId ?? record.id) : null,
    data: normalizeCharacterSheet(record.data, fallbackName),
    revealed,
    folderId: typeof record.folderId === "string" ? record.folderId : null,
    ...(typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
      ? { sortOrder: record.sortOrder }
      : {}),
    ...(typeof record.npcFolderId === "string" ? { npcFolderId: record.npcFolderId } : {}),
    ...(typeof record.npcSortOrder === "number" && Number.isFinite(record.npcSortOrder)
      ? { npcSortOrder: record.npcSortOrder }
      : {}),
    ...(record.redacted ? { redacted: true } : {}),
  };
}

/// <summary>
/// Validates a persisted catalog item.
/// </summary>
export function normalizeItem(item: Partial<ItemRecord> & { id: string }): ItemRecord {
  const num = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : undefined;
  const quantity = num(item.quantity, 100000);
  const weight = num(item.weight, 100000);
  return {
    id: item.id,
    name: typeof item.name === "string" && item.name.trim() ? item.name : "Item",
    description: typeof item.description === "string" ? item.description : "",
    iconUrl: typeof item.iconUrl === "string" ? item.iconUrl : null,
    iconCrop: normalizeIconCrop(item.iconCrop),
    folderId: typeof item.folderId === "string" ? item.folderId : null,
    ...(typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder)
      ? { sortOrder: item.sortOrder }
      : {}),
    ...(ITEM_TYPES.includes(item.type as ItemType) ? { type: item.type } : {}),
    ...(ITEM_RARITIES.includes(item.rarity as ItemRarity) ? { rarity: item.rarity } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(typeof item.value === "string" && item.value.trim() ? { value: item.value.slice(0, 60) } : {}),
    ...(item.attunement ? { attunement: true } : {}),
    ...(typeof item.damage === "string" && item.damage.trim() ? { damage: item.damage.slice(0, 40) } : {}),
    ...(typeof item.damageType === "string" && item.damageType.trim()
      ? { damageType: item.damageType.slice(0, 40) }
      : {}),
    ...(Array.isArray(item.properties)
      ? {
          properties: item.properties
            .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            .slice(0, 12)
            .map((p) => p.slice(0, 30)),
        }
      : {}),
    ...(item.equippable ? { equippable: true } : {}),
    ...(typeof item.toHit === "number" && Number.isFinite(item.toHit)
      ? { toHit: Math.round(item.toHit) }
      : {}),
  };
}

export type PlayerSlot = {
  id: string;
  name: string;
};

export type ConnectedPlayer = {
  clientId: string;
  playerId: string;
  displayName: string;
};

/**
 * One labeled component of a roll's total (Phase 7). Built server-side so the LogPanel
 * can render color-coded chips that sum to the total. `die` = a die result, `ability`/
 * `prof`/`item` = typed modifiers, `flat` = a bare number.
 */
export type RollPart = {
  kind: "die" | "ability" | "prof" | "item" | "flat";
  value: number;
  label?: string;
};

/** Max labeled parts kept on a roll (server-enforced). */
export const MAX_ROLL_PARTS = 24;

/**
 * A structured sheet roll (Phase 7). The server resolves it FROM the sheet it owns and
 * builds the color-coded `parts` breakdown — the client never declares the modifiers.
 * The seam for a future rules engine (it reads `traits`); `ROLL_DICE` stays for freeform.
 */
export type CheckSpec =
  | { kind: "ability"; abilityId: string }
  | { kind: "skill"; statId: string }
  | { kind: "save"; statId: string }
  | { kind: "tool"; toolId: string }
  | { kind: "initiative" }
  | { kind: "attack"; rowId: string }
  /** `crit` doubles the weapon dice (+ melee-crit-damage-dice extras on melee rows). */
  | { kind: "damage"; rowId: string; crit?: boolean }
  | { kind: "spell-attack" };

export type DiceRoll = {
  id: string;
  rollerName: string;
  rollerId: string;
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
  timestamp: number;
  /** Advantage/disadvantage: the expression was rolled twice, best/worst total kept. */
  adv?: "adv" | "dis";
  /** The discarded roll's total when adv/dis was used. */
  otherTotal?: number;
  /** Color-coded breakdown (Phase 7). Absent on freeform/legacy rolls. */
  parts?: RollPart[];
  /** Attack roll met the crit threshold (natural die ≥ 20, or lower via traits). */
  crit?: boolean;
};

/** One entry in the unified roll/action/chat log. */
export type LogEntry =
  | {
      id: string;
      t: number;
      kind: "roll";
      roll: DiceRoll;
      /** Who the roll was made as (the character), not necessarily who clicked. */
      actor: { name: string; sheetId?: string };
      /** e.g. "Stealth check" for sheet-integrated rolls. */
      label?: string;
      /** Secret DM roll — values masked in player frames. */
      dmOnly?: boolean;
      /** Set on outbound player copies of secret rolls: values are blanked. */
      masked?: boolean;
    }
  | { id: string; t: number; kind: "event"; text: string; dmOnly?: boolean }
  | {
      id: string;
      t: number;
      kind: "chat";
      from: string;
      /** Stable sender id (playerId or "dm") — drives whisper visibility. */
      fromId: string;
      text: string;
      /** Whisper target (slotId or "dm"); visible only to sender, target, and DM. */
      whisperTo?: string;
    };

export type GameState = {
  roomId: string;
  dmClientId: string | null;
  activeSceneId: string;
  scenes: Scene[];
  tokens: Token[];
  viewport: Viewport;
  playerSlots: PlayerSlot[];
  /** All sheets (PC + NPC) keyed by sheet id. PC sheet ids equal their slot ids. */
  sheets: Record<string, SheetRecord>;
  connectedPlayers: ConnectedPlayer[];
  /** Unified roll/action/chat log, capped at MAX_LOG_ENTRIES server-side. */
  log: LogEntry[];
  /** DM-only scratchpad — redacted to "" for players. */
  dmNotes: string;
  /** Active combat/initiative tracker, or null out of combat. */
  combat: CombatState | null;
  /** Actor/item directory folders (DM-only; stripped for players). */
  folders: Folder[];
  /** Item catalog (DM-only; sheets copy item names into their inventories). */
  items: Record<string, ItemRecord>;
  /** DM-managed handout images. Players receive only the ones granted to them (redacted). */
  handouts: Handout[];
  /** Per-group default token shapes (Phase 6.7). */
  tokenShapeDefaults?: TokenShapeDefaults;
  /** Default token size in grid cells (diameter), applied to tokens without their own `size`. */
  defaultTokenSize?: number;
  /**
   * Whether players may use the Draw tool (persistent/scribble annotations). Off by
   * default; the shift-drag pointer arrow is gated separately by `playersCanPoint`.
   */
  playersCanDraw: boolean;
  /** Whether players may move/rotate their own characters' tokens. On by default. */
  playersCanMove: boolean;
  /** Whether players may draw shift-drag dotted pointer arrows. On by default. */
  playersCanPoint: boolean;
  /**
   * DM master switch: when on, every token shows its HP bar to all players, overriding the
   * per-token default of hidden. Off by default (players see HP only for tokens the DM turned
   * on individually in the Token panel). Only forces the bar — numeric values stay per-token.
   */
  showAllTokenHp: boolean;
  /**
   * DM master switch: when on, the on-board token tray (the top-center strip of PC/NPC portrait
   * chips) is hidden for everyone — the DM included. Off by default. Purely a display toggle; it
   * changes nothing about who's on the board or what they can see.
   */
  hideTokenTray: boolean;
  /**
   * Whether new image uploads are downscaled + re-encoded to WebP on the client before they're
   * stored (portraits/tokens ≤1024px, maps ≤2560px). On by default: much smaller files — faster
   * to load/decode and far easier on the 10 GB storage budget. Only affects NEW uploads.
   */
  optimizeUploads: boolean;
  /**
   * DM-forced UI theme (Phase 8): when set, every client renders this theme +
   * accent instead of their own device preference. null (default) = players
   * pick their own look in Settings.
   */
  uiOverride: UiThemeOverride | null;
};

/** Accent variations of the Quill & Ember skin (Phase 8). "sky" is the default. */
export const UI_ACCENTS = [
  "sky",
  "moss",
  "ember",
  "lapis",
  "amethyst",
  "rose",
  "teal",
  "crimson",
] as const;
export type UiAccent = (typeof UI_ACCENTS)[number];
export const UI_ACCENT_LABEL: Record<UiAccent, string> = {
  sky: "Sky (default)",
  moss: "Moss & Loam",
  ember: "Ember & Wine",
  lapis: "Tide & Lapis",
  amethyst: "Amethyst & Dusk",
  rose: "Rose & Bramble",
  teal: "Teal & Reef",
  crimson: "Crimson & Garnet",
};
export type UiTheme = "day" | "night";
/**
 * DM table-look override. Each dimension is independent: a null theme or accent means
 * "not overridden" — players keep their own for that one. So the DM can force just the
 * theme, just the accent, both, or (null/null, or a null override) neither.
 */
export type UiThemeOverride = { theme: UiTheme | null; accent: UiAccent | null };

export function normalizeUiOverride(value: unknown): UiThemeOverride | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<UiThemeOverride>;
  return {
    theme: candidate.theme === "night" || candidate.theme === "day" ? candidate.theme : null,
    accent: UI_ACCENTS.includes(candidate.accent as UiAccent) ? (candidate.accent as UiAccent) : null,
  };
}

export const MAX_LOG_ENTRIES = 100;

/**
 * A full-campaign backup (Phase 7). `state` is exactly what the server persists (durable
 * GameState minus connection fields). Distinct from the v1 `CampaignManifest` (scenes only),
 * which IMPORT_CAMPAIGN still accepts for back-compat.
 */
export type CampaignExport = { version: 2; exportedAt: number; state: GameState };
/** Max serialized import size (under the WS frame limit; images are URLs, never blobs). */
export const MAX_CAMPAIGN_BYTES = 900_000;

/** Pre-Phase-1/2 persisted states: slot-keyed sheets, roll-only dice log. */
type LegacyGameStateFields = {
  characterSheets?: Record<string, CharacterSheet>;
  publicDiceLog?: DiceRoll[];
};

export type JoinMessage =
  | { type: "JOIN"; role: "dm"; displayName: string; roomKey: string }
  | { type: "JOIN"; role: "player"; slotId: string; roomKey: string };

export type ClientMessage =
  | JoinMessage
  | { type: "UPDATE_VIEWPORT"; viewport: Viewport }
  | { type: "SET_SCENE"; sceneId: string }
  | { type: "ADD_SCENE"; scene: Scene }
  | { type: "UPDATE_SCENE"; scene: Scene }
  /** Rotate the scene 90° CW: map image, geometry, AND its tokens — atomic, always live. */
  | { type: "ROTATE_SCENE"; sceneId: string }
  | { type: "REMOVE_SCENE"; sceneId: string }
  /**
   * Open/close a scene for player viewing alongside the active one. A dedicated tiny
   * message (not UPDATE_SCENE) so the at-the-table toggle can't clobber a concurrent
   * ScenesPage draft edit.
   */
  | { type: "SET_SCENE_PLAYER_VISIBLE"; sceneId: string; visible: boolean }
  | { type: "ADD_TOKEN"; token: Token }
  | { type: "MOVE_TOKEN"; tokenId: string; x: number; y: number; facing?: number }
  | { type: "UPDATE_TOKEN"; token: Token }
  | { type: "REMOVE_TOKEN"; tokenId: string }
  | { type: "SET_TOKEN_CONDITIONS"; tokenId: string; conditions: string[] }
  /** Partial patch: the server merges over the stored sheet, so editors send only touched fields. */
  | { type: "UPDATE_SHEET"; sheetId: string; sheet: Partial<CharacterSheet> }
  | { type: "CREATE_SHEET"; sheetId: string; name: string }
  | { type: "DUPLICATE_SHEET"; sheetId: string; newSheetId: string }
  | { type: "DELETE_SHEET"; sheetId: string }
  | { type: "SET_SHEET_REVEAL"; sheetId: string; section: SheetSectionId; revealed: boolean }
  /** Rest with real effects (Tier 3). Short rests may spend hit dice (server-rolled). */
  | { type: "REST"; sheetId: string; kind: "short" | "long"; spendHitDice?: number }
  | { type: "ADJUST_HP"; sheetId: string; delta: number }
  /** Spend one spell slot of `level` (1..9). DM any sheet; players own only. */
  | { type: "CAST_SPELL"; sheetId: string; level: number }
  /** Decrement a feature's uses. DM any sheet; players own only. */
  | { type: "USE_FEATURE"; sheetId: string; featureId: string }
  /** Decrement an inventory row's charges. DM any sheet; players own only. */
  | { type: "USE_ITEM_CHARGE"; sheetId: string; rowId: string }
  /** Server-rolled death saving throw: 10+ success, nat 1 = 2 failures, nat 20 = 1 HP. */
  | { type: "DEATH_SAVE"; sheetId: string }
  /**
   * DM-only: apply damage to a sheet respecting its resistance/immunity/vulnerability
   * pills (half / zero / double), temp HP first.
   */
  | { type: "APPLY_DAMAGE"; sheetId: string; amount: number; damageType?: string }
  | {
      type: "SET_SHEET_FOLDER";
      sheetId: string;
      folderId: string | null;
      sortOrder?: number;
      /** Which tree to file into: the Actors sidebar ("actor", default) or the NPCs page ("npc"). */
      tree?: "actor" | "npc";
    }
  | { type: "CREATE_FOLDER"; folderId: string; kind: Folder["kind"]; name: string }
  | { type: "RENAME_FOLDER"; folderId: string; name: string }
  | { type: "MOVE_FOLDER"; folderId: string; sortOrder: number }
  | { type: "DELETE_FOLDER"; folderId: string }
  | { type: "CREATE_ITEM"; itemId: string; name: string }
  | { type: "UPDATE_ITEM"; item: ItemRecord }
  | { type: "DUPLICATE_ITEM"; itemId: string; newItemId: string }
  | { type: "DELETE_ITEM"; itemId: string }
  | { type: "ADD_HANDOUT"; handout: Handout }
  /** Rename and/or edit the durable per-player visibility grants. */
  | { type: "UPDATE_HANDOUT"; handout: Handout }
  | { type: "REMOVE_HANDOUT"; handoutId: string }
  /** Pop the handout on targeted players' screens now; also auto-grants lasting visibility. */
  | { type: "SHOW_HANDOUT"; handoutId: string; to: "all" | string[] }
  | { type: "SET_TOKEN_DEFAULTS"; defaults: TokenShapeDefaults }
  | { type: "SET_DEFAULT_TOKEN_SIZE"; size: number }
  | { type: "UPDATE_DM_NOTES"; notes: string }
  | { type: "EXPORT_CAMPAIGN" }
  | { type: "IMPORT_CAMPAIGN"; manifest: CampaignManifest | CampaignExport }
  | { type: "ADD_PLAYER_SLOT"; name: string }
  | { type: "UPDATE_PLAYER_SLOT"; slot: PlayerSlot }
  | { type: "REMOVE_PLAYER_SLOT"; slotId: string }
  | { type: "KICK_PLAYER"; playerId: string }
  | {
      type: "ROLL_DICE";
      expression: string;
      private?: boolean;
      /** Roll attributed to a sheet (DM: any sheet; player: own only). */
      context?: { sheetId?: string; label?: string };
      adv?: "adv" | "dis";
    }
  | {
      /** Structured sheet roll — the server resolves modifiers + builds color parts. */
      type: "ROLL_CHECK";
      sheetId: string;
      check: CheckSpec;
      adv?: "adv" | "dis";
      private?: boolean;
      /**
       * The acting token (conditions like Poisoned grant adv/dis). Optional — without
       * it the server uses the sheet's single linked token when unambiguous.
       */
      tokenId?: string;
    }
  | { type: "SEND_CHAT"; text: string; whisperTo?: string }
  | {
      /** A physical 3D throw: the roller pre-simulated and recorded the exact motion. */
      type: "DICE_THROW_REQUEST";
      rollId: string;
      specs: DieSpec[];
      track: DiceTrack;
      modifier: number;
      trayCenter: WorldPoint;
      /** Roller's world-units-per-physics-unit — shared so every client places the
       *  dice at the same world footprint (dice are map-glued after landing). */
      worldScale?: number;
      context?: { sheetId?: string; label?: string };
      private?: boolean;
    }
  | { type: "COMBAT_START"; tokenIds: string[] }
  | { type: "COMBAT_ROLL_INITIATIVE" }
  | { type: "COMBAT_SET_INITIATIVE"; entryId: string; value: number }
  | { type: "COMBAT_NEXT" }
  | { type: "COMBAT_PREV" }
  | { type: "COMBAT_END" }
  /** Live ruler points (world coords, flat x,y) — transient relay, null = cleared. */
  | { type: "MEASURE"; sceneId: string; points: number[] | null }
  /** Live area template — transient relay like MEASURE, null = cleared. */
  | { type: "TEMPLATE"; sceneId: string; shape: TemplateShape | null }
  /** Live token drag position (world coords) — transient relay like MEASURE, null = drag ended. */
  | { type: "TOKEN_DRAG"; tokenId: string; pos: { x: number; y: number } | null }
  | { type: "ADD_ANNOTATION"; sceneId: string; annotation: Annotation }
  | { type: "REMOVE_ANNOTATION"; sceneId: string; annotationId: string }
  /** Edit an existing annotation in place (pins): note text and/or position. */
  | { type: "UPDATE_ANNOTATION"; sceneId: string; annotationId: string; text?: string; x?: number; y?: number }
  | { type: "CLEAR_ANNOTATIONS"; sceneId: string }
  | { type: "FOG_SET"; sceneId: string; enabled: boolean; inverted?: boolean }
  | { type: "FOG_REVEAL"; sceneId: string; shape: FogReveal }
  | { type: "FOG_RESET"; sceneId: string }
  | { type: "SET_PLAYERS_CAN_DRAW"; enabled: boolean }
  | { type: "SET_UI_OVERRIDE"; override: UiThemeOverride | null }
  | { type: "SET_PLAYERS_CAN_MOVE"; enabled: boolean }
  | { type: "SET_OPTIMIZE_UPLOADS"; enabled: boolean }
  | { type: "SET_PLAYERS_CAN_POINT"; enabled: boolean }
  | { type: "SET_SHOW_ALL_TOKEN_HP"; enabled: boolean }
  | { type: "SET_HIDE_TOKEN_TRAY"; enabled: boolean }
  /** Replace a scene's whole wall set — bulk ops only (clear all / paste). Granular edits below. */
  | { type: "SET_WALLS"; sceneId: string; walls: Wall[] }
  | { type: "ADD_WALL"; sceneId: string; wall: Wall }
  | { type: "UPDATE_WALL"; sceneId: string; wall: Wall }
  /** Upsert-by-id batch (chained draw, group move, clone, multi-config). */
  | { type: "UPDATE_WALLS"; sceneId: string; walls: Wall[] }
  | { type: "REMOVE_WALL"; sceneId: string; wallId: string }
  /** Player door click — open/close a door (server refuses when the door is locked). */
  | { type: "TOGGLE_DOOR"; sceneId: string; wallId: string }
  /** DM / config-panel: set a door's exact state (closed / open / locked). */
  | { type: "SET_DOOR_STATE"; sceneId: string; wallId: string; state: WallDoorState }
  | { type: "ADD_LIGHT"; sceneId: string; light: Light }
  | { type: "UPDATE_LIGHT"; sceneId: string; light: Light }
  | { type: "REMOVE_LIGHT"; sceneId: string; lightId: string };

export type ServerMessage =
  | { type: "STATE"; state: GameState; yourClientId: string; yourRole: Role | null }
  /** Lightweight DM pan/zoom delta — never triggers a full STATE broadcast. */
  | { type: "VIEWPORT"; viewport: Viewport }
  /**
   * A validated 3D throw for every client to replay. `faceValues` are the server's
   * CSPRNG results; they are OMITTED on non-DM copies of secret throws so those
   * clients render blank dice. Transient — never part of GameState.
   */
  | {
      type: "DICE_THROW";
      rollId: string;
      actorName: string;
      specs: DieSpec[];
      track: DiceTrack;
      trayCenter: WorldPoint;
      worldScale?: number;
      faceValues?: number[];
      secret?: boolean;
    }
  /** Another client's live ruler (transient; null points = ruler cleared). */
  | {
      type: "MEASURE";
      clientId: string;
      name: string;
      color: string;
      sceneId: string;
      points: number[] | null;
    }
  /** Another client's live area template (transient; null shape = cleared). */
  | {
      type: "TEMPLATE";
      clientId: string;
      name: string;
      color: string;
      sceneId: string;
      shape: TemplateShape | null;
    }
  /** Another client's live token drag (transient; null pos = dropped/cancelled). */
  | {
      type: "TOKEN_DRAG";
      clientId: string;
      tokenId: string;
      pos: { x: number; y: number } | null;
    }
  /**
   * Ephemeral "look at this now" push, sent only to targeted players. Self-contained
   * (name + URL, not just an id): broadcastState awaits persistState, so this frame can
   * arrive BEFORE the STATE frame that grants visibility — the popup must not depend on
   * state.handouts having caught up.
   */
  | { type: "HANDOUT_SHOW"; handout: { id: string; name: string; imageUrl: string | null } }
  | { type: "ERROR"; message: string }
  | { type: "JOINED"; role: Role; playerId: string }
  | { type: "KICKED"; message: string }
  /** Full-campaign backup, sent only to the requesting DM to download. */
  | { type: "CAMPAIGN_EXPORT"; manifest: CampaignExport };

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export const DEFAULT_SCENE_BACKGROUND = "#0d0f14";

/**
 * Quick-pick swatches for the BOARD BACKDROP (the tabletop around the map).
 * (Formerly SCENE_BACKGROUND_PRESETS for `scene.backgroundColor` — the color
 * UNDER the map image, which opaque maps cover completely, so that UI row was
 * dead in practice and was removed. The field itself remains: it still paints
 * under transparent/missing maps.)
 */
export const BOARD_BACKDROP_PRESETS = [
  { label: "Dark", value: "#0d0f14" },
  { label: "Stone", value: "#1c1a18" },
  { label: "Parchment", value: "#2a2418" },
  { label: "Forest", value: "#0f1a14" },
  { label: "Ocean", value: "#0a1628" },
  { label: "Night", value: "#14101a" },
] as const;

export const TOKEN_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#ecf0f1",
];

export const TOKEN_PLAYER_COLOR = "#c9a227";
export const TOKEN_ENEMY_COLOR = "#c45c5c";
export const TOKEN_ITEM_COLOR = "#8a7a5c";

/// <summary>
/// Returns a distinct token color for a player slot.
/// </summary>
export function playerTokenColorForSlot(slotId: string, slots: PlayerSlot[]): string {
  const index = slots.findIndex((slot) => slot.id === slotId);
  const safeIndex = index < 0 ? 0 : index;
  return TOKEN_COLORS[safeIndex % TOKEN_COLORS.length] ?? TOKEN_PLAYER_COLOR;
}

/// <summary>
/// Derives a token's image (and, for player tokens, label/color/sheet-link) from the entity
/// it's linked to, so a linked token never needs its own uploaded copy — no duplication and
/// the reference is counted. A player token mirrors its owner's PC sheet (full sync); any
/// other sheet-linked token (NPC/character) takes that sheet's portrait; an item token takes
/// its catalog item's icon. Unlinked tokens (or ones whose entity has no image) keep their own.
/// </summary>
export function syncTokenFromState(token: Token, state: GameState): Token {
  const normalized = normalizeToken(token);
  if (normalized.kind === "player" && normalized.ownerPlayerId) {
    const slot = state.playerSlots.find((item) => item.id === normalized.ownerPlayerId);
    const sheet = state.sheets[normalized.ownerPlayerId]?.data;
    return {
      ...normalized,
      sheetId: normalized.ownerPlayerId,
      color: playerTokenColorForSlot(normalized.ownerPlayerId, state.playerSlots),
      label: sheet?.characterName?.trim() || slot?.name || normalized.label,
      // Mirror the sheet's portrait exactly (null included) when a sheet exists, so clearing
      // the portrait clears the token too. Only a slot with no sheet keeps its own image.
      imageUrl: sheet ? (sheet.iconUrl ?? null) : normalized.imageUrl,
    };
  }
  // NPC / character token linked to a sheet → mirror that sheet's portrait exactly. Uploads
  // for a linked token always write the sheet's portrait (see TokenEditor), so the token never
  // owns an independent image — a null portrait must clear the token, not fall back to a stale copy.
  if (normalized.sheetId) {
    const sheet = state.sheets[normalized.sheetId]?.data;
    if (sheet) {
      return { ...normalized, imageUrl: sheet.iconUrl ?? null };
    }
  }
  // Item token → mirror its catalog item's icon exactly (kept live if the item's icon changes).
  if (normalized.itemId) {
    const item = state.items[normalized.itemId];
    if (item) {
      return { ...normalized, imageUrl: item.iconUrl ?? null };
    }
  }
  return normalized;
}

/// <summary>
/// Ensures tokens include kind, image, sheet-link, and combat fields from older
/// persisted rooms. Unknown condition ids are dropped.
/// </summary>
/** Validates the per-group default shapes, falling back per-group to the built-in default. */
export function normalizeTokenShapeDefaults(value: unknown): TokenShapeDefaults {
  const v = (value ?? {}) as Partial<TokenShapeDefaults>;
  const pick = (s: unknown, fallback: TokenShape): TokenShape =>
    TOKEN_SHAPES.includes(s as TokenShape) ? (s as TokenShape) : fallback;
  return {
    player: pick(v.player, DEFAULT_TOKEN_SHAPES.player),
    enemy: pick(v.enemy, DEFAULT_TOKEN_SHAPES.enemy),
    item: pick(v.item, DEFAULT_TOKEN_SHAPES.item),
  };
}

/** Wraps a heading into [0, 360). Shared by tokens and the directional-vision wedge. */
export function normalizeFacing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const TOKEN_KINDS = new Set<TokenKind>(["player", "enemy", "item"]);

export function normalizeToken(token: Token): Token {
  const kind: TokenKind = TOKEN_KINDS.has(token.kind)
    ? token.kind
    : token.ownerPlayerId
      ? "player"
      : "enemy";
  // Player-owned tokens default to sight (see lit areas; 0ft darkvision) so a player
  // isn't stranded in the dark the moment the DM turns on dynamic lighting. The DM can
  // still turn it off or add darkvision per token. Enemies/items default to no vision.
  const vision = token.vision
    ? sanitizeTokenVision(token.vision)
    : kind === "player"
      ? { enabled: true, rangeFt: 0 }
      : undefined;
  const defaultColor =
    kind === "enemy" ? TOKEN_ENEMY_COLOR : kind === "item" ? TOKEN_ITEM_COLOR : TOKEN_PLAYER_COLOR;
  return {
    ...token,
    kind,
    imageUrl: token.imageUrl ?? null,
    sheetId: token.sheetId ?? null,
    conditions: Array.isArray(token.conditions)
      ? token.conditions.filter((id) => CONDITION_IDS.has(id))
      : [],
    showHp: token.showHp === "bar" || token.showHp === "values" ? token.showHp : "none",
    color: token.color || defaultColor,
    ...(token.hidden ? { hidden: true } : { hidden: undefined }),
    ...(token.nameConcealed ? { nameConcealed: true } : { nameConcealed: undefined }),
    ...(token.portraitConcealed ? { portraitConcealed: true } : { portraitConcealed: undefined }),
    dmVisibility: token.dmVisibility === "always" ? "always" : undefined,
    revealTo: (() => {
      if (!Array.isArray(token.revealTo)) return undefined;
      const ids = Array.from(
        new Set(token.revealTo.filter((id): id is string => typeof id === "string")),
      ).slice(0, 16);
      return ids.length > 0 ? ids : undefined;
    })(),
    ...(vision ? { vision } : {}),
    // Override (not conditional-add) so the spread above can't carry invalid values through.
    shape: TOKEN_SHAPES.includes(token.shape as TokenShape) ? token.shape : undefined,
    imageFit: token.imageFit === "raw" ? "raw" : undefined,
    itemId: typeof token.itemId === "string" ? token.itemId : undefined,
    size:
      typeof token.size === "number" && Number.isFinite(token.size)
        ? clampTokenSize(token.size)
        : undefined,
    facing:
      typeof token.facing === "number" && Number.isFinite(token.facing)
        ? ((token.facing % 360) + 360) % 360
        : undefined,
  };
}

/// <summary>
/// Validates persisted combat state; clamps the turn pointer into range.
/// </summary>
export function normalizeCombat(combat: CombatState | null | undefined): CombatState | null {
  if (!combat || typeof combat !== "object" || !Array.isArray(combat.entries)) {
    return null;
  }
  const entries: CombatEntry[] = combat.entries
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id,
      tokenId: entry.tokenId ?? null,
      sheetId: entry.sheetId ?? null,
      name: typeof entry.name === "string" ? entry.name : "Combatant",
      initiative:
        typeof entry.initiative === "number" && Number.isFinite(entry.initiative)
          ? entry.initiative
          : null,
      dexScore:
        typeof entry.dexScore === "number" && Number.isFinite(entry.dexScore)
          ? entry.dexScore
          : DEFAULT_ABILITY_SCORE,
      hasRolled: Boolean(entry.hasRolled),
      ...(entry.hidden ? { hidden: true } : {}),
    }));
  if (entries.length === 0) {
    return null;
  }
  const round = typeof combat.round === "number" && combat.round >= 1 ? combat.round : 1;
  const turnIndex = Math.min(Math.max(combat.turnIndex ?? 0, 0), entries.length - 1);
  return { round, turnIndex, entries };
}

export function createDefaultSheet(name: string): CharacterSheet {
  return {
    characterName: name,
    playerName: "",
    characterClass: "",
    subclass: "",
    classes: [],
    level: 1,
    xp: 0,
    race: "",
    background: "",
    creatureType: "",
    cr: "",
    source: "",
    originalClass: "",
    alignment: "",
    size: "",
    age: "",
    height: "",
    weight: "",
    eyes: "",
    skin: "",
    hair: "",
    faith: "",
    gender: "",
    ideals: "",
    bonds: "",
    flaws: "",
    personality: "",
    appearance: "",
    backstoryPersonality: "",
    notes: "",
    inventory: [],
    iconUrl: null,
    iconCrop: { ...DEFAULT_ICON_CROP },
    hp: { current: 0, max: 0 },
    ac: 0,
    initiative: 0,
    speed: 30,
    proficiencyBonus: 2,
    deathSaves: { successes: 0, failures: 0 },
    hitDice: { current: 0, max: 0, die: "d8" },
    senses: "",
    resources: [],
    abilityScores: {},
    skillMods: {},
    saveMods: {},
    skillProfs: {},
    saveProfs: {},
    tools: [],
    languages: [],
    weaponProfs: [],
    armorProfs: [],
    resistances: [],
    immunities: [],
    conditionImmunities: [],
    vulnerabilities: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    carryCapacity: 0,
    carryMultiplier: 1,
    attunementMax: 3,
    attacks: [],
    features: [],
    spells: [],
    spellSlots: {},
    spellcasting: { abilityId: "", attackBonus: 0, saveDc: 0, casterType: "none" },
    effects: [],
    traits: {},
    favorites: [],
    overrides: {},
  };
}

/// Baseline ability score used when a player hasn't entered one yet (modifier +0).
export const DEFAULT_ABILITY_SCORE = 10;

/// <summary>
/// Standard 5e ability modifier: floor((score - 10) / 2).
/// </summary>
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/// <summary>
/// Computes a skill or saving throw total: ability modifier plus the player's manual
/// modifier, or just the manual modifier for constant stats.
/// </summary>
export function derivedStatTotal(
  def: DerivedStatDef,
  manual: number,
  abilityScores: Record<string, number>,
): number {
  switch (def.mode) {
    case "ability":
      return abilityModifier(abilityScores[def.abilityId] ?? DEFAULT_ABILITY_SCORE) + manual;
    case "constant":
      return manual;
  }
}

/// <summary>
/// Formats a modifier with an explicit sign (e.g. +2, 0, -1).
/// </summary>
export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/// <summary>
/// Builds the standard D&D 5e sheet template: 6 abilities, 18 skills, 6 saving throws.
/// </summary>
export function createDefaultSheetTemplate(): SheetTemplate {
  const abilities: AbilityDef[] = [
    { id: "str", name: "Strength", abbr: "STR" },
    { id: "dex", name: "Dexterity", abbr: "DEX" },
    { id: "con", name: "Constitution", abbr: "CON" },
    { id: "int", name: "Intelligence", abbr: "INT" },
    { id: "wis", name: "Wisdom", abbr: "WIS" },
    { id: "cha", name: "Charisma", abbr: "CHA" },
  ];

  const skillMap: Array<[string, string, string]> = [
    ["skill-acrobatics", "Acrobatics", "dex"],
    ["skill-animal-handling", "Animal Handling", "wis"],
    ["skill-arcana", "Arcana", "int"],
    ["skill-athletics", "Athletics", "str"],
    ["skill-deception", "Deception", "cha"],
    ["skill-history", "History", "int"],
    ["skill-insight", "Insight", "wis"],
    ["skill-intimidation", "Intimidation", "cha"],
    ["skill-investigation", "Investigation", "int"],
    ["skill-medicine", "Medicine", "wis"],
    ["skill-nature", "Nature", "int"],
    ["skill-perception", "Perception", "wis"],
    ["skill-performance", "Performance", "cha"],
    ["skill-persuasion", "Persuasion", "cha"],
    ["skill-religion", "Religion", "int"],
    ["skill-sleight-of-hand", "Sleight of Hand", "dex"],
    ["skill-stealth", "Stealth", "dex"],
    ["skill-survival", "Survival", "wis"],
  ];

  const skills: DerivedStatDef[] = skillMap.map(([id, name, abilityId]) => ({
    id,
    name,
    mode: "ability",
    abilityId,
  }));

  const saves: DerivedStatDef[] = abilities.map((ability) => ({
    id: `save-${ability.id}`,
    name: ability.name,
    mode: "ability",
    abilityId: ability.id,
  }));

  return { abilities, skills, saves };
}

/// Hard-coded 5e sheet template used everywhere (no in-app editor in the bare-bones build).
export const DEFAULT_SHEET_TEMPLATE: SheetTemplate = createDefaultSheetTemplate();

/// <summary>
/// Combines older story fields that lack a dedicated Phase 7 home (backstory, allies,
/// treasure/goals) into the current backstory field. Fields with a dedicated home
/// (ideals/bonds/flaws/background/personality/faith) migrate individually.
/// </summary>
function mergeLegacyStoryFields(sheet: LegacyCharacterSheet): string {
  return [sheet.backstoryPersonality, sheet.backstory, sheet.allies, sheet.treasureGoals]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

/**
 * Per-sheet server-side size cap (serialized JSON length). Bounds the full-state
 * broadcast when a campaign has many NPC sheets. Enforced in the UPDATE_SHEET handler.
 */
export const MAX_SHEET_BYTES = 20_000;
/** Client soft-warning threshold (below the hard server cap). */
export const SHEET_SOFT_WARN_BYTES = 18_000;

/** Row-count caps per sheet (server-enforced, oldest-first truncation). */
export const SHEET_ROW_CAPS = {
  inventory: 200,
  attacks: 50,
  features: 100,
  spells: 200,
  effects: 50,
  resources: 20,
  tools: 20,
  favorites: 30,
  pills: 40,
} as const;

export const NAME_CAP = 120;
export const DESC_CAP = 1000;
export const SHORT_CAP = 40;
export const PILL_CAP = 60;
const BIO_CAP = 5000;

/// <summary>
/// Returns a finite number, or the fallback when the value is missing or invalid.
/// </summary>
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Clamp a value to an integer within [min, max], falling back when invalid. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function str(value: unknown, cap: number): string {
  return typeof value === "string" ? value.slice(0, cap) : "";
}

/** Sanitize an array of rows: filter objects, cap count, map each, backfill ids. */
function sanitizeRows<T>(
  rows: unknown,
  cap: number,
  idPrefix: string,
  mapOne: (raw: Record<string, unknown>, id: string) => T,
): T[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .slice(0, cap)
    .map((row, index) => {
      const id = typeof row.id === "string" && row.id ? row.id : `${idPrefix}-${index}`;
      return mapOne(row, id);
    });
}

/** Sanitize a pill string list (cap count + per-entry length). */
function sanitizePillList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, SHEET_ROW_CAPS.pills)
    .map((entry) => entry.slice(0, PILL_CAP));
}

/** Sanitize an optional {current,max} uses/charges object. */
function sanitizeUses(value: unknown): { current: number; max: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const v = value as { current?: unknown; max?: unknown };
  return { current: clampInt(v.current, 0, 999, 0), max: clampInt(v.max, 0, 999, 0) };
}

/// <summary>
/// Keeps only finite numeric entries from a persisted record (defaults to empty).
/// </summary>
function sanitizeNumberRecord(
  record: Record<string, number> | undefined,
): Record<string, number> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return result;
}

/** Sanitize a proficiency-dot record (integer 0..2), capped at 64 keys. */
function sanitizeDotRecord(record: unknown, maxDot: number): Record<string, number> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      result[key] = Math.min(Math.max(Math.round(value), 0), maxDot);
    }
    if (Object.keys(result).length >= 64) {
      break;
    }
  }
  return result;
}

/** Sanitize the feats/species-traits toggle+override map (bool | finite number). */
function sanitizeTraits(record: unknown): Record<string, boolean | number> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const result: Record<string, boolean | number> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (typeof value === "boolean") {
      if (value) result[key] = true;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = Math.min(Math.max(value, -1000), 1000);
    }
    if (Object.keys(result).length >= 64) {
      break;
    }
  }
  return result;
}

/** Sanitize the per-stat override map (finite numbers, capped keys/values). */
function sanitizeOverrides(record: unknown): Record<string, number> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key.slice(0, 40)] = Math.min(Math.max(Math.round(value), -1000), 1000);
    }
    if (Object.keys(result).length >= 80) {
      break;
    }
  }
  return result;
}

/** Valid auto-to-hit ability ids: the six abilities or "spell" (spellcasting ability). */
function sanitizeToHitAbility(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const valid = value === "spell" || DEFAULT_SHEET_TEMPLATE.abilities.some((a) => a.id === value);
  return valid ? value : undefined;
}

/// <summary>
/// Keeps only well-formed inventory rows (v2: self-contained display copies).
/// Legacy rows without an id are backfilled deterministically (`inv-${index}`).
/// </summary>
function sanitizeInventory(inventory: unknown): InventoryEntry[] {
  return sanitizeRows(inventory, SHEET_ROW_CAPS.inventory, "inv", (raw, id) => {
    const category = INVENTORY_CATEGORIES.includes(raw.category as InventoryCategory)
      ? (raw.category as InventoryCategory)
      : "equipment";
    const charges = sanitizeUses(raw.charges);
    return {
      id,
      itemId: typeof raw.itemId === "string" ? raw.itemId : null,
      name: str(raw.name, 200) || "Item",
      qty:
        typeof raw.qty === "number" && Number.isFinite(raw.qty) && raw.qty > 0
          ? Math.floor(raw.qty)
          : 1,
      note: str(raw.note, 500),
      category,
      ...(typeof raw.weight === "number" && Number.isFinite(raw.weight)
        ? { weight: Math.max(raw.weight, 0) }
        : {}),
      ...(typeof raw.price === "string" && raw.price.trim() ? { price: str(raw.price, SHORT_CAP) } : {}),
      ...(charges ? { charges } : {}),
      ...(raw.equipped ? { equipped: true } : {}),
      ...(raw.attuned ? { attuned: true } : {}),
      ...(typeof raw.toHit === "number" && Number.isFinite(raw.toHit) ? { toHit: Math.round(raw.toHit) } : {}),
      ...(typeof raw.damage === "string" && raw.damage.trim() ? { damage: str(raw.damage, SHORT_CAP) } : {}),
      ...(typeof raw.damageType === "string" && raw.damageType.trim()
        ? { damageType: str(raw.damageType, SHORT_CAP) }
        : {}),
      ...(sanitizeToHitAbility(raw.toHitAbility) ? { toHitAbility: sanitizeToHitAbility(raw.toHitAbility) } : {}),
      ...(raw.range === "melee" || raw.range === "ranged" ? { range: raw.range } : {}),
      ...(typeof raw.description === "string" && raw.description.trim()
        ? { description: str(raw.description, DESC_CAP) }
        : {}),
    };
  });
}

function sanitizeAttacks(value: unknown): AttackEntry[] {
  return sanitizeRows(value, SHEET_ROW_CAPS.attacks, "atk", (raw, id) => {
    const uses = sanitizeUses(raw.uses);
    return {
      id,
      name: str(raw.name, NAME_CAP) || "Attack",
      toHit: clampInt(raw.toHit, -100, 100, 0),
      damage: str(raw.damage, SHORT_CAP),
      ...(typeof raw.damageType === "string" && raw.damageType.trim()
        ? { damageType: str(raw.damageType, SHORT_CAP) }
        : {}),
      ...(uses ? { uses } : {}),
      ...(typeof raw.notes === "string" && raw.notes.trim() ? { notes: str(raw.notes, DESC_CAP) } : {}),
      ...(typeof raw.itemId === "string" ? { itemId: raw.itemId } : {}),
      ...(sanitizeToHitAbility(raw.toHitAbility) ? { toHitAbility: sanitizeToHitAbility(raw.toHitAbility) } : {}),
      ...(raw.range === "melee" || raw.range === "ranged" ? { range: raw.range } : {}),
    };
  });
}

function sanitizeFeatures(value: unknown): FeatureEntry[] {
  const sources = new Set(["class", "species", "feat", "other"]);
  return sanitizeRows(value, SHEET_ROW_CAPS.features, "feat", (raw, id) => {
    const uses = sanitizeUses(raw.uses);
    return {
      id,
      name: str(raw.name, NAME_CAP) || "Feature",
      source: (sources.has(raw.source as string) ? raw.source : "other") as FeatureEntry["source"],
      ...(uses ? { uses } : {}),
      ...(raw.recovery === "sr" || raw.recovery === "lr" ? { recovery: raw.recovery } : {}),
      description: str(raw.description, DESC_CAP),
    };
  });
}

function sanitizeSpells(value: unknown): SpellEntry[] {
  return sanitizeRows(value, SHEET_ROW_CAPS.spells, "spell", (raw, id) => ({
    id,
    name: str(raw.name, NAME_CAP) || "Spell",
    level: clampInt(raw.level, 0, 9, 0),
    ...(typeof raw.components === "string" && raw.components.trim()
      ? { components: str(raw.components, SHORT_CAP) }
      : {}),
    ...(typeof raw.time === "string" && raw.time.trim() ? { time: str(raw.time, SHORT_CAP) } : {}),
    ...(typeof raw.range === "string" && raw.range.trim() ? { range: str(raw.range, SHORT_CAP) } : {}),
    ...(typeof raw.target === "string" && raw.target.trim() ? { target: str(raw.target, SHORT_CAP) } : {}),
    ...(typeof raw.roll === "string" && raw.roll.trim() ? { roll: str(raw.roll, SHORT_CAP) } : {}),
    ...(raw.prepared ? { prepared: true } : {}),
    ...(typeof raw.description === "string" && raw.description.trim()
      ? { description: str(raw.description, DESC_CAP) }
      : {}),
  }));
}

function sanitizeEffects(value: unknown): EffectEntry[] {
  return sanitizeRows(value, SHEET_ROW_CAPS.effects, "eff", (raw, id) => ({
    id,
    name: str(raw.name, NAME_CAP) || "Effect",
    ...(typeof raw.source === "string" && raw.source.trim() ? { source: str(raw.source, NAME_CAP) } : {}),
    enabled: raw.enabled !== false,
    ...(typeof raw.description === "string" && raw.description.trim()
      ? { description: str(raw.description, DESC_CAP) }
      : {}),
  }));
}

function sanitizeTools(value: unknown): ToolEntry[] {
  return sanitizeRows(value, SHEET_ROW_CAPS.tools, "tool", (raw, id) => ({
    id,
    name: str(raw.name, NAME_CAP) || "Tool",
    ...(typeof raw.abilityId === "string" ? { abilityId: str(raw.abilityId, SHORT_CAP) } : {}),
    mod: clampInt(raw.mod, -100, 100, 0),
  }));
}

function sanitizeResources(value: unknown): ResourceEntry[] {
  return sanitizeRows(value, SHEET_ROW_CAPS.resources, "res", (raw, id) => ({
    id,
    name: str(raw.name, NAME_CAP) || "Resource",
    current: clampInt(raw.current, 0, 999, 0),
    max: clampInt(raw.max, 0, 999, 0),
  }));
}

function sanitizeCurrency(value: unknown): Currency {
  const v = (value ?? {}) as Partial<Record<keyof Currency, unknown>>;
  const coin = (n: unknown) => clampInt(n, 0, 1_000_000, 0);
  return { cp: coin(v.cp), sp: coin(v.sp), ep: coin(v.ep), gp: coin(v.gp), pp: coin(v.pp) };
}

function sanitizeSpellSlots(
  value: unknown,
  casterType: CasterType = "none",
): Record<string, { current: number; max: number }> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, { current: number; max: number }> = {};
  for (let level = 1; level <= 9; level += 1) {
    const slot = (value as Record<string, unknown>)[String(level)];
    if (slot && typeof slot === "object") {
      const s = slot as { current?: unknown; max?: unknown };
      const max = clampInt(s.max, 0, 12, 0);
      // With an auto caster type, maximums derive from level (rules engine) and the
      // stored max is dormant — keep `current` up to the absolute cap instead of
      // clamping it to a stored max of 0.
      const current = Math.min(clampInt(s.current, 0, 12, 0), casterType === "none" ? max : 12);
      if (max > 0 || current > 0) {
        result[String(level)] = { current, max };
      }
    }
  }
  return result;
}

/// <summary>
/// Merges legacy and partial character sheets into the current schema. All Phase 7
/// fields are required + defaulted so the redaction copy-loop stays total.
/// </summary>
/**
 * Sanitize + migrate the multiclass array, then sync the legacy display fields.
 * Single entry: `level` stays authoritative (the level-ring keeps working) and the
 * entry mirrors it. 2+ entries: per-class levels are authoritative and `level` is
 * their sum. `characterClass`/`subclass` always mirror the first-class entry.
 */
function reconcileClasses(
  raw: unknown,
  fields: { characterClass: string; subclass: string; level: number },
): { classes: ClassEntry[]; characterClass: string; subclass: string; level: number } {
  const rows = Array.isArray(raw) ? raw.slice(0, MAX_CLASSES) : [];
  let classes: ClassEntry[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Partial<ClassEntry>;
    const className = str(typeof entry.className === "string" ? entry.className : "", NAME_CAP);
    if (!className) continue;
    classes.push({
      id: typeof entry.id === "string" && entry.id ? entry.id.slice(0, 40) : `cls-${index}`,
      className,
      subclassName: str(typeof entry.subclassName === "string" ? entry.subclassName : "", NAME_CAP),
      level: clampInt(entry.level, 1, 20, 1),
      isFirstClass: entry.isFirstClass === true,
    });
  }
  // Exactly one first class: first flagged entry wins, else the first entry.
  const firstIdx = Math.max(0, classes.findIndex((c) => c.isFirstClass));
  classes = classes.map((c, i) => ({ ...c, isFirstClass: i === firstIdx }));

  // Migration: legacy single-class sheets seed the array from the display fields.
  if (classes.length === 0 && fields.characterClass.trim()) {
    classes.push({
      id: "cls-0",
      className: str(fields.characterClass, NAME_CAP),
      subclassName: str(fields.subclass, NAME_CAP),
      level: clampInt(fields.level, 1, 20, 1),
      isFirstClass: true,
    });
  }
  if (classes.length === 0) {
    return { classes, ...fields };
  }
  const primary = classes[firstIdx < classes.length ? firstIdx : 0];
  const level =
    classes.length === 1
      ? fields.level
      : classes.reduce((sum, c) => sum + c.level, 0);
  if (classes.length === 1) {
    classes = [{ ...classes[0], level: clampInt(fields.level, 1, 20, 1) }];
  }
  return { classes, characterClass: primary.className, subclass: primary.subclassName, level };
}

export function normalizeCharacterSheet(
  sheet: LegacyCharacterSheet | undefined,
  fallbackName: string,
): CharacterSheet {
  const defaults = createDefaultSheet(fallbackName);
  if (!sheet) {
    return defaults;
  }

  const legacyName = sheet.name ?? sheet.characterName;
  const legacyStory = mergeLegacyStoryFields(sheet);
  const casterType: CasterType = CASTER_TYPES.includes(
    sheet.spellcasting?.casterType as CasterType,
  )
    ? (sheet.spellcasting?.casterType as CasterType)
    : "none";
  const reconciled = reconcileClasses(sheet.classes, {
    characterClass: sheet.characterClass ?? defaults.characterClass,
    subclass: sheet.subclass ?? defaults.subclass,
    level: typeof sheet.level === "number" && sheet.level > 0 ? sheet.level : defaults.level,
  });

  return {
    characterName: sheet.characterName ?? legacyName?.trim() ?? defaults.characterName,
    playerName: sheet.playerName ?? defaults.playerName,
    characterClass: reconciled.characterClass,
    subclass: reconciled.subclass,
    classes: reconciled.classes,
    level: reconciled.level,
    xp: typeof sheet.xp === "number" && sheet.xp >= 0 ? sheet.xp : defaults.xp,
    race: sheet.race ?? sheet.species?.trim() ?? defaults.race,
    background: sheet.background ?? defaults.background,
    creatureType: sheet.creatureType ?? defaults.creatureType,
    cr: sheet.cr ?? defaults.cr,
    source: sheet.source ?? defaults.source,
    originalClass: sheet.originalClass ?? defaults.originalClass,
    alignment: sheet.alignment ?? defaults.alignment,
    size: sheet.size ?? defaults.size,
    age: sheet.age ?? defaults.age,
    height: sheet.height ?? defaults.height,
    weight: sheet.weight ?? defaults.weight,
    eyes: sheet.eyes ?? defaults.eyes,
    skin: sheet.skin ?? defaults.skin,
    hair: sheet.hair ?? defaults.hair,
    faith: sheet.faith ?? sheet.deityPatron ?? defaults.faith,
    gender: sheet.gender ?? sheet.pronouns ?? defaults.gender,
    ideals: str(sheet.ideals ?? defaults.ideals, BIO_CAP),
    bonds: str(sheet.bonds ?? defaults.bonds, BIO_CAP),
    flaws: str(sheet.flaws ?? defaults.flaws, BIO_CAP),
    personality: str(sheet.personality ?? sheet.personalityTraits ?? defaults.personality, BIO_CAP),
    appearance: str(sheet.appearance ?? defaults.appearance, BIO_CAP),
    backstoryPersonality: str(
      sheet.backstoryPersonality ?? (legacyStory || defaults.backstoryPersonality),
      BIO_CAP,
    ),
    notes: str(sheet.notes ?? defaults.notes, 20_000),
    inventory: sanitizeInventory(sheet.inventory),
    iconUrl: sheet.iconUrl ?? sheet.portraitUrl ?? null,
    iconCrop: normalizeIconCrop(sheet.iconCrop),
    hp: {
      current: numberOr(sheet.hp?.current, defaults.hp.current),
      max: numberOr(sheet.hp?.max, defaults.hp.max),
      ...(typeof sheet.hp?.temp === "number" && Number.isFinite(sheet.hp.temp) && sheet.hp.temp > 0
        ? { temp: Math.round(sheet.hp.temp) }
        : {}),
    },
    ac: numberOr(sheet.ac, defaults.ac),
    initiative: numberOr(sheet.initiative, defaults.initiative),
    speed: numberOr(sheet.speed, defaults.speed),
    proficiencyBonus: numberOr(sheet.proficiencyBonus, defaults.proficiencyBonus),
    deathSaves: {
      successes: clampInt(sheet.deathSaves?.successes, 0, 3, 0),
      failures: clampInt(sheet.deathSaves?.failures, 0, 3, 0),
    },
    hitDice: {
      current: numberOr(sheet.hitDice?.current, defaults.hitDice.current),
      max: numberOr(sheet.hitDice?.max, defaults.hitDice.max),
      die: str(sheet.hitDice?.die, SHORT_CAP) || defaults.hitDice.die,
    },
    senses: sheet.senses ?? defaults.senses,
    resources: sanitizeResources(sheet.resources),
    abilityScores: sanitizeNumberRecord(sheet.abilityScores),
    skillMods: sanitizeNumberRecord(sheet.skillMods),
    saveMods: sanitizeNumberRecord(sheet.saveMods),
    skillProfs: sanitizeDotRecord(sheet.skillProfs, 2),
    saveProfs: sanitizeDotRecord(sheet.saveProfs, 1),
    tools: sanitizeTools(sheet.tools),
    languages: sanitizePillList(sheet.languages),
    weaponProfs: sanitizePillList(sheet.weaponProfs),
    armorProfs: sanitizePillList(sheet.armorProfs),
    resistances: sanitizePillList(sheet.resistances),
    immunities: sanitizePillList(sheet.immunities),
    conditionImmunities: sanitizePillList(sheet.conditionImmunities),
    vulnerabilities: sanitizePillList(sheet.vulnerabilities),
    currency: sanitizeCurrency(sheet.currency),
    carryCapacity: numberOr(sheet.carryCapacity, defaults.carryCapacity),
    carryMultiplier: numberOr(sheet.carryMultiplier, defaults.carryMultiplier),
    attunementMax: clampInt(sheet.attunementMax, 0, 99, defaults.attunementMax),
    attacks: sanitizeAttacks(sheet.attacks),
    features: sanitizeFeatures(sheet.features),
    spells: sanitizeSpells(sheet.spells),
    spellSlots: sanitizeSpellSlots(sheet.spellSlots, casterType),
    spellcasting: {
      abilityId: str(sheet.spellcasting?.abilityId, SHORT_CAP),
      attackBonus: clampInt(sheet.spellcasting?.attackBonus, -100, 100, 0),
      saveDc: clampInt(sheet.spellcasting?.saveDc, 0, 100, 0),
      casterType,
    },
    effects: sanitizeEffects(sheet.effects),
    traits: sanitizeTraits(sheet.traits),
    favorites: sanitizePillList(sheet.favorites).slice(0, SHEET_ROW_CAPS.favorites),
    overrides: sanitizeOverrides(sheet.overrides),
  };
}

/// <summary>
/// Creates a new player slot with a stable id for joining and character sheets.
/// </summary>
export function createPlayerSlot(name: string): PlayerSlot {
  return {
    id: `slot-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim() || "Player",
  };
}

/// <summary>
/// Ensures a player slot has an id and name from older persisted rooms.
/// </summary>
export function normalizePlayerSlot(slot: PlayerSlot): PlayerSlot {
  return {
    id: slot.id,
    name: slot.name?.trim() || "Player",
  };
}

/// <summary>
/// Validates a client-supplied annotation. Returns null when malformed. Shared by the
/// server handler and scene normalization so persisted and inbound data obey one shape.
/// </summary>
export function sanitizeAnnotation(annotation: unknown): Annotation | null {
  const a = annotation as Partial<Annotation> | null;
  if (!a || typeof a !== "object" || typeof a.id !== "string") {
    return null;
  }
  const kind =
    a.kind === "stroke" ||
    a.kind === "arrow" ||
    a.kind === "rect" ||
    a.kind === "circle" ||
    a.kind === "text" ||
    a.kind === "pin"
      ? a.kind
      : null;
  if (!kind) {
    return null;
  }
  let points: number[] | undefined;
  if (kind === "stroke" || kind === "arrow") {
    if (!Array.isArray(a.points) || a.points.length < 4 || a.points.length % 2 !== 0) {
      return null;
    }
    points = a.points.slice(0, MAX_ANNOTATION_POINTS).map((v) => numberOr(v, 0));
  }
  return {
    id: a.id.slice(0, 40),
    authorId: typeof a.authorId === "string" ? a.authorId.slice(0, 40) : "dm",
    kind,
    ...(points ? { points } : {}),
    ...(typeof a.x === "number" && Number.isFinite(a.x) ? { x: a.x } : {}),
    ...(typeof a.y === "number" && Number.isFinite(a.y) ? { y: a.y } : {}),
    ...(typeof a.w === "number" && Number.isFinite(a.w) ? { w: a.w } : {}),
    ...(typeof a.h === "number" && Number.isFinite(a.h) ? { h: a.h } : {}),
    ...(typeof a.text === "string" ? { text: a.text.slice(0, 200) } : {}),
    color: typeof a.color === "string" ? a.color.slice(0, 32) : "#ffd166",
    width: Math.min(Math.max(numberOr(a.width, 3), 1), 12),
    createdAt: numberOr(a.createdAt, Date.now()),
    ephemeral: Boolean(a.ephemeral),
    ...(a.dmOnly ? { dmOnly: true } : {}),
    ...(a.origin === "template" ? { origin: "template" as const } : {}),
  };
}

/// <summary>Validates a fog shape (rect, circle, or brush stroke in world coords).</summary>
export function sanitizeFogReveal(shape: unknown): FogReveal | null {
  const s = shape as Partial<
    FogReveal & { x: number; y: number; w: number; h: number; r: number; points: number[] }
  > | null;
  if (!s || typeof s !== "object") {
    return null;
  }
  // Only "cover" is ever stored — absent mode means reveal (keeps payloads small).
  const cover = s.mode === "cover" ? ({ mode: "cover" } as const) : {};
  if (s.kind === "brush") {
    if (
      !Array.isArray(s.points) ||
      s.points.length < 4 ||
      s.points.length % 2 !== 0 ||
      !s.points.every((value) => Number.isFinite(value))
    ) {
      return null;
    }
    const r = numberOr(s.r, NaN);
    if (!Number.isFinite(r)) {
      return null;
    }
    return {
      kind: "brush",
      points: s.points.slice(0, MAX_FOG_BRUSH_POINTS).map((value) => numberOr(value, 0)),
      r: Math.min(Math.max(r, 4), 2000),
      ...cover,
    };
  }
  if (s.kind === "poly") {
    // A filled selection polygon (≥3 vertices = 6 numbers); auto-closed on render.
    if (
      !Array.isArray(s.points) ||
      s.points.length < 6 ||
      s.points.length % 2 !== 0 ||
      !s.points.every((value) => Number.isFinite(value))
    ) {
      return null;
    }
    return {
      kind: "poly",
      points: s.points.slice(0, MAX_FOG_POLY_POINTS).map((value) => numberOr(value, 0)),
      ...cover,
    };
  }
  const x = numberOr(s.x, NaN);
  const y = numberOr(s.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (s.kind === "rect") {
    const w = numberOr(s.w, NaN);
    const h = numberOr(s.h, NaN);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    return { kind: "rect", x, y, w, h, ...cover };
  }
  if (s.kind === "circle") {
    const r = numberOr(s.r, NaN);
    if (!Number.isFinite(r) || r <= 0) {
      return null;
    }
    return { kind: "circle", x, y, r, ...cover };
  }
  return null;
}

function sanitizeFog(fog: unknown): SceneFog {
  const f = fog as Partial<SceneFog> | null;
  const reveals = Array.isArray(f?.reveals)
    ? f.reveals
        .map((shape) => sanitizeFogReveal(shape))
        .filter((shape): shape is FogReveal => shape !== null)
        .slice(-MAX_FOG_REVEALS)
    : [];
  return { enabled: Boolean(f?.enabled), reveals, inverted: f?.inverted === true };
}

/** Coerce an unknown to a member of `allowed`, else `fallback`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/// <summary>
/// Validates a wall/door segment (world coords, finite, non-degenerate) and migrates the
/// legacy Phase-6 shape `{ kind: "wall"|"door", open? }` into the Phase-6.9 channel model.
/// </summary>
export function sanitizeWall(wall: unknown): Wall | null {
  const w = wall as (Partial<Wall> & { kind?: unknown; open?: unknown }) | null;
  if (!w || typeof w !== "object" || typeof w.id !== "string") {
    return null;
  }
  const x1 = numberOr(w.x1, NaN);
  const y1 = numberOr(w.y1, NaN);
  const x2 = numberOr(w.x2, NaN);
  const y2 = numberOr(w.y2, NaN);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  if (Math.hypot(x2 - x1, y2 - y1) < 1) {
    return null; // degenerate (zero-length) segment
  }

  const hasChannels = w.sight !== undefined || w.light !== undefined || w.move !== undefined;
  const legacyDoor = w.kind === "door";

  let sight: WallRestriction;
  let light: WallRestriction;
  let move: WallRestriction;
  let door: WallDoor;
  let state: WallDoorState;

  if (!hasChannels && (w.kind === "wall" || w.kind === "door")) {
    // Pure legacy record → all-normal channels; a legacy door becomes a real (openable) door.
    sight = "normal";
    light = "normal";
    move = "normal";
    door = legacyDoor ? "door" : "none";
    state = legacyDoor ? (w.open ? "open" : "closed") : "closed";
  } else {
    sight = oneOf(w.sight, WALL_RESTRICTIONS, "normal");
    light = oneOf(w.light, WALL_RESTRICTIONS, "normal");
    move = oneOf(w.move, WALL_RESTRICTIONS, "normal");
    door = oneOf(w.door, WALL_DOORS, "none");
    // Still honor a stray legacy `open` if a mixed record carried it.
    state = oneOf(w.state, WALL_DOOR_STATES, w.open ? "open" : "closed");
  }

  const dir = oneOf(w.dir, WALL_DIRS, "both");
  const preset = oneOf(w.preset, WALL_PRESET_IDS, "custom");

  const result: Wall = { id: w.id.slice(0, 40), x1, y1, x2, y2, sight, light, move };
  if (dir !== "both") result.dir = dir;
  if (door !== "none") {
    result.door = door;
    result.state = state;
  }
  // Proximity range (only meaningful when a channel is `proximity`, but keep it if provided).
  if (typeof w.threshold === "number" && Number.isFinite(w.threshold)) {
    result.threshold = Math.min(Math.max(w.threshold, 0), 1000);
  } else if (sight === "proximity" || light === "proximity") {
    result.threshold = DEFAULT_WALL_THRESHOLD;
  }
  if (preset !== "custom") result.preset = preset;
  return result;
}

/// <summary>Validates a light source; radii clamped to sane feet ranges.</summary>
export function sanitizeLight(light: unknown): Light | null {
  const l = light as Partial<Light> | null;
  if (!l || typeof l !== "object" || typeof l.id !== "string") {
    return null;
  }
  const x = numberOr(l.x, NaN);
  const y = numberOr(l.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const brightR = Math.min(Math.max(numberOr(l.brightR, 20), 0), 1000);
  const dimR = Math.min(Math.max(numberOr(l.dimR, 40), brightR), 1000);
  return {
    id: l.id.slice(0, 40),
    x,
    y,
    brightR,
    dimR,
    ...(typeof l.color === "string" ? { color: l.color.slice(0, 32) } : {}),
    enabled: l.enabled !== false,
    ...(l.colorIntensity !== undefined
      ? { colorIntensity: Math.min(Math.max(numberOr(l.colorIntensity, 0.5), 0), 1) }
      : {}),
    ...(l.angle !== undefined
      ? { angle: Math.min(Math.max(numberOr(l.angle, 360), 0), 360) }
      : {}),
    ...(l.rotation !== undefined
      ? { rotation: ((numberOr(l.rotation, 0) % 360) + 360) % 360 }
      : {}),
    ...(l.gradual !== undefined ? { gradual: l.gradual !== false } : {}),
    ...(l.animation && typeof l.animation === "object"
      ? { animation: sanitizeLightAnimation(l.animation) }
      : {}),
  };
}

/// <summary>Validates a light's animation block (Phase 6.6).</summary>
function sanitizeLightAnimation(anim: Partial<LightAnimation>): LightAnimation {
  const type =
    anim.type === "flicker" || anim.type === "pulse" ? anim.type : "none";
  return {
    type,
    speed: Math.min(Math.max(numberOr(anim.speed, 1), 0), 10),
    intensity: Math.min(Math.max(numberOr(anim.intensity, 0.5), 0), 1),
  };
}

/// <summary>Validates a token's vision block.</summary>
export function sanitizeTokenVision(vision: unknown): TokenVision | undefined {
  const v = vision as Partial<TokenVision> | null;
  if (!v || typeof v !== "object") {
    return undefined;
  }
  return {
    enabled: Boolean(v.enabled),
    rangeFt: Math.min(Math.max(numberOr(v.rangeFt, 0), 0), 1000),
  };
}

/// <summary>
/// Normalizes a persisted scene into the single-image schema, migrating legacy
/// multi-layer / single-mapUrl scenes and filling grid/annotation/fog defaults.
/// </summary>
export function normalizeScene(scene: Partial<Scene> & Record<string, unknown>): Scene {
  const legacyLayers = Array.isArray(scene.layers)
    ? (scene.layers as Array<{ url?: string; width?: number; height?: number }>)
    : [];
  const firstLayer = legacyLayers[0];
  const mapUrl =
    (typeof scene.mapUrl === "string" ? scene.mapUrl : null) ?? firstLayer?.url ?? null;
  const width = numberOr(scene.width, numberOr(firstLayer?.width, 800));
  const height = numberOr(scene.height, numberOr(firstLayer?.height, 600));
  const annotations = Array.isArray(scene.annotations)
    ? scene.annotations
        .map((annotation) => sanitizeAnnotation(annotation))
        .filter((annotation): annotation is Annotation => annotation !== null)
        .slice(-MAX_SCENE_ANNOTATIONS)
    : [];
  const walls = Array.isArray(scene.walls)
    ? scene.walls
        .map((wall) => sanitizeWall(wall))
        .filter((wall): wall is Wall => wall !== null)
        .slice(-MAX_WALLS)
    : [];
  const lights = Array.isArray(scene.lights)
    ? scene.lights
        .map((light) => sanitizeLight(light))
        .filter((light): light is Light => light !== null)
        .slice(-MAX_LIGHTS)
    : [];
  return {
    id: typeof scene.id === "string" ? scene.id : `scene-${crypto.randomUUID().slice(0, 8)}`,
    name: typeof scene.name === "string" ? scene.name : "Scene",
    mapUrl,
    width,
    height,
    mapRotation:
      scene.mapRotation === 90 || scene.mapRotation === 180 || scene.mapRotation === 270
        ? scene.mapRotation
        : undefined,
    gridSize: numberOr(scene.gridSize, 50),
    gridOffsetX: numberOr(scene.gridOffsetX, 0),
    gridOffsetY: numberOr(scene.gridOffsetY, 0),
    feetPerSquare: Math.max(numberOr(scene.feetPerSquare, 5), 1),
    gridColor: typeof scene.gridColor === "string" ? scene.gridColor.slice(0, 32) : "#ffffff",
    gridOpacity: Math.min(Math.max(numberOr(scene.gridOpacity, 0.09), 0), 1),
    showGrid: scene.showGrid ?? true,
    backgroundColor:
      typeof scene.backgroundColor === "string" ? scene.backgroundColor : DEFAULT_SCENE_BACKGROUND,
    defaultViewport:
      scene.defaultViewport && typeof scene.defaultViewport === "object"
        ? (scene.defaultViewport as Viewport)
        : { ...DEFAULT_VIEWPORT },
    annotations,
    fog: sanitizeFog(scene.fog),
    walls,
    // Default ON: movement-restricting walls block token drags unless the DM turns it off.
    wallsBlockMovement: scene.wallsBlockMovement !== false,
    lights,
    // Default ON so existing scenes stay fully lit until the DM opts into dynamic vision.
    globalIllumination: scene.globalIllumination !== false,
    // Ambient darkness 0..1. Migrate from the legacy boolean when absent: lit → 0, dark → 1.
    darkness:
      scene.darkness !== undefined
        ? Math.min(Math.max(numberOr(scene.darkness, 0), 0), 1)
        : scene.globalIllumination === false
          ? 1
          : 0,
    lightBlendMode: LIGHT_BLEND_MODES.includes(scene.lightBlendMode as LightBlendMode)
      ? (scene.lightBlendMode as LightBlendMode)
      : "screen",
    boardBgColor: typeof scene.boardBgColor === "string" ? scene.boardBgColor.slice(0, 32) : null,
    boardBgImageUrl:
      typeof scene.boardBgImageUrl === "string" ? scene.boardBgImageUrl.slice(0, 600) : null,
    boardBgBlur: Math.min(Math.max(numberOr(scene.boardBgBlur, 12), 0), 30),
    // Default OFF: pre-Phase-B saves keep today's active-scene-only player view.
    playerVisible: scene.playerVisible === true,
  };
}

/// <summary>
/// Validates a persisted/imported handout. The 600-char imageUrl slice matches the
/// boardBgImageUrl cap: a real URL always fits, and an accidentally-embedded data URL
/// is truncated to harmless garbage instead of bloating state frames.
/// </summary>
export function normalizeHandout(value: unknown): Handout | null {
  const handout = value as Partial<Handout> | null;
  if (!handout || typeof handout !== "object" || typeof handout.id !== "string" || !handout.id) {
    return null;
  }
  const visibleTo =
    handout.visibleTo === "all"
      ? ("all" as const)
      : Array.isArray(handout.visibleTo)
        ? [...new Set(handout.visibleTo.filter((id): id is string => typeof id === "string"))]
        : [];
  const width = numberOr(handout.width, 0);
  const height = numberOr(handout.height, 0);
  return {
    id: handout.id.slice(0, 64),
    name: typeof handout.name === "string" ? handout.name.slice(0, 120) : "Handout",
    imageUrl: typeof handout.imageUrl === "string" ? handout.imageUrl.slice(0, 600) : null,
    ...(width > 0 ? { width: Math.round(width) } : {}),
    ...(height > 0 ? { height: Math.round(height) } : {}),
    visibleTo,
    createdAt: numberOr(handout.createdAt, Date.now()),
  };
}

/// <summary>
/// Normalizes full game state (fills missing arrays, syncs player tokens) on load.
/// Migrates legacy `characterSheets` (keyed by slot) into first-class `sheets`
/// records, and preserves NPC sheets alongside per-slot PC sheets.
/// </summary>
export function normalizeGameState(state: GameState & LegacyGameStateFields): GameState {
  const playerSlots = (state.playerSlots ?? []).map((slot) => normalizePlayerSlot(slot));
  const slotIds = new Set(playerSlots.map((slot) => slot.id));

  const sheets: Record<string, SheetRecord> = {};
  for (const [id, record] of Object.entries(state.sheets ?? {})) {
    if (!record || typeof record !== "object") {
      continue;
    }
    // A sheet keyed by a slot id is that slot's PC sheet regardless of stored kind.
    const kind: SheetKind = slotIds.has(id) ? "pc" : "npc";
    const fallbackName =
      kind === "pc" ? (playerSlots.find((slot) => slot.id === id)?.name ?? "Character") : "NPC";
    sheets[id] = normalizeSheetRecord({ ...record, id, kind }, fallbackName);
  }
  for (const slot of playerSlots) {
    if (!sheets[slot.id]) {
      // Legacy migration: fold characterSheets[slotId] into a PC record.
      const legacy = state.characterSheets?.[slot.id];
      sheets[slot.id] = normalizeSheetRecord(
        { id: slot.id, kind: "pc", data: legacy },
        slot.name,
      );
    }
  }

  // Legacy migration: fold the roll-only publicDiceLog into the unified log.
  const log: LogEntry[] = Array.isArray(state.log)
    ? state.log
    : (state.publicDiceLog ?? []).map((roll) => ({
        id: `log-${roll.id}`,
        t: roll.timestamp,
        kind: "roll" as const,
        roll,
        actor: { name: roll.rollerName },
      }));

  const folders: Folder[] = (Array.isArray(state.folders) ? state.folders : []).filter(
    (folder): folder is Folder =>
      Boolean(folder) &&
      typeof folder.id === "string" &&
      typeof folder.name === "string" &&
      (folder.kind === "actor" || folder.kind === "npc" || folder.kind === "item"),
  );
  const folderIds = new Set(folders.map((folder) => folder.id));

  const items: Record<string, ItemRecord> = {};
  for (const [id, item] of Object.entries(state.items ?? {})) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const normalized = normalizeItem({ ...item, id });
    // Drop references to folders that no longer exist.
    items[id] = folderIds.has(normalized.folderId ?? "")
      ? normalized
      : { ...normalized, folderId: null };
  }
  for (const record of Object.values(sheets)) {
    if (record.folderId && !folderIds.has(record.folderId)) {
      record.folderId = null;
    }
    if (record.npcFolderId && !folderIds.has(record.npcFolderId)) {
      record.npcFolderId = null;
    }
  }

  const scenes = (state.scenes ?? []).map((scene) => normalizeScene(scene));
  const base: GameState = {
    roomId: state.roomId,
    dmClientId: state.dmClientId ?? null,
    activeSceneId: state.activeSceneId,
    scenes,
    viewport: state.viewport ?? { ...DEFAULT_VIEWPORT },
    playerSlots,
    sheets,
    connectedPlayers: state.connectedPlayers ?? [],
    log: log.slice(-MAX_LOG_ENTRIES),
    dmNotes: typeof state.dmNotes === "string" ? state.dmNotes : "",
    combat: normalizeCombat(state.combat),
    folders,
    items,
    // Pre-handout saves simply get an empty library (persist/export/import all round-trip here).
    handouts: (Array.isArray(state.handouts) ? state.handouts : [])
      .map((handout) => normalizeHandout(handout))
      .filter((handout): handout is Handout => handout !== null)
      .slice(-MAX_HANDOUTS),
    playersCanDraw: Boolean(state.playersCanDraw),
    // Default-allowed: only an explicit `false` turns these off (undefined ⇒ on).
    playersCanMove: state.playersCanMove !== false,
    playersCanPoint: state.playersCanPoint !== false,
    // Off by default: only an explicit `true` turns it on (undefined ⇒ off).
    showAllTokenHp: state.showAllTokenHp === true,
    hideTokenTray: state.hideTokenTray === true,
    optimizeUploads: state.optimizeUploads !== false,
    uiOverride: normalizeUiOverride(state.uiOverride),
    tokenShapeDefaults: normalizeTokenShapeDefaults(state.tokenShapeDefaults),
    defaultTokenSize:
      typeof state.defaultTokenSize === "number" && Number.isFinite(state.defaultTokenSize)
        ? clampTokenSize(state.defaultTokenSize)
        : DEFAULT_TOKEN_SIZE,
    tokens: [],
  };
  base.tokens = (state.tokens ?? []).map((token) => {
    const synced = syncTokenFromState(token, base);
    // Drop links to sheets that no longer exist.
    return synced.sheetId && !sheets[synced.sheetId] ? { ...synced, sheetId: null } : synced;
  });
  return base;
}

export function createDefaultScenes(): Scene[] {
  return [
    normalizeScene({
      id: "scene-1",
      name: "Dungeon",
      mapUrl: "/maps/sample-dungeon.svg",
      width: 800,
      height: 600,
    }),
    normalizeScene({
      id: "scene-2",
      name: "Tavern",
      mapUrl: "/maps/sample-tavern.svg",
      width: 800,
      height: 600,
    }),
  ];
}

export function createInitialState(roomId: string): GameState {
  const scenes = createDefaultScenes();
  return {
    roomId,
    dmClientId: null,
    activeSceneId: scenes[0].id,
    scenes,
    tokens: [],
    viewport: { ...DEFAULT_VIEWPORT },
    playerSlots: [],
    sheets: {},
    connectedPlayers: [],
    log: [],
    dmNotes: "",
    combat: null,
    folders: [],
    items: {},
    handouts: [],
    playersCanDraw: false,
    playersCanMove: true,
    playersCanPoint: true,
    showAllTokenHp: false,
    hideTokenTray: false,
    optimizeUploads: true,
    uiOverride: null,
    tokenShapeDefaults: { ...DEFAULT_TOKEN_SHAPES },
    defaultTokenSize: DEFAULT_TOKEN_SIZE,
  };
}
