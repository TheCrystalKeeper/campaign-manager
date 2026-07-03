import { useState } from "react";
import type { GameState, Scene } from "../lib/types";
import { SCENE_BACKGROUND_PRESETS } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { createEmptyScene, gridSizeForMapHeight } from "../lib/sceneUtils";
import { uploadMapImage } from "../lib/uploadAsset";

type ScenePanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
};

/// <summary>
/// DM scene manager: switch/add/remove scenes, upload the background map image, and toggle
/// the grid + background color for the active scene. Rendered inside a FloatingWindow,
/// which provides the title bar and close control.
/// </summary>
export function ScenePanel({ state, dm }: ScenePanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = state.scenes.find((scene) => scene.id === state.activeSceneId) ?? state.scenes[0];

  const patchActive = (patch: Partial<Scene>) => {
    if (!active) return;
    dm.updateScene({ ...active, ...patch });
  };

  const handleMapUpload = async (file: File) => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const { url, width, height } = await uploadMapImage(state.roomId, active.id, file);
      dm.updateScene({
        ...active,
        mapUrl: url,
        width,
        height,
        gridSize: gridSizeForMapHeight(height),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Map upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body stack">
        <div className="stack">
          {state.scenes.map((scene) => (
            <div className="row" key={scene.id}>
              <button
                className={scene.id === state.activeSceneId ? "btn-active" : ""}
                style={{ flex: 1, textAlign: "left" }}
                onClick={() => dm.setScene(scene.id)}
              >
                {scene.id === state.activeSceneId ? "▶ " : ""}
                {scene.name}
              </button>
              <button
                className="btn-danger"
                disabled={state.scenes.length <= 1}
                onClick={() => dm.removeScene(scene.id)}
                title="Remove scene"
              >
                ✕
              </button>
            </div>
          ))}
          <button onClick={() => dm.addScene(createEmptyScene(`Scene ${state.scenes.length + 1}`))}>
            + Add scene
          </button>
        </div>

        {active ? (
          <>
            <div className="section-title">Active: {active.name}</div>
            <div className="field">
              <label>Scene name</label>
              <input value={active.name} onChange={(e) => patchActive({ name: e.target.value })} />
            </div>

            <label style={{ cursor: "pointer" }}>
              {busy ? "Uploading…" : active.mapUrl ? "Replace map image" : "Upload map image"}
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
                className={active.showGrid ? "btn-active" : ""}
                onClick={() => patchActive({ showGrid: !active.showGrid })}
              >
                {active.showGrid ? "On" : "Off"}
              </button>
            </div>

            <div className="section-title">Grid calibration</div>
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Tip: the 🎯 map tool (G) sets size + offset by dragging a box over one square.
            </span>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Cell size</label>
                <input
                  type="number"
                  min={10}
                  value={active.gridSize}
                  onChange={(e) =>
                    patchActive({ gridSize: Math.max(Number(e.target.value) || 10, 10) })
                  }
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Feet / square</label>
                <input
                  type="number"
                  min={1}
                  value={active.feetPerSquare}
                  onChange={(e) =>
                    patchActive({ feetPerSquare: Math.max(Number(e.target.value) || 5, 1) })
                  }
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Offset X</label>
                <input
                  type="number"
                  value={active.gridOffsetX}
                  onChange={(e) => patchActive({ gridOffsetX: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Offset Y</label>
                <input
                  type="number"
                  value={active.gridOffsetY}
                  onChange={(e) => patchActive({ gridOffsetY: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Grid color</label>
                <input
                  type="color"
                  value={active.gridColor}
                  onChange={(e) => patchActive({ gridColor: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 2 }}>
                <label>Grid opacity ({Math.round(active.gridOpacity * 100)}%)</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(active.gridOpacity * 100)}
                  onChange={(e) => patchActive({ gridOpacity: Number(e.target.value) / 100 })}
                />
              </div>
            </div>

            <div className="section-title">Fog of war</div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ margin: 0 }}>Fog enabled</label>
              <button
                className={active.fog.enabled ? "btn-active" : ""}
                onClick={() => dm.setFogEnabled(active.id, !active.fog.enabled)}
              >
                {active.fog.enabled ? "On" : "Off"}
              </button>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: "0.75rem" }}>
                Reveal areas with the 🌫 map tool (F). {active.fog.reveals.length} reveal
                {active.fog.reveals.length === 1 ? "" : "s"}.
              </span>
              <button onClick={() => dm.resetFog(active.id)}>Re-cover all</button>
            </div>

            <div className="field">
              <label>Background</label>
              <div className="dice-quick">
                {SCENE_BACKGROUND_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    className={active.backgroundColor === preset.value ? "btn-active" : ""}
                    onClick={() => patchActive({ backgroundColor: preset.value })}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
    </div>
  );
}
