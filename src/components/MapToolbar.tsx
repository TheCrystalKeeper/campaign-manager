import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Blinds,
  BrickWall,
  Brush,
  Circle,
  CloudFog,
  Construction,
  DoorClosed,
  Eye,
  EyeOff,
  Footprints,
  Ghost,
  Lasso,
  LayoutGrid,
  Leaf,
  Magnet,
  Minus,
  Moon,
  Move,
  Pentagon,
  Pin,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  Sparkles,
  SquareDashed,
  Sun,
  Trash2,
  Triangle,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { CalibrateMode, MapTool } from "../map/tools/types";
import type { LightPreset } from "../map/tools/lights";
import {
  TEMPLATE_KINDS,
  WALL_BRUSHES,
  type FogShape,
  type LightBlendMode,
  type TemplateKind,
  type WallBrush,
} from "../lib/types";
import type { History } from "../lib/history";
import { useKeybinds } from "../lib/useKeybinds";
import { formatBinding, type KeybindId } from "../lib/keybinds";

const DRAW_COLORS = ["#ffd166", "#ff6b6b", "#7cc4ff", "#8ce99a", "#f3f0ff"];
const FOG_SHAPE_OPTIONS: Array<{ id: FogShape; label: ReactNode; title: string }> = [
  { id: "brush", label: <><Brush size={13} strokeWidth={2.2} /> Brush</>, title: "Freehand brush — paint fog (Alt+scroll resizes)" },
  { id: "rect", label: <><RectangleHorizontal size={13} strokeWidth={2.2} /> Rect</>, title: "Rectangle select — drag a box to fog the area" },
  { id: "lasso", label: <><Lasso size={13} strokeWidth={2.2} /> Lasso</>, title: "Lasso — drag a freehand outline, release to fill" },
  { id: "polygon", label: <><Pentagon size={13} strokeWidth={2.2} /> Polygon</>, title: "Polygon lasso — click vertices; dbl-click or first point to finish" },
];
const TEMPLATE_ICON: Record<TemplateKind, ReactNode> = {
  circle: <><Circle size={13} strokeWidth={2.2} /> Circle</>,
  cone: <><Triangle size={13} strokeWidth={2.2} style={{ transform: "rotate(-90deg)" }} /> Cone</>,
  line: <><Minus size={13} strokeWidth={2.2} /> Line</>,
  rect: <><RectangleHorizontal size={13} strokeWidth={2.2} /> Rect</>,
};
const DRAW_WIDTHS = [2, 4, 7];
/** CSP-style labels for the light tint blend modes (+ the tint-off escape hatch). */
const LIGHT_BLEND_OPTIONS: Array<{ id: LightBlendMode; label: string }> = [
  { id: "none", label: "None (fog only)" },
  { id: "overlay", label: "Overlay" },
  { id: "screen", label: "Screen" },
  { id: "soft-light", label: "Soft Light" },
  { id: "multiply", label: "Multiply" },
  { id: "plus-lighter", label: "Add (Glow)" },
];
const LIGHT_PRESET_LIST: Array<{ id: LightPreset; label: string }> = [
  { id: "candle", label: "Candle" },
  { id: "torch", label: "Torch" },
  { id: "lantern", label: "Lantern" },
];
/** Icon-only button glyphs for the walls tool's draw brushes (full names live in the tooltip). */
const WALL_BRUSH_ICONS: Record<WallBrush, ReactNode> = {
  normal: <BrickWall size={15} strokeWidth={2.2} />,
  terrain: <Leaf size={15} strokeWidth={2.2} />,
  invisible: <SquareDashed size={15} strokeWidth={2.2} />,
  ethereal: <Ghost size={15} strokeWidth={2.2} />,
  window: <Blinds size={15} strokeWidth={2.2} />,
  door: <DoorClosed size={15} strokeWidth={2.2} />,
};
const WALL_BRUSH_TITLES: Record<WallBrush, string> = {
  normal: "Wall — blocks sight, light, and movement",
  terrain: "Terrain — see/light past one, blocked by two (foliage, fog)",
  invisible: "Invisible — blocks movement only (glass, force fields)",
  ethereal: "Ethereal — blocks sight & light, not movement (curtains, veils)",
  window: "Window — partial sight, light and movement pass",
  door: "Door — openable; blocks everything while closed",
};

type MapToolbarProps = {
  isDm: boolean;
  /** Per-device: whether this client broadcasts its sound effects (dice/coins/token handling)
   *  to the rest of the table. The rail button flips it; it does not mute your own sounds. */
  broadcastSfx: boolean;
  onToggleBroadcastSfx: () => void;
  /** Tools available to this client (already role/permission filtered). */
  tools: MapTool[];
  activeToolId: string;
  onSelectTool: (id: string) => void;
  snap: boolean;
  onToggleSnap: () => void;
  drawColor: string;
  onDrawColor: (color: string) => void;
  drawWidth: number;
  onDrawWidth: (width: number) => void;
  /** Templates tool (Phase 7): shape + pin toggle. */
  templateKind: TemplateKind;
  onTemplateKind: (kind: TemplateKind) => void;
  templatePin: boolean;
  onToggleTemplatePin: () => void;
  /** Pinned templates the current user may clear (DM: all; player: their own). */
  templatePinCount: number;
  onClearTemplates: () => void;
  /** Calibrate tool: box-over-one-square vs free-drag to slide the grid. */
  calibrateMode: CalibrateMode;
  onCalibrateMode: (mode: CalibrateMode) => void;
  fogEnabled: boolean;
  onToggleFog: () => void;
  onResetFog: () => void;
  fogMode: "reveal" | "cover";
  onFogMode: (mode: "reveal" | "cover") => void;
  /** Fog shape: freehand brush vs rectangle / lasso / polygon-lasso area selection. */
  fogShape: FogShape;
  onFogShape: (shape: FogShape) => void;
  /** Brush radius in grid cells (radius = gridSize × scale). */
  fogBrushScale: number;
  onFogBrushScale: (scale: number) => void;
  fogInverted: boolean;
  onToggleFogInverted: () => void;
  onClearAnnotations: () => void;
  playersCanDraw: boolean;
  onTogglePlayersCanDraw: () => void;
  /** Phase 6 dynamic vision (walls/lights tools). */
  globalIllumination: boolean;
  onToggleGlobalIllumination: () => void;
  /** Phase 6.6: ambient darkness 0..1 (slider value, incl. the DM's live drag draft). */
  darkness: number;
  onDarknessInput: (value: number) => void;
  onDarknessCommit: (value: number) => void;
  /** Phase 6.6: per-frame light animations (client toggle / low-end escape hatch). */
  lightAnimations: boolean;
  onToggleLightAnimations: () => void;
  /** OS `prefers-reduced-motion` is on — the ✨ toggle overrides it, so surface a hint. */
  reducedMotion?: boolean;
  /** Phase 6.6b: how colored-light tint composites over the scene (per-scene, synced). */
  lightBlendMode: LightBlendMode;
  onLightBlendMode: (mode: LightBlendMode) => void;
  visionPreview: boolean;
  onToggleVisionPreview: () => void;
  /** Walls tool (Phase 6.9b): the draw brush (channel preset / door), clone + movement toggle. */
  wallBrush: WallBrush;
  onWallBrush: (brush: WallBrush) => void;
  /** DM toggle: show wall lines while the walls tool is inactive (persisted per client). */
  showWalls: boolean;
  onToggleShowWalls: () => void;
  wallCount: number;
  wallSelectionCount: number;
  onCloneWalls: () => void;
  onClearWalls: () => void;
  /** Per-scene: walls block token movement (players; DM always passes). */
  wallsBlockMovement: boolean;
  onToggleWallsBlockMovement: () => void;
  lightPreset: LightPreset;
  onLightPreset: (preset: LightPreset) => void;
  lightCount: number;
  onClearLights: () => void;
  /** Any token on this scene has vision (for the preview hint). */
  hasVisionTokens: boolean;
  /** DM undo/redo (renders ↶/↷ rail buttons when present). */
  history?: History;
};

/** A uniform option button (equal-width within its row; `square` = fixed-size icon button). */
function OptBtn({
  active,
  onClick,
  title,
  disabled,
  square,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  square?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`map-opt-btn${square ? " map-opt-btn--square" : ""}${active ? " btn-active" : ""}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <span className="map-opt-label">{children}</span>
);
const Row = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={`map-opt-row${className ? ` ${className}` : ""}`}>{children}</div>
);

/// <summary>
/// Left-edge map toolbar: a vertical rail of tool buttons + the snap toggle, and a
/// contextual options popup for the active tool. Options are laid out as labeled rows
/// of uniform-width buttons (Phase 6.5 UX pass).
/// </summary>
export function MapToolbar({
  isDm,
  broadcastSfx,
  onToggleBroadcastSfx,
  tools,
  activeToolId,
  onSelectTool,
  snap,
  onToggleSnap,
  drawColor,
  onDrawColor,
  templateKind,
  onTemplateKind,
  templatePin,
  onToggleTemplatePin,
  templatePinCount,
  onClearTemplates,
  calibrateMode,
  onCalibrateMode,
  drawWidth,
  onDrawWidth,
  fogEnabled,
  onToggleFog,
  onResetFog,
  fogMode,
  onFogMode,
  fogShape,
  onFogShape,
  fogBrushScale,
  onFogBrushScale,
  fogInverted,
  onToggleFogInverted,
  onClearAnnotations,
  playersCanDraw,
  onTogglePlayersCanDraw,
  globalIllumination,
  onToggleGlobalIllumination,
  darkness,
  onDarknessInput,
  onDarknessCommit,
  lightAnimations,
  onToggleLightAnimations,
  reducedMotion = false,
  lightBlendMode,
  onLightBlendMode,
  visionPreview,
  onToggleVisionPreview,
  wallBrush,
  onWallBrush,
  showWalls,
  onToggleShowWalls,
  wallCount,
  wallSelectionCount,
  onCloneWalls,
  onClearWalls,
  wallsBlockMovement,
  onToggleWallsBlockMovement,
  lightPreset,
  onLightPreset,
  lightCount,
  onClearLights,
  hasVisionTokens,
  history,
}: MapToolbarProps) {
  // Tool hotkeys are user-rebindable, so tooltips read the live binding rather than tool.hotkey.
  const keybinds = useKeybinds();
  // Shared "Lighting on/off + Preview" block for the walls & lights tools.
  const lightingRow = (
    <>
      <Label>Dynamic lighting</Label>
      <Row>
        <OptBtn
          active={!globalIllumination}
          title={
            globalIllumination
              ? "Scene is fully lit. Click to turn on DYNAMIC lighting (darkness + lights + vision)."
              : "Dynamic lighting is ON (scene is dark, lit only by lights/vision). Click to fully light the scene."
          }
          onClick={onToggleGlobalIllumination}
        >
          {globalIllumination ? <><Sun size={13} strokeWidth={2.2} /> Fully lit</> : <><Moon size={13} strokeWidth={2.2} /> Dynamic</>}
        </OptBtn>
        <OptBtn
          active={visionPreview}
          title="Preview what players see through their tokens' vision"
          onClick={onToggleVisionPreview}
        >
          <Eye size={13} strokeWidth={2.2} /> Preview
        </OptBtn>
      </Row>
      {visionPreview && !hasVisionTokens ? (
        <span className="map-toolbar-hint">
          No vision tokens: players see nothing. Give a token vision — lit areas show here as
          a glow.
        </span>
      ) : null}
      {!globalIllumination ? (
        <>
          <Label>Darkness ({Math.round(darkness * 100)}%)</Label>
          <Row>
            <OptBtn title="Transition to full daylight" onClick={() => onDarknessCommit(0)}>
              <Sun size={13} strokeWidth={2.2} />
            </OptBtn>
            <input
              className="map-darkness-slider"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={darkness}
              title="Ambient darkness — drag for day↔night"
              onChange={(e) => onDarknessInput(Number(e.target.value))}
              onPointerUp={(e) => onDarknessCommit(Number((e.target as HTMLInputElement).value))}
              onBlur={(e) => onDarknessCommit(Number(e.target.value))}
            />
            <OptBtn title="Transition to full darkness" onClick={() => onDarknessCommit(1)}>
              <Moon size={13} strokeWidth={2.2} />
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              active={lightAnimations}
              title="Animate flickering/pulsing lights (turn off on low-end machines)"
              onClick={onToggleLightAnimations}
            >
              <Sparkles size={13} strokeWidth={2.2} /> Animations {lightAnimations ? "on" : "off"}
            </OptBtn>
            {reducedMotion && lightAnimations ? (
              <span
                className="map-toolbar-hint"
                title="Windows 'reduce motion' is on. Lighting animations are playing because you enabled them here — turn ✨ Animations off to respect the system setting."
              >
                <AlertTriangle size={12} strokeWidth={2.2} /> overriding system reduce-motion
              </span>
            ) : null}
            <select
              className="map-blend-select"
              value={lightBlendMode}
              title="How colored light blends with the map & tokens (like paint-app blending modes)"
              onChange={(e) => onLightBlendMode(e.target.value as LightBlendMode)}
            >
              {LIGHT_BLEND_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  Blend: {option.label}
                </option>
              ))}
            </select>
          </Row>
        </>
      ) : null}
    </>
  );

  return (
    <div className="map-toolbar">
      <div className="map-toolbar-rail">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`map-tool-btn${activeToolId === tool.id ? " btn-active" : ""}`}
            title={`${tool.label} (${formatBinding(keybinds[`tool.${tool.id}` as KeybindId])})`}
            // Clicking the already-active tool toggles back to Select (v).
            onClick={() =>
              onSelectTool(activeToolId === tool.id && tool.id !== "select" ? "select" : tool.id)
            }
          >
            {tool.icon}
          </button>
        ))}
        <span className="map-toolbar-sep" />
        <button
          className={`map-tool-btn${snap ? " btn-active" : ""}`}
          title={snap ? "Snap to grid: on" : "Snap to grid: off"}
          onClick={onToggleSnap}
        >
          <Magnet size={16} strokeWidth={2.2} />
        </button>
        {history ? (
          <>
            <span className="map-toolbar-sep" />
            <button
              className="map-tool-btn"
              title="Undo (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={history.undo}
            >
              <Undo2 size={16} strokeWidth={2.2} />
            </button>
            <button
              className="map-tool-btn"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={history.redo}
            >
              <Redo2 size={16} strokeWidth={2.2} />
            </button>
          </>
        ) : null}
        <span className="map-toolbar-sep" />
        {/* Table manners: whether the rest of the table hears the sound effects YOU make —
            dice, coins, and moving/placing minis. Off mutes them only for others; you still
            hear your own. Personal + per-device, so it lives here rather than in scene state. */}
        <button
          className={`map-tool-btn${broadcastSfx ? " btn-active" : ""}`}
          title={
            broadcastSfx
              ? "Others hear your sound effects (dice, coins, moving tokens). Click to mute them for the table."
              : "Your sound effects are muted for other players. Click to let the table hear them again."
          }
          onClick={onToggleBroadcastSfx}
        >
          {broadcastSfx ? <Volume2 size={16} strokeWidth={2.2} /> : <VolumeX size={16} strokeWidth={2.2} />}
        </button>
      </div>

      {activeToolId === "draw" ? (
        <div className="map-toolbar-options">
          <Label>Color</Label>
          <div className="map-opt-row map-opt-swatches">
            {DRAW_COLORS.map((color) => (
              <button
                key={color}
                className={`draw-swatch${drawColor === color ? " draw-swatch--active" : ""}`}
                style={{ background: color }}
                title={color}
                onClick={() => onDrawColor(color)}
              />
            ))}
          </div>
          <Label>Width</Label>
          <Row>
            {DRAW_WIDTHS.map((width) => (
              <OptBtn
                key={width}
                active={drawWidth === width}
                title={`Stroke width ${width}`}
                onClick={() => onDrawWidth(width)}
              >
                <span className="draw-width-dot" style={{ width: width * 2, height: width * 2 }} />
              </OptBtn>
            ))}
          </Row>
          {isDm ? (
            <Row>
              <OptBtn title="Clear all drawings on this scene" onClick={onClearAnnotations}>
                <Trash2 size={13} strokeWidth={2.2} /> Clear
              </OptBtn>
              <OptBtn
                active={playersCanDraw}
                title={
                  playersCanDraw
                    ? "Players can draw — click to disable (the shift-drag arrow stays on)"
                    : "Players can't draw — click to allow"
                }
                onClick={onTogglePlayersCanDraw}
              >
                {playersCanDraw ? "Players ✓" : "Players ✕"}
              </OptBtn>
            </Row>
          ) : null}
          <span className="map-toolbar-hint">
            {isDm ? "Right-click a drawing to erase it" : "Your drawings fade after ~10s"}
          </span>
        </div>
      ) : null}

      {activeToolId === "template" ? (
        <div className="map-toolbar-options">
          <Label>Shape</Label>
          <Row className="row-wrap">
            {TEMPLATE_KINDS.map((kind) => (
              <OptBtn
                key={kind}
                active={templateKind === kind}
                title={`${kind} template`}
                onClick={() => onTemplateKind(kind)}
              >
                {TEMPLATE_ICON[kind]}
              </OptBtn>
            ))}
          </Row>
          <Row>
            <OptBtn
              active={templatePin}
              title={templatePin ? "Pin: the shape stays until cleared" : "Fades ~2s after you release"}
              onClick={onToggleTemplatePin}
            >
              {templatePin ? <><Pin size={13} strokeWidth={2.2} /> Pin ✓</> : <><Pin size={13} strokeWidth={2.2} /> Pin</>}
            </OptBtn>
            <OptBtn
              disabled={templatePinCount === 0}
              title={
                templatePinCount === 0
                  ? "No pinned templates to clear"
                  : `Remove ${templatePinCount} pinned template${templatePinCount === 1 ? "" : "s"}`
              }
              onClick={onClearTemplates}
            >
              <Trash2 size={13} strokeWidth={2.2} /> Clear
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">Drag from the origin to size the area.</span>
        </div>
      ) : null}

      {activeToolId === "fog" && isDm ? (
        <div className="map-toolbar-options">
          <Label>Fog</Label>
          <Row>
            {/* A switch, not a pushbutton: fog on/off is persistent scene state, and the
                sliding knob reads as state at a glance. Same cell size as the other options. */}
            <button
              type="button"
              role="switch"
              aria-checked={fogEnabled}
              className={`map-opt-btn map-opt-switch${fogEnabled ? " map-opt-switch--on" : ""}`}
              title="Show/hide fog on this scene"
              onClick={onToggleFog}
            >
              <span className="switch-track" aria-hidden>
                <span className="switch-knob" />
              </span>
              <span className="switch-label">{fogEnabled ? "On" : "Off"}</span>
            </button>
            <OptBtn
              active={fogInverted}
              title={
                fogInverted
                  ? "Inverted: map starts CLEAR — paint fog in with Cover. Click for start-covered."
                  : "Normal: map starts COVERED — paint openings with Reveal. Click to invert."
              }
              onClick={onToggleFogInverted}
            >
              <ArrowLeftRight size={13} strokeWidth={2.2} /> Invert
            </OptBtn>
          </Row>
          <Label>{fogMode === "cover" ? "Paints fog in" : "Reveals area"}</Label>
          <Row>
            <OptBtn
              active={fogMode === "reveal"}
              title="Reveal — paints fog away"
              onClick={() => onFogMode("reveal")}
            >
              <Sun size={13} strokeWidth={2.2} /> Reveal
            </OptBtn>
            <OptBtn
              active={fogMode === "cover"}
              title="Cover — paints fog back in"
              onClick={() => onFogMode("cover")}
            >
              <CloudFog size={13} strokeWidth={2.2} /> Cover
            </OptBtn>
          </Row>
          <Label>Shape</Label>
          <Row className="row-wrap">
            {FOG_SHAPE_OPTIONS.map((option) => (
              <OptBtn
                key={option.id}
                active={fogShape === option.id}
                title={option.title}
                onClick={() => onFogShape(option.id)}
              >
                {option.label}
              </OptBtn>
            ))}
          </Row>
          {fogShape === "brush" ? (
            <>
              <Label>Brush size ({fogBrushScale.toFixed(2)} cells)</Label>
              <input
                className="map-opt-slider"
                type="range"
                min={0.15}
                max={3}
                step={0.05}
                value={fogBrushScale}
                title="Fog brush radius (in grid cells) — Alt+scroll on the map also resizes"
                onChange={(e) => onFogBrushScale(Number(e.target.value))}
              />
            </>
          ) : null}
          <Row>
            <OptBtn
              title={fogInverted ? "Clear all painted fog" : "Re-cover the whole map"}
              onClick={onResetFog}
            >
              <RotateCcw size={13} strokeWidth={2.2} /> {fogInverted ? "Clear fog" : "Re-cover"}
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">
            {fogShape === "brush"
              ? `Paint to ${fogMode} · click for a single dab · Alt+scroll = size`
              : fogShape === "rect"
                ? `Drag a box to ${fogMode} the area`
                : fogShape === "lasso"
                  ? `Drag a freehand outline to ${fogMode}; release to fill`
                  : `Click to add points · dbl-click or first point to finish · right-click/Esc cancels`}
          </span>
        </div>
      ) : null}

      {activeToolId === "calibrate" && isDm ? (
        <div className="map-toolbar-options">
          <Label>Calibrate by</Label>
          {/* Stacked full-width: "Move + Resize" doesn't fit a 2-up split without ellipsis. */}
          <Row>
            <OptBtn
              active={calibrateMode === "adjust"}
              title="Direct-manipulate the grid: hover a grid point and drag it to resize, drag anywhere else to move"
              onClick={() => onCalibrateMode("adjust")}
            >
              <Move size={13} strokeWidth={2.2} /> Move + Resize
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              active={calibrateMode === "box"}
              title="Drag a fresh box over exactly one map square — sets the grid size and offset from scratch"
              onClick={() => onCalibrateMode("box")}
            >
              <LayoutGrid size={13} strokeWidth={2.2} /> Box a cell
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">
            {calibrateMode === "adjust"
              ? "Hover a grid point and drag the handle to resize · drag anywhere else to move the grid."
              : "Drag a box over exactly one map square."}
          </span>
        </div>
      ) : null}

      {activeToolId === "walls" && isDm ? (
        <div className="map-toolbar-options">
          {lightingRow}
          <Label>Draw type</Label>
          <div className="map-opt-row map-opt-swatches">
            {WALL_BRUSHES.map((b) => (
              <OptBtn
                key={b}
                square
                active={wallBrush === b}
                title={WALL_BRUSH_TITLES[b]}
                onClick={() => onWallBrush(b)}
              >
                {WALL_BRUSH_ICONS[b]}
              </OptBtn>
            ))}
          </div>
          <Row>
            <OptBtn
              title="Duplicate the selected walls (Ctrl+D)"
              disabled={wallSelectionCount === 0}
              onClick={onCloneWalls}
            >
              ⧉ Clone{wallSelectionCount ? ` (${wallSelectionCount})` : ""}
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              active={showWalls}
              title="Show wall lines on the board while the walls tool is inactive (always shown while editing)"
              onClick={onToggleShowWalls}
            >
              {showWalls ? <><Eye size={13} strokeWidth={2.2} /> Walls shown off-tool</> : <><EyeOff size={13} strokeWidth={2.2} /> Walls hidden off-tool</>}
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              active={wallsBlockMovement}
              title="When on, movement-blocking walls stop players' tokens (the DM always passes through)"
              onClick={onToggleWallsBlockMovement}
            >
              {wallsBlockMovement ? <><Construction size={13} strokeWidth={2.2} /> Walls block movement</> : <><Footprints size={13} strokeWidth={2.2} /> Movement unblocked</>}
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              title="Remove every wall and door on this scene"
              disabled={wallCount === 0}
              onClick={onClearWalls}
            >
              <Trash2 size={13} strokeWidth={2.2} /> Clear walls{wallCount ? ` (${wallCount})` : ""}
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">
            Click empty to draw · drag dots/line to move · click to select · Shift +select · Alt run ·
            Shift = precise · right-click/Esc ends · X deletes · Ctrl+D clones · dbl-click configures
          </span>
        </div>
      ) : null}

      {activeToolId === "lights" && isDm ? (
        <div className="map-toolbar-options">
          {lightingRow}
          <Label>Place</Label>
          <Row>
            {LIGHT_PRESET_LIST.map((preset) => (
              <OptBtn
                key={preset.id}
                active={lightPreset === preset.id}
                title={`Place ${preset.label.toLowerCase()}-sized lights`}
                onClick={() => onLightPreset(preset.id)}
              >
                {preset.label}
              </OptBtn>
            ))}
          </Row>
          <Row>
            <OptBtn
              title="Remove every light on this scene"
              disabled={lightCount === 0}
              onClick={onClearLights}
            >
              <Trash2 size={13} strokeWidth={2.2} /> Clear lights{lightCount ? ` (${lightCount})` : ""}
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">
            Click to place · drag to move · drag a ring to resize · double-click to edit ·
            right-click to delete
          </span>
        </div>
      ) : null}
    </div>
  );
}
