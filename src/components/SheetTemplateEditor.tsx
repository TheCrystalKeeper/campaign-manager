import { useEffect, useRef, useState } from "react";
import {
  createAbilityDef,
  createDefaultSheetTemplate,
  createDerivedStatDef,
  type DerivedStatDef,
  type SheetTemplate,
} from "../lib/types";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import type { useDmActions } from "../hooks/useGameRoom";

type SheetTemplateEditorProps = {
  template: SheetTemplate;
  dm: ReturnType<typeof useDmActions>;
};

/// <summary>
/// Returns whether two templates are structurally identical (order preserved).
/// </summary>
function templatesEqual(a: SheetTemplate, b: SheetTemplate): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// <summary>
/// DM editor for the campaign sheet template: abilities, skills, and saving throws.
/// Text edits are debounced; structural changes (add/remove/mode) apply immediately.
/// </summary>
export function SheetTemplateEditor({ template, dm }: SheetTemplateEditorProps) {
  const [draft, setDraft] = useState(template);
  const lastSentRef = useRef(template);

  const { debounced: debouncedSend, flush } = useDebouncedCallback((next: SheetTemplate) => {
    lastSentRef.current = next;
    dm.updateSheetTemplate(next);
  }, 400);

  useEffect(() => {
    setDraft((current) => (templatesEqual(current, lastSentRef.current) ? template : current));
    lastSentRef.current = template;
  }, [template]);

  // Debounced: keep the in-progress text local, sync after a pause.
  const edit = (next: SheetTemplate) => {
    setDraft(next);
    debouncedSend(next);
  };

  // Immediate: flush any pending edit and send right away.
  const commit = (next: SheetTemplate) => {
    flush();
    setDraft(next);
    lastSentRef.current = next;
    dm.updateSheetTemplate(next);
  };

  const addAbility = () =>
    commit({ ...draft, abilities: [...draft.abilities, createAbilityDef("New ability", "NEW")] });

  const removeAbility = (abilityId: string) => {
    const downgrade = (stats: DerivedStatDef[]): DerivedStatDef[] =>
      stats.map((stat) =>
        stat.mode === "ability" && stat.abilityId === abilityId
          ? { id: stat.id, name: stat.name, mode: "constant" }
          : stat,
      );
    commit({
      abilities: draft.abilities.filter((ability) => ability.id !== abilityId),
      skills: downgrade(draft.skills),
      saves: downgrade(draft.saves),
    });
  };

  const renderStatSection = (
    title: string,
    key: "skills" | "saves",
    addLabel: string,
  ) => {
    const stats = draft[key];

    const setStats = (next: DerivedStatDef[], immediate: boolean) => {
      const nextTemplate = { ...draft, [key]: next };
      if (immediate) {
        commit(nextTemplate);
      } else {
        edit(nextTemplate);
      }
    };

    const renameStat = (id: string, name: string) =>
      setStats(
        stats.map((stat) => (stat.id === id ? { ...stat, name } : stat)),
        false,
      );

    const changeMode = (id: string, abilityId: string) =>
      setStats(
        stats.map((stat) => {
          if (stat.id !== id) {
            return stat;
          }
          return abilityId
            ? { id: stat.id, name: stat.name, mode: "ability", abilityId }
            : { id: stat.id, name: stat.name, mode: "constant" };
        }),
        true,
      );

    const removeStat = (id: string) =>
      setStats(stats.filter((stat) => stat.id !== id), true);

    const addStat = () =>
      setStats([...stats, createDerivedStatDef("New", draft.abilities[0]?.id ?? null)], true);

    return (
      <div className="template-group">
        <div className="template-group-header">
          <h4>{title}</h4>
          <button type="button" className="btn-compact" onClick={addStat}>
            {addLabel}
          </button>
        </div>
        {stats.length === 0 ? (
          <p className="settings-hint">None yet.</p>
        ) : (
          stats.map((stat) => (
            <div key={stat.id} className="template-row">
              <input
                className="template-name"
                value={stat.name}
                onChange={(event) => renameStat(stat.id, event.target.value)}
              />
              <select
                className="template-mode"
                value={stat.mode === "ability" ? stat.abilityId : ""}
                onChange={(event) => changeMode(stat.id, event.target.value)}
              >
                <option value="">Constant</option>
                {draft.abilities.map((ability) => (
                  <option key={ability.id} value={ability.id}>
                    {ability.abbr}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-compact danger"
                onClick={() => removeStat(stat.id)}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <section className="settings-section template-editor">
      <h3>Sheet template</h3>
      <p className="settings-hint">
        Defines the abilities, skills, and saving throws on every player's sheet. Editing
        changes player sheets live — best set before the campaign starts.
      </p>

      <div className="template-group">
        <div className="template-group-header">
          <h4>Abilities</h4>
          <button type="button" className="btn-compact" onClick={addAbility}>
            + Ability
          </button>
        </div>
        {draft.abilities.length === 0 ? (
          <p className="settings-hint">None yet.</p>
        ) : (
          draft.abilities.map((ability) => (
            <div key={ability.id} className="template-row">
              <input
                className="template-abbr"
                value={ability.abbr}
                aria-label="Abbreviation"
                onChange={(event) =>
                  edit({
                    ...draft,
                    abilities: draft.abilities.map((item) =>
                      item.id === ability.id ? { ...item, abbr: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                className="template-name"
                value={ability.name}
                aria-label="Ability name"
                onChange={(event) =>
                  edit({
                    ...draft,
                    abilities: draft.abilities.map((item) =>
                      item.id === ability.id ? { ...item, name: event.target.value } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="btn-compact danger"
                onClick={() => removeAbility(ability.id)}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {renderStatSection("Skills", "skills", "+ Skill")}
      {renderStatSection("Saving throws", "saves", "+ Save")}

      <button
        type="button"
        className="btn-compact"
        onClick={() => commit(createDefaultSheetTemplate())}
      >
        Reset to D&D 5e defaults
      </button>
    </section>
  );
}
