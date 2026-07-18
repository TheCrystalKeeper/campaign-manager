import { useState } from "react";
import { loadSpells, type CompendiumSpell } from "../../lib/compendium";
import { spellEntryFromCompendium } from "../../lib/compendiumMap";
import { SHEET_ROW_CAPS } from "../../lib/types";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import type { SheetEdit } from "./context";

const CASTER_CLASSES = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];
const levelLabel = (level: number) => (level === 0 ? "Cantrip" : String(level));

/// <summary>
/// DM-only compendium spell browser (opened from the Spells page add-bar). Multi-pick:
/// each Add appends a fully-filled spell row at the spell's own level. Level and
/// class filters narrow the 339-spell list.
/// </summary>
export function SpellPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [levelFilter, setLevelFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  return (
    <CompendiumPickerModal<CompendiumSpell>
      title="Add spells from the compendium"
      load={loadSpells}
      columns={[
        { label: "Lv", render: (s) => levelLabel(s.level) },
        { label: "School", render: (s) => s.school },
        { label: "Time", render: (s) => s.time },
      ]}
      getSearchText={(s) => `${s.school} ${s.classes.join(" ")}`}
      filters={
        <>
          <select value={levelFilter} aria-label="Filter by level" onChange={(e) => setLevelFilter(e.target.value)}>
            <option value="">All levels</option>
            {Array.from({ length: 10 }, (_, lv) => (
              <option key={lv} value={String(lv)}>
                {lv === 0 ? "Cantrips" : `Level ${lv}`}
              </option>
            ))}
          </select>
          <select value={classFilter} aria-label="Filter by class" onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {CASTER_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </>
      }
      filterFn={(s) =>
        (levelFilter === "" || s.level === Number(levelFilter)) &&
        (classFilter === "" || s.classes.includes(classFilter))
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
          <p>{s.description}</p>
          <p className="muted">Classes: {s.classes.map((c) => c[0].toUpperCase() + c.slice(1)).join(", ")}</p>
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
