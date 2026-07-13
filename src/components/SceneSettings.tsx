import { useEffect, useRef, useState } from "react";
import { Image, RotateCw, X } from "lucide-react";
import type { Scene } from "../lib/types";
import { BOARD_BACKDROP_PRESETS } from "../lib/types";
import { gridSizeForMapHeight } from "../lib/sceneUtils";
import { uploadLibraryImage, uploadMapImage } from "../lib/uploadAsset";

type SceneSettingsProps = {
  scene: Scene;
  roomId: string;
  /** Patches scene fields — live (dm.updateScene) or staged, per the caller. */
  onPatch: (patch: Partial<Scene>) => void;
  /** Fog enable/invert — routed like a FOG_SET so staging can intercept it. */
  onSetFog: (patch: { enabled?: boolean; inverted?: boolean }) => void;
  onResetFog: () => void;
  /** Rotate the whole scene 90° CW (map + geometry + tokens). Omitted = no button. */
  onRotate?: () => void;
  /** Disable rotate (e.g. while staged edits are pending — they hold pre-rotation coords). */
  rotateDisabled?: boolean;
};

type NumberInputProps = {
  value: number;
  min?: number;
  onCommit: (value: number) => void;
};

/// <summary>
/// Text field that defers to blur / Enter before committing. A live-controlled input here would
/// round-trip every keystroke through the server (UPDATE_SCENE → STATE echo) — fast typing races
/// the echoes and characters get clobbered. Editing stays local; Escape cancels; external changes
/// to `value` sync in while the field isn't focused. Bonus: one undo step per rename, not per key.
/// </summary>
function TextInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setText(value); // Escape — discard the edit
      return;
    }
    if (text !== value) onCommit(text);
  };

  return (
    <input
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/// <summary>
/// Number field that defers to blur / Enter before applying, so the value can be edited freely
/// (cleared, retyped) without snapping mid-edit the way a live-controlled input does. On commit,
/// empty / non-numeric input is REJECTED (the field reverts to the last good value); a valid number
/// is clamped to `min` and committed. Escape cancels the edit; external changes to `value` sync in
/// while the field isn't focused.
/// </summary>
function NumberInput({ value, min, onCommit }: NumberInputProps) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setText(String(value)); // Escape — discard the edit
      return;
    }
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) {
      setText(String(value)); // invalid — reject and restore the last good value
      return;
    }
    const next = min != null ? Math.max(n, min) : n;
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="number"
      min={min}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/// <summary>
/// Per-scene settings form (name, map image, grid calibration, fog, dynamic
/// lighting, background) — shared by the dock ScenePanel (always the ACTIVE
/// scene, live) and the Scenes-page editor inspector (the SELECTED scene,
/// draft-aware when Live updates is off).
/// </summary>
export function SceneSettings({ scene, roomId, onPatch, onSetFog, onResetFog, onRotate, rotateDisabled }: SceneSettingsProps) {
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

  const [backdropBusy, setBackdropBusy] = useState(false);
  const handleBackdropUpload = async (file: File) => {
    setBackdropBusy(true);
    setError(null);
    try {
      const { url } = await uploadLibraryImage(roomId, file);
      onPatch({ boardBgImageUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backdrop upload failed.");
    } finally {
      setBackdropBusy(false);
    }
  };

  return (
    <>
      <div className="field">
        <label>Scene name</label>
        <TextInput value={scene.name} onCommit={(name) => onPatch({ name })} />
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
      {error ? <span className="muted" style={{ color: "var(--danger-text)" }}>{error}</span> : null}

      {onRotate && scene.mapUrl ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Rotate map 90°</label>
          <button
            disabled={rotateDisabled}
            title={
              rotateDisabled
                ? "Apply or discard staged changes first"
                : "Rotate the scene a quarter turn clockwise — walls, lights, fog, drawings and tokens turn with it"
            }
            onClick={onRotate}
          >
            <RotateCw size={13} strokeWidth={2.2} /> Rotate
          </button>
        </div>
      ) : null}

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
          <NumberInput value={scene.gridSize} min={10} onCommit={(v) => onPatch({ gridSize: v })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Feet / square</label>
          <NumberInput value={scene.feetPerSquare} min={1} onCommit={(v) => onPatch({ feetPerSquare: v })} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Offset X</label>
          <NumberInput value={scene.gridOffsetX} onCommit={(v) => onPatch({ gridOffsetX: v })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Offset Y</label>
          <NumberInput value={scene.gridOffsetY} onCommit={(v) => onPatch({ gridOffsetY: v })} />
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

      <div className="section-title">Board backdrop</div>
      <span className="muted" style={{ fontSize: "0.75rem" }}>
        The tabletop around the map. Auto picks a very dark tone from the map's average
        color; or set your own color, or an image (blurred, behind the map).
      </span>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Backdrop color</label>
        <div className="row" style={{ gap: "0.25rem" }}>
          <button
            className={scene.boardBgColor == null ? "btn-active" : ""}
            title="Derive a very dark backdrop from the map image's average color"
            onClick={() => onPatch({ boardBgColor: null })}
          >
            Auto
          </button>
          <button
            className={scene.boardBgColor != null ? "btn-active" : ""}
            title="Pick the backdrop color yourself"
            onClick={() => {
              if (scene.boardBgColor == null) {
                onPatch({ boardBgColor: "#1e1a15" });
              }
            }}
          >
            Custom
          </button>
        </div>
      </div>
      {scene.boardBgColor != null ? (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }}>Pick a color</label>
            <input
              type="color"
              value={scene.boardBgColor}
              onChange={(e) => onPatch({ boardBgColor: e.target.value })}
              title="Backdrop color"
            />
          </div>
          <div className="backdrop-presets">
            {BOARD_BACKDROP_PRESETS.map((preset) => (
              <button
                key={preset.value}
                className={scene.boardBgColor === preset.value ? "btn-active" : ""}
                title={preset.label}
                onClick={() => onPatch({ boardBgColor: preset.value })}
              >
                <span className="backdrop-preset-dot" style={{ backgroundColor: preset.value }} />
                <span className="backdrop-preset-label">{preset.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="row">
        <label
          className={`map-upload${backdropBusy ? " map-upload--busy" : ""}`}
          style={{ flex: 1 }}
        >
          {scene.boardBgImageUrl ? (
            <img className="map-upload-thumb" src={scene.boardBgImageUrl} alt="" draggable={false} />
          ) : (
            <span className="map-upload-ico" aria-hidden>
              <Image size={22} strokeWidth={2.2} />
            </span>
          )}
          <span className="map-upload-text">
            {backdropBusy
              ? "Uploading…"
              : scene.boardBgImageUrl
                ? "Replace backdrop image"
                : "Backdrop image (optional)"}
            <small>Click to choose a file</small>
          </span>
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleBackdropUpload(file);
            }}
          />
        </label>
        {scene.boardBgImageUrl ? (
          <button
            className="btn-ghost icon-btn"
            title="Remove backdrop image"
            onClick={() => onPatch({ boardBgImageUrl: null })}
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        ) : null}
      </div>
      {scene.boardBgImageUrl ? (
        <div className="field">
          <label>Backdrop blur ({scene.boardBgBlur ?? 12})</label>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={scene.boardBgBlur ?? 12}
            title="Blur is pre-baked into a small bitmap — heavier blur costs nothing at runtime"
            onChange={(e) => onPatch({ boardBgBlur: Number(e.target.value) })}
          />
        </div>
      ) : null}
    </>
  );
}
