import { useState } from "react";
import { Shield } from "lucide-react";
import {
  createInventoryRow,
  INVENTORY_CATEGORIES,
  SHEET_ROW_CAPS,
  type Currency,
  type InventoryCategory,
  type InventoryEntry,
} from "../../../lib/types";
import { inventoryRowFromEquipment, inventoryRowFromMagicItem } from "../../../lib/compendiumMap";
import { attackModParts, sumParts } from "../../../lib/rules5e";
import { NumberInput } from "../../NumberInput";
import { RowTable, type RowGroup } from "../RowTable";
import { SrdItemPickerModal } from "../../SrdItemPickerModal";
import { DerivedNumber } from "../atoms";
import { advFromEvent, ROLL_HINT, type SheetEdit } from "../context";
import { RangeTagSelect, ToHitAbilitySelect } from "./FeaturesPage";


const CATEGORY_TITLES: Record<InventoryCategory, string> = {
  weapon: "Weapons",
  equipment: "Equipment",
  consumable: "Consumables",
  loot: "Loot",
};

const CURRENCY_KEYS: Array<{ key: keyof Currency; label: string }> = [
  { key: "cp", label: "CP" },
  { key: "sp", label: "SP" },
  { key: "ep", label: "EP" },
  { key: "gp", label: "GP" },
  { key: "pp", label: "PP" },
];

/**
 * The Inventory page: encumbrance header (carried weight vs manual capacity), currency,
 * attunement counter, and item tables grouped by category. Carried weight is a
 * client-side display sum — no rules automation (Phase 7 manual-fields-first).
 */
export function InventoryPage({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, isDm, derived, setOverride, update, onRollCheck, actions } = sheet;
  const [srdPickerOpen, setSrdPickerOpen] = useState(false);

  const setRows = (rows: InventoryEntry[]) => update({ inventory: rows });
  const appendRow = (row: InventoryEntry) =>
    update({ inventory: [...sheet.value.inventory, row].slice(0, SHEET_ROW_CAPS.inventory) });
  const patchRow = (id: string, patch: Partial<InventoryEntry>) =>
    setRows(value.inventory.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const carried = value.inventory.reduce((sum, r) => sum + (r.weight ?? 0) * r.qty, 0);
  // PC capacity derives from STR × 15 × multiplier (override-aware); NPC stays manual.
  const capacity = derived.values["carry-capacity"] ?? value.carryCapacity;
  const over = capacity > 0 && carried > capacity;
  const attunedCount = value.inventory.filter((r) => r.attuned).length;

  // Rules engine: to-hit displays as the sum of the SAME parts the roll resolver
  // uses (auto ability + prof, or manual, plus tagged global bonuses).
  const rowToHit = (row: InventoryEntry) =>
    derived.auto
      ? sumParts(attackModParts(value, { ...row, toHit: row.toHit ?? 0 }, derived.values["prof"] ?? 0))
      : row.toHit ?? 0;

  const groups: RowGroup<InventoryEntry>[] = INVENTORY_CATEGORIES.map((category) => ({
    id: category,
    title: CATEGORY_TITLES[category],
    rows: value.inventory.filter((r) => r.category === category),
    onAdd: canEdit ? () => setRows([...value.inventory, createInventoryRow({ category })]) : undefined,
  }));

  return (
    <div className="sheet-page inventory-page">
      <div className="encumbrance sheet-section">
        <div className={`encumbrance-bar ${over ? "encumbrance-bar--over" : ""}`}>
          <div
            className="encumbrance-fill"
            style={{ width: `${capacity > 0 ? Math.min(100, (carried / capacity) * 100) : 0}%` }}
          />
          <span className="encumbrance-text">
            {carried.toFixed(carried % 1 ? 1 : 0)} / {capacity || "—"}
          </span>
        </div>
        <div className="encumbrance-stats">
          <div className="enc-stat">
            <span className="enc-stat-label">Strength</span>
            <span className="enc-stat-value">{value.abilityScores["str"] ?? 10}</span>
          </div>
          <div className="enc-stat">
            <span className="enc-stat-label">Size</span>
            <span className="enc-stat-value">{value.size || "—"}</span>
          </div>
          <div className="enc-stat">
            <span className="enc-stat-label">Capacity</span>
            {derived.auto ? (
              <DerivedNumber
                value={capacity}
                base={derived.base["carry-capacity"] ?? 0}
                overridden={value.overrides["carry-capacity"] !== undefined}
                canEdit={canEdit}
                onCommit={(next) => setOverride("carry-capacity", next)}
                onReset={() => setOverride("carry-capacity", null)}
                ariaLabel="Carry capacity"
              />
            ) : canEdit ? (
              <NumberInput value={value.carryCapacity} min={0} allowNegative={false} onCommit={(carryCapacity) => update({ carryCapacity })} aria-label="Carry capacity" />
            ) : (
              <span className="enc-stat-value">{value.carryCapacity}</span>
            )}
          </div>
          <div className="enc-stat">
            <span className="enc-stat-label">Attunement</span>
            <span className="enc-stat-value">
              {attunedCount} /{" "}
              {canEdit ? (
                <NumberInput className="enc-attune-max" value={value.attunementMax} min={0} allowNegative={false} onCommit={(attunementMax) => update({ attunementMax })} aria-label="Attunement max" />
              ) : (
                value.attunementMax
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="currency-row sheet-section">
        {CURRENCY_KEYS.map(({ key, label }) => (
          <div className="currency-cell" key={key}>
            <span className="currency-label">{label}</span>
            {canEdit ? (
              <NumberInput value={value.currency[key]} min={0} allowNegative={false} onCommit={(n) => update({ currency: { ...value.currency, [key]: n } })} aria-label={label} />
            ) : (
              <span>{value.currency[key]}</span>
            )}
          </div>
        ))}
      </div>

      {canEdit && isDm ? (
        <div className="spell-add-bar">
          <button
            type="button"
            className="btn-ghost"
            title="Browse the full compendium item list (DM only)"
            onClick={() => setSrdPickerOpen(true)}
          >
            ＋ From compendium
          </button>
        </div>
      ) : null}
      {srdPickerOpen ? (
        <SrdItemPickerModal
          onPickEquipment={(eq) => appendRow(inventoryRowFromEquipment(eq))}
          onPickMagicItem={(mi) => appendRow(inventoryRowFromMagicItem(mi))}
          onClose={() => setSrdPickerOpen(false)}
        />
      ) : null}

      <RowTable
        groups={groups}
        canEdit={canEdit}
        getSearchText={(r) => `${r.name} ${r.note} ${r.damageType ?? ""}`}
        emptyHint="No items. Drag from the Items tab, or add a row per category."
        onRemove={canEdit ? (row) => setRows(value.inventory.filter((r) => r.id !== row.id)) : undefined}
        renderName={(row) => (
          <div className="inv-name">
            {canEdit ? (
              <input className="inv-name-input" value={row.name} onChange={(e) => patchRow(row.id, { name: e.target.value })} aria-label="Item name" />
            ) : (
              <span className="inv-name-text">{row.name}</span>
            )}
            {row.damageType ? <span className="inv-subtitle">{row.damageType}</span> : null}
          </div>
        )}
        renderCells={(row) => (
          <>
            {row.category === "weapon" ? (
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
            ) : (
              <>
                <span className="inv-cell" title="Weight">
                  {canEdit ? (
                    <NumberInput className="inv-num" value={row.weight ?? 0} min={0} allowNegative={false} onCommit={(weight) => patchRow(row.id, { weight })} aria-label="Weight" />
                  ) : (
                    <span>{row.weight ?? "—"}</span>
                  )}
                </span>
                <span className="inv-cell inv-qty" title="Quantity">
                  {canEdit ? (
                    <>
                      <button className="qty-step" onClick={() => patchRow(row.id, { qty: Math.max(1, row.qty - 1) })}>−</button>
                      <span>{row.qty}</span>
                      <button className="qty-step" onClick={() => patchRow(row.id, { qty: row.qty + 1 })}>+</button>
                    </>
                  ) : (
                    <span>×{row.qty}</span>
                  )}
                </span>
              </>
            )}
            <span className="inv-cell inv-equip">
              {row.category === "weapon" || row.category === "equipment" ? (
                <button
                  type="button"
                  className={`equip-toggle ${row.equipped ? "equip-toggle--on" : ""}`}
                  disabled={!canEdit}
                  title={row.equipped ? "Equipped" : "Not equipped"}
                  onClick={() => patchRow(row.id, { equipped: !row.equipped })}
                >
                  <Shield size={13} strokeWidth={2.2} />
                </button>
              ) : null}
              <button
                type="button"
                className={`attune-toggle ${row.attuned ? "attune-toggle--on" : ""}`}
                disabled={!canEdit}
                title={row.attuned ? "Attuned" : "Not attuned"}
                onClick={() => patchRow(row.id, { attuned: !row.attuned })}
              >
                ✦
              </button>
            </span>
          </>
        )}
        renderExpand={(row) => (
          <div className="inv-expand">
            <div className="inv-expand-grid">
              {row.category === "weapon" ? (
                <>
                  {derived.auto ? (
                    <>
                      <label>Auto to-hit</label>
                      <ToHitAbilitySelect
                        value={row.toHitAbility ?? ""}
                        disabled={!canEdit}
                        onChange={(toHitAbility) => patchRow(row.id, { toHitAbility })}
                      />
                      <label>Range</label>
                      <RangeTagSelect
                        value={row.range ?? ""}
                        disabled={!canEdit}
                        onChange={(range) => patchRow(row.id, { range })}
                      />
                    </>
                  ) : null}
                  <label>To hit</label>
                  <NumberInput
                    value={rowToHit(row)}
                    disabled={!canEdit || (derived.auto && Boolean(row.toHitAbility))}
                    onCommit={(toHit) => patchRow(row.id, { toHit })}
                    aria-label="To hit"
                  />
                  <label>Damage</label>
                  <input
                    value={row.damage ?? ""}
                    disabled={!canEdit}
                    placeholder="1d6+3"
                    onChange={(e) => patchRow(row.id, { damage: e.target.value })}
                  />
                </>
              ) : null}
              <label>Price</label>
              {canEdit ? (
                <input value={row.price ?? ""} placeholder="5 gp" onChange={(e) => patchRow(row.id, { price: e.target.value })} />
              ) : (
                <span>{row.price || "—"}</span>
              )}
              <label>Charges</label>
              {canEdit ? (
                <span className="uses-cell">
                  {actions && (row.charges?.max ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="use-btn"
                      disabled={(row.charges?.current ?? 0) <= 0}
                      title={`Use a charge (${row.charges?.current ?? 0}/${row.charges?.max ?? 0} left)`}
                      onClick={() => actions.useItemCharge(row.id)}
                    >
                      ▶
                    </button>
                  ) : null}
                  <NumberInput value={row.charges?.current ?? 0} min={0} allowNegative={false} onCommit={(current) => patchRow(row.id, { charges: { current, max: row.charges?.max ?? 0 } })} aria-label="Charges current" />
                  <span className="muted">/</span>
                  <NumberInput value={row.charges?.max ?? 0} min={0} allowNegative={false} onCommit={(max) => patchRow(row.id, { charges: { current: row.charges?.current ?? 0, max } })} aria-label="Charges max" />
                </span>
              ) : (
                <span>{row.charges ? `${row.charges.current}/${row.charges.max}` : "—"}</span>
              )}
            </div>
            <label>Notes</label>
            <textarea value={row.description ?? row.note} disabled={!canEdit} rows={2} onChange={(e) => patchRow(row.id, { description: e.target.value })} />
          </div>
        )}
      />
    </div>
  );
}
