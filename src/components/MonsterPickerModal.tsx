import { useState } from "react";
import { loadMonsters, type CompendiumMonster } from "../lib/compendium";
import { CompendiumPickerModal } from "./CompendiumPickerModal";
import { PreviewLine } from "./compendiumPreview";

const CR_ORDER = ["0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const MONSTER_TYPES = [
  "Aberration", "Beast", "Celestial", "Construct", "Dragon", "Elemental", "Fey",
  "Fiend", "Giant", "Humanoid", "Monstrosity", "Ooze", "Plant", "Undead",
];

// Rank maps for the CR and Size columns — both are small text (a fraction, a size name) that
// sorts wrong as plain text ("10" before "2"; "Gargantuan" before "Tiny"), so the column-sort
// needs the real domain order instead of alphabetical.
const CR_RANK: Record<string, number> = Object.fromEntries(CR_ORDER.map((cr, i) => [cr, i]));
const SIZE_ORDER = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const SIZE_RANK: Record<string, number> = Object.fromEntries(SIZE_ORDER.map((s, i) => [s, i]));

const ABILITY_ROW: Array<[string, string]> = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

/// <summary>
/// DM-only compendium monster browser — picking one creates a fully-filled NPC sheet
/// (the host wires the create). CR and type filters; preview shows a compact
/// stat block.
/// </summary>
export function MonsterPickerModal({
  onPick,
  onClose,
  title = "Create NPC from a compendium monster",
  pickLabel = "Create NPC",
}: {
  onPick: (monster: CompendiumMonster) => void;
  onClose: () => void;
  title?: string;
  pickLabel?: string;
}) {
  const [crFilter, setCrFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  return (
    <CompendiumPickerModal<CompendiumMonster>
      title={title}
      load={loadMonsters}
      columns={[
        { label: "CR", render: (m) => m.cr, sortValue: (m) => CR_RANK[m.cr] ?? 999 },
        { label: "Type", render: (m) => m.type },
        { label: "Size", render: (m) => m.size, sortValue: (m) => SIZE_RANK[m.size] ?? 999 },
      ]}
      getSearchText={(m) => `${m.type} ${m.size} cr ${m.cr}`}
      filters={
        <>
          <select value={crFilter} aria-label="Filter by challenge rating" onChange={(e) => setCrFilter(e.target.value)}>
            <option value="">All CRs</option>
            {CR_ORDER.map((cr) => (
              <option key={cr} value={cr}>
                CR {cr}
              </option>
            ))}
          </select>
          <select value={typeFilter} aria-label="Filter by creature type" onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {MONSTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </>
      }
      filterFn={(m) => (crFilter === "" || m.cr === crFilter) && (typeFilter === "" || m.type === typeFilter)}
      renderPreview={(m) => (
        <div>
          <h3>{m.name}</h3>
          <p className="cmp-tagline">
            {m.size} {m.type}
            {m.alignment ? `, ${m.alignment}` : ""} · CR {m.cr}
            {m.xp ? ` (${m.xp} XP)` : ""}
          </p>
          <p>
            AC {m.ac}
            {m.acNote ? ` (${m.acNote})` : ""} · HP {m.hp}
            {m.hitDice ? ` (${m.hitDice})` : ""} · Speed {m.speedLine}
          </p>
          <p>
            {ABILITY_ROW.map(([id, label]) => `${label} ${m.abilities[id] ?? 10}`).join(" · ")}
          </p>
          {m.senses ? <PreviewLine label="Senses">{m.senses}</PreviewLine> : null}
          {m.languages ? <PreviewLine label="Languages">{m.languages}</PreviewLine> : null}
          {(m.traits ?? []).map((t) => (
            <p key={t.name}>
              <strong>{t.name}.</strong> {t.description}
            </p>
          ))}
          {(m.actions ?? []).length ? (
            <p>
              <strong>Actions.</strong> {(m.actions ?? []).map((a) => a.name).join(", ")}
            </p>
          ) : null}
          {(m.legendary ?? []).length ? (
            <p>
              <strong>Legendary.</strong> {(m.legendary ?? []).map((a) => a.name).join(", ")}
            </p>
          ) : null}
        </div>
      )}
      pickLabel={pickLabel}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
