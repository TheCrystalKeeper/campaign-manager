import { useEffect, useState } from "react";
import { Lamp } from "lucide-react";
import type { Light, LightAnimation } from "../lib/types";

/// <summary>
/// Phase 6.6 DM editor for a single light, opened by double-clicking its marker. Edits
/// radius (bright/dim), color + intensity, emission angle + rotation, gradual falloff, and
/// animation. Every change emits the whole light via `onChange` (→ UPDATE_LIGHT); the
/// server re-sanitises, so out-of-range values are clamped centrally.
/// </summary>
export function LightConfigPanel({
  light,
  onChange,
  onDelete,
  onClose,
}: {
  light: Light;
  onChange: (light: Light) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const patch = (fields: Partial<Light>) => onChange({ ...light, ...fields });
  const angle = light.angle ?? 360;
  const anim: LightAnimation = light.animation ?? { type: "none", speed: 1, intensity: 0.5 };
  const patchAnim = (fields: Partial<LightAnimation>) =>
    patch({ animation: { ...anim, ...fields } });

  // Bright/Dim are edited as free local text and only committed (validated) on blur/Enter — so a
  // keystroke is never clamped mid-type (typing "25" while Bright is 20 used to collapse to 20 on
  // the first digit). The drafts re-seed whenever the authoritative radii change (switching lights,
  // or a commit that couples the two), keeping them in sync without fighting the input.
  const [brightDraft, setBrightDraft] = useState(String(light.brightR));
  const [dimDraft, setDimDraft] = useState(String(light.dimR));
  const [dimError, setDimError] = useState<string | null>(null);
  useEffect(() => {
    setBrightDraft(String(light.brightR));
    setDimDraft(String(light.dimR));
    setDimError(null);
  }, [light.id, light.brightR, light.dimR]);

  const commitBright = () => {
    const brightR = Math.max(0, Number(brightDraft) || 0);
    // Raising Bright still pulls Dim up to keep Dim ≥ Bright (the intended coupling).
    patch({ brightR, dimR: Math.max(brightR, light.dimR) });
  };
  const commitDim = () => {
    const dimR = Math.max(0, Number(dimDraft) || 0);
    if (dimR < light.brightR) {
      // Reject: keep the old value and tell the DM why (Dim can't be smaller than Bright).
      setDimError(`Dim must be ≥ Bright (${light.brightR} ft)`);
      setDimDraft(String(light.dimR));
      return;
    }
    setDimError(null);
    patch({ dimR });
  };

  return (
    <div className="panel" style={{ width: "min(280px, 92vw)" }}>
      <div className="panel-header">
        <span className="panel-title"><Lamp size={14} strokeWidth={2.2} /> Light</span>
        <button className="btn-ghost icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Enabled</label>
          <button
            className={light.enabled ? "btn-active" : ""}
            onClick={() => patch({ enabled: !light.enabled })}
          >
            {light.enabled ? "On" : "Off"}
          </button>
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Bright (ft)</label>
            <input
              type="number"
              min={0}
              step={5}
              value={brightDraft}
              onChange={(e) => setBrightDraft(e.target.value)}
              onBlur={commitBright}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>Dim (ft)</label>
            <input
              type="number"
              min={0}
              step={5}
              value={dimDraft}
              onChange={(e) => {
                setDimDraft(e.target.value);
                if (dimError) setDimError(null);
              }}
              onBlur={commitDim}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>
        </div>
        {/* Fixed-height slot so showing/clearing the error never reflows the panel. */}
        <div className="light-field-note" role="alert">
          {dimError}
        </div>

        <div className="field">
          <label>Color</label>
          <div className="row">
            <input
              type="color"
              value={light.color ?? "#ffd166"}
              onChange={(e) => patch({ color: e.target.value })}
            />
            {light.color ? (
              <button
                className="btn-ghost"
                title="Remove color (neutral white light)"
                onClick={() => patch({ color: undefined, colorIntensity: undefined })}
              >
                Clear
              </button>
            ) : (
              <span className="map-toolbar-hint">Neutral (no tint)</span>
            )}
          </div>
        </div>
        {light.color ? (
          <div className="field">
            <label>Color intensity ({Math.round((light.colorIntensity ?? 0.5) * 100)}%)</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={light.colorIntensity ?? 0.5}
              onChange={(e) => patch({ colorIntensity: Number(e.target.value) })}
            />
          </div>
        ) : null}

        <div className="field">
          <label>Emission angle ({angle === 360 ? "full circle" : `${angle}°`})</label>
          <input
            type="range"
            min={10}
            max={360}
            step={5}
            value={angle}
            onChange={(e) => patch({ angle: Number(e.target.value) })}
          />
        </div>
        {angle < 360 ? (
          <div className="field">
            <label>Rotation ({Math.round(light.rotation ?? 0)}°)</label>
            <input
              type="range"
              min={0}
              max={355}
              step={5}
              value={light.rotation ?? 0}
              onChange={(e) => patch({ rotation: Number(e.target.value) })}
            />
          </div>
        ) : null}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }} title="Smooth bright→dim→dark fade vs a hard edge">
            Gradual falloff
          </label>
          <button
            className={light.gradual !== false ? "btn-active" : ""}
            onClick={() => patch({ gradual: light.gradual === false })}
          >
            {light.gradual !== false ? "Smooth" : "Hard edge"}
          </button>
        </div>

        <div className="field">
          <label>Animation</label>
          <select
            value={anim.type}
            onChange={(e) => patchAnim({ type: e.target.value as LightAnimation["type"] })}
          >
            <option value="none">None</option>
            <option value="flicker">Flicker (torch)</option>
            <option value="pulse">Pulse</option>
          </select>
        </div>
        {anim.type !== "none" ? (
          <>
            <div className="field">
              <label>Speed ({(anim.speed ?? 1).toFixed(1)}×)</label>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={anim.speed ?? 1}
                onChange={(e) => patchAnim({ speed: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Intensity ({Math.round((anim.intensity ?? 0.5) * 100)}%)</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={anim.intensity ?? 0.5}
                onChange={(e) => patchAnim({ intensity: Number(e.target.value) })}
              />
            </div>
          </>
        ) : null}

        <button
          className="btn-danger"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          Delete light
        </button>
      </div>
    </div>
  );
}
