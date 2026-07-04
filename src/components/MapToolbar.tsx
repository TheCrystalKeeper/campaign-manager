import type { ReactNode } from "react";
import type { MapTool } from "../map/tools/types";
import type { LightPreset } from "../map/tools/lights";
import type { LightBlendMode } from "../lib/types";
import type { History } from "../lib/history";

const DRAW_COLORS = ["#ffd166", "#ff6b6b", "#7cc4ff", "#8ce99a", "#f3f0ff"];
const DRAW_WIDTHS = [2, 4, 7];
/** CSP-style labels for the light tint blend modes (+ the tint-off escape hatch). */
const LIGHT_BLEND_OPTIONS: Array<{ id: LightBlendMode; label: string }> = [
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "soft-light", label: "Soft Light" },
  { id: "multiply", label: "Multiply" },
  { id: "plus-lighter", label: "Add (Glow)" },
  { id: "none", label: "None (fog only)" },
];
const LIGHT_PRESET_LIST: Array<{ id: LightPreset; label: string }> = [
  { id: "candle", label: "Candle" },
  { id: "torch", label: "Torch" },
  { id: "lantern", label: "Lantern" },
];

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
  fogEnabled: boolean;
  onToggleFog: () => void;
  onResetFog: () => void;
  fogMode: "reveal" | "cover";
  onFogMode: (mode: "reveal" | "cover") => void;
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
  /** Phase 6.6b: how colored-light tint composites over the scene (per-scene, synced). */
  lightBlendMode: LightBlendMode;
  onLightBlendMode: (mode: LightBlendMode) => void;
  visionPreview: boolean;
  onToggleVisionPreview: () => void;
  wallKind: "wall" | "door";
  onWallKind: (kind: "wall" | "door") => void;
  wallCount: number;
  onClearWalls: () => void;
  lightPreset: LightPreset;
  onLightPreset: (preset: LightPreset) => void;
  lightCount: number;
  onClearLights: () => void;
  /** Any token on this scene has vision (for the preview hint). */
  hasVisionTokens: boolean;
  /** DM undo/redo (renders ↶/↷ rail buttons when present). */
  history?: History;
};

/** A uniform option button (equal-width within its row). */
function OptBtn({
  active,
  onClick,
  title,
  disabled,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      className={`map-opt-btn${active ? " btn-active" : ""}`}
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
const Row = ({ children }: { children: ReactNode }) => <div className="map-opt-row">{children}</div>;

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
  drawWidth,
  onDrawWidth,
  fogEnabled,
  onToggleFog,
  onResetFog,
  fogMode,
  onFogMode,
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
  lightBlendMode,
  onLightBlendMode,
  visionPreview,
  onToggleVisionPreview,
  wallKind,
  onWallKind,
  wallCount,
  onClearWalls,
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
          <Label>Brush paints</Label>
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
          <Label>Brush size ({fogBrushScale.toFixed(2)} cells)</Label>
          <input
            className="map-opt-slider"
            type="range"
            min={0.15}
            max={3}
            step={0.05}
            value={fogBrushScale}
            title="Fog brush radius (in grid cells)"
            onChange={(e) => onFogBrushScale(Number(e.target.value))}
          />
          <Row>
            <OptBtn
              title={fogInverted ? "Clear all painted fog" : "Re-cover the whole map"}
              onClick={onResetFog}
            >
              ♻ {fogInverted ? "Clear fog" : "Re-cover"}
            </OptBtn>
          </Row>
          <span className="map-toolbar-hint">Paint to {fogMode} · click for a single dab</span>
        </div>
      ) : null}

      {activeToolId === "calibrate" && isDm ? (
        <div className="map-toolbar-options">
          <span className="map-toolbar-hint">Drag a box over exactly one map square.</span>
        </div>
      ) : null}

      {activeToolId === "walls" && isDm ? (
        <div className="map-toolbar-options">
          {lightingRow}
          <Label>Draw</Label>
          <Row>
            <OptBtn
              active={wallKind === "wall"}
              title="Draw solid walls (blocks sight)"
              onClick={() => onWallKind("wall")}
            >
              🧱 Wall
            </OptBtn>
            <OptBtn
              active={wallKind === "door"}
              title="Draw doors (open/close to pass sight)"
              onClick={() => onWallKind("door")}
            >
              🚪 Door
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
            Drag to draw · Shift flips kind · click a door to open/close · right-click to delete
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
