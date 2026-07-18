import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadClasses, type CompendiumClass } from "../../lib/compendium";
import { multiclassPrereqFailures } from "../../lib/compendiumMap";
import type { ClassEntry } from "../../lib/types";
import { NumberInput } from "../NumberInput";
import { ClassPickerModal } from "./ClassPickerModal";
import type { SheetEdit } from "./context";

/// <summary>
/// Multiclass manager, opened from the class chip once a sheet has 2+ classes.
/// Per-class level steppers (total level = sum, kept in sync), remove for
/// non-first classes, the combined hit-dice breakdown, soft prerequisite
/// warnings, and "＋ Add class" (the picker in multiclass mode).
/// </summary>
export function ManageClassesModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [compendium, setCompendium] = useState<CompendiumClass[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    void loadClasses().then(setCompendium, () => setCompendium([]));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const classes = sheet.value.classes;
  const total = classes.reduce((sum, c) => sum + c.level, 0);

  const commit = (next: ClassEntry[]) =>
    sheet.update({ classes: next, level: next.reduce((sum, c) => sum + c.level, 0) });

  const setLevel = (id: string, level: number) =>
    commit(classes.map((c) => (c.id === id ? { ...c, level: Math.max(1, Math.min(20, level)) } : c)));

  const remove = (id: string) => commit(classes.filter((c) => c.id !== id));

  const hitDieFor = (className: string) =>
    compendium.find((c) => c.name.toLowerCase() === className.trim().toLowerCase())?.hitDie;
  const diceBreakdown = classes
    .map((c) => {
      const die = hitDieFor(c.className);
      return die ? `${c.level}d${die}` : null;
    })
    .filter(Boolean)
    .join(" + ");

  const prereqFailures = multiclassPrereqFailures(classes, sheet.value.abilityScores, compendium);

  if (addOpen) {
    return <ClassPickerModal sheet={sheet} forceAdd onClose={() => setAddOpen(false)} />;
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal manage-classes" onClick={(e) => e.stopPropagation()}>
        <div className="cmp-head">
          <h2>Classes — level {total}</h2>
          <button className="btn-ghost icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="mc-list">
          {classes.map((entry) => (
            <div className="mc-row" key={entry.id}>
              <span className="mc-name">
                {entry.className}
                {entry.subclassName ? <span className="muted"> · {entry.subclassName}</span> : null}
                {entry.isFirstClass ? (
                  <span className="mc-first" title="Taken at character level 1 — full starting proficiencies">
                    1st
                  </span>
                ) : null}
              </span>
              <label className="mc-level">
                Level
                <NumberInput
                  value={entry.level}
                  min={1}
                  max={20}
                  allowNegative={false}
                  disabled={!sheet.canEdit}
                  onCommit={(level) => setLevel(entry.id, level)}
                  aria-label={`${entry.className} level`}
                />
              </label>
              {!entry.isFirstClass && sheet.canEdit ? (
                <button
                  className="btn-ghost icon-btn"
                  title={`Remove ${entry.className} (proficiencies it granted stay on the sheet)`}
                  onClick={() => remove(entry.id)}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {diceBreakdown ? (
          <p className="muted mc-note">
            Hit dice: {diceBreakdown}. Short-rest healing rolls the first class's die (
            {sheet.value.hitDice.die}).
          </p>
        ) : null}
        {prereqFailures.length ? (
          <p className="cmp-prereq-warn mc-note">
            ⚠ Prerequisites not met: {prereqFailures.map((f) => `${f.className} needs ${f.requirement}`).join("; ")}
          </p>
        ) : null}
        {sheet.canEdit ? (
          <div className="cmp-actions">
            <span className="muted" style={{ flex: 1 }}>
              Spell slots pool automatically across caster classes.
            </span>
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              ＋ Add class
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
