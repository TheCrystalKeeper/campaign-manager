import { useState } from "react";
import { Image } from "lucide-react";
import type { Scene } from "../lib/types";
import { SCENE_BACKGROUND_PRESETS } from "../lib/types";
import { gridSizeForMapHeight } from "../lib/sceneUtils";
import { uploadMapImage } from "../lib/uploadAsset";

type SceneSettingsProps = {
  scene: Scene;
  roomId: string;
  /** Patches scene fields — live (dm.updateScene) or staged, per the caller. */
  onPatch: (patch: Partial<Scene>) => void;
  /** Fog enable/invert — routed like a FOG_SET so staging can intercept it. */
  onSetFog: (patch: { enabled?: boolean; inverted?: boolean }) => void;
  onResetFog: () => void;
};

/// <summary>
/// Per-scene settings form (name, map image, grid calibration, fog, dynamic
/// lighting, background) — shared by the dock ScenePanel (always the ACTIVE
/// scene, live) and the Scenes-page editor inspector (the SELECTED scene,
/// draft-aware when Live updates is off).
/// </summary>
export function SceneSettings({ scene, roomId, onPatch, onSetFog, onResetFog }: SceneSettingsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMapUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { url, width, height } = await uploadMapImage(roomId, scene.id, file);
      onPatch({ mapUrl: url, width, height, gridSize: gridSizeForMapHeight(height) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Map upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="field">
        <label>Scene name</label>
        <input value={scene.name} onChange={(e) => onPatch({ name: e.target.value })} />
      </div>

      <label className={`map-upload${busy ? " map-upload--busy" : ""}`}>
        {scene.mapUrl ? (
          <img className="map-upload-thumb" src={scene.mapUrl} alt="" draggable={false} />
        ) : (
          <span className="map-upload-ico" aria-hidden>
            <Image size={22} strokeWidth={2.2} />
          </span>
        )}
        <span className="map-upload-text">
          {busy ? "Uploading…" : scene.mapUrl ? "Replace map image" : "Upload map image"}
          <small>Click to choose a file</small>
        </span>
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleMapUpload(file);
          }}
        />
      </label>
      {error ? <span className="muted" style={{ color: "#ffb4ab" }}>{error}</span> : null}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Show grid</label>
        <button
          className={scene.showGrid ? "btn-active" : ""}
          onClick={() => onPatch({ showGrid: !scene.showGrid })}
        >
          {scene.showGrid ? "On" : "Off"}
        </button>
      </div>

      <div className="section-title">Grid calibration</div>
      <span className="muted" style={{ fontSize: "0.75rem" }}>
        Tip: the grid-calibrate map tool (G) adjusts the grid by dragging — hover a grid point and drag the
        handle to resize, drag anywhere else to move it, or use “Box a cell” to set it from one square.
      </span>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Cell size</label>
          <input
            type="number"
            min={10}
            value={scene.gridSize}
            onChange={(e) => onPatch({ gridSize: Math.max(Number(e.target.value) || 10, 10) })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Feet / square</label>
          <input
            type="number"
            min={1}
            value={scene.feetPerSquare}
            onChange={(e) => onPatch({ feetPerSquare: Math.max(Number(e.target.value) || 5, 1) })}
          />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Offset X</label>
          <input
            type="number"
            value={scene.gridOffsetX}
            onChange={(e) => onPatch({ gridOffsetX: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Offset Y</label>
          <input
            type="number"
            value={scene.gridOffsetY}
            onChange={(e) => onPatch({ gridOffsetY: Number(e.target.value) || 0 })}
          />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Grid color</label>
          <input
            type="color"
            value={scene.gridColor}
            onChange={(e) => onPatch({ gridColor: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label>Grid opacity ({Math.round(scene.gridOpacity * 100)}%)</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(scene.gridOpacity * 100)}
            onChange={(e) => onPatch({ gridOpacity: Number(e.target.value) / 100 })}
          />
        </div>
      </div>

      <div className="section-title">Fog of war</div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Fog enabled</label>
        <button
          className={scene.fog.enabled ? "btn-active" : ""}
          onClick={() => onSetFog({ enabled: !scene.fog.enabled })}
        >
          {scene.fog.enabled ? "On" : "Off"}
        </button>
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }} title="Inverted: the map starts clear and the brush paints fog IN">
          Inverted (paint fog in)
        </label>
        <button
          className={scene.fog.inverted ? "btn-active" : ""}
          onClick={() => onSetFog({ inverted: !scene.fog.inverted })}
        >
          {scene.fog.inverted ? "On" : "Off"}
        </button>
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Paint with the fog brush (F). {scene.fog.reveals.length} shape
          {scene.fog.reveals.length === 1 ? "" : "s"}.
        </span>
        <button onClick={onResetFog}>{scene.fog.inverted ? "Clear fog" : "Re-cover all"}</button>
      </div>

      <div className="section-title">Dynamic lighting</div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Global illumination</label>
        <button
          className={scene.globalIllumination ? "btn-active" : ""}
          onClick={() => onPatch({ globalIllumination: !scene.globalIllumination })}
        >
          {scene.globalIllumination ? "Lit" : "Dark"}
        </button>
      </div>
      <span className="muted" style={{ fontSize: "0.75rem" }}>
        Turn off to enable walls + lights vision. Draw walls with the walls tool (W), place lights
        with the lights tool (L). {scene.walls.length} wall{scene.walls.length === 1 ? "" : "s"},{" "}
        {scene.lights.length} light{scene.lights.length === 1 ? "" : "s"}.
      </span>

      <div className="field">
        <label>Background</label>
        <div className="dice-quick">
          {SCENE_BACKGROUND_PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={scene.backgroundColor === preset.value ? "btn-active" : ""}
              onClick={() => onPatch({ backgroundColor: preset.value })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
