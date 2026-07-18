import { useEffect, useState } from "react";
import {
  loadClasses,
  loadSubclasses,
  type CompendiumClass,
  type CompendiumSubclass,
} from "../../lib/compendium";
import { classAutofillPatch } from "../../lib/compendiumMap";
import { DEFAULT_SHEET_TEMPLATE } from "../../lib/types";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import type { SheetEdit } from "./context";

const SKILL_NAME: Record<string, string> = Object.fromEntries(
  DEFAULT_SHEET_TEMPLATE.skills.map((s) => [s.id, s.name]),
);

/// <summary>
/// SRD class/subclass picker, opened from the class chip. Default = names only
/// (sets characterClass/subclass text and nothing else); the "Autofill basics"
/// checkbox additionally applies hit die, save dots, armor/weapon/tool
/// proficiencies, spellcasting ability, and an optional choose-N skill grid.
/// On NPC sheets the dots are display-only (the rules engine is off there) —
/// the DM still gets the names and lists.
/// </summary>
export function ClassPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [subclasses, setSubclasses] = useState<CompendiumSubclass[]>([]);
  const [current, setCurrent] = useState<CompendiumClass | null>(null);
  const [subclassId, setSubclassId] = useState("");
  const [autofill, setAutofill] = useState(false);
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);

  useEffect(() => {
    void loadSubclasses().then(setSubclasses, () => setSubclasses([]));
  }, []);

  // Subclass + skill choices are per-class; reset them when the highlight moves.
  const handleSelect = (cls: CompendiumClass | null) => {
    setCurrent(cls);
    setSubclassId("");
    setChosenSkills([]);
  };

  const toggleSkill = (id: string, max: number) =>
    setChosenSkills((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length < max ? [...prev, id] : prev,
    );

  const classSubclasses = subclasses.filter((sc) => sc.classId === current?.id);
  const skillChoices = autofill ? current?.skillChoices : undefined;

  return (
    <CompendiumPickerModal<CompendiumClass>
      title="Choose a class"
      load={loadClasses}
      columns={[
        { label: "Hit die", render: (c) => `d${c.hitDie}` },
        { label: "Saves", render: (c) => c.saves.map((s) => s.toUpperCase()).join(", ") },
        {
          label: "Spellcasting",
          render: (c) => (c.spellcasting ? c.spellcasting.abilityId.toUpperCase() : "—"),
        },
      ]}
      getSearchText={(c) => c.primaryAbility ?? ""}
      renderPreview={(c) => (
        <div>
          <h3>{c.name}</h3>
          <p className="cmp-tagline">
            d{c.hitDie} hit die · {c.primaryAbility ?? "—"} primary ·{" "}
            {c.saves.map((s) => s.toUpperCase()).join("/")} saves
          </p>
          {c.armorProfs?.length ? <p>Armor: {c.armorProfs.join(", ")}</p> : null}
          {c.weaponProfs?.length ? <p>Weapons: {c.weaponProfs.join(", ")}</p> : null}
          {c.toolProfs?.length ? <p>Tools: {c.toolProfs.join(", ")}</p> : null}
          {c.skillChoices ? (
            <p>
              Skills: choose {c.skillChoices.choose} from{" "}
              {c.skillChoices.from.map((id) => SKILL_NAME[id] ?? id).join(", ")}
            </p>
          ) : null}
          {c.spellcasting ? (
            <p>
              Spellcasting: {c.spellcasting.abilityId.toUpperCase()} (
              {c.spellcasting.casterType === "pact" ? "pact magic" : `${c.spellcasting.casterType} caster`})
            </p>
          ) : null}
          <p className="muted">
            Subclass unlocks at level {c.subclassLevel}. The SRD includes one subclass per class.
          </p>
        </div>
      )}
      onSelect={handleSelect}
      footer={
        <div className="cmp-footer">
          <label>
            Subclass
            <select value={subclassId} onChange={(e) => setSubclassId(e.target.value)}>
              <option value="">—</option>
              {classSubclasses.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name}
                </option>
              ))}
            </select>
          </label>
          <label title="Also fill hit die, saving throws, proficiencies, and spellcasting ability from the class">
            <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} />
            Autofill basics
          </label>
          {sheet.kind === "npc" && autofill ? (
            <span className="muted">NPC numbers stay manual — this fills names and lists.</span>
          ) : null}
          {skillChoices ? (
            <div className="cmp-skill-grid">
              <span className="muted">
                Choose {skillChoices.choose} skill{skillChoices.choose > 1 ? "s" : ""} ({chosenSkills.length}/
                {skillChoices.choose}):
              </span>
              {skillChoices.from.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={chosenSkills.includes(id)}
                    disabled={!chosenSkills.includes(id) && chosenSkills.length >= skillChoices.choose}
                    onChange={() => toggleSkill(id, skillChoices.choose)}
                  />
                  {SKILL_NAME[id] ?? id}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      }
      pickLabel="Set class"
      onPick={(cls) => {
        const subclassName = classSubclasses.find((sc) => sc.id === subclassId)?.name;
        sheet.update(
          classAutofillPatch(cls, { subclassName, autofill, chosenSkills, sheet: sheet.value }),
        );
      }}
      onClose={onClose}
    />
  );
}
