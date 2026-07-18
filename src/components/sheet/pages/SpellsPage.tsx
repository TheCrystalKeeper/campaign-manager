import { useState, type ReactElement } from "react";
import { Sparkles } from "lucide-react";
import {
  CASTER_TYPES,
  DEFAULT_SHEET_TEMPLATE,
  type CasterType,
  rowId,
  type SpellEntry,
} from "../../../lib/types";
import { NumberInput } from "../../NumberInput";
import { RowTable, type RowGroup } from "../RowTable";
import { DerivedNumber, SlotPips } from "../atoms";
import { type SheetEdit } from "../context";
import { SpellPickerModal } from "../SpellPickerModal";

function levelTitle(level: number): string {
  return level === 0 ? "Cantrips" : `Level ${level}`;
}

const CASTER_TYPE_LABELS: Record<CasterType, string> = {
  none: "Manual",
  full: "Full caster",
  half: "Half caster",
  third: "Third caster",
  pact: "Pact (warlock)",
};

/**
 * The Spells page: the spellcasting header (ability / caster type / attack / save DC),
 * spell-slot pips per level, and a per-level spell list. Always present — simply empty
 * for non-casters (never hidden). Rules engine (PC): picking a casting ability derives
 * attack/DC (prof + mod / 8 + prof + mod, override-aware); picking a caster type
 * derives slot maximums from level.
 */
export function SpellsPage({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, isDm, derived, setOverride, update, actions } = sheet;
  const [srdPickerOpen, setSrdPickerOpen] = useState(false);

  const patchSpell = (id: string, patch: Partial<SpellEntry>) =>
    update({ spells: value.spells.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const addSpell = (level: number) =>
    update({ spells: [...value.spells, { id: rowId("spell"), name: "New spell", level }] });

  const setSlot = (level: number, patch: { current?: number; max?: number }) => {
    const cur = value.spellSlots[String(level)] ?? { current: 0, max: 0 };
    update({ spellSlots: { ...value.spellSlots, [String(level)]: { ...cur, ...patch } } });
  };

  const levels = [...new Set(value.spells.map((s) => s.level))].sort((a, b) => a - b);
  const groups: RowGroup<SpellEntry>[] = levels.map((level) => ({
    id: String(level),
    title: levelTitle(level),
    rows: value.spells.filter((s) => s.level === level),
    onAdd: canEdit ? () => addSpell(level) : undefined,
  }));

  // Slot maximums: auto caster types derive them from level (max inputs hidden);
  // "Manual" keeps the stored per-level maximums editable. Multiclassed sheets
  // (2+ classes) derive pooled maxes from the class list regardless of casterType.
  const autoSlots =
    derived.auto &&
    (value.spellcasting.casterType !== "none" ||
      (value.classes.length >= 2 && Object.keys(derived.slotMaxes).length > 0));
  const slotMax = (lv: number) =>
    autoSlots ? derived.slotMaxes[String(lv)] ?? 0 : value.spellSlots[String(lv)]?.max ?? 0;
  const slotLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((lv) =>
    autoSlots ? slotMax(lv) > 0 : canEdit || slotMax(lv) > 0,
  );

  // Attack/DC derive once a casting ability is picked; the manual numbers remain the
  // fallback while it's unset (and always for NPCs).
  const autoCasting = derived.auto && Boolean(value.spellcasting.abilityId);

  const castingStat = (key: "spell-attack" | "spell-dc", label: string, manual: ReactElement) =>
    autoCasting ? (
      <DerivedNumber
        value={derived.values[key] ?? 0}
        base={derived.base[key] ?? 0}
        overridden={value.overrides[key] !== undefined}
        canEdit={canEdit}
        onCommit={(next) => setOverride(key, next)}
        onReset={() => setOverride(key, null)}
        className="sc-value"
        formatted={key === "spell-attack"}
        ariaLabel={label}
      />
    ) : (
      manual
    );

  return (
    <div className="sheet-page spells-page">
      <div className="spellcasting-card sheet-section">
        <div className="spellcasting-cell">
          <span className="sc-label">Ability</span>
          {canEdit ? (
            <select value={value.spellcasting.abilityId} onChange={(e) => update({ spellcasting: { ...value.spellcasting, abilityId: e.target.value } })}>
              <option value="">—</option>
              {DEFAULT_SHEET_TEMPLATE.abilities.map((a) => (
                <option key={a.id} value={a.id}>{a.abbr}</option>
              ))}
            </select>
          ) : (
            <span className="sc-value">{DEFAULT_SHEET_TEMPLATE.abilities.find((a) => a.id === value.spellcasting.abilityId)?.abbr ?? "—"}</span>
          )}
        </div>
        {derived.auto ? (
          <div className="spellcasting-cell">
            <span className="sc-label">Slots</span>
            {canEdit ? (
              <select
                value={value.spellcasting.casterType}
                aria-label="Caster type"
                onChange={(e) => update({ spellcasting: { ...value.spellcasting, casterType: e.target.value as CasterType } })}
              >
                {CASTER_TYPES.map((type) => (
                  <option key={type} value={type}>{CASTER_TYPE_LABELS[type]}</option>
                ))}
              </select>
            ) : (
              <span className="sc-value">{CASTER_TYPE_LABELS[value.spellcasting.casterType]}</span>
            )}
          </div>
        ) : null}
        <div className="spellcasting-cell">
          <span className="sc-label">Attack</span>
          {castingStat(
            "spell-attack",
            "Spell attack bonus",
            canEdit ? (
              <NumberInput className="sc-value" value={value.spellcasting.attackBonus} onCommit={(attackBonus) => update({ spellcasting: { ...value.spellcasting, attackBonus } })} aria-label="Spell attack bonus" />
            ) : (
              <span className="sc-value">{value.spellcasting.attackBonus >= 0 ? `+${value.spellcasting.attackBonus}` : value.spellcasting.attackBonus}</span>
            ),
          )}
        </div>
        <div className="spellcasting-cell">
          <span className="sc-label">Spell DC</span>
          {castingStat(
            "spell-dc",
            "Spell save DC",
            canEdit ? (
              <NumberInput className="sc-value" value={value.spellcasting.saveDc} min={0} allowNegative={false} onCommit={(saveDc) => update({ spellcasting: { ...value.spellcasting, saveDc } })} aria-label="Spell save DC" />
            ) : (
              <span className="sc-value">{value.spellcasting.saveDc}</span>
            ),
          )}
        </div>
      </div>

      {slotLevels.length > 0 ? (
        <div className="spell-slots sheet-section">
          {slotLevels.map((lv) => {
            const max = slotMax(lv);
            // Auto slots: an absent stored entry means "never spent" = full.
            const current = Math.min(value.spellSlots[String(lv)]?.current ?? (autoSlots ? max : 0), max);
            return (
              <div className="spell-slot-row" key={lv}>
                <span className="spell-slot-lv">Lv {lv}</span>
                <SlotPips
                  current={current}
                  max={max}
                  disabled={!canEdit}
                  onChange={(next) => setSlot(lv, { current: next, ...(autoSlots ? { max } : {}) })}
                />
                {canEdit && !autoSlots ? (
                  <span className="spell-slot-max">
                    max <NumberInput value={max} min={0} allowNegative={false} onCommit={(next) => setSlot(lv, { max: next, current: Math.min(current, next) })} aria-label={`Level ${lv} max slots`} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {canEdit ? (
        <div className="spell-add-bar">
          <button type="button" className="btn-ghost" onClick={() => addSpell(0)}>＋ Cantrip</button>
          <button type="button" className="btn-ghost" onClick={() => addSpell(1)}>＋ Spell</button>
          {isDm ? (
            <button
              type="button"
              className="btn-ghost"
              title="Browse the full SRD spell list (DM only)"
              onClick={() => setSrdPickerOpen(true)}
            >
              ＋ From SRD
            </button>
          ) : null}
        </div>
      ) : null}
      {srdPickerOpen ? <SpellPickerModal sheet={sheet} onClose={() => setSrdPickerOpen(false)} /> : null}

      <RowTable
        groups={groups}
        canEdit={canEdit}
        getSearchText={(r) => `${r.name} ${r.components ?? ""}`}
        emptyHint="No spells. This page stays available for non-casters."
        onRemove={canEdit ? (row) => update({ spells: value.spells.filter((s) => s.id !== row.id) }) : undefined}
        renderName={(row) => (
          <div className="inv-name">
            {canEdit ? (
              <input className="inv-name-input" value={row.name} onChange={(e) => patchSpell(row.id, { name: e.target.value })} aria-label="Spell name" />
            ) : (
              <span className="inv-name-text">{row.name}</span>
            )}
            {row.components ? <span className="inv-subtitle">{row.components}</span> : null}
          </div>
        )}
        renderCells={(row) => (
          <>
            <span className="inv-cell inv-cell--sm">{row.time || "—"}</span>
            <span className="inv-cell inv-cell--sm">{row.range || "—"}</span>
            <span className="inv-cell inv-cell--sm">{row.target || "—"}</span>
            <span className="inv-cell inv-equip">
              {actions && canEdit && row.level >= 1 ? (
                <button
                  type="button"
                  className="cast-btn"
                  title={`Cast (spends a level-${row.level} slot)`}
                  onClick={() => actions.castSpell(row.level)}
                >
                  <Sparkles size={14} strokeWidth={2.2} />
                </button>
              ) : null}
              <button
                type="button"
                className={`prepared-toggle ${row.prepared ? "prepared-toggle--on" : ""}`}
                disabled={!canEdit}
                title={row.prepared ? "Prepared" : "Not prepared"}
                onClick={() => patchSpell(row.id, { prepared: !row.prepared })}
              >
                ✓
              </button>
            </span>
          </>
        )}
        renderExpand={(row) => (
          <div className="inv-expand">
            <div className="inv-expand-grid">
              <label>Level</label>
              <NumberInput value={row.level} min={0} max={9} allowNegative={false} disabled={!canEdit} onCommit={(level) => patchSpell(row.id, { level })} aria-label="Spell level" />
              <label>Components</label>
              <input value={row.components ?? ""} disabled={!canEdit} placeholder="V,S,M" onChange={(e) => patchSpell(row.id, { components: e.target.value })} />
              <label>Time</label>
              <input value={row.time ?? ""} disabled={!canEdit} onChange={(e) => patchSpell(row.id, { time: e.target.value })} />
              <label>Range</label>
              <input value={row.range ?? ""} disabled={!canEdit} onChange={(e) => patchSpell(row.id, { range: e.target.value })} />
              <label>Target</label>
              <input value={row.target ?? ""} disabled={!canEdit} onChange={(e) => patchSpell(row.id, { target: e.target.value })} />
              <label>Roll</label>
              <input value={row.roll ?? ""} disabled={!canEdit} placeholder="e.g. 2d8" onChange={(e) => patchSpell(row.id, { roll: e.target.value })} />
            </div>
            <label>Description</label>
            <textarea value={row.description ?? ""} disabled={!canEdit} rows={3} onChange={(e) => patchSpell(row.id, { description: e.target.value })} />
          </div>
        )}
      />
    </div>
  );
}
