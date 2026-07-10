import { BrickWall } from "lucide-react";
import {
  WALL_PRESETS,
  matchWallPreset,
  type Wall,
  type WallDir,
  type WallDoor,
  type WallDoorState,
  type WallPreset,
  type WallRestriction,
} from "../lib/types";

/// <summary>
/// Phase 6.9 DM editor for a wall (or a whole multi-selection), opened by double-clicking a
/// wall in select mode. Emits FIELD PATCHES via `onChange` (never geometry), so the same edit
/// applies to every selected wall. A preset overwrites the channels; any manual channel/dir edit
/// flips the preset to "custom". The server re-sanitises every wall centrally.
/// </summary>
const PRESET_OPTIONS: Array<{ id: WallPreset; label: string }> = [
  { id: "normal", label: "Normal" },
  { id: "terrain", label: "Terrain" },
  { id: "invisible", label: "Invisible" },
  { id: "ethereal", label: "Ethereal" },
  { id: "window", label: "Window" },
  { id: "custom", label: "Custom" },
];
const RESTRICTIONS: Array<{ id: WallRestriction; label: string }> = [
  { id: "none", label: "None" },
  { id: "normal", label: "Block" },
  { id: "limited", label: "Limited" },
  { id: "proximity", label: "Prox" },
];
const MOVE_OPTIONS: Array<{ id: WallRestriction; label: string }> = [
  { id: "none", label: "None" },
  { id: "normal", label: "Block" },
];
const DIR_OPTIONS: Array<{ id: WallDir; label: string }> = [
  { id: "both", label: "Both" },
  { id: "left", label: "◀ Left" },
  { id: "right", label: "Right ▶" },
];
const DOOR_OPTIONS: Array<{ id: WallDoor; label: string }> = [
  { id: "none", label: "None" },
  { id: "door", label: "Door" },
  { id: "secret", label: "Secret" },
];
const DOOR_STATES: Array<{ id: WallDoorState; label: string }> = [
  { id: "closed", label: "Closed" },
  { id: "open", label: "Open" },
  { id: "locked", label: "Locked" },
];

/** Equal-width segmented control (reuses the toolbar option-button styling). */
function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="map-opt-row">
      {options.map((o) => (
        <button
          key={o.id}
          className={`map-opt-btn${value === o.id ? " btn-active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function WallConfigPanel({
  wall,
  selectionCount,
  onChange,
  onDelete,
  onClose,
}: {
  /** The wall whose values seed the controls (the multi-select "primary"). */
  wall: Wall;
  /** How many walls the edit applies to (>1 when a multi-selection is being configured). */
  selectionCount: number;
  onChange: (patch: Partial<Wall>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const preset = matchWallPreset(wall);
  const door = wall.door ?? "none";
  const dir = wall.dir ?? "both";
  const many = selectionCount > 1;

  return (
    <div className="panel" style={{ width: "min(280px, 92vw)" }}>
      <div className="panel-header">
        <span className="panel-title"><BrickWall size={14} strokeWidth={2.2} /> Wall{many ? ` ×${selectionCount}` : ""}</span>
        <button className="btn-ghost icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label>Preset</label>
          <select
            value={preset}
            onChange={(e) => {
              const p = e.target.value as WallPreset;
              if (p === "custom") {
                onChange({ preset: "custom" });
                return;
              }
              onChange({ ...WALL_PRESETS[p], preset: p });
            }}
          >
            {PRESET_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label title="Blocks line-of-sight. Limited = see past one, blocked by two.">Sight</label>
          <Seg value={wall.sight} options={RESTRICTIONS} onChange={(v) => onChange({ sight: v, preset: "custom" })} />
        </div>
        <div className="field">
          <label title="Blocks light. Limited = light passes one, blocked by two.">Light</label>
          <Seg value={wall.light} options={RESTRICTIONS} onChange={(v) => onChange({ light: v, preset: "custom" })} />
        </div>
        <div className="field">
          <label title="Blocks token movement (players; the DM always passes). Proximity/Limited block like a wall.">
            Movement
          </label>
          <Seg
            value={wall.move === "normal" || wall.move === "none" ? wall.move : "normal"}
            options={MOVE_OPTIONS}
            onChange={(v) => onChange({ move: v, preset: "custom" })}
          />
        </div>
        {wall.sight === "proximity" || wall.light === "proximity" ? (
          <div className="field">
            <label title="A 'window': sight/light pass only when the source is within this range.">
              Proximity range (ft)
            </label>
            <input
              type="number"
              min={0}
              step={5}
              value={wall.threshold ?? 10}
              onChange={(e) => onChange({ threshold: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
        ) : null}

        <div className="field">
          <label title="One-way: block only when the source is on the arrow's side.">Direction</label>
          <Seg value={dir} options={DIR_OPTIONS} onChange={(v) => onChange({ dir: v, preset: "custom" })} />
        </div>

        <div className="field">
          <label>Door</label>
          <Seg
            value={door}
            options={DOOR_OPTIONS}
            onChange={(v) =>
              onChange(v === "none" ? { door: "none", state: undefined } : { door: v, state: wall.state ?? "closed" })
            }
          />
        </div>
        {door !== "none" ? (
          <div className="field">
            <label>Door state</label>
            <Seg value={wall.state ?? "closed"} options={DOOR_STATES} onChange={(v) => onChange({ state: v })} />
          </div>
        ) : null}

        <button
          className="btn-danger"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          Delete wall{many ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
