import type { ReactNode } from "react";
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

const DRAW_COLORS = ["#ffd166", "#ff6b6b", "#7cc4ff", "#8ce99a", "#f3f0ff"];
const FOG_SHAPE_OPTIONS: Array<{ id: FogShape; label: string; title: string }> = [
  { id: "brush", label: "🖌 Brush", title: "Freehand brush — paint fog (Alt+scroll resizes)" },
  { id: "rect", label: "▭ Rect", title: "Rectangle select — drag a box to fog the area" },
  { id: "lasso", label: "◠ Lasso", title: "Lasso — drag a freehand outline, release to fill" },
  { id: "polygon", label: "⬟ Polygon", title: "Polygon lasso — click vertices; dbl-click or first point to finish" },
];
const TEMPLATE_ICON: Record<TemplateKind, string> = {
  circle: "○ Circle",
  cone: "◁ Cone",
  line: "／ Line",
  rect: "▭ Rect",
};
const DRAW_WIDTHS = [2, 4, 7];
/** CSP-style labels for the light tint blend modes (+ the tint-off escape hatch). */
const LIGHT_BLEND_OPTIONS: Array<{ id: LightBlendMode; label: string }> = [
  { id: "none", label: "None (fog only)" },
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
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
const WALL_BRUSH_ICONS: Record<WallBrush, string> = {
  normal: "🧱",
  terrain: "🌿",
  invisible: "🪟",
  ethereal: "👻",
  window: "🔲",
  door: "🚪",
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
          {globalIllumination ? "☀ Fully lit" : "🌙 Dynamic"}
        </OptBtn>
        <OptBtn
          active={visionPreview}
          title="Preview what players see through their tokens' vision"
          onClick={onToggleVisionPreview}
        >
          👁 Preview
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
              ☀
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
              🌙
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              active={lightAnimations}
              title="Animate flickering/pulsing lights (turn off on low-end machines)"
              onClick={onToggleLightAnimations}
            >
              ✨ Animations {lightAnimations ? "on" : "off"}
            </OptBtn>
            {reducedMotion && lightAnimations ? (
              <span
                className="map-toolbar-hint"
                title="Windows 'reduce motion' is on. Lighting animations are playing because you enabled them here — turn ✨ Animations off to respect the system setting."
              >
                ⚠ overriding system reduce-motion
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
            title={`${tool.label} (${tool.hotkey.toUpperCase()})`}
            onClick={() => onSelectTool(tool.id)}
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
          🧲
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
              ↶
            </button>
            <button
              className="map-tool-btn"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={history.redo}
            >
              ↷
            </button>
          </>
        ) : null}
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
                🗑 Clear
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
          <Row>
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
              {templatePin ? "📌 Pin ✓" : "📌 Pin"}
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">Drag from the origin to size the area.</span>
        </div>
      ) : null}

      {activeToolId === "fog" && isDm ? (
        <div className="map-toolbar-options">
          <Label>Fog</Label>
          <Row>
            <OptBtn active={fogEnabled} title="Show/hide fog on this scene" onClick={onToggleFog}>
              {fogEnabled ? "On" : "Off"}
            </OptBtn>
            <OptBtn
              active={fogInverted}
              title={
                fogInverted
                  ? "Inverted: map starts CLEAR — paint fog in with Cover. Click for start-covered."
                  : "Normal: map starts COVERED — paint openings with Reveal. Click to invert."
              }
              onClick={onToggleFogInverted}
            >
              ⇄ Invert
            </OptBtn>
          </Row>
          <Label>{fogMode === "cover" ? "Paints fog in" : "Reveals area"}</Label>
          <Row>
            <OptBtn
              active={fogMode === "reveal"}
              title="Reveal — paints fog away"
              onClick={() => onFogMode("reveal")}
            >
              ☀ Reveal
            </OptBtn>
            <OptBtn
              active={fogMode === "cover"}
              title="Cover — paints fog back in"
              onClick={() => onFogMode("cover")}
            >
              🌫 Cover
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
              ♻ {fogInverted ? "Clear fog" : "Re-cover"}
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
          <Row>
            <OptBtn
              active={calibrateMode === "adjust"}
              title="Direct-manipulate the grid: hover a grid point and drag it to resize, drag anywhere else to move"
              onClick={() => onCalibrateMode("adjust")}
            >
              ✥⤢ Move + Resize
            </OptBtn>
            <OptBtn
              active={calibrateMode === "box"}
              title="Drag a fresh box over exactly one map square — sets the grid size and offset from scratch"
              onClick={() => onCalibrateMode("box")}
            >
              ▦ Box a cell
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
              {showWalls ? "👁 Walls shown off-tool" : "🚫 Walls hidden off-tool"}
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              active={wallsBlockMovement}
              title="When on, movement-blocking walls stop players' tokens (the DM always passes through)"
              onClick={onToggleWallsBlockMovement}
            >
              {wallsBlockMovement ? "🚧 Walls block movement" : "🚶 Movement unblocked"}
            </OptBtn>
          </Row>
          <Row>
            <OptBtn
              title="Remove every wall and door on this scene"
              disabled={wallCount === 0}
              onClick={onClearWalls}
            >
              🗑 Clear walls{wallCount ? ` (${wallCount})` : ""}
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
              🗑 Clear lights{lightCount ? ` (${lightCount})` : ""}
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
