import { NumberInput } from "../../NumberInput";
import { Lock, LockOpen } from "lucide-react";
import { TRAIT_GROUPS, type TraitDef } from "../traitDefs";
import type { SheetEdit } from "../context";

/**
 * The Special Traits page: original-class dropdown, then curated feat/species-trait
 * toggle rows + numeric overrides and the global-bonus fields. These are manual
 * switches today; a future rules engine consumes `sheet.traits` behind the same keys.
 */
export function TraitsPage({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, update } = sheet;

  const setTrait = (id: string, next: boolean | number) =>
    update({ traits: { ...value.traits, [id]: next } });

  const renderTrait = (trait: TraitDef) => {
    if (trait.kind === "toggle") {
      const on = value.traits[trait.id] === true;
      return (
        <div className="trait-row" key={trait.id}>
          <div className="trait-info">
            <div className="trait-name">{trait.name}</div>
            {trait.description ? <div className="trait-desc">{trait.description}</div> : null}
          </div>
          <button
            type="button"
            className={`trait-lock ${on ? "trait-lock--on" : ""}`}
            disabled={!canEdit}
            title={on ? "Enabled — click to disable" : "Disabled — click to enable"}
            onClick={() => setTrait(trait.id, !on)}
          >
            {on ? <LockOpen size={13} strokeWidth={2.2} /> : <Lock size={13} strokeWidth={2.2} />}
          </button>
        </div>
      );
    }
    const num = typeof value.traits[trait.id] === "number" ? (value.traits[trait.id] as number) : 0;
    return (
      <div className="trait-row" key={trait.id}>
        <div className="trait-info">
          <div className="trait-name">{trait.name}</div>
          {trait.description ? <div className="trait-desc">{trait.description}</div> : null}
        </div>
        <NumberInput className="trait-num" value={num} disabled={!canEdit} onCommit={(n) => setTrait(trait.id, n)} aria-label={trait.name} />
      </div>
    );
  };

  return (
    <div className="sheet-page traits-page">
      <div className="trait-group">
        <div className="sheet-section-title">Class</div>
        <div className="trait-row">
          <div className="trait-info">
            <div className="trait-name">Original Class</div>
            <div className="trait-desc">First class taken by the character, used to determine certain traits when multiclassing.</div>
          </div>
          {canEdit ? (
            <input className="trait-class" value={value.originalClass} placeholder="Class" onChange={(e) => update({ originalClass: e.target.value })} />
          ) : (
            <span className="muted">{value.originalClass || "—"}</span>
          )}
        </div>
      </div>

      {TRAIT_GROUPS.map((group) => (
        <div className="trait-group" key={group.id}>
          <div className="sheet-section-title">{group.title}</div>
          {group.traits.map(renderTrait)}
        </div>
      ))}
    </div>
  );
}
