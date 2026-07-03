import { useEffect, useRef, useState } from "react";
import type {
  CharacterSheet,
  ConnectedPlayer,
  DerivedStatDef,
  PlayerSlot,
  SheetTemplate,
} from "../lib/types";
import {
  abilityModifier,
  characterSheetsEqual,
  DEFAULT_ABILITY_SCORE,
  derivedStatTotal,
  formatModifier,
} from "../lib/types";
import { uploadPortrait } from "../lib/uploadAsset";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { NumberInput } from "./NumberInput";
import type { useDmActions } from "../hooks/useGameRoom";

type CharacterSheetProps = {
  sheet: CharacterSheet | null;
  canEdit: boolean;
  onChange: (sheet: CharacterSheet) => void;
  template: SheetTemplate;
  slotId?: string | null;
  playerSlots?: PlayerSlot[];
  connectedPlayers?: ConnectedPlayer[];
  allSheets?: Record<string, CharacterSheet>;
  isDm?: boolean;
  dm?: ReturnType<typeof useDmActions>;
  showSlotManagement?: boolean;
  /** Read-only party grid for non-DM views (e.g. player "Players" tab). */
  showPartySheets?: boolean;
  /** Renders body only (no outer side-panel shell) for tabbed SheetDicePanel. */
  embedded?: boolean;
};

export type { CharacterSheetProps };

type CharacterSheetFormProps = {
  sheet: CharacterSheet;
  canEdit: boolean;
  template: SheetTemplate;
  onChange?: (sheet: CharacterSheet) => void;
  slotId?: string | null;
  compact?: boolean;
};

type SheetFieldProps = {
  label: string;
  children: React.ReactNode;
};

/// <summary>
/// Label wrapper for a single character sheet field.
/// </summary>
function SheetField({ label, children }: SheetFieldProps) {
  return (
    <label className="sheet-field">
      <span className="sheet-field-label">{label}</span>
      {children}
    </label>
  );
}

type SheetSectionProps = {
  title: string;
  children: React.ReactNode;
};

/// <summary>
/// Groups related character sheet fields under a section heading.
/// </summary>
function SheetSection({ title, children }: SheetSectionProps) {
  return (
    <section className="sheet-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

type AbilityCardProps = {
  abbr: string;
  name: string;
  score: number;
  canEdit: boolean;
  onScoreChange: (value: number) => void;
};

/// <summary>
/// One ability: editable score with its derived 5e modifier shown beneath.
/// </summary>
function AbilityCard({ abbr, name, score, canEdit, onScoreChange }: AbilityCardProps) {
  return (
    <div className="ability-card" title={name}>
      <span className="ability-abbr">{abbr}</span>
      <NumberInput
        className="ability-score"
        value={score}
        min={0}
        allowNegative={false}
        disabled={!canEdit}
        onCommit={onScoreChange}
      />
      <span className="ability-mod">{formatModifier(abilityModifier(score))}</span>
    </div>
  );
}

type DerivedStatRowProps = {
  def: DerivedStatDef;
  abilityAbbr: string | null;
  manual: number;
  total: number;
  canEdit: boolean;
  onManualChange: (value: number) => void;
};

/// <summary>
/// One skill or saving throw: computed total, linked-ability tag, and the player's manual modifier.
/// </summary>
function DerivedStatRow({
  def,
  abilityAbbr,
  manual,
  total,
  canEdit,
  onManualChange,
}: DerivedStatRowProps) {
  return (
    <div className="stat-row">
      <span className="stat-total">{formatModifier(total)}</span>
      <span className="stat-name">{def.name}</span>
      <span className="stat-ability-tag">{abilityAbbr ?? "—"}</span>
      <NumberInput
        className="stat-mod-input"
        value={manual}
        disabled={!canEdit}
        aria-label={`${def.name} modifier`}
        onCommit={onManualChange}
      />
    </div>
  );
}

/// <summary>
/// Shared character sheet fields for player edit and DM read-only views.
/// </summary>
function CharacterSheetForm({
  sheet: serverSheet,
  canEdit,
  template,
  onChange,
  slotId,
  compact = false,
}: CharacterSheetFormProps) {
  const iconRef = useRef<HTMLInputElement>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [draft, setDraft] = useState(serverSheet);
  const lastSentRef = useRef(serverSheet);
  const storyRows = compact ? 8 : 6;

  const { debounced: debouncedSave, flush } = useDebouncedCallback((next: CharacterSheet) => {
    lastSentRef.current = next;
    onChange?.(next);
  }, 400);

  useEffect(() => {
    setDraft((current) =>
      characterSheetsEqual(current, lastSentRef.current) ? serverSheet : current,
    );
    lastSentRef.current = serverSheet;
  }, [serverSheet]);

  const update = (partial: Partial<CharacterSheet>) => {
    if (!canEdit || !onChange) {
      return;
    }
    const next = { ...draft, ...partial };
    setDraft(next);
    debouncedSave(next);
  };

  const saveNow = (next: CharacterSheet) => {
    setDraft(next);
    flush();
    lastSentRef.current = next;
    onChange?.(next);
  };

  const updateAbilityScore = (abilityId: string, value: number) =>
    update({ abilityScores: { ...draft.abilityScores, [abilityId]: value } });

  const updateSkillMod = (skillId: string, value: number) =>
    update({ skillMods: { ...draft.skillMods, [skillId]: value } });

  const updateSaveMod = (saveId: string, value: number) =>
    update({ saveMods: { ...draft.saveMods, [saveId]: value } });

  const handleIconFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canEdit || !onChange || !slotId) {
      return;
    }

    setIconError(null);
    setUploadingIcon(true);
    try {
      const uploaded = await uploadPortrait(slotId, file);
      saveNow({ ...draft, iconUrl: uploaded.url });
    } catch (error) {
      setIconError(error instanceof Error ? error.message : "Icon upload failed.");
    } finally {
      setUploadingIcon(false);
    }
  };

  const sheet = draft;
  const abilityById = new Map(template.abilities.map((ability) => [ability.id, ability]));
  const abbrFor = (def: DerivedStatDef): string | null =>
    def.mode === "ability" ? (abilityById.get(def.abilityId)?.abbr ?? null) : null;

  return (
    <div className={`character-form${compact ? " character-form-compact" : ""}`}>
      <SheetSection title="Character">
        <div className="sheet-icon-row">
          {sheet.iconUrl ? (
            <img className="sheet-portrait" src={sheet.iconUrl} alt="" />
          ) : (
            <div className="sheet-portrait sheet-portrait-empty">No icon</div>
          )}
          {canEdit && slotId ? (
            <div className="sheet-icon-actions">
              <button
                type="button"
                className="btn-compact"
                disabled={uploadingIcon}
                onClick={() => iconRef.current?.click()}
              >
                {uploadingIcon ? "Uploading…" : sheet.iconUrl ? "Change icon" : "Upload icon"}
              </button>
              {sheet.iconUrl ? (
                <button type="button" className="btn-compact" onClick={() => update({ iconUrl: null })}>
                  Remove
                </button>
              ) : null}
              <input
                ref={iconRef}
                className="file-input-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  void handleIconFile(event);
                }}
              />
              {iconError ? <p className="sheet-field-error">{iconError}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="sheet-field-grid">
          <SheetField label="Character name">
            <input
              value={sheet.characterName}
              disabled={!canEdit}
              onChange={(event) => update({ characterName: event.target.value })}
            />
          </SheetField>
          <SheetField label="Player name">
            <input
              value={sheet.playerName}
              disabled={!canEdit}
              onChange={(event) => update({ playerName: event.target.value })}
            />
          </SheetField>
        </div>
      </SheetSection>

      <SheetSection title="Class & level">
        <div className="sheet-field-grid">
          <SheetField label="Class">
            <input
              value={sheet.characterClass}
              disabled={!canEdit}
              onChange={(event) => update({ characterClass: event.target.value })}
            />
          </SheetField>
          <SheetField label="Subclass">
            <input
              value={sheet.subclass}
              disabled={!canEdit}
              onChange={(event) => update({ subclass: event.target.value })}
            />
          </SheetField>
          <SheetField label="Level">
            <NumberInput
              value={sheet.level}
              min={1}
              allowNegative={false}
              disabled={!canEdit}
              onCommit={(level) => update({ level })}
            />
          </SheetField>
          <SheetField label="XP">
            <NumberInput
              value={sheet.xp}
              min={0}
              allowNegative={false}
              disabled={!canEdit}
              onCommit={(xp) => update({ xp })}
            />
          </SheetField>
        </div>
      </SheetSection>

      <SheetSection title="Combat">
        <div className="sheet-field-grid">
          <SheetField label="HP (current)">
            <NumberInput
              value={sheet.hp.current}
              disabled={!canEdit}
              onCommit={(current) => update({ hp: { ...draft.hp, current } })}
            />
          </SheetField>
          <SheetField label="HP (max)">
            <NumberInput
              value={sheet.hp.max}
              min={0}
              allowNegative={false}
              disabled={!canEdit}
              onCommit={(max) => update({ hp: { ...draft.hp, max } })}
            />
          </SheetField>
          <SheetField label="Armor Class">
            <NumberInput
              value={sheet.ac}
              min={0}
              allowNegative={false}
              disabled={!canEdit}
              onCommit={(ac) => update({ ac })}
            />
          </SheetField>
          <SheetField label="Initiative">
            <NumberInput
              value={sheet.initiative}
              disabled={!canEdit}
              onCommit={(initiative) => update({ initiative })}
            />
          </SheetField>
        </div>
      </SheetSection>

      {template.abilities.length > 0 ? (
        <SheetSection title="Abilities">
          <div className="ability-grid">
            {template.abilities.map((ability) => (
              <AbilityCard
                key={ability.id}
                abbr={ability.abbr}
                name={ability.name}
                score={sheet.abilityScores[ability.id] ?? DEFAULT_ABILITY_SCORE}
                canEdit={canEdit}
                onScoreChange={(value) => updateAbilityScore(ability.id, value)}
              />
            ))}
          </div>
        </SheetSection>
      ) : null}

      {template.skills.length > 0 ? (
        <SheetSection title="Skills">
          <div className="stat-list">
            {template.skills.map((skill) => {
              const manual = sheet.skillMods[skill.id] ?? 0;
              return (
                <DerivedStatRow
                  key={skill.id}
                  def={skill}
                  abilityAbbr={abbrFor(skill)}
                  manual={manual}
                  total={derivedStatTotal(skill, manual, sheet.abilityScores)}
                  canEdit={canEdit}
                  onManualChange={(value) => updateSkillMod(skill.id, value)}
                />
              );
            })}
          </div>
        </SheetSection>
      ) : null}

      {template.saves.length > 0 ? (
        <SheetSection title="Saving throws">
          <div className="stat-list">
            {template.saves.map((save) => {
              const manual = sheet.saveMods[save.id] ?? 0;
              return (
                <DerivedStatRow
                  key={save.id}
                  def={save}
                  abilityAbbr={abbrFor(save)}
                  manual={manual}
                  total={derivedStatTotal(save, manual, sheet.abilityScores)}
                  canEdit={canEdit}
                  onManualChange={(value) => updateSaveMod(save.id, value)}
                />
              );
            })}
          </div>
        </SheetSection>
      ) : null}

      <SheetSection title="Details">
        <div className="sheet-field-grid">
          <SheetField label="Race">
            <input
              value={sheet.race}
              disabled={!canEdit}
              onChange={(event) => update({ race: event.target.value })}
            />
          </SheetField>
          <SheetField label="Alignment">
            <input
              value={sheet.alignment}
              disabled={!canEdit}
              onChange={(event) => update({ alignment: event.target.value })}
            />
          </SheetField>
          <SheetField label="Size">
            <input
              value={sheet.size}
              disabled={!canEdit}
              onChange={(event) => update({ size: event.target.value })}
            />
          </SheetField>
          <SheetField label="Age">
            <input
              value={sheet.age}
              disabled={!canEdit}
              onChange={(event) => update({ age: event.target.value })}
            />
          </SheetField>
          <SheetField label="Height">
            <input
              value={sheet.height}
              disabled={!canEdit}
              onChange={(event) => update({ height: event.target.value })}
            />
          </SheetField>
          <SheetField label="Weight">
            <input
              value={sheet.weight}
              disabled={!canEdit}
              onChange={(event) => update({ weight: event.target.value })}
            />
          </SheetField>
          <SheetField label="Eyes">
            <input
              value={sheet.eyes}
              disabled={!canEdit}
              onChange={(event) => update({ eyes: event.target.value })}
            />
          </SheetField>
          <SheetField label="Skin">
            <input
              value={sheet.skin}
              disabled={!canEdit}
              onChange={(event) => update({ skin: event.target.value })}
            />
          </SheetField>
          <SheetField label="Hair">
            <input
              value={sheet.hair}
              disabled={!canEdit}
              onChange={(event) => update({ hair: event.target.value })}
            />
          </SheetField>
        </div>
      </SheetSection>

      <SheetSection title="Story">
        <SheetField label="Backstory / personality / flaws, etc.">
          <textarea
            className="sheet-textarea-large"
            rows={storyRows}
            value={sheet.backstoryPersonality}
            disabled={!canEdit}
            onChange={(event) => update({ backstoryPersonality: event.target.value })}
          />
        </SheetField>
        <SheetField label="Notes">
          <textarea
            className="sheet-textarea-large"
            rows={storyRows}
            value={sheet.notes}
            disabled={!canEdit}
            onChange={(event) => update({ notes: event.target.value })}
          />
        </SheetField>
      </SheetSection>
    </div>
  );
}

/// <summary>
/// Sidebar character sheet form; editable for the owning player, read-only for the DM view.
/// </summary>
export function CharacterSheetPanel({
  sheet,
  canEdit,
  onChange,
  template,
  slotId,
  playerSlots,
  connectedPlayers,
  allSheets,
  isDm,
  dm,
  showSlotManagement = true,
  showPartySheets = false,
  embedded = false,
}: CharacterSheetProps) {
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const partySheetMode =
    (isDm && playerSlots && dm) || (showPartySheets && playerSlots && allSheets);

  if (partySheetMode) {
    const connectedBySlot = new Map(
      (connectedPlayers ?? []).map((player) => [player.playerId, player]),
    );

    const visibleSlots = showPartySheets
      ? playerSlots!.filter((slot) => slot.id !== slotId)
      : playerSlots!;

    const partyBody =
      visibleSlots.length === 0 ? (
        <p className="muted">
          {showSlotManagement
            ? "Create player slots so your party can join without duplicates."
            : showPartySheets
              ? "No other players have joined yet."
              : "Add player slots in the Players tab to view character sheets here."}
        </p>
      ) : (
        <div className="party-list party-grid">
          {visibleSlots.map((slot) => {
            const connected = connectedBySlot.get(slot.id);
            const playerSheet = allSheets?.[slot.id];
            return (
              <div key={slot.id} className="party-card party-card-sheet">
                {showSlotManagement && isDm && dm ? (
                  <div className="party-card-meta">
                    <input
                      className="slot-name-input"
                      value={slot.name}
                      onChange={(event) =>
                        dm.updatePlayerSlot({ ...slot, name: event.target.value })
                      }
                    />
                    <span className={`slot-connection${connected ? " online" : ""}`}>
                      {connected ? "Connected" : "Waiting"}
                    </span>
                    {confirmRemoveId === slot.id ? (
                      <div className="party-remove-confirm">
                        <button
                          type="button"
                          className="btn-compact"
                          onClick={() => setConfirmRemoveId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-compact danger"
                          onClick={() => {
                            dm.removePlayerSlot(slot.id);
                            setConfirmRemoveId(null);
                          }}
                        >
                          Confirm remove
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-compact danger"
                        disabled={Boolean(connected)}
                        onClick={() => setConfirmRemoveId(slot.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="party-card-heading">
                    <h3>{slot.name}</h3>
                    <span className={`slot-connection${connected ? " online" : ""}`}>
                      {connected ? "Connected" : "Waiting"}
                    </span>
                  </div>
                )}
                {playerSheet ? (
                  <CharacterSheetForm
                    sheet={playerSheet}
                    canEdit={false}
                    template={template}
                    slotId={slot.id}
                    compact
                  />
                ) : (
                  <p className="muted party-sheet-empty">
                    No sheet yet — the player fills this in after joining.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      );

    if (embedded) {
      return (
        <div
          className={`character-sheet-embedded party-panel${showSlotManagement ? "" : " party-panel-sheets-only"}`}
        >
          {showSlotManagement && isDm && dm ? (
            <div className="embedded-panel-toolbar">
              <button type="button" className="btn-compact" onClick={() => dm.addPlayerSlot("New player")}>
                + Slot
              </button>
            </div>
          ) : null}
          {partyBody}
        </div>
      );
    }

    return (
      <div className={`side-panel party-panel${showSlotManagement ? "" : " party-panel-sheets-only"}`}>
        <header className="side-panel-header">
          <h2>{showSlotManagement && isDm ? "Players" : "Character sheets"}</h2>
          {showSlotManagement && isDm && dm ? (
            <button type="button" className="btn-compact" onClick={() => dm.addPlayerSlot("New player")}>
              + Slot
            </button>
          ) : null}
        </header>
        <div className="side-panel-body">{partyBody}</div>
      </div>
    );
  }

  if (!sheet) {
    const empty = <p className="muted">Join as a player to edit your sheet.</p>;
    if (embedded) {
      return <div className="character-sheet-embedded">{empty}</div>;
    }
    return (
      <div className="side-panel">
        <header className="side-panel-header">
          <h2>Character sheet</h2>
        </header>
        <div className="side-panel-body">{empty}</div>
      </div>
    );
  }

  const form = (
    <CharacterSheetForm
      sheet={sheet}
      canEdit={canEdit}
      template={template}
      onChange={onChange}
      slotId={slotId}
    />
  );

  if (embedded) {
    return <div className="character-sheet-embedded">{form}</div>;
  }

  return (
    <div className="side-panel">
      <header className="side-panel-header">
        <h2>Character sheet</h2>
      </header>
      <div className="side-panel-body">{form}</div>
    </div>
  );
}
