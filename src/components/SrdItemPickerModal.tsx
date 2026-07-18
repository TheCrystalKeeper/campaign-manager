import { useState } from "react";
import {
  loadEquipment,
  loadMagicItems,
  type CompendiumEquipment,
  type CompendiumMagicItem,
} from "../lib/compendium";
import { CompendiumPickerModal } from "./CompendiumPickerModal";

/// <summary>
/// DM-only SRD item browser with two tabs — mundane Equipment and Magic Items —
/// rendered as two picker configs behind one tab state. The host supplies what a
/// pick does (append an inventory row, or create a catalog item), so the same
/// modal serves the Items catalog and sheet Inventory pages. Multi-pick.
/// </summary>
export function SrdItemPickerModal({
  onPickEquipment,
  onPickMagicItem,
  onClose,
}: {
  onPickEquipment: (eq: CompendiumEquipment) => void;
  onPickMagicItem: (mi: CompendiumMagicItem) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"equipment" | "magic">("equipment");
  const [typeFilter, setTypeFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");

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
    </div>
  );

  if (tab === "equipment") {
    return (
      <CompendiumPickerModal<CompendiumEquipment>
        title="Add items from the SRD"
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
            <select value={typeFilter} aria-label="Filter by type" onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="weapon">Weapons</option>
              <option value="armor">Armor</option>
              <option value="tool">Tools</option>
              <option value="gear">Gear</option>
            </select>
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
              <p>
                Damage: {e.damage} {e.damageType}
              </p>
            ) : null}
            {e.properties?.length ? <p>Properties: {e.properties.join(", ")}</p> : null}
            {e.acBase != null ? (
              <p>
                AC {e.acBase}
                {e.acDexBonus ? ` + Dex${e.acMaxBonus ? ` (max ${e.acMaxBonus})` : ""}` : ""}
                {e.strMin ? ` · Str ${e.strMin}` : ""}
                {e.stealthDisadvantage ? " · Stealth disadvantage" : ""}
              </p>
            ) : null}
            {e.description ? <p>{e.description}</p> : null}
          </div>
        )}
        multiPick
        onPick={onPickEquipment}
        onClose={onClose}
      />
    );
  }

  return (
    <CompendiumPickerModal<CompendiumMagicItem>
      title="Add items from the SRD"
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
          <select value={rarityFilter} aria-label="Filter by rarity" onChange={(e) => setRarityFilter(e.target.value)}>
            <option value="">All rarities</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="very-rare">Very rare</option>
            <option value="legendary">Legendary</option>
            <option value="artifact">Artifact</option>
            <option value="varies">Varies</option>
          </select>
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
          <p>{m.description}</p>
        </div>
      )}
      multiPick
      onPick={onPickMagicItem}
      onClose={onClose}
    />
  );
}
