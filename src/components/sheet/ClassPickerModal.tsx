import { useEffect, useState } from "react";
import {
  loadClasses,
  loadSubclasses,
  type CompendiumClass,
  type CompendiumSubclass,
} from "../../lib/compendium";
import {
  addMulticlassPatch,
  classAutofillPatch,
  multiclassPrereqFailures,
} from "../../lib/compendiumMap";
import { DEFAULT_SHEET_TEMPLATE } from "../../lib/types";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import { PreviewLine } from "../compendiumPreview";
import type { SheetEdit } from "./context";

const SKILL_NAME: Record<string, string> = Object.fromEntries(
  DEFAULT_SHEET_TEMPLATE.skills.map((s) => [s.id, s.name]),
);

/// <summary>
/// Compendium class/subclass picker, opened from the class chip. Default = names only
/// (sets the class and nothing else); the "Autofill basics" checkbox additionally
/// applies hit die, save dots, proficiencies, spellcasting ability, and a
/// choose-N skill grid. When the sheet already has a class, an "Add as
/// multiclass" mode appends the pick at level 1 instead — applying only the
/// smaller multiclass proficiency set (never saving throws) with a soft
/// prerequisite warning (13+ ability minimums for every class, spec §6).
/// </summary>
export function ClassPickerModal({
  sheet,
  forceAdd = false,
  onClose,
}: {
  sheet: SheetEdit;
  /** Open directly in "add as multiclass" mode (the Manage classes ＋ button). */
  forceAdd?: boolean;
  onClose: () => void;
}) {
  const [allClasses, setAllClasses] = useState<CompendiumClass[] | null>(null);
  const [subclasses, setSubclasses] = useState<CompendiumSubclass[] | null>(null);
  const [current, setCurrent] = useState<CompendiumClass | null>(null);
  const [subclassId, setSubclassId] = useState("");
  const [autofill, setAutofill] = useState(sheet.value.classAutofill);
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const hasClass = Boolean(sheet.value.characterClass.trim());
  const [addMode, setAddMode] = useState(forceAdd);

  useEffect(() => {
    void loadSubclasses().then(setSubclasses, () => setSubclasses([]));
    void loadClasses().then(setAllClasses, () => setAllClasses([]));
  }, []);

  // Wait for both lists so the pre-selection is stable at mount (both are cached).
  if (allClasses === null || subclasses === null) return null;

  // Reverse-map the sheet's current class/subclass so reopening pre-selects them.
  // Skipped in add-mode: that flow is picking a NEW class to multiclass into.
  const initialClassId = forceAdd
    ? undefined
    : allClasses.find((c) => c.name.toLowerCase() === sheet.value.characterClass.trim().toLowerCase())?.id;
  const initialSubclassId = subclasses.find(
    (sc) => sc.classId === initialClassId && sc.name.toLowerCase() === sheet.value.subclass.trim().toLowerCase(),
  )?.id;

  // Subclass + skill choices are per-class; reset them when the highlight genuinely
  // changes, so the pre-seeded subclass survives the modal's initial auto-select.
  const handleSelect = (cls: CompendiumClass | null) => {
    if (cls?.id === current?.id) return;
    setCurrent(cls);
    setSubclassId(cls?.id === initialClassId ? initialSubclassId ?? "" : "");
    setChosenSkills([]);
  };

  const skillChoices = autofill
    ? addMode
      ? current?.multiclass.skillChoice
      : current?.skillChoices
    : undefined;

  const toggleSkill = (id: string, max: number) =>
    setChosenSkills((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length < max ? [...prev, id] : prev,
    );

  const classSubclasses = subclasses.filter((sc) => sc.classId === current?.id);

  // Soft prereq check (add mode): existing classes + the candidate, 13+ minimums.
  const prereqFailures =
    addMode && current
      ? multiclassPrereqFailures(
          [...sheet.value.classes, { className: current.name }],
          sheet.value.abilityScores,
          allClasses,
        )
      : [];

  return (
    <CompendiumPickerModal<CompendiumClass>
      title={addMode ? "Add a class (multiclass)" : "Choose a class"}
      load={loadClasses}
      initialSelectedId={initialClassId}
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
          {c.armorProfs?.length ? <PreviewLine label="Armor">{c.armorProfs.join(", ")}</PreviewLine> : null}
          {c.weaponProfs?.length ? <PreviewLine label="Weapons">{c.weaponProfs.join(", ")}</PreviewLine> : null}
          {c.toolProfs?.length ? <PreviewLine label="Tools">{c.toolProfs.join(", ")}</PreviewLine> : null}
          {c.skillChoices ? (
            <PreviewLine label="Skills">
              choose {c.skillChoices.choose} from{" "}
              {c.skillChoices.from.map((id) => SKILL_NAME[id] ?? id).join(", ")}
            </PreviewLine>
          ) : null}
          {c.spellcasting ? (
            <PreviewLine label="Spellcasting">
              {c.spellcasting.abilityId.toUpperCase()} (
              {c.spellcasting.casterType === "pact" ? "pact magic" : `${c.spellcasting.casterType} caster`})
            </PreviewLine>
          ) : null}
          <p className="muted">
            Subclass unlocks at level {c.subclassLevel}. Includes the four PHB subclasses for each class.
          </p>
        </div>
      )}
      onSelect={handleSelect}
      footer={
        <div className="cmp-footer">
          {hasClass && !forceAdd ? (
            <label title="Replace the current class, or keep it and add this one at level 1">
              <input type="checkbox" checked={addMode} onChange={(e) => setAddMode(e.target.checked)} />
              Add as multiclass (keep {sheet.value.characterClass})
            </label>
          ) : null}
          {hasClass && !forceAdd ? (
            <button
              type="button"
              className="btn-ghost"
              title="Remove the class entirely, leaving it unset"
              onClick={() => {
                sheet.update({ characterClass: "", subclass: "", classAutofill: false, classes: [] });
                onClose();
              }}
            >
              Clear class
            </button>
          ) : null}
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
          <label
            title={
              addMode
                ? "Also apply the multiclass proficiency set (never saving throws)"
                : "Also fill hit die, saving throws, proficiencies, and spellcasting ability from the class"
            }
          >
            <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} />
            {addMode ? "Autofill multiclass proficiencies" : "Autofill basics"}
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
          {prereqFailures.length ? (
            <span className="cmp-prereq-warn">
              ⚠ Multiclass prerequisites not met:{" "}
              {prereqFailures.map((f) => `${f.className} needs ${f.requirement}`).join("; ")} — you can
              add it anyway (house rules welcome).
            </span>
          ) : null}
        </div>
      }
      pickLabel={addMode ? "Add class" : "Set class"}
      onPick={(cls) => {
        const subclassName = classSubclasses.find((sc) => sc.id === subclassId)?.name;
        sheet.update(
          addMode
            ? addMulticlassPatch(cls, { subclassName, autofill, chosenSkills, sheet: sheet.value })
            : {
                ...classAutofillPatch(cls, { subclassName, autofill, chosenSkills, sheet: sheet.value }),
                classAutofill: autofill,
              },
        );
      }}
      onClose={onClose}
    />
  );
}
