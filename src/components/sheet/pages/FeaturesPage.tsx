import {
  DEFAULT_SHEET_TEMPLATE,
  rowId,
  type AttackEntry,
  type FeatureEntry,
} from "../../../lib/types";
import { attackModParts, sumParts } from "../../../lib/rules5e";
import { NumberInput } from "../../NumberInput";
import { RowTable, type RowGroup } from "../RowTable";
import { UsesCell } from "../atoms";
import { advFromEvent, ROLL_HINT, type SheetEdit } from "../context";
import { AbilityRow, SavesRow } from "./MainPage";


type AttackRow = AttackEntry & { derived?: boolean };

/** The melee/ranged tag picker — routes the global weapon/spell attack+damage bonuses. */
export function RangeTagSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (range: "melee" | "ranged" | undefined) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label="Melee or ranged"
      onChange={(e) => onChange(e.target.value === "melee" || e.target.value === "ranged" ? e.target.value : undefined)}
    >
      <option value="">—</option>
      <option value="melee">Melee</option>
      <option value="ranged">Ranged</option>
    </select>
  );
}

/** The auto-to-hit ability picker (rules engine): manual, one of the six, or Spell. */
export function ToHitAbilitySelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (toHitAbility: string | undefined) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label="Auto to-hit"
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">Manual</option>
      {DEFAULT_SHEET_TEMPLATE.abilities.map((a) => (
        <option key={a.id} value={a.id}>{a.abbr} + Prof</option>
      ))}
      <option value="spell">Spell ability + Prof</option>
    </select>
  );
}

const FEATURE_GROUPS: Array<{ id: FeatureEntry["source"]; title: string }> = [
  { id: "class", title: "Class Features" },
  { id: "species", title: "Species Features" },
  { id: "feat", title: "Feats" },
  { id: "other", title: "Other" },
];

/**
 * The Features page. For NPCs this is the home page: it leads with the ability blocks +
 * saving-throw row (the missing Main tab), then an Actions table, then Features. The
 * Actions table merges manual `attacks` with equipped inventory weapons (derived rows,
 * read-only here — edit them in Inventory).
 */
export function FeaturesPage({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, kind, derived, update, onRollCheck, actions } = sheet;
  const isNpc = kind === "npc";

  const derivedRows: AttackRow[] = value.inventory
    .filter((r) => r.equipped && r.damage)
    .map((r) => ({
      id: `inv:${r.id}`,
      name: r.name,
      toHit: r.toHit ?? 0,
      damage: r.damage ?? "",
      damageType: r.damageType,
      toHitAbility: r.toHitAbility,
      range: r.range,
      derived: true,
    }));
  const attackRows: AttackRow[] = [...value.attacks, ...derivedRows];

  // Rules engine: to-hit displays as the sum of the SAME parts the roll resolver
  // uses (auto ability + prof, or manual, plus tagged global bonuses).
  const rowToHit = (row: AttackRow) =>
    derived.auto ? sumParts(attackModParts(value, row, derived.values["prof"] ?? 0)) : row.toHit;

  const patchAttack = (id: string, patch: Partial<AttackEntry>) =>
    update({ attacks: value.attacks.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const addAttack = () =>
    update({ attacks: [...value.attacks, { id: rowId("atk"), name: "New action", toHit: 0, damage: "1d6" }] });

  const patchFeature = (id: string, patch: Partial<FeatureEntry>) =>
    update({ features: value.features.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
  const addFeature = (source: FeatureEntry["source"]) =>
    update({ features: [...value.features, { id: rowId("feat"), name: "New feature", source, description: "" }] });

  const featureGroups: RowGroup<FeatureEntry>[] = FEATURE_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    rows: value.features.filter((f) => f.source === g.id),
    onAdd: canEdit ? () => addFeature(g.id) : undefined,
  }));

  return (
    <div className="sheet-page features-page">
      {isNpc ? (
        <div className="npc-stat-header">
          <AbilityRow sheet={sheet} />
          <SavesRow sheet={sheet} />
        </div>
      ) : (
        <div className="class-chip">
          {value.characterClass || "Class"} {value.subclass ? `· ${value.subclass}` : ""} {value.level}
        </div>
      )}

      <RowTable
        groups={[{ id: "actions", title: isNpc ? "Actions" : "Attacks & Actions", rows: attackRows, onAdd: canEdit ? addAttack : undefined }]}
        canEdit={canEdit}
        getSearchText={(r) => r.name}
        emptyHint="No actions. Add one, or equip a weapon in Inventory."
        onRemove={canEdit ? (row) => { if (!row.derived) update({ attacks: value.attacks.filter((a) => a.id !== row.id) }); } : undefined}
        renderName={(row) => (
          <div className="inv-name">
            {canEdit && !row.derived ? (
              <input className="inv-name-input" value={row.name} onChange={(e) => patchAttack(row.id, { name: e.target.value })} aria-label="Action name" />
            ) : (
              <span className="inv-name-text">{row.name}{row.derived ? <span className="inv-subtitle">equipped</span> : null}</span>
            )}
          </div>
        )}
        renderCells={(row) => (
          <>
            <span className="inv-cell">
              {onRollCheck ? (
                <button className="roll-btn" title={`${row.name} attack — ${ROLL_HINT}`} onClick={(e) => onRollCheck({ kind: "attack", rowId: row.id }, advFromEvent(e))}>
                  {rowToHit(row) >= 0 ? `+${rowToHit(row)}` : rowToHit(row)}
                </button>
              ) : (
                <span>{rowToHit(row) >= 0 ? `+${rowToHit(row)}` : rowToHit(row)}</span>
              )}
            </span>
            <span className="inv-cell">
              {onRollCheck && row.damage ? (
                <button
                  className="roll-btn"
                  title={`${row.name} damage — Shift-click for crit damage`}
                  onClick={(e) => onRollCheck({ kind: "damage", rowId: row.id, crit: e.shiftKey || undefined })}
                >
                  {row.damage}
                </button>
              ) : (
                <span>{row.damage || "—"}</span>
              )}
            </span>
          </>
        )}
        renderExpand={(row) =>
          row.derived ? (
            <div className="rt-expand-note muted">Edit this weapon in the Inventory page.</div>
          ) : (
            <div className="inv-expand">
              <div className="inv-expand-grid">
                {!isNpc ? (
                  <>
                    <label>Auto to-hit</label>
                    <ToHitAbilitySelect
                      value={row.toHitAbility ?? ""}
                      disabled={!canEdit}
                      onChange={(toHitAbility) => patchAttack(row.id, { toHitAbility })}
                    />
                    <label>Range</label>
                    <RangeTagSelect
                      value={row.range ?? ""}
                      disabled={!canEdit}
                      onChange={(range) => patchAttack(row.id, { range })}
                    />
                  </>
                ) : null}
                <label>To hit</label>
                <NumberInput
                  value={row.toHitAbility && !isNpc ? rowToHit(row) : row.toHit}
                  disabled={!canEdit || (!isNpc && Boolean(row.toHitAbility))}
                  onCommit={(toHit) => patchAttack(row.id, { toHit })}
                  aria-label="To hit"
                />
                <label>Damage</label>
                <input value={row.damage} disabled={!canEdit} onChange={(e) => patchAttack(row.id, { damage: e.target.value })} />
                <label>Type</label>
                <input value={row.damageType ?? ""} disabled={!canEdit} onChange={(e) => patchAttack(row.id, { damageType: e.target.value })} />
              </div>
              <label>Notes</label>
              <textarea value={row.notes ?? ""} disabled={!canEdit} rows={2} onChange={(e) => patchAttack(row.id, { notes: e.target.value })} />
            </div>
          )
        }
      />

      <RowTable
        groups={featureGroups}
        canEdit={canEdit}
        getSearchText={(r) => r.name}
        emptyHint="No features."
        onRemove={canEdit ? (row) => update({ features: value.features.filter((f) => f.id !== row.id) }) : undefined}
        renderName={(row) => (
          <div className="inv-name">
            {canEdit ? (
              <input className="inv-name-input" value={row.name} onChange={(e) => patchFeature(row.id, { name: e.target.value })} aria-label="Feature name" />
            ) : (
              <span className="inv-name-text">{row.name}</span>
            )}
          </div>
        )}
        renderCells={(row) => (
          <>
            <span className="inv-cell" title="Uses">
              {actions && canEdit && (row.uses?.max ?? 0) > 0 ? (
                <button
                  type="button"
                  className="use-btn"
                  disabled={(row.uses?.current ?? 0) <= 0}
                  title={`Use ${row.name} (${row.uses?.current ?? 0}/${row.uses?.max ?? 0} left)`}
                  onClick={() => actions.useFeature(row.id)}
                >
                  ▶
                </button>
              ) : null}
              {row.uses || canEdit ? (
                <UsesCell
                  current={row.uses?.current ?? 0}
                  max={row.uses?.max ?? 0}
                  disabled={!canEdit}
                  onCurrent={(current) => patchFeature(row.id, { uses: { current, max: row.uses?.max ?? 0 } })}
                  onMax={(max) => patchFeature(row.id, { uses: { current: row.uses?.current ?? 0, max } })}
                />
              ) : (
                <span>—</span>
              )}
            </span>
            <span className="inv-cell" title="Recovery">
              {canEdit ? (
                <select value={row.recovery ?? ""} onChange={(e) => patchFeature(row.id, { recovery: (e.target.value || undefined) as FeatureEntry["recovery"] })}>
                  <option value="">—</option>
                  <option value="sr">SR</option>
                  <option value="lr">LR</option>
                </select>
              ) : (
                <span>{row.recovery ? row.recovery.toUpperCase() : "—"}</span>
              )}
            </span>
          </>
        )}
        renderExpand={(row) => (
          <div className="inv-expand">
            <label>Description</label>
            <textarea value={row.description} disabled={!canEdit} rows={3} onChange={(e) => patchFeature(row.id, { description: e.target.value })} />
          </div>
        )}
      />
    </div>
  );
}
