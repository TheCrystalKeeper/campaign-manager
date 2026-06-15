import { useState } from "react";
import type { CharacterSheet, ConnectedPlayer, PlayerSlot } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type CharacterSheetProps = {
  sheet: CharacterSheet | null;
  canEdit: boolean;
  onChange: (sheet: CharacterSheet) => void;
  playerSlots?: PlayerSlot[];
  connectedPlayers?: ConnectedPlayer[];
  allSheets?: Record<string, CharacterSheet>;
  isDm?: boolean;
  dm?: ReturnType<typeof useDmActions>;
};

type CharacterSheetFormProps = {
  sheet: CharacterSheet;
  canEdit: boolean;
  onChange?: (sheet: CharacterSheet) => void;
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

/// <summary>
/// Shared character sheet fields for player edit and DM read-only views.
/// </summary>
function CharacterSheetForm({ sheet, canEdit, onChange, compact = false }: CharacterSheetFormProps) {
  const textRows = compact ? 3 : 5;

  const update = (partial: Partial<CharacterSheet>) => {
    if (!canEdit || !onChange) {
      return;
    }
    onChange({ ...sheet, ...partial });
  };

  return (
    <div className={`character-form${compact ? " character-form-compact" : ""}`}>
      <SheetSection title="Character">
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
            <input
              type="number"
              min={1}
              value={sheet.level}
              disabled={!canEdit}
              onChange={(event) => update({ level: Number(event.target.value) || 1 })}
            />
          </SheetField>
          <SheetField label="XP">
            <input
              type="number"
              min={0}
              value={sheet.xp}
              disabled={!canEdit}
              onChange={(event) => update({ xp: Number(event.target.value) || 0 })}
            />
          </SheetField>
        </div>
      </SheetSection>

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
            rows={textRows}
            value={sheet.backstoryPersonality}
            disabled={!canEdit}
            onChange={(event) => update({ backstoryPersonality: event.target.value })}
          />
        </SheetField>
        <SheetField label="Notes">
          <textarea
            rows={textRows}
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
  playerSlots,
  connectedPlayers,
  allSheets,
  isDm,
  dm,
}: CharacterSheetProps) {
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  if (isDm && playerSlots && dm) {
    const connectedBySlot = new Map(
      (connectedPlayers ?? []).map((player) => [player.playerId, player]),
    );

    return (
      <div className="side-panel party-panel">
        <header className="side-panel-header">
          <h2>Players</h2>
          <button type="button" className="btn-compact" onClick={() => dm.addPlayerSlot("New player")}>
            + Slot
          </button>
        </header>
        <div className="side-panel-body">
          {playerSlots.length === 0 ? (
            <p className="muted">Create player slots so your party can join without duplicates.</p>
          ) : (
            <div className="party-list party-grid">
              {playerSlots.map((slot) => {
                const connected = connectedBySlot.get(slot.id);
                const playerSheet = allSheets?.[slot.id];
                return (
                  <div key={slot.id} className="party-card party-card-sheet">
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
                    {playerSheet ? (
                      <CharacterSheetForm sheet={playerSheet} canEdit={false} compact />
                    ) : (
                      <p className="muted party-sheet-empty">
                        No sheet yet — the player fills this in after joining.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="side-panel">
        <header className="side-panel-header">
          <h2>Character sheet</h2>
        </header>
        <div className="side-panel-body">
          <p className="muted">Join as a player to edit your sheet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <header className="side-panel-header">
        <h2>Character sheet</h2>
      </header>
      <div className="side-panel-body">
        <CharacterSheetForm sheet={sheet} canEdit={canEdit} onChange={onChange} />
      </div>
    </div>
  );
}
