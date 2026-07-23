import { useState } from "react";
import { loadSpells, type CompendiumSpell } from "../../lib/compendium";
import { spellEntryFromCompendium } from "../../lib/compendiumMap";
import { SHEET_ROW_CAPS } from "../../lib/types";
import { useHomebrew } from "../../hooks/useHomebrew";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import { PickerSelect, optionLabel } from "../pickerFilters";
import { CompendiumDescription } from "../compendiumPreview";
import { matchesSource } from "./ClassPickerModal";
import type { SheetEdit } from "./context";

const CASTER_CLASSES = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];
const SOURCE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "homebrew", label: "Homebrew" },
];
const levelLabel = (level: number) => (level === 0 ? "Cantrip" : String(level));

/// <summary>
/// Compendium spell browser (opened from the Spells page add-bar by anyone who can
/// edit the sheet). Multi-pick: each Add appends a fully-filled spell row at the
/// spell's own level. Level and class filters narrow the spell list.
/// </summary>
export function SpellPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [levelFilter, setLevelFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const { homebrew } = useHomebrew();
  const hbSpells = Object.values(homebrew.spells);
  // Homebrew classes join the class filter — homebrew spells reference them by id.
  const classOptions = [
    ...CASTER_CLASSES.map((c) => ({ value: c, label: optionLabel(c) })),
    ...Object.values(homebrew.classes).map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <CompendiumPickerModal<CompendiumSpell>
      title="Add spells from the compendium"
      load={async () => [...(await loadSpells()), ...hbSpells]}
      badge={(s) => (s.homebrew ? "Homebrew" : null)}
      columns={[
        { label: "Lv", render: (s) => levelLabel(s.level) },
        { label: "School", render: (s) => s.school },
        { label: "Time", render: (s) => s.time },
      ]}
      getSearchText={(s) => `${s.school} ${s.classes.join(" ")}`}
      filters={
        <>
          <PickerSelect
            label="Filter by level"
            value={levelFilter}
            onChange={setLevelFilter}
            allLabel="All levels"
            options={Array.from({ length: 10 }, (_, lv) => ({
              value: String(lv),
              label: lv === 0 ? "Cantrips" : `Level ${lv}`,
            }))}
          />
          <PickerSelect
            label="Filter by class"
            value={classFilter}
            onChange={setClassFilter}
            allLabel="All classes"
            options={classOptions}
          />
          {hbSpells.length ? (
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
      filterFn={(s) =>
        (levelFilter === "" || s.level === Number(levelFilter)) &&
        (classFilter === "" || s.classes.includes(classFilter)) &&
        matchesSource(sourceFilter, s)
      }
      renderPreview={(s) => (
        <div>
          <h3>{s.name}</h3>
          <p className="cmp-tagline">
            {s.level === 0 ? "Cantrip" : `Level ${s.level}`} {s.school} · {s.time} · {s.range} ·{" "}
            {s.components || "—"} · {s.duration}
            {s.concentration ? " (C)" : ""}
            {s.ritual ? " (R)" : ""}
          </p>
          <CompendiumDescription text={s.description} />
          <p className="muted">
            <strong>Classes:</strong> {s.classes.map((c) => c[0].toUpperCase() + c.slice(1)).join(", ")}
          </p>
        </div>
      )}
      multiPick
      onPick={(spell) => {
        sheet.update({
          spells: [...sheet.value.spells, spellEntryFromCompendium(spell)].slice(0, SHEET_ROW_CAPS.spells),
        });
      }}
      onClose={onClose}
    />
  );
}
