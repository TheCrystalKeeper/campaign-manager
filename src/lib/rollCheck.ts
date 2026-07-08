import {
  abilityModifier,
  DEFAULT_SHEET_TEMPLATE,
  type CharacterSheet,
  type CheckSpec,
  type RollPart,
  type SheetKind,
} from "./types";
import {
  abilityCheckModParts,
  attackDamageBonus,
  attackModParts,
  autoAttackAbilityId,
  critThreshold,
  effectiveProf,
  initiativeModParts,
  saveModParts,
  skillModParts,
  spellAttackModParts,
  traitNum,
  traitOn,
} from "./rules5e";
import { rollDiceExpression } from "./dice";

/**
 * The resolved result of a ROLL_CHECK — shaped to drop straight into a DiceRoll.
 * `parts` sum to `total`; `rolls` is the d20 (or damage dice) kept.
 */
export type ResolvedCheck = {
  label: string;
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
  parts: RollPart[];
  adv?: "adv" | "dis";
  otherTotal?: number;
  /** Attack roll met the crit threshold (natural die, before modifiers). */
  crit?: boolean;
};

/** Caller context: the sheet kind gates the rules engine; conditions gate adv/dis. */
export type CheckOptions = {
  kind?: SheetKind;
  /** The acting token's conditions (Poisoned/Prone/… impose disadvantage). */
  conditions?: string[];
};

const abbrOf = (abilityId: string) =>
  DEFAULT_SHEET_TEMPLATE.abilities.find((a) => a.id === abilityId)?.abbr ?? abilityId.toUpperCase();
const abilityNameOf = (abilityId: string) =>
  DEFAULT_SHEET_TEMPLATE.abilities.find((a) => a.id === abilityId)?.name ?? abilityId;

/** Find an attack/damage source row by id (manual attacks, then inventory weapons). */
function findAttackRow(sheet: CharacterSheet, rowId: string) {
  const id = rowId.startsWith("inv:") ? rowId.slice(4) : rowId;
  const attack = sheet.attacks.find((a) => a.id === id);
  if (attack) {
    return {
      name: attack.name,
      toHit: attack.toHit,
      damage: attack.damage,
      toHitAbility: attack.toHitAbility,
      range: attack.range,
    };
  }
  const item = sheet.inventory.find((r) => r.id === id);
  if (item) {
    return {
      name: item.name,
      toHit: item.toHit ?? 0,
      damage: item.damage ?? "",
      toHitAbility: item.toHitAbility,
      range: item.range,
    };
  }
  return null;
}

/**
 * Conditions on the ROLLER that impose disadvantage, by roll type (5e). Effects that
 * depend on the TARGET (attacking an invisible creature…) need a targeting system the
 * app doesn't have. Returns the condition id for the log note, or null.
 */
function conditionDisadvantage(
  check: CheckSpec,
  conditions: string[],
): string | null {
  if (conditions.length === 0) {
    return null;
  }
  const has = (id: string) => conditions.includes(id);
  switch (check.kind) {
    case "attack":
    case "spell-attack":
      for (const id of ["poisoned", "prone", "blinded", "restrained", "frightened"]) {
        if (has(id)) return id;
      }
      return null;
    case "ability":
    case "skill":
    case "tool":
    case "initiative":
      for (const id of ["poisoned", "frightened", "exhaustion"]) {
        if (has(id)) return id;
      }
      return null;
    case "save":
      // Restrained: disadvantage on DEX saves specifically.
      return check.statId === "save-dex" && has("restrained") ? "restrained" : null;
    default:
      return null;
  }
}

/** The governing ability of a check, for Elven Accuracy's DEX/INT/WIS/CHA gate. */
function checkAbilityId(sheet: CharacterSheet, check: CheckSpec): string | null {
  switch (check.kind) {
    case "ability":
      return check.abilityId;
    case "skill": {
      const def = DEFAULT_SHEET_TEMPLATE.skills.find((s) => s.id === check.statId);
      return def && def.mode === "ability" ? def.abilityId : null;
    }
    case "save": {
      const def = DEFAULT_SHEET_TEMPLATE.saves.find((s) => s.id === check.statId);
      return def && def.mode === "ability" ? def.abilityId : null;
    }
    case "initiative":
      return "dex";
    case "attack": {
      const row = findAttackRow(sheet, check.rowId);
      return row?.toHitAbility ? autoAttackAbilityId(sheet, row.toHitAbility) || null : null;
    }
    case "spell-attack":
      return sheet.spellcasting.abilityId || null;
    default:
      return null;
  }
}

const ELVEN_ACCURACY_ABILITIES = new Set(["dex", "int", "wis", "cha"]);

/**
 * Resolves a structured sheet roll into a labeled, color-coded breakdown. Pure — the
 * caller supplies `randInt` (the server passes secureRandInt for provable fairness).
 * PC sheets go through the rules engine: modifiers come from the SAME part builders
 * the sheet display sums, traits shape the roll (rerolls, crit thresholds, extra
 * advantage dice), and the roller's token conditions impose disadvantage. NPC sheets
 * read their manual fields as-entered (conditions still apply — a poisoned goblin has
 * disadvantage too).
 */
export function resolveCheck(
  sheet: CharacterSheet,
  check: CheckSpec,
  adv: "adv" | "dis" | undefined,
  randInt: (n: number) => number,
  opts: CheckOptions = {},
): ResolvedCheck {
  const kind = opts.kind ?? "pc";
  const auto = kind !== "npc";
  const conditions = opts.conditions ?? [];
  const profBonus = auto ? effectiveProf(sheet) : sheet.proficiencyBonus;
  /** An overridden stat rolls as d20 + one flat "Override" part (the breakdown is gone). */
  const overridePart = (key: string): RollPart[] | null =>
    auto && sheet.overrides[key] !== undefined
      ? [{ kind: "flat", value: sheet.overrides[key], label: "Override" }]
      : null;

  // Damage rolls have no d20 — roll the weapon's damage expression instead. A crit
  // doubles the dice (+ melee-crit-damage-dice extras on melee rows).
  if (check.kind === "damage") {
    const row = findAttackRow(sheet, check.rowId);
    const name = row?.name ?? "Attack";
    const expr = row?.damage || "1d6";
    let result;
    try {
      result = rollDiceExpression(expr, randInt);
    } catch {
      result = rollDiceExpression("1d6", randInt);
    }
    if (check.crit) {
      const match = result.expression.match(/^(\d+)d(\d+)/i);
      const dieCount = match ? Number.parseInt(match[1], 10) : 1;
      const dieSize = match ? Number.parseInt(match[2], 10) : 6;
      // Doubled dice, plus the melee-crit-damage-dice trait's extras on melee rows.
      const extraTraitDice =
        auto && row?.range === "melee"
          ? Math.max(0, Math.min(10, Math.round(traitNum(sheet, "melee-crit-damage-dice"))))
          : 0;
      const extraCount = dieCount + extraTraitDice;
      const extraRolls = Array.from({ length: extraCount }, () => randInt(dieSize) + 1);
      result = {
        ...result,
        rolls: [...result.rolls, ...extraRolls],
        total: result.total + extraRolls.reduce((s, v) => s + v, 0),
        expression: `${dieCount + extraCount}d${dieSize}${result.modifier > 0 ? `+${result.modifier}` : result.modifier < 0 ? String(result.modifier) : ""}`,
      };
    }
    const parts: RollPart[] = result.rolls.map((v) => ({ kind: "die", value: v, label: dieLabel(result.expression) }));
    if (result.modifier !== 0) {
      parts.push({ kind: "item", value: result.modifier, label: name });
    }
    let total = result.total;
    if (auto && row) {
      const globalBonus = attackDamageBonus(sheet, row);
      if (globalBonus !== 0) {
        parts.push({ kind: "flat", value: globalBonus, label: "Bonus" });
        total += globalBonus;
      }
    }
    return {
      label: `${name} damage${check.crit ? " (CRIT)" : ""}`,
      expression: result.expression,
      rolls: result.rolls,
      modifier: total - result.rolls.reduce((s, v) => s + v, 0),
      total,
      parts,
      ...(check.crit ? { crit: true } : {}),
    };
  }

  // Every other check is d20 + typed modifiers.
  let mods: RollPart[] = [];
  let label = "Check";

  switch (check.kind) {
    case "ability": {
      label = `${abilityNameOf(check.abilityId)} check`;
      if (auto) {
        mods = abilityCheckModParts(sheet, check.abilityId, profBonus);
      } else {
        const abilityMod = abilityModifier(sheet.abilityScores[check.abilityId] ?? 10);
        if (abilityMod !== 0) mods.push({ kind: "ability", value: abilityMod, label: abbrOf(check.abilityId) });
      }
      break;
    }
    case "skill":
    case "save": {
      const def = (check.kind === "skill" ? DEFAULT_SHEET_TEMPLATE.skills : DEFAULT_SHEET_TEMPLATE.saves).find(
        (s) => s.id === check.statId,
      );
      label = `${def?.name ?? "Check"} ${check.kind === "skill" ? "check" : "save"}`;
      // Template stat ids double as override keys ("skill-stealth", "save-dex").
      const override = overridePart(check.statId);
      if (override) {
        mods = override;
        break;
      }
      if (auto) {
        mods =
          check.kind === "skill"
            ? skillModParts(sheet, check.statId, profBonus)
            : saveModParts(sheet, check.statId, profBonus);
        break;
      }
      const abilityId = def && def.mode === "ability" ? def.abilityId : undefined;
      const abilityMod = abilityId ? abilityModifier(sheet.abilityScores[abilityId] ?? 10) : 0;
      const manual = (check.kind === "skill" ? sheet.skillMods : sheet.saveMods)[check.statId] ?? 0;
      if (abilityMod !== 0 && abilityId) mods.push({ kind: "ability", value: abilityMod, label: abbrOf(abilityId) });
      if (manual !== 0) mods.push({ kind: "prof", value: manual });
      break;
    }
    case "tool": {
      const tool = sheet.tools.find((t) => t.id === check.toolId);
      label = `${tool?.name ?? "Tool"} check`;
      if (tool && tool.mod !== 0) mods.push({ kind: "flat", value: tool.mod });
      break;
    }
    case "initiative": {
      label = "Initiative";
      const override = overridePart("init");
      if (override) {
        mods = override;
        break;
      }
      if (auto) {
        mods = initiativeModParts(sheet, profBonus);
      } else if (sheet.initiative !== 0) {
        mods.push({ kind: "flat", value: sheet.initiative, label: "Init" });
      }
      break;
    }
    case "attack": {
      const row = findAttackRow(sheet, check.rowId);
      label = `${row?.name ?? "Attack"} attack`;
      if (row) {
        if (auto) {
          mods = attackModParts(sheet, row, profBonus);
        } else if (row.toHit !== 0) {
          mods.push({ kind: "item", value: row.toHit, label: row.name });
        }
      }
      break;
    }
    case "spell-attack": {
      label = "Spell attack";
      const override = overridePart("spell-attack");
      if (override) {
        mods = override;
        break;
      }
      if (auto) {
        mods = spellAttackModParts(sheet, profBonus);
      } else if (sheet.spellcasting.attackBonus !== 0) {
        mods.push({ kind: "item", value: sheet.spellcasting.attackBonus, label: "Spell" });
      }
      break;
    }
  }

  // ---- Advantage / disadvantage: user click + trait advantage + condition
  // disadvantage, combined by the 5e stacking rule (any adv + any dis cancel).
  const condDis = conditionDisadvantage(check, conditions);
  const traitAdv = auto && check.kind === "initiative" && traitOn(sheet, "advantage-initiative");
  const hasAdv = adv === "adv" || traitAdv;
  const hasDis = adv === "dis" || condDis !== null;
  const effAdv: "adv" | "dis" | undefined = hasAdv && hasDis ? undefined : hasAdv ? "adv" : hasDis ? "dis" : undefined;
  const notes: string[] = [];
  if (traitAdv && adv !== "adv") notes.push("adv: initiative trait");
  if (condDis) notes.push(`dis: ${condDis}`);
  if (hasAdv && hasDis) notes.push("cancelled");

  // ---- Roll the d20(s). Halfling Lucky rerolls natural 1s once; Elven Accuracy rolls
  // a third die when advantaged on a DEX/INT/WIS/CHA-based roll.
  const lucky = auto && traitOn(sheet, "halfling-lucky");
  const rerolled: boolean[] = [];
  const d20 = (): number => {
    let v = randInt(20) + 1;
    let wasRerolled = false;
    if (lucky && v === 1) {
      v = randInt(20) + 1;
      wasRerolled = true;
    }
    rerolled.push(wasRerolled);
    return v;
  };

  const abilityId = checkAbilityId(sheet, check);
  const elven =
    auto &&
    traitOn(sheet, "elven-accuracy") &&
    effAdv === "adv" &&
    abilityId !== null &&
    ELVEN_ACCURACY_ABILITIES.has(abilityId);
  const dieCount = effAdv ? (elven ? 3 : 2) : 1;
  const dice = Array.from({ length: dieCount }, () => d20());
  let kept = effAdv === "dis" ? Math.min(...dice) : Math.max(...dice);
  if (effAdv === undefined) {
    kept = dice[0];
  }
  const keptIndex = dice.indexOf(kept);
  const keptRerolled = rerolled[keptIndex] === true;
  if (elven) notes.push("Elven Accuracy");
  if (keptRerolled) notes.push("rerolled 1");

  // Reliable Talent: proficient skill checks treat a kept die below 10 as 10.
  let effKept = kept;
  const reliable =
    auto &&
    check.kind === "skill" &&
    traitOn(sheet, "reliable-talent") &&
    (sheet.skillProfs[check.statId] ?? 0) > 0 &&
    kept < 10;
  if (reliable) {
    effKept = 10;
    notes.push("Reliable Talent");
  }

  const modTotal = mods.reduce((sum, p) => sum + p.value, 0);
  let otherTotal: number | undefined;
  if (effAdv) {
    const others = dice.filter((_, i) => i !== keptIndex);
    const other = effAdv === "dis" ? Math.min(...others) : Math.max(...others);
    otherTotal = other + modTotal;
  }

  // Crit: attack rolls whose NATURAL kept die meets the threshold (traits can lower it).
  const isAttack = check.kind === "attack" || check.kind === "spell-attack";
  const spellish =
    check.kind === "spell-attack" ||
    (check.kind === "attack" && findAttackRow(sheet, check.rowId)?.toHitAbility === "spell");
  const crit = isAttack && kept >= (auto ? critThreshold(sheet, spellish) : 20);

  const dieLabelText = reliable ? "d20 (Reliable Talent)" : keptRerolled ? "d20 (rerolled 1)" : "d20";
  const parts: RollPart[] = [{ kind: "die", value: effKept, label: dieLabelText }, ...mods];
  const modExprTail = modTotal === 0 ? "" : modTotal > 0 ? `+${modTotal}` : `${modTotal}`;

  return {
    label: notes.length > 0 ? `${label} (${notes.join(", ")})` : label,
    expression: `1d20${modExprTail}`,
    rolls: [effKept],
    modifier: modTotal,
    total: effKept + modTotal,
    parts,
    ...(effAdv ? { adv: effAdv } : {}),
    ...(otherTotal !== undefined ? { otherTotal } : {}),
    ...(crit ? { crit: true } : {}),
  };
}

/** Extracts a "dNN" label from a normalized "CdNN±M" expression. */
function dieLabel(expression: string): string {
  const match = expression.match(/d(\d+)/i);
  return match ? `d${match[1]}` : "die";
}

/** Builds color-coded parts from a freeform expression roll (ROLL_DICE / tray). */
export function partsFromExpression(rolls: number[], modifier: number, expression: string): RollPart[] {
  const label = dieLabel(expression);
  const parts: RollPart[] = rolls.map((v) => ({ kind: "die", value: v, label }));
  if (modifier !== 0) {
    parts.push({ kind: "flat", value: modifier });
  }
  return parts;
}
