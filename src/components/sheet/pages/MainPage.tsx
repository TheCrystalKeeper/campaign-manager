import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  abilityModifier,
  DEFAULT_SHEET_TEMPLATE,
  formatModifier,
  rowId,
  type ToolEntry,
} from "../../../lib/types";
import { NumberInput } from "../../NumberInput";
import { OverrideMarker, PillList, ProfDot, SectionHeader } from "../atoms";
import { advFromEvent, ROLL_HINT, type SheetEdit } from "../context";

const template = DEFAULT_SHEET_TEMPLATE;

/** Ability abbreviation for a save/skill's governing ability. */
function abilityAbbr(abilityId: string): string {
  return template.abilities.find((a) => a.id === abilityId)?.abbr ?? "";
}

/**
 * The Main page (PC): ability blocks, skills (prof dot + passive), tools, saving
 * throws, and the proficiency/resistance/language pill lists. Totals come from the
 * rules engine (ability mod + dot × proficiency + Misc, override-aware); NPCs render
 * the ability blocks + saves at the top of their Features page instead (AbilityHeader).
 */
export function MainPage({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, derived, setOverride, update, onRollCheck } = sheet;
  // Which stat total (skill/save id) is showing its inline override editor.
  const [editingStat, setEditingStat] = useState<string | null>(null);

  const profValue = derived.values["prof"] ?? 0;
  const rollTitle = (base: string) =>
    `${base} — ${ROLL_HINT}${canEdit && derived.auto ? " · Right-click to override" : ""}`;

  /**
   * Migration honesty (AUTOMATION_PLAN §4.4): before automation the dots were
   * decorative and proficiency was hand-typed into the modifier box. A dot + a Misc
   * equal to dot × prof now double-counts — flag it, never silently rewrite.
   */
  const doubleCounts = (statId: string, profs: Record<string, number>, mods: Record<string, number>) => {
    if (!derived.auto || !canEdit) return false;
    const dot = profs[statId] ?? 0;
    const misc = mods[statId] ?? 0;
    return dot > 0 && misc !== 0 && misc === dot * profValue;
  };
  const clearMisc = (statId: string, field: "skillMods" | "saveMods") => {
    const next = { ...value[field] };
    delete next[statId];
    update({ [field]: next });
  };

  /** The total cell: roll button (right-click = override editor) + override marker. */
  const totalCell = (statId: string, name: string, checkKind: "skill" | "save") => {
    const total = derived.values[statId] ?? 0;
    const overridden = derived.auto && value.overrides[statId] !== undefined;
    const cls = checkKind === "skill" ? "skill-total" : "save-total";
    return (
      <span className="stat-total-wrap" onBlur={() => setEditingStat(null)}>
        {editingStat === statId && canEdit && derived.auto ? (
          <NumberInput
            className={`${cls} ovr-edit`}
            value={total}
            autoFocus
            onCommit={(next) => {
              setOverride(statId, next);
              setEditingStat(null);
            }}
            aria-label={`${name} override`}
          />
        ) : onRollCheck ? (
          <button
            className={`${cls} roll-btn`}
            title={rollTitle(`${name}${checkKind === "save" ? " save" : ""}`)}
            onClick={(e) => onRollCheck({ kind: checkKind, statId }, advFromEvent(e))}
            onContextMenu={
              canEdit && derived.auto
                ? (e) => {
                    e.preventDefault();
                    setEditingStat(statId);
                  }
                : undefined
            }
          >
            {formatModifier(total)}
          </button>
        ) : (
          <span className={cls}>{formatModifier(total)}</span>
        )}
        <OverrideMarker
          overridden={overridden}
          baseValue={derived.base[statId] ?? 0}
          onReset={() => setOverride(statId, null)}
          disabled={!canEdit}
        />
      </span>
    );
  };

  return (
    <div className="sheet-page main-page">
      <AbilityRow sheet={sheet} />

      <div className="main-columns">
        <div className="main-col">
          <SectionHeader title="Skills" />
          {template.skills.map((skill) => {
            const manual = value.skillMods[skill.id] ?? 0;
            const prof = value.skillProfs[skill.id] ?? 0;
            return (
              <div className="skill-row" key={skill.id}>
                <ProfDot
                  level={prof}
                  max={2}
                  disabled={!canEdit}
                  title={`${skill.name} proficiency`}
                  onCycle={(next) => update({ skillProfs: { ...value.skillProfs, [skill.id]: next } })}
                />
                <span className="skill-abbr">{abilityAbbr((skill as { abilityId?: string }).abilityId ?? "")}</span>
                <span className="skill-name">{skill.name}</span>
                {canEdit ? (
                  <span className="misc-wrap">
                    <NumberInput className="skill-mod-input" value={manual} onCommit={(next) => update({ skillMods: { ...value.skillMods, [skill.id]: next } })} aria-label={`${skill.name} misc bonus`} />
                    {doubleCounts(skill.id, value.skillProfs, value.skillMods) ? (
                      <button
                        type="button"
                        className="dc-warn"
                        title={`Possible double-count: Misc (${formatModifier(manual)}) equals the dot's proficiency. If you typed proficiency in before automation, click to clear Misc.`}
                        onClick={() => clearMisc(skill.id, "skillMods")}
                      >
                        <AlertTriangle size={12} strokeWidth={2.2} />
                      </button>
                    ) : null}
                  </span>
                ) : null}
                {totalCell(skill.id, skill.name, "skill")}
                <span className="skill-passive" title="Passive">{derived.values[`passive-${skill.id}`] ?? 10}</span>
              </div>
            );
          })}

          <ToolsSection sheet={sheet} />
        </div>

        <div className="main-col">
          <SectionHeader title="Saving Throws" />
          <div className="saves-grid">
            {template.saves.map((save) => {
              const manual = value.saveMods[save.id] ?? 0;
              const prof = value.saveProfs[save.id] ?? 0;
              return (
                <div className="save-row" key={save.id}>
                  <ProfDot level={prof} max={1} disabled={!canEdit} title={`${save.name} save proficiency`} onCycle={(next) => update({ saveProfs: { ...value.saveProfs, [save.id]: next } })} />
                  <span className="save-name">{save.name}</span>
                  {totalCell(save.id, save.name, "save")}
                  {canEdit ? (
                    <span className="misc-wrap">
                      <NumberInput className="save-mod-input" value={manual} onCommit={(next) => update({ saveMods: { ...value.saveMods, [save.id]: next } })} aria-label={`${save.name} save misc bonus`} />
                      {doubleCounts(save.id, value.saveProfs, value.saveMods) ? (
                        <button
                          type="button"
                          className="dc-warn"
                          title={`Possible double-count: Misc (${formatModifier(manual)}) equals the dot's proficiency. If you typed proficiency in before automation, click to clear Misc.`}
                          onClick={() => clearMisc(save.id, "saveMods")}
                        >
                          <AlertTriangle size={12} strokeWidth={2.2} />
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <PillList label="Resistances" values={value.resistances} canEdit={canEdit} onChange={(resistances) => update({ resistances })} />
          <PillList label="Immunities" values={value.immunities} canEdit={canEdit} onChange={(immunities) => update({ immunities })} />
          <PillList label="Vulnerabilities" values={value.vulnerabilities} canEdit={canEdit} onChange={(vulnerabilities) => update({ vulnerabilities })} />
          <PillList label="Condition Immunities" values={value.conditionImmunities} canEdit={canEdit} onChange={(conditionImmunities) => update({ conditionImmunities })} />
          <PillList label="Armor" values={value.armorProfs} canEdit={canEdit} onChange={(armorProfs) => update({ armorProfs })} />
          <PillList label="Weapons" values={value.weaponProfs} canEdit={canEdit} onChange={(weaponProfs) => update({ weaponProfs })} />
          <PillList label="Languages" values={value.languages} canEdit={canEdit} onChange={(languages) => update({ languages })} />
        </div>
      </div>
    </div>
  );
}

/** Six ability blocks (abbr, modifier, score). Reused by the NPC Features header. */
export function AbilityRow({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, update, onRollCheck } = sheet;
  return (
    <div className="ability-row">
      {template.abilities.map((ability) => {
        const score = value.abilityScores[ability.id] ?? 10;
        const mod = abilityModifier(score);
        return (
          <div className="ability-block" key={ability.id}>
            <div className="ability-block-abbr">{ability.abbr}</div>
            {onRollCheck ? (
              <button className="ability-block-mod roll-btn" title={`${ability.name} check — ${ROLL_HINT}`} onClick={(e) => onRollCheck({ kind: "ability", abilityId: ability.id }, advFromEvent(e))}>
                {formatModifier(mod)}
              </button>
            ) : (
              <div className="ability-block-mod">{formatModifier(mod)}</div>
            )}
            {canEdit ? (
              <NumberInput className="ability-block-score" value={score} min={1} allowNegative={false} onCommit={(next) => update({ abilityScores: { ...value.abilityScores, [ability.id]: next } })} aria-label={ability.name} />
            ) : (
              <div className="ability-block-score">{score}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** An inline saving-throw row shown under the NPC ability blocks. */
export function SavesRow({ sheet }: { sheet: SheetEdit }) {
  const { derived, onRollCheck } = sheet;
  return (
    <div className="npc-saves-row">
      {template.saves.map((save) => {
        const total = derived.values[save.id] ?? 0;
        return (
          <button
            type="button"
            key={save.id}
            className="npc-save-chip roll-btn"
            disabled={!onRollCheck}
            title={`${save.name} save`}
            onClick={(e) => onRollCheck?.({ kind: "save", statId: save.id }, advFromEvent(e))}
          >
            <span>{abilityAbbr((save as { abilityId?: string }).abilityId ?? "")}</span>
            <span className="total">{formatModifier(total)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ToolsSection({ sheet }: { sheet: SheetEdit }) {
  const { value, canEdit, update, onRollCheck } = sheet;
  const addTool = () =>
    update({ tools: [...value.tools, { id: rowId("tool"), name: "New tool", mod: 0 } as ToolEntry] });
  return (
    <>
      <SectionHeader title="Tools" onAdd={canEdit ? addTool : undefined} />
      {value.tools.length === 0 ? <span className="muted rt-empty">No tools.</span> : null}
      {value.tools.map((tool, index) => (
        <div className="skill-row" key={tool.id}>
          <span className="skill-abbr" />
          {canEdit ? (
            <input
              className="skill-name"
              value={tool.name}
              onChange={(e) => update({ tools: value.tools.map((t, i) => (i === index ? { ...t, name: e.target.value } : t)) })}
            />
          ) : (
            <span className="skill-name">{tool.name}</span>
          )}
          {canEdit ? (
            <NumberInput className="skill-mod-input" value={tool.mod} onCommit={(mod) => update({ tools: value.tools.map((t, i) => (i === index ? { ...t, mod } : t)) })} aria-label={`${tool.name} modifier`} />
          ) : null}
          {onRollCheck ? (
            <button className="skill-total roll-btn" title={`${tool.name} — ${ROLL_HINT}`} onClick={(e) => onRollCheck({ kind: "tool", toolId: tool.id }, advFromEvent(e))}>
              {formatModifier(tool.mod)}
            </button>
          ) : (
            <span className="skill-total">{formatModifier(tool.mod)}</span>
          )}
          {canEdit ? (
            <button className="btn-ghost icon-btn" title="Remove" onClick={() => update({ tools: value.tools.filter((_, i) => i !== index) })}>✕</button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </>
  );
}
