import { useState } from "react";
import {
  loadEquipment,
  loadMagicItems,
  type CompendiumEquipment,
  type CompendiumMagicItem,
} from "../lib/compendium";
import { ITEM_RARITIES, type ItemRecord } from "../lib/types";
import { useHomebrew } from "../hooks/useHomebrew";
import { CompendiumPickerModal } from "./CompendiumPickerModal";
import { PickerSelect, optionLabel } from "./pickerFilters";
import { CompendiumDescription, PreviewLine } from "./compendiumPreview";

// Intentionally the subset of ItemType present in equipment.json — mundane equipment
// has no wondrous/ring/etc. entries, so those options would always filter to nothing.
const EQUIPMENT_TYPES = ["weapon", "armor", "tool", "gear"] as const;

/// <summary>
/// Compendium item browser with two tabs — mundane Equipment and Magic Items —
/// rendered as two picker configs behind one tab state. The host supplies what a
/// pick does (append an inventory row, create a catalog item, or overwrite an
/// existing item), so the same modal serves the Items catalog, sheet Inventory
/// pages, and the Item Sheet's apply-from-compendium flow. Multi-pick by default;
/// apply-mode hosts pass `multiPick={false}` with their own title/pickLabel.
/// `onPick*` may return `false` to keep the modal open (e.g. a cancelled confirm).
/// </summary>
export function SrdItemPickerModal({
  title = "Add items from the compendium",
  pickLabel,
  multiPick = true,
  onPickEquipment,
  onPickMagicItem,
  onPickHomebrewItem,
  onClose,
}: {
  title?: string;
  pickLabel?: string;
  multiPick?: boolean;
  onPickEquipment: (eq: CompendiumEquipment) => void | boolean;
  onPickMagicItem: (mi: CompendiumMagicItem) => void | boolean;
  /** When provided, a third "Homebrew" tab lists the campaign's published catalog items. */
  onPickHomebrewItem?: (item: ItemRecord) => void | boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"equipment" | "magic" | "homebrew">("equipment");
  const [typeFilter, setTypeFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const { catalogItems } = useHomebrew();
  const showHomebrewTab = Boolean(onPickHomebrewItem);

  const tabs = (
    <div className="cmp-tabs">
      <button
        type="button"
        className={tab === "equipment" ? "cmp-tab cmp-tab--on" : "cmp-tab"}
        onClick={() => setTab("equipment")}
      >
        Equipment
      </button>
      <button
        type="button"
        className={tab === "magic" ? "cmp-tab cmp-tab--on" : "cmp-tab"}
        onClick={() => setTab("magic")}
      >
        Magic items
      </button>
      {showHomebrewTab ? (
        <button
          type="button"
          className={tab === "homebrew" ? "cmp-tab cmp-tab--on" : "cmp-tab"}
          onClick={() => setTab("homebrew")}
        >
          Homebrew
        </button>
      ) : null}
    </div>
  );

  // key={tab} on every branch: all three tabs render the same component type at the
  // same tree position, and CompendiumPickerModal fetches its rows once on mount —
  // without a remount, switching tabs would keep showing the previous tab's rows
  // (and hand the wrong row type to this tab's pick handler).
  if (tab === "homebrew" && onPickHomebrewItem) {
    return (
      <CompendiumPickerModal<ItemRecord>
        key={tab}
        title={title}
        load={async () => [...catalogItems].sort((a, b) => a.name.localeCompare(b.name))}
        badge={() => "Homebrew"}
        columns={[
          { label: "Type", render: (i) => (i.type ? optionLabel(i.type) : "—") },
          { label: "Rarity", render: (i) => (i.rarity ? optionLabel(i.rarity) : "—") },
          { label: "Value", render: (i) => i.value ?? "—" },
        ]}
        getSearchText={(i) => `${i.type ?? ""} ${i.rarity ?? ""}`}
        filters={tabs}
        renderPreview={(i) => (
          <div>
            <h3>{i.name}</h3>
            <p className="cmp-tagline">
              {[
                i.type ? optionLabel(i.type) : null,
                i.rarity ? optionLabel(i.rarity) : null,
                i.attunement ? "requires attunement" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Campaign item"}
            </p>
            {i.damage ? (
              <PreviewLine label="Damage">
                {i.damage} {i.damageType ?? ""}
              </PreviewLine>
            ) : null}
            {i.properties?.length ? (
              <PreviewLine label="Properties">{i.properties.join(", ")}</PreviewLine>
            ) : null}
            {i.description ? <CompendiumDescription text={i.description} /> : null}
          </div>
        )}
        pickLabel={pickLabel}
        multiPick={multiPick}
        onPick={onPickHomebrewItem}
        onClose={onClose}
      />
    );
  }

  if (tab === "equipment") {
    return (
      <CompendiumPickerModal<CompendiumEquipment>
        key={tab}
        title={title}
        load={loadEquipment}
        columns={[
          { label: "Category", render: (e) => e.category },
          { label: "Cost", render: (e) => e.cost ?? "—" },
          { label: "Damage", render: (e) => (e.damage ? `${e.damage} ${e.damageType ?? ""}` : "—") },
        ]}
        getSearchText={(e) => e.category}
        filters={
          <>
            {tabs}
            <PickerSelect
              label="Filter by type"
              value={typeFilter}
              onChange={setTypeFilter}
              allLabel="All types"
              options={EQUIPMENT_TYPES.map((t) => ({ value: t, label: optionLabel(t) }))}
            />
          </>
        }
        filterFn={(e) => typeFilter === "" || e.itemType === typeFilter}
        renderPreview={(e) => (
          <div>
            <h3>{e.name}</h3>
            <p className="cmp-tagline">
              {e.category}
              {e.cost ? ` · ${e.cost}` : ""}
              {typeof e.weight === "number" ? ` · ${e.weight} lb` : ""}
            </p>
            {e.damage ? (
              <PreviewLine label="Damage">
                {e.damage} {e.damageType}
              </PreviewLine>
            ) : null}
            {e.properties?.length ? <PreviewLine label="Properties">{e.properties.join(", ")}</PreviewLine> : null}
            {e.acBase != null ? (
              <p>
                <strong>AC {e.acBase}</strong>
                {e.acDexBonus ? ` + Dex${e.acMaxBonus ? ` (max ${e.acMaxBonus})` : ""}` : ""}
                {e.strMin ? ` · Str ${e.strMin}` : ""}
                {e.stealthDisadvantage ? " · Stealth disadvantage" : ""}
              </p>
            ) : null}
            {e.description ? <CompendiumDescription text={e.description} /> : null}
          </div>
        )}
        pickLabel={pickLabel}
        multiPick={multiPick}
        onPick={onPickEquipment}
        onClose={onClose}
      />
    );
  }

  return (
    <CompendiumPickerModal<CompendiumMagicItem>
      key={tab}
      title={title}
      load={loadMagicItems}
      columns={[
        { label: "Category", render: (m) => m.category },
        { label: "Rarity", render: (m) => m.rarityText ?? m.rarity },
        { label: "Attune", render: (m) => (m.attunement ? "Yes" : "—") },
      ]}
      getSearchText={(m) => `${m.category} ${m.rarityText ?? m.rarity}`}
      filters={
        <>
          {tabs}
          <PickerSelect
            label="Filter by rarity"
            value={rarityFilter}
            onChange={setRarityFilter}
            allLabel="All rarities"
            options={[...ITEM_RARITIES, "varies"].map((r) => ({ value: r, label: optionLabel(r) }))}
          />
        </>
      }
      filterFn={(m) => rarityFilter === "" || m.rarity === rarityFilter}
      renderPreview={(m) => (
        <div>
          <h3>{m.name}</h3>
          <p className="cmp-tagline">
            {m.category} · {m.rarityText ?? m.rarity}
            {m.attunement ? " · requires attunement" : ""}
          </p>
          <CompendiumDescription text={m.description} />
        </div>
      )}
      pickLabel={pickLabel}
      multiPick={multiPick}
      onPick={onPickMagicItem}
      onClose={onClose}
    />
  );
}
