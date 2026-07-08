import { useState } from "react";
import { DEFAULT_ICON_CROP, DEFAULT_SHEET_TEMPLATE, PORTRAIT_ASPECT, formatModifier } from "../../lib/types";
import { CroppableImage } from "../CroppableImage";
import { ImageCropModal } from "../ImageCropModal";
import { AssetPickerModal } from "../AssetPickerModal";
import { NumberInput } from "../NumberInput";
import { BarMeter, DerivedNumber, StatBadge } from "./atoms";
import { DeathSaveTracker } from "./DeathSaveTracker";
import type { RevealControl } from "./SheetHeader";
import type { SheetEdit } from "./context";

/**
 * The persistent left "vitals" sidebar. PC: portrait, AC shield, init/speed/prof
 * badges, HP+temp, hit dice, death saves, favorites. NPC: adds a skills summary,
 * senses, and condition-immunity pills (it absorbs what the missing Main tab held),
 * and drops death saves/favorites.
 */
export function SheetSidebar({
  sheet,
  roomId,
  uploading,
  handlePortrait,
  onRemoveFavorite,
  reveal,
}: {
  sheet: SheetEdit;
  /** Room id for the "choose from library" image picker. */
  roomId: string;
  uploading: boolean;
  handlePortrait: (file: File) => void;
  onRemoveFavorite: (id: string) => void;
  /** DM + NPC: reveal control for the identity + combat (sidebar) sections. */
  reveal: RevealControl;
}) {
  const { value, canEdit, kind, derived, setOverride, update } = sheet;
  const isNpc = kind === "npc";
  const [cropOpen, setCropOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  // Reuse an already-uploaded image as the portrait; a fresh pick resets the crop.
  const pickFromLibrary = (iconUrl: string) => update({ iconUrl, iconCrop: { ...DEFAULT_ICON_CROP } });

  const skillsSummary = DEFAULT_SHEET_TEMPLATE.skills.filter(
    (skill) => (value.skillProfs[skill.id] ?? 0) > 0 || (value.skillMods[skill.id] ?? 0) !== 0,
  );

  /** A rules-engine badge value: editable (commit = override) with the auto marker. */
  const derivedBadge = (key: string, label: string) => (
    <DerivedNumber
      value={derived.values[key] ?? 0}
      base={derived.base[key] ?? 0}
      overridden={derived.auto && value.overrides[key] !== undefined}
      canEdit={canEdit && derived.auto}
      onCommit={(next) => setOverride(key, next)}
      onReset={() => setOverride(key, null)}
      className="stat-badge-input"
      formatted
      ariaLabel={label}
    />
  );

  return (
    <div className="sheet-vitals">
      {reveal ? (
        <button
          type="button"
          className={`reveal-toggle reveal-toggle--sidebar ${reveal.revealed ? "reveal-toggle--on" : ""}`}
          title={reveal.revealed ? "Vitals visible to players — click to hide" : "Vitals hidden from players — click to reveal"}
          onClick={() => reveal.onToggle(!reveal.revealed)}
        >
          {reveal.revealed ? "👁 Vitals" : "✕ Vitals"}
        </button>
      ) : null}
      {value.iconUrl ? (
        // Existing portrait: drag to reposition + zoom (when editable); a separate
        // "Change" button uploads a new one so dragging never triggers a file picker.
        <div className="sheet-portrait-wrap">
          <CroppableImage
            className="sheet-portrait sheet-portrait--lg"
            src={value.iconUrl}
            crop={value.iconCrop}
            editable={canEdit}
            onChange={(iconCrop) => update({ iconCrop })}
            alt="portrait"
          />
          {canEdit ? (
            <>
              <label className="sheet-portrait-change" title="Upload a different portrait">
                {uploading ? "…" : "Change"}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePortrait(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="sheet-portrait-crop"
                title="Crop portrait"
                onClick={() => setCropOpen(true)}
              >
                ✂ Crop
              </button>
              <button
                type="button"
                className="sheet-portrait-lib"
                title="Reuse an already-uploaded image"
                onClick={() => setLibOpen(true)}
              >
                🖼 Library
              </button>
            </>
          ) : null}
          {cropOpen && value.iconUrl ? (
            <ImageCropModal
              src={value.iconUrl}
              crop={value.iconCrop}
              frameAspect={PORTRAIT_ASPECT}
              title="Crop portrait"
              onApply={(iconCrop) => {
                update({ iconCrop });
                setCropOpen(false);
              }}
              onClose={() => setCropOpen(false)}
            />
          ) : null}
        </div>
      ) : canEdit ? (
        <div className="sheet-portrait-wrap">
          <label className="sheet-portrait-btn sheet-portrait-btn--lg" title="Click to upload a portrait">
            <div className="sheet-portrait sheet-portrait--lg sheet-portrait--empty">
              <span>{uploading ? "…" : "＋"}</span>
            </div>
            <span className="sheet-portrait-hint">{uploading ? "Uploading…" : "Add photo"}</span>
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePortrait(file);
              }}
            />
          </label>
          <button
            type="button"
            className="sheet-portrait-lib sheet-portrait-lib--empty"
            title="Reuse an already-uploaded image"
            onClick={() => setLibOpen(true)}
          >
            🖼 Library
          </button>
        </div>
      ) : (
        <div className="sheet-portrait sheet-portrait--lg" />
      )}
      {libOpen ? (
        <AssetPickerModal
          roomId={roomId}
          title="Choose a portrait"
          onPick={pickFromLibrary}
          onClose={() => setLibOpen(false)}
        />
      ) : null}

      <div className="ac-shield" title="Armor Class">
        <span className="ac-shield-icon">🛡</span>
        {canEdit ? (
          <NumberInput className="ac-shield-value" value={value.ac} onCommit={(ac) => update({ ac })} aria-label="AC" />
        ) : (
          <span className="ac-shield-value">{value.ac}</span>
        )}
      </div>

      <div className="vitals-badges">
        <StatBadge label="Init" value={isNpc ? formatModifier(value.initiative) : derivedBadge("init", "Initiative")} />
        <StatBadge label="Walk" value={value.speed} />
        <StatBadge label="Prof" value={isNpc ? formatModifier(value.proficiencyBonus) : derivedBadge("prof", "Proficiency bonus")} />
      </div>

      <div className="vitals-block">
        <label className="vitals-label">Hit Points</label>
        <BarMeter current={value.hp.current} max={value.hp.max} over={false}>
          {canEdit ? (
            <span className="hp-edit">
              <NumberInput value={value.hp.current} onCommit={(current) => update({ hp: { ...value.hp, current } })} aria-label="Current HP" />
              <span>/</span>
              <NumberInput value={value.hp.max} onCommit={(max) => update({ hp: { ...value.hp, max } })} aria-label="Max HP" />
            </span>
          ) : (
            <span>{value.hp.current} / {value.hp.max}</span>
          )}
        </BarMeter>
        <div className="vitals-row">
          <span className="vitals-sub">TMP</span>
          {canEdit ? (
            <NumberInput
              value={value.hp.temp ?? 0}
              min={0}
              allowNegative={false}
              onCommit={(temp) => update({ hp: { ...value.hp, temp: temp > 0 ? temp : undefined } })}
              aria-label="Temp HP"
            />
          ) : (
            <span>{value.hp.temp ?? 0}</span>
          )}
        </div>
      </div>

      <div className="vitals-block">
        <label className="vitals-label">Hit Dice</label>
        <BarMeter current={value.hitDice.current} max={derived.values["hit-dice-max"] ?? value.hitDice.max}>
          {canEdit ? (
            <span className="hp-edit">
              <NumberInput value={value.hitDice.current} min={0} allowNegative={false} onCommit={(current) => update({ hitDice: { ...value.hitDice, current } })} aria-label="Hit dice current" />
              <span>/</span>
              {derived.auto ? (
                <DerivedNumber
                  value={derived.values["hit-dice-max"] ?? 0}
                  base={derived.base["hit-dice-max"] ?? 0}
                  overridden={value.overrides["hit-dice-max"] !== undefined}
                  canEdit={canEdit}
                  onCommit={(next) => setOverride("hit-dice-max", next)}
                  onReset={() => setOverride("hit-dice-max", null)}
                  ariaLabel="Hit dice max"
                />
              ) : (
                <NumberInput value={value.hitDice.max} min={0} allowNegative={false} onCommit={(max) => update({ hitDice: { ...value.hitDice, max } })} aria-label="Hit dice max" />
              )}
            </span>
          ) : (
            <span>{value.hitDice.current} / {derived.values["hit-dice-max"] ?? value.hitDice.max}</span>
          )}
        </BarMeter>
      </div>

      {isNpc ? (
        <>
          {skillsSummary.length > 0 ? (
            <div className="vitals-block">
              <label className="vitals-label">Skills</label>
              {skillsSummary.map((skill) => (
                <div className="vitals-skill" key={skill.id}>
                  <span>{skill.name}</span>
                  <span className="total">{formatModifier(derived.values[skill.id] ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="vitals-block">
            <label className="vitals-label">Senses</label>
            {canEdit ? (
              <input value={value.senses} placeholder="Blindsight 60 ft…" onChange={(e) => update({ senses: e.target.value })} />
            ) : (
              <span className="muted">{value.senses || "—"}</span>
            )}
          </div>
          {value.conditionImmunities.length > 0 ? (
            <div className="vitals-block">
              <label className="vitals-label">Condition Immunities</label>
              <div className="pill-list-items">
                {value.conditionImmunities.map((c, i) => (
                  <span className="pill" key={`${c}-${i}`}>{c}</span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <DeathSaveTracker
            value={value.deathSaves}
            canEdit={canEdit}
            onChange={(deathSaves) => update({ deathSaves })}
            onRoll={sheet.actions?.deathSave}
          />
          <div className="vitals-block">
            <label className="vitals-label">Favorites</label>
            <div className="favorites-drop">
              {value.favorites.length === 0 ? (
                <span className="muted">Drop favorite</span>
              ) : (
                <div className="pill-list-items">
                  {value.favorites.map((f) => (
                    <span className="pill" key={f}>
                      {f.split(":").slice(1).join(":") || f}
                      {canEdit ? (
                        <button type="button" className="pill-x" onClick={() => onRemoveFavorite(f)}>✕</button>
                      ) : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
