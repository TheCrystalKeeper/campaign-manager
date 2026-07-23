import { useState } from "react";
import { loadMonsters, type CompendiumMonster } from "../lib/compendium";
import type { SheetRecord } from "../lib/types";
import { useHomebrew } from "../hooks/useHomebrew";
import { CompendiumPickerModal } from "./CompendiumPickerModal";
import { PickerSelect } from "./pickerFilters";
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

const SOURCE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "homebrew", label: "Homebrew" },
];

/**
 * One picker row — either an official compendium monster or a homebrew statblock
 * (an NPC sheet the DM published via "Show in monster compendium"). Hosts branch on
 * `source` to apply the right mapper (`monsterSheetPatch`/`statblockPatch` vs. a
 * sheet clone / `statblockPatchFromSheet`).
 */
export type MonsterPickRow =
  | { id: string; name: string; source: "official"; monster: CompendiumMonster }
  | { id: string; name: string; source: "homebrew"; sheet: SheetRecord };

// Homebrew rows read free-text sheet fields, so CR normalizes decimal forms to the
// official fractions and the type/size filters compare case-insensitively — a
// hand-typed "undead" / "0.5" must still match the "Undead" / "CR 1/2" options.
const CR_DECIMALS: Record<string, string> = { "0.125": "1/8", "0.25": "1/4", "0.5": "1/2", ".125": "1/8", ".25": "1/4", ".5": "1/2" };

const rowCr = (r: MonsterPickRow): string => {
  const cr = r.source === "official" ? r.monster.cr : r.sheet.data.cr.trim();
  return CR_DECIMALS[cr] ?? cr;
};
const rowType = (r: MonsterPickRow): string =>
  r.source === "official" ? r.monster.type : r.sheet.data.creatureType.trim();
const rowSize = (r: MonsterPickRow): string =>
  r.source === "official" ? r.monster.size : r.sheet.data.size.trim();

/// <summary>
/// DM-only monster browser: official compendium monsters plus the campaign's homebrew
/// statblocks, merged into one list (homebrew rows badged + source-filterable). Picking
/// hands the host a MonsterPickRow; the host wires what a pick does (create an NPC, or
/// apply onto an existing one). CR and type filters; preview shows a compact stat block.
/// </summary>
export function MonsterPickerModal({
  onPick,
  onClose,
  title = "Create NPC from a compendium monster",
  pickLabel = "Create NPC",
}: {
  onPick: (row: MonsterPickRow) => void;
  onClose: () => void;
  title?: string;
  pickLabel?: string;
}) {
  const [crFilter, setCrFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const { npcTemplates } = useHomebrew();

  const load = async (): Promise<MonsterPickRow[]> => {
    const monsters = await loadMonsters();
    return [
      ...monsters.map<MonsterPickRow>((monster) => ({
        id: monster.id,
        name: monster.name,
        source: "official",
        monster,
      })),
      // "hbnpc-" prefix keeps ids collision-free against monster slugs.
      ...npcTemplates.map<MonsterPickRow>((sheet) => ({
        id: `hbnpc-${sheet.id}`,
        name: sheet.data.characterName?.trim() || "Unnamed NPC",
        source: "homebrew",
        sheet,
      })),
    ];
  };

  return (
    <CompendiumPickerModal<MonsterPickRow>
      title={title}
      load={load}
      badge={(r) => (r.source === "homebrew" ? "Homebrew" : null)}
      columns={[
        { label: "CR", render: (r) => rowCr(r) || "—", sortValue: (r) => CR_RANK[rowCr(r)] ?? 999 },
        { label: "Type", render: (r) => rowType(r) || "—" },
        { label: "Size", render: (r) => rowSize(r) || "—", sortValue: (r) => SIZE_RANK[rowSize(r)] ?? 999 },
      ]}
      getSearchText={(r) => `${rowType(r)} ${rowSize(r)} cr ${rowCr(r)}`}
      filters={
        <>
          <PickerSelect
            label="Filter by challenge rating"
            value={crFilter}
            onChange={setCrFilter}
            allLabel="All CRs"
            options={CR_ORDER.map((cr) => ({ value: cr, label: `CR ${cr}` }))}
          />
          <PickerSelect
            label="Filter by creature type"
            value={typeFilter}
            onChange={setTypeFilter}
            allLabel="All types"
            options={MONSTER_TYPES.map((t) => ({ value: t, label: t }))}
          />
          {npcTemplates.length ? (
            <PickerSelect
              label="Filter by source"
              value={sourceFilter}
              onChange={setSourceFilter}
              allLabel="All sources"
              options={SOURCE_OPTIONS}
            />
          ) : null}
        </>
      }
      filterFn={(r) =>
        (crFilter === "" || rowCr(r) === crFilter) &&
        (typeFilter === "" || rowType(r).toLowerCase() === typeFilter.toLowerCase()) &&
        (sourceFilter === "" || r.source === sourceFilter)
      }
      renderPreview={(r) =>
        r.source === "official" ? (
          <OfficialPreview monster={r.monster} />
        ) : (
          <HomebrewPreview name={r.name} sheet={r.sheet} />
        )
      }
      pickLabel={pickLabel}
      onPick={onPick}
      onClose={onClose}
    />
  );
}

function OfficialPreview({ monster: m }: { monster: CompendiumMonster }) {
  return (
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
  );
}

function HomebrewPreview({ name, sheet }: { name: string; sheet: SheetRecord }) {
  const d = sheet.data;
  return (
    <div>
      <h3>{name}</h3>
      <p className="cmp-tagline">
        {[d.size.trim(), d.creatureType.trim()].filter(Boolean).join(" ") || "Homebrew statblock"}
        {d.alignment.trim() ? `, ${d.alignment.trim()}` : ""}
        {d.cr.trim() ? ` · CR ${d.cr.trim()}` : ""}
        {d.xp ? ` (${d.xp} XP)` : ""}
      </p>
      <p>
        AC {d.ac} · HP {d.hp.max} · Speed {d.speed} ft.
      </p>
      <p>
        {ABILITY_ROW.map(([id, label]) => `${label} ${d.abilityScores[id] ?? 10}`).join(" · ")}
      </p>
      {d.senses.trim() ? <PreviewLine label="Senses">{d.senses}</PreviewLine> : null}
      {d.languages.length ? <PreviewLine label="Languages">{d.languages.join(", ")}</PreviewLine> : null}
      {d.attacks.length ? (
        <p>
          <strong>Actions.</strong> {d.attacks.map((a) => a.name).join(", ")}
        </p>
      ) : null}
      {d.features.length ? (
        <p>
          <strong>Features.</strong> {d.features.map((f) => f.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
