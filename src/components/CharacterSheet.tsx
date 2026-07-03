import { useEffect, useState, type ReactNode } from "react";
import {
  abilityModifier,
  createDefaultSheet,
  DEFAULT_SHEET_TEMPLATE,
  derivedStatTotal,
  formatModifier,
  type CharacterSheet,
  type SheetRecord,
  type SheetSectionId,
} from "../lib/types";
import { NumberInput } from "./NumberInput";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { uploadPortrait } from "../lib/uploadAsset";

type CharacterSheetPanelProps = {
  record: SheetRecord | null;
  canEdit: boolean;
  isDm: boolean;
  roomId: string;
  onChange: (sheet: CharacterSheet) => void;
  /** DM-only: flips a section's player visibility (NPC sheets). */
  onToggleReveal?: (section: SheetSectionId, revealed: boolean) => void;
  /** Click-to-roll (1d20 + modifier), attributed to this sheet. Shift = advantage, Alt = disadvantage. */
  onRoll?: (label: string, modifier: number, adv?: "adv" | "dis") => void;
};

const template = DEFAULT_SHEET_TEMPLATE;

/** Shift-click rolls with advantage, Alt-click with disadvantage. */
function advFromEvent(event: React.MouseEvent): "adv" | "dis" | undefined {
  if (event.shiftKey) return "adv";
  if (event.altKey) return "dis";
  return undefined;
}

const ROLL_HINT = "Click to roll (Shift = advantage, Alt = disadvantage)";

/// <summary>
/// One collapsible sheet section card. Cards are the reveal granularity: on NPC
/// sheets the DM gets a show/hide toggle per card, and players see "???" for
/// sections the server stripped.
/// </summary>
function SheetCard({
  title,
  hidden,
  revealToggle,
  children,
}: {
  title: string;
  /** Player-side: the server redacted this section. */
  hidden: boolean;
  /** DM-side reveal control for NPC sheets, or null. */
  revealToggle: { revealed: boolean; onToggle: (revealed: boolean) => void } | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="sheet-card">
      <header className="sheet-card-head">
        <button className="sheet-card-toggle" onClick={() => setOpen((v) => !v)}>
          <span className="chevron">{open ? "▾" : "▸"}</span>
          {title}
        </button>
        {revealToggle ? (
          <button
            className={`reveal-toggle ${revealToggle.revealed ? "reveal-toggle--on" : ""}`}
            title={
              revealToggle.revealed
                ? "Visible to players — click to hide"
                : "Hidden from players — click to reveal"
            }
            onClick={() => revealToggle.onToggle(!revealToggle.revealed)}
          >
            {revealToggle.revealed ? "👁 Shown" : "✕ Hidden"}
          </button>
        ) : null}
      </header>
      {open ? (
        hidden ? (
          <div className="sheet-card-body">
            <span className="muted">??? — not yet revealed</span>
          </div>
        ) : (
          <div className="sheet-card-body stack">{children}</div>
        )
      ) : null}
    </section>
  );
}

/// <summary>
/// A character sheet rendered as collapsible section cards. Editable by its
/// owner and by the DM (who edits NPC sheets in place); players see unrevealed
/// NPC sections as "???" — the data itself is stripped server-side.
/// </summary>
export function CharacterSheetPanel({
  record,
  canEdit,
  isDm,
  roomId,
  onChange,
  onToggleReveal,
  onRoll,
}: CharacterSheetPanelProps) {
  const [draft, setDraft] = useState<CharacterSheet>(record?.data ?? createDefaultSheet(""));
  const [uploading, setUploading] = useState(false);
  const { debounced } = useDebouncedCallback((next: CharacterSheet) => onChange(next), 400);

  // Reset the editable draft when switching which sheet is shown.
  useEffect(() => {
    setDraft(record?.data ?? createDefaultSheet(""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  if (!record) {
    return (
      <div className="panel-body">
        <span className="muted">This sheet no longer exists.</span>
      </div>
    );
  }

  const value = canEdit ? draft : record.data;

  const update = (patch: Partial<CharacterSheet>) => {
    if (!canEdit) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    debounced(next);
  };

  const handlePortrait = async (file: File) => {
    if (!canEdit) return;
    setUploading(true);
    try {
      const { url } = await uploadPortrait(roomId, record.id, file);
      update({ iconUrl: url });
    } catch {
      // Non-fatal: portrait stays unchanged.
    } finally {
      setUploading(false);
    }
  };

  /** Section is stripped for this viewer (players looking at unrevealed NPC data). */
  const hiddenFor = (section: SheetSectionId) =>
    !isDm && record.kind === "npc" && !record.revealed[section];

  /** DM-only reveal toggle, present on NPC sheet cards. */
  const revealToggleFor = (section: SheetSectionId) =>
    isDm && record.kind === "npc" && onToggleReveal
      ? {
          revealed: record.revealed[section],
          onToggle: (revealed: boolean) => onToggleReveal(section, revealed),
        }
      : null;

  return (
    // sheet-body: goes multi-column when its container (window / page) is wide.
    <div className="panel-body stack sheet-body">
      <SheetCard
        title="Identity"
        hidden={hiddenFor("identity")}
        revealToggle={revealToggleFor("identity")}
      >
        <div className="sheet-top">
          {canEdit ? (
            <label
              className="sheet-portrait-btn"
              title="Click to upload a portrait"
            >
              {value.iconUrl ? (
                <img className="sheet-portrait" src={value.iconUrl} alt="portrait" />
              ) : (
                <div className="sheet-portrait sheet-portrait--empty">
                  <span>{uploading ? "…" : "＋"}</span>
                </div>
              )}
              <span className="sheet-portrait-hint">
                {uploading ? "Uploading…" : value.iconUrl ? "Change" : "Add photo"}
              </span>
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePortrait(file);
                }}
              />
            </label>
          ) : value.iconUrl ? (
            <img className="sheet-portrait" src={value.iconUrl} alt="portrait" />
          ) : (
            <div className="sheet-portrait" />
          )}
          <div style={{ flex: 1 }}>
            <label>Character name</label>
            <input
              value={value.characterName}
              disabled={!canEdit}
              onChange={(e) => update({ characterName: e.target.value })}
            />
          </div>
        </div>

        <div className="grid-2">
          <div>
            <label>Class</label>
            <input
              value={value.characterClass}
              disabled={!canEdit}
              onChange={(e) => update({ characterClass: e.target.value })}
            />
          </div>
          <div>
            <label>Level</label>
            <NumberInput
              value={value.level}
              min={1}
              allowNegative={false}
              disabled={!canEdit}
              onCommit={(level) => update({ level })}
            />
          </div>
          <div>
            <label>Race</label>
            <input
              value={value.race}
              disabled={!canEdit}
              onChange={(e) => update({ race: e.target.value })}
            />
          </div>
          <div>
            <label>Alignment</label>
            <input
              value={value.alignment}
              disabled={!canEdit}
              onChange={(e) => update({ alignment: e.target.value })}
            />
          </div>
        </div>
      </SheetCard>

      <SheetCard
        title="Combat"
        hidden={hiddenFor("combat")}
        revealToggle={revealToggleFor("combat")}
      >
        <div className="grid-3">
          <div>
            <label>HP</label>
            <div className="row">
              <NumberInput
                value={value.hp.current}
                disabled={!canEdit}
                onCommit={(current) => update({ hp: { ...value.hp, current } })}
                aria-label="Current HP"
              />
              <span className="muted">/</span>
              <NumberInput
                value={value.hp.max}
                disabled={!canEdit}
                onCommit={(max) => update({ hp: { ...value.hp, max } })}
                aria-label="Max HP"
              />
            </div>
          </div>
          <div>
            <label>AC</label>
            <NumberInput value={value.ac} disabled={!canEdit} onCommit={(ac) => update({ ac })} />
          </div>
          <div>
            <label>Init</label>
            <div className="row">
              <NumberInput
                value={value.initiative}
                disabled={!canEdit}
                onCommit={(initiative) => update({ initiative })}
              />
              {onRoll ? (
                <button
                  className="roll-btn"
                  title={ROLL_HINT}
                  onClick={(e) => onRoll("Initiative", value.initiative, advFromEvent(e))}
                >
                  🎲
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </SheetCard>

      <SheetCard
        title="Abilities"
        hidden={hiddenFor("abilities")}
        revealToggle={revealToggleFor("abilities")}
      >
        <div className="grid-3">
          {template.abilities.map((ability) => {
            const score = value.abilityScores[ability.id] ?? 10;
            const mod = abilityModifier(score);
            return (
              <div className="ability" key={ability.id}>
                <div className="abbr">{ability.abbr}</div>
                {onRoll ? (
                  <button
                    className="mod roll-btn"
                    title={`${ability.name} check — ${ROLL_HINT}`}
                    onClick={(e) => onRoll(`${ability.name} check`, mod, advFromEvent(e))}
                  >
                    {formatModifier(mod)}
                  </button>
                ) : (
                  <div className="mod">{formatModifier(mod)}</div>
                )}
                <NumberInput
                  value={score}
                  min={1}
                  allowNegative={false}
                  disabled={!canEdit}
                  onCommit={(next) =>
                    update({ abilityScores: { ...value.abilityScores, [ability.id]: next } })
                  }
                  aria-label={ability.name}
                />
              </div>
            );
          })}
        </div>
      </SheetCard>

      <SheetCard
        title="Saving throws"
        hidden={hiddenFor("saves")}
        revealToggle={revealToggleFor("saves")}
      >
        {template.saves.map((save) => {
          const manual = value.saveMods[save.id] ?? 0;
          const total = derivedStatTotal(save, manual, value.abilityScores);
          return (
            <div className="stat-row" key={save.id}>
              <span>{save.name}</span>
              <NumberInput
                value={manual}
                disabled={!canEdit}
                onCommit={(next) => update({ saveMods: { ...value.saveMods, [save.id]: next } })}
                aria-label={`${save.name} save modifier`}
              />
              {onRoll ? (
                <button
                  className="total roll-btn"
                  title={`${save.name} save — ${ROLL_HINT}`}
                  onClick={(e) => onRoll(`${save.name} save`, total, advFromEvent(e))}
                >
                  {formatModifier(total)}
                </button>
              ) : (
                <span className="total">{formatModifier(total)}</span>
              )}
            </div>
          );
        })}
      </SheetCard>

      <SheetCard
        title="Skills"
        hidden={hiddenFor("skills")}
        revealToggle={revealToggleFor("skills")}
      >
        {template.skills.map((skill) => {
          const manual = value.skillMods[skill.id] ?? 0;
          const total = derivedStatTotal(skill, manual, value.abilityScores);
          return (
            <div className="stat-row" key={skill.id}>
              <span>{skill.name}</span>
              <NumberInput
                value={manual}
                disabled={!canEdit}
                onCommit={(next) => update({ skillMods: { ...value.skillMods, [skill.id]: next } })}
                aria-label={`${skill.name} modifier`}
              />
              {onRoll ? (
                <button
                  className="total roll-btn"
                  title={`${skill.name} check — ${ROLL_HINT}`}
                  onClick={(e) => onRoll(`${skill.name} check`, total, advFromEvent(e))}
                >
                  {formatModifier(total)}
                </button>
              ) : (
                <span className="total">{formatModifier(total)}</span>
              )}
            </div>
          );
        })}
      </SheetCard>

      <SheetCard
        title="Inventory"
        hidden={hiddenFor("inventory")}
        revealToggle={revealToggleFor("inventory")}
      >
        <div
          className="stack"
          // Drop target for pointer-dragged items from the Items directory.
          data-inv-drop={canEdit ? record.id : undefined}
        >
          {value.inventory.length === 0 ? (
            <span className="muted" style={{ fontSize: "0.78rem" }}>
              {canEdit && isDm
                ? "Empty. Drag items here from the Items tab, or add a row."
                : "Empty."}
            </span>
          ) : null}
          {value.inventory.map((entry, index) => (
            <div className="inv-row" key={index}>
              <input
                value={entry.name}
                disabled={!canEdit}
                aria-label="Item name"
                onChange={(e) =>
                  update({
                    inventory: value.inventory.map((row, i) =>
                      i === index ? { ...row, name: e.target.value } : row,
                    ),
                  })
                }
              />
              <NumberInput
                value={entry.qty}
                min={1}
                allowNegative={false}
                disabled={!canEdit}
                aria-label="Quantity"
                onCommit={(qty) =>
                  update({
                    inventory: value.inventory.map((row, i) =>
                      i === index ? { ...row, qty } : row,
                    ),
                  })
                }
              />
              <input
                value={entry.note}
                disabled={!canEdit}
                placeholder="note"
                aria-label="Item note"
                onChange={(e) =>
                  update({
                    inventory: value.inventory.map((row, i) =>
                      i === index ? { ...row, note: e.target.value } : row,
                    ),
                  })
                }
              />
              {canEdit ? (
                <button
                  className="btn-ghost icon-btn"
                  title="Remove"
                  onClick={() =>
                    update({ inventory: value.inventory.filter((_, i) => i !== index) })
                  }
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {canEdit ? (
            <button
              onClick={() =>
                update({
                  inventory: [...value.inventory, { itemId: null, name: "New item", qty: 1, note: "" }],
                })
              }
            >
              ＋ Add row
            </button>
          ) : null}
        </div>
      </SheetCard>

      <SheetCard title="Notes" hidden={hiddenFor("notes")} revealToggle={revealToggleFor("notes")}>
        <textarea
          value={value.notes}
          disabled={!canEdit}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Backstory, reminders…"
        />
      </SheetCard>
    </div>
  );
}
