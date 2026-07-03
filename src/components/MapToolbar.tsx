import type { MapTool } from "../map/tools/types";

const DRAW_COLORS = ["#ffd166", "#ff6b6b", "#7cc4ff", "#8ce99a", "#f3f0ff"];
const DRAW_WIDTHS = [2, 4, 7];

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
  onClearAnnotations: () => void;
  playersCanDraw: boolean;
  onTogglePlayersCanDraw: () => void;
};

/// <summary>
/// Left-edge map toolbar: one button per registered tool (hotkey in the tooltip),
/// the per-client snap-to-grid toggle, and contextual controls for the active tool
/// (draw colors/width + DM clear; fog enable/reset; calibrate hint).
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
  onClearAnnotations,
  playersCanDraw,
  onTogglePlayersCanDraw,
}: MapToolbarProps) {
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
      </div>

      {activeToolId === "draw" ? (
        <div className="map-toolbar-options">
          {DRAW_COLORS.map((color) => (
            <button
              key={color}
              className={`draw-swatch${drawColor === color ? " draw-swatch--active" : ""}`}
              style={{ background: color }}
              title={color}
              onClick={() => onDrawColor(color)}
            />
          ))}
          {DRAW_WIDTHS.map((width) => (
            <button
              key={width}
              className={`map-tool-btn${drawWidth === width ? " btn-active" : ""}`}
              title={`Stroke width ${width}`}
              onClick={() => onDrawWidth(width)}
            >
              <span className="draw-width-dot" style={{ width: width * 2, height: width * 2 }} />
            </button>
          ))}
          {isDm ? (
            <>
              <button
                className="map-tool-btn"
                title="Clear all drawings on this scene"
                onClick={onClearAnnotations}
              >
                🗑
              </button>
              <button
                className={`map-tool-btn${playersCanDraw ? " btn-active" : ""}`}
                title={
                  playersCanDraw
                    ? "Players can use the Draw tool — click to disable"
                    : "Players can't draw — click to allow (the shift-drag arrow is always on)"
                }
                onClick={onTogglePlayersCanDraw}
              >
                {playersCanDraw ? "Players: on" : "Players: off"}
              </button>
            </>
          ) : null}
          <span className="map-toolbar-hint">
            {isDm ? "Right-click a drawing to erase it" : "Your drawings fade after ~10s"}
          </span>
        </div>
      ) : null}

      {activeToolId === "fog" && isDm ? (
        <div className="map-toolbar-options">
          <button
            className={`map-tool-btn${fogEnabled ? " btn-active" : ""}`}
            title={fogEnabled ? "Fog of war: on" : "Fog of war: off"}
            onClick={onToggleFog}
          >
            {fogEnabled ? "Fog on" : "Fog off"}
          </button>
          <button className="map-tool-btn" title="Re-cover the whole map" onClick={onResetFog}>
            ♻ Reset
          </button>
          <span className="map-toolbar-hint">Drag to reveal — Shift-drag for a circle</span>
        </div>
      ) : null}

      {activeToolId === "calibrate" && isDm ? (
        <div className="map-toolbar-options">
          <span className="map-toolbar-hint">Drag a box over exactly one map square</span>
        </div>
      ) : null}
    </div>
  );
}
