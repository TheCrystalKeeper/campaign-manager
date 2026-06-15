import { useRef, useState } from "react";
import {
  DEFAULT_SCENE_BACKGROUND,
  SCENE_BACKGROUND_PRESETS,
  type GameState,
  type Scene,
  type Viewport,
} from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { saveCampaignToDisk } from "../lib/devSaveCampaign";
import { uploadMapImageInDev } from "../lib/devUploadMapImage";
import {
  addImageLayerToScene,
  createEmptyScene,
  normalizeScene,
  prepareImageFromFile,
  removeMapLayer,
} from "../lib/sceneUtils";

type SceneSettingsPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  viewport: Viewport;
  onFitView: () => void;
  onResetView: () => void;
};

/// <summary>
/// Sidebar panel for configuring scene layout, fog, grid, map images, and DM preview viewport.
/// </summary>
export function SceneSettingsPanel({
  state,
  dm,
  viewport,
  onFitView,
  onResetView,
}: SceneSettingsPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingSceneId, setEditingSceneId] = useState(state.activeSceneId);

  const rawScene = state.scenes.find((scene) => scene.id === editingSceneId);
  const scene = rawScene ? normalizeScene(rawScene) : undefined;

  const updateScene = (next: Scene) => {
    dm.updateScene(next);
  };

  const handleAddScene = () => {
    const newScene = createEmptyScene(`Scene ${state.scenes.length + 1}`);
    dm.addScene(newScene);
    setEditingSceneId(newScene.id);
    dm.setScene(newScene.id);
  };

  const handleRemoveScene = () => {
    if (state.scenes.length <= 1 || !scene) {
      return;
    }
    dm.removeScene(scene.id);
    const remaining = state.scenes.filter((item) => item.id !== scene.id);
    setEditingSceneId(remaining[0]?.id ?? state.activeSceneId);
  };

  const handleMapFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !scene) {
      return;
    }

    setUploadError(null);
    setUploading(true);

    try {
      const label = file.name.replace(/\.[^.]+$/, "");
      if (import.meta.env.DEV) {
        const uploaded = await uploadMapImageInDev(scene.id, file);
        updateScene(
          addImageLayerToScene(
            scene,
            uploaded.url,
            uploaded.width,
            uploaded.height,
            label,
            uploaded.layerId,
          ),
        );
      } else {
        const { dataUrl, width, height } = await prepareImageFromFile(file);
        updateScene(addImageLayerToScene(scene, dataUrl, width, height, label));
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Could not add image. Try a smaller PNG or JPG.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleFogEnabledChange = (enabled: boolean) => {
    if (!scene) {
      return;
    }
    updateScene({
      ...scene,
      fogEnabled: enabled,
      fogDataUrl: enabled ? scene.fogDataUrl : null,
    });
  };

  const handleClearFog = () => {
    if (!scene) {
      return;
    }
    updateScene({ ...scene, fogDataUrl: null });
  };

  const handleSaveToDisk = async () => {
    setSaveStatus(null);
    setSaving(true);
    try {
      const manifest = await saveCampaignToDisk(state);
      dm.importCampaign(manifest);
      setSaveStatus("Saved to public/campaign/scenes.json and public/maps/");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="side-panel scene-settings-panel">
      <header className="side-panel-header">
        <h2>Scene management</h2>
      </header>

      <div className="side-panel-body">
          <section className="settings-section">
            <h3>Scenes</h3>
            <div className="settings-row">
              {state.scenes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === editingSceneId ? "active" : ""}
                  onClick={() => {
                    setEditingSceneId(item.id);
                    dm.setScene(item.id);
                  }}
                >
                  {item.name}
                </button>
              ))}
              <button type="button" onClick={handleAddScene}>
                + New
              </button>
            </div>
          </section>

          {scene ? (
            <>
              <section className="settings-section">
                <h3>General</h3>
                <label className="settings-field">
                  Name
                  <input
                    value={scene.name}
                    onChange={(event) => updateScene({ ...scene, name: event.target.value })}
                  />
                </label>
                <div className="settings-field">
                  Background color
                  <div className="color-presets">
                    {SCENE_BACKGROUND_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`color-swatch${scene.backgroundColor === preset.value ? " active" : ""}`}
                        style={{ backgroundColor: preset.value }}
                        title={preset.label}
                        aria-label={preset.label}
                        onClick={() => updateScene({ ...scene, backgroundColor: preset.value })}
                      />
                    ))}
                  </div>
                  <div className="color-input-row">
                    <input
                      type="color"
                      className="color-picker"
                      value={scene.backgroundColor}
                      onChange={(event) =>
                        updateScene({ ...scene, backgroundColor: event.target.value })
                      }
                    />
                    <input
                      type="text"
                      className="color-hex"
                      value={scene.backgroundColor}
                      spellCheck={false}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
                          updateScene({ ...scene, backgroundColor: value });
                        }
                      }}
                      onBlur={(event) => {
                        if (!/^#[0-9a-fA-F]{6}$/.test(event.target.value)) {
                          event.target.value = scene.backgroundColor;
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateScene({ ...scene, backgroundColor: DEFAULT_SCENE_BACKGROUND })
                      }
                    >
                      Reset
                    </button>
                  </div>
                </div>
                {state.scenes.length > 1 ? (
                  <button type="button" className="danger" onClick={handleRemoveScene}>
                    Delete this scene
                  </button>
                ) : null}
              </section>

              <section className="settings-section">
                <h3>DM preview view</h3>
                <p className="settings-hint">
                  Pan and zoom on the map behind this panel. Only you see this — players have their
                  own view.
                </p>
                <div className="settings-row">
                  <button type="button" onClick={onFitView}>
                    Fit to map
                  </button>
                  <button type="button" onClick={onResetView}>
                    Reset view
                  </button>
                </div>
                <p className="settings-hint">
                  Zoom {Math.round(viewport.scale * 100)}% · offset ({Math.round(viewport.x)},{" "}
                  {Math.round(viewport.y)})
                </p>
              </section>

              <section className="settings-section">
                <h3>Map images</h3>
                <p className="settings-hint">Drag images on the map to reposition them.</p>
                {uploadError ? <p className="settings-error">{uploadError}</p> : null}
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? "Adding…" : "+ Add image"}
                </button>
                <input
                  ref={fileRef}
                  className="file-input-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  onChange={(event) => {
                    void handleMapFile(event);
                  }}
                />
                {scene.layers.length > 0 ? (
                  <ul className="layer-list">
                    {scene.layers.map((layer) => (
                      <li key={layer.id}>
                        <span>{layer.label ?? "Image"}</span>
                        <span className="layer-meta">
                          {layer.width}×{layer.height} at ({layer.x}, {layer.y})
                        </span>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => updateScene(removeMapLayer(scene, layer.id))}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="settings-hint">No images yet — add map tiles to build this scene.</p>
                )}
              </section>

              <section className="settings-section">
                <h3>Grid</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={scene.showGrid}
                    onChange={(event) =>
                      updateScene({ ...scene, showGrid: event.target.checked })
                    }
                  />
                  Show grid
                </label>
                <label className="settings-field">
                  Grid size (px)
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={scene.gridSize}
                    onChange={(event) =>
                      updateScene({ ...scene, gridSize: Number(event.target.value) || 50 })
                    }
                  />
                </label>
              </section>

              <section className="settings-section">
                <h3>Fog of war</h3>
                <label className="settings-check">
                  <input
                    type="checkbox"
                    checked={scene.fogEnabled}
                    onChange={(event) => handleFogEnabledChange(event.target.checked)}
                  />
                  Enable fog for this scene
                </label>
                {scene.fogEnabled ? (
                  <>
                    <p className="settings-hint">
                      Players only see revealed areas. Use the fog brush during play to reveal or hide.
                    </p>
                    <button type="button" onClick={handleClearFog}>
                      Reset fog (cover entire map)
                    </button>
                  </>
                ) : (
                  <p className="settings-hint">Players see the full map with no fog overlay.</p>
                )}
              </section>

              {import.meta.env.DEV ? (
                <section className="settings-section">
                  <h3>Save to project (dev)</h3>
                  <p className="settings-hint">
                    Writes map images to <code>public/maps/</code> and scene config to{" "}
                    <code>public/campaign/scenes.json</code>. Commit those files to keep your
                    campaign in git. Only available on localhost.
                  </p>
                  {saveStatus ? <p className="settings-hint">{saveStatus}</p> : null}
                  <button type="button" disabled={saving} onClick={() => void handleSaveToDisk()}>
                    {saving ? "Saving…" : "Save campaign to disk"}
                  </button>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
    </div>
  );
}
