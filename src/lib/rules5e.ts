import {
  abilityModifier,
  DEFAULT_ABILITY_SCORE,
  DEFAULT_SHEET_TEMPLATE,
  type CasterType,
  type CharacterSheet,
  type RollPart,
  type SheetKind,
} from "./types";

/**
 * The 5e rules engine (AUTOMATION_PLAN.md). Pure functions shared by the sheet UI and
 * the server's roll resolver so displayed numbers and authoritative rolls can never
 * disagree: every stat's labeled parts are built HERE, `computeDerived` totals are the
 * sum of those parts, and `resolveCheck` rolls d20 + the same parts. Everything is
 * COMPUTED, NEVER STORED — the only persisted inputs are the sheet's own fields plus
 * the `overrides` map, whose present keys replace a derived value verbatim. The engine
 * runs for PC sheets only; NPC sheets mirror their manual fields (monster stat blocks
 * are copied from books as-written).
 */

/** Derived stats, keyed by override key. `base` ignores overrides (for "auto: X" hints). */
export type Derived = {
  /** False for NPC sheets — every value mirrors the stored manual field. */
  auto: boolean;
  /** Final values (override-aware). */
  values: Record<string, number>;
  /** Formula values ignoring overrides (equal to `values` where nothing is overridden). */
  base: Record<string, number>;
  /** Effective spell-slot maximums per level "1".."9" (derived when casterType is set). */
  slotMaxes: Record<string, number>;
};

/** Standard 5e proficiency bonus: +2 at level 1, +1 every 4 levels (max +6 at 17). */
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(20, Math.round(level))) - 1) / 4);
}

/** A toggle trait is on (Special Traits page; ids from traitDefs.ts). */
export function traitOn(sheet: CharacterSheet, id: string): boolean {
  return sheet.traits[id] === true;
}

/** A numeric trait's value, or 0 (crit thresholds, global bonuses). */
export function traitNum(sheet: CharacterSheet, id: string): number {
  const value = sheet.traits[id];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export const sumParts = (parts: RollPart[]): number => parts.reduce((sum, p) => sum + p.value, 0);

const score = (sheet: CharacterSheet, abilityId: string) =>
  sheet.abilityScores[abilityId] ?? DEFAULT_ABILITY_SCORE;

const mod = (sheet: CharacterSheet, abilityId: string) => abilityModifier(score(sheet, abilityId));

const abbrOf = (abilityId: string) =>
  DEFAULT_SHEET_TEMPLATE.abilities.find((a) => a.id === abilityId)?.abbr ?? abilityId.toUpperCase();

/** The spellcasting ability modifier, or null when no ability is picked. */
function castingMod(sheet: CharacterSheet): number | null {
  const abilityId = sheet.spellcasting.abilityId;
  return abilityId ? mod(sheet, abilityId) : null;
}

const PHYSICAL_ABILITIES = new Set(["str", "dex", "con"]);

/**
 * Half-proficiency traits on an unproficient ability check: Jack of All Trades
 * (⌊prof/2⌋, any check) and Remarkable Athlete (⌈prof/2⌉, STR/DEX/CON + initiative).
 * They don't stack — the better one applies.
 */
function halfProfBonus(sheet: CharacterSheet, prof: number, abilityId: string | null): number {
  const jack = traitOn(sheet, "jack-of-all-trades") ? Math.floor(prof / 2) : 0;
  const athlete =
    traitOn(sheet, "remarkable-athlete") && abilityId !== null && PHYSICAL_ABILITIES.has(abilityId)
      ? Math.ceil(prof / 2)
      : 0;
  return Math.max(jack, athlete);
}

const push = (parts: RollPart[], part: RollPart) => {
  if (part.value !== 0) parts.push(part);
};

/** Parts for a bare ability check: ability mod + half-prof traits + global bonus. */
export function abilityCheckModParts(
  sheet: CharacterSheet,
  abilityId: string,
  prof: number,
): RollPart[] {
  const parts: RollPart[] = [];
  push(parts, { kind: "ability", value: mod(sheet, abilityId), label: abbrOf(abilityId) });
  push(parts, { kind: "prof", value: halfProfBonus(sheet, prof, abilityId), label: "Half Prof" });
  push(parts, { kind: "flat", value: traitNum(sheet, "global-ability-check-bonus"), label: "Bonus" });
  return parts;
}

/** Parts for a skill check: ability + dot×prof (or half-prof traits) + Misc + globals. */
export function skillModParts(sheet: CharacterSheet, statId: string, prof: number): RollPart[] {
  const def = DEFAULT_SHEET_TEMPLATE.skills.find((s) => s.id === statId);
  const abilityId = def && def.mode === "ability" ? def.abilityId : null;
  const dot = sheet.skillProfs[statId] ?? 0;
  const parts: RollPart[] = [];
  if (abilityId) {
    push(parts, { kind: "ability", value: mod(sheet, abilityId), label: abbrOf(abilityId) });
  }
  if (dot > 0) {
    push(parts, { kind: "prof", value: dot * prof, label: dot >= 2 ? "Expertise" : "Prof" });
  } else {
    push(parts, { kind: "prof", value: halfProfBonus(sheet, prof, abilityId), label: "Half Prof" });
  }
  push(parts, { kind: "flat", value: sheet.skillMods[statId] ?? 0, label: "Misc" });
  push(parts, {
    kind: "flat",
    value: traitNum(sheet, "global-ability-check-bonus") + traitNum(sheet, "global-skill-check-bonus"),
    label: "Bonus",
  });
  return parts;
}

/** Parts for a saving throw: ability + dot×prof (Diamond Soul = all proficient) + Misc + global. */
export function saveModParts(sheet: CharacterSheet, statId: string, prof: number): RollPart[] {
  const def = DEFAULT_SHEET_TEMPLATE.saves.find((s) => s.id === statId);
  const abilityId = def && def.mode === "ability" ? def.abilityId : null;
  const dot = Math.max(sheet.saveProfs[statId] ?? 0, traitOn(sheet, "diamond-soul") ? 1 : 0);
  const parts: RollPart[] = [];
  if (abilityId) {
    push(parts, { kind: "ability", value: mod(sheet, abilityId), label: abbrOf(abilityId) });
  }
  push(parts, { kind: "prof", value: dot * prof, label: "Prof" });
  push(parts, { kind: "flat", value: sheet.saveMods[statId] ?? 0, label: "Misc" });
  push(parts, { kind: "flat", value: traitNum(sheet, "global-saving-throw-bonus"), label: "Bonus" });
  return parts;
}

/** Parts for initiative: DEX + Alert-proficiency / half-prof traits + Misc + global. */
export function initiativeModParts(sheet: CharacterSheet, prof: number): RollPart[] {
  const parts: RollPart[] = [];
  push(parts, { kind: "ability", value: mod(sheet, "dex"), label: "DEX" });
  const alert = traitOn(sheet, "alert-feat") ? prof : 0;
  const traitBonus = Math.max(alert, halfProfBonus(sheet, prof, "dex"));
  push(parts, { kind: "prof", value: traitBonus, label: alert >= traitBonus && alert > 0 ? "Alert" : "Half Prof" });
  push(parts, { kind: "flat", value: sheet.initiative, label: "Misc" });
  push(parts, { kind: "flat", value: traitNum(sheet, "global-ability-check-bonus"), label: "Bonus" });
  return parts;
}

/** An attack row's roll-relevant fields (manual attacks + inventory weapons). */
export type AttackRowLike = {
  name?: string;
  toHit: number;
  toHitAbility?: string;
  range?: "melee" | "ranged";
};

/** Resolves an attack row's auto-to-hit ability ("spell" → the spellcasting ability). */
export function autoAttackAbilityId(sheet: CharacterSheet, toHitAbility: string): string {
  return toHitAbility === "spell" ? sheet.spellcasting.abilityId : toHitAbility;
}

/**
 * Derived to-hit for an attack row with `toHitAbility` set: ability mod + proficiency.
 * Shared by the sheet display and the roll resolver (whose parts sum to this).
 */
export function autoAttackBonus(
  sheet: CharacterSheet,
  toHitAbility: string,
  profBonus: number,
): number {
  const abilityId = autoAttackAbilityId(sheet, toHitAbility);
  return (abilityId ? mod(sheet, abilityId) : 0) + profBonus;
}

/** The global attack/damage trait id for a tagged row ("spell" to-hit = spell attack). */
function globalAttackTraitId(row: AttackRowLike, kind: "attack" | "damage"): string | null {
  if (!row.range) {
    return null; // untagged rows skip the melee/ranged global bonuses
  }
  const weaponOrSpell = row.toHitAbility === "spell" ? "spell" : "weapon";
  return `${row.range}-${weaponOrSpell}-${kind}-bonus`;
}

/** Parts for an attack roll: auto (ability + prof) or manual to-hit, + tagged globals. */
export function attackModParts(sheet: CharacterSheet, row: AttackRowLike, prof: number): RollPart[] {
  const parts: RollPart[] = [];
  const abilityId = row.toHitAbility ? autoAttackAbilityId(sheet, row.toHitAbility) : "";
  if (abilityId) {
    push(parts, { kind: "ability", value: mod(sheet, abilityId), label: abbrOf(abilityId) });
    push(parts, { kind: "prof", value: prof, label: "Prof" });
  } else {
    push(parts, { kind: "item", value: row.toHit, label: row.name ?? "To hit" });
  }
  const traitId = globalAttackTraitId(row, "attack");
  if (traitId) {
    push(parts, { kind: "flat", value: traitNum(sheet, traitId), label: "Bonus" });
  }
  return parts;
}

/** The tagged global damage bonus for an attack row (0 when untagged). */
export function attackDamageBonus(sheet: CharacterSheet, row: AttackRowLike): number {
  const traitId = globalAttackTraitId(row, "damage");
  return traitId ? traitNum(sheet, traitId) : 0;
}

/** Parts for a generic spell attack (no melee/ranged tag): casting ability + prof. */
export function spellAttackModParts(sheet: CharacterSheet, prof: number): RollPart[] {
  const parts: RollPart[] = [];
  const cast = castingMod(sheet);
  if (cast === null) {
    push(parts, { kind: "item", value: sheet.spellcasting.attackBonus, label: "Spell" });
    return parts;
  }
  push(parts, { kind: "ability", value: cast, label: abbrOf(sheet.spellcasting.abilityId) });
  push(parts, { kind: "prof", value: prof, label: "Prof" });
  return parts;
}

/** The effective proficiency bonus (override-aware) for a PC sheet. */
export function effectiveProf(sheet: CharacterSheet): number {
  return sheet.overrides["prof"] ?? proficiencyBonusForLevel(sheet.level);
}

/** Crit threshold for an attack (natural roll ≥ this = crit); 20 unless a trait lowers it. */
export function critThreshold(sheet: CharacterSheet, spell: boolean): number {
  const raw = traitNum(sheet, spell ? "spell-crit-threshold" : "weapon-crit-threshold");
  return raw >= 2 && raw <= 20 ? raw : 20;
}

/**
 * Full-caster spell slots per level 1..20 (PHB). Half/third casters map onto this table
 * at ceil(level/2) / ceil(level/3) — matches the single-class Paladin/Eldritch Knight
 * progressions — except they get nothing before their casting comes online.
 */
const FULL_CASTER_SLOTS: number[][] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Warlock pact magic: [slot count, slot level] per character level 1..20. */
const PACT_SLOTS: Array<[number, number]> = [
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 2],
  [2, 3],
  [2, 3],
  [2, 4],
  [2, 4],
  [2, 5],
  [2, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [4, 5],
  [4, 5],
  [4, 5],
  [4, 5],
];

/** Spell-slot maximums for an auto caster type at a character level ("1".."9" keys). */
export function spellSlotMaxes(casterType: CasterType, level: number): Record<string, number> {
  const lvl = Math.max(1, Math.min(20, Math.round(level)));
  if (casterType === "pact") {
    const [count, slotLevel] = PACT_SLOTS[lvl - 1];
    return { [String(slotLevel)]: count };
  }
  let row: number[] | undefined;
  if (casterType === "full") {
    row = FULL_CASTER_SLOTS[lvl - 1];
  } else if (casterType === "half" && lvl >= 2) {
    row = FULL_CASTER_SLOTS[Math.ceil(lvl / 2) - 1];
  } else if (casterType === "third" && lvl >= 3) {
    row = FULL_CASTER_SLOTS[Math.ceil(lvl / 3) - 1];
  }
  if (!row) {
    return {};
  }
  const maxes: Record<string, number> = {};
  row.forEach((count, index) => {
    maxes[String(index + 1)] = count;
  });
  return maxes;
}

/** Whether a stat is manually overridden (shows the marker + reset affordance). */
export function isOverridden(sheet: CharacterSheet, key: string): boolean {
  return sheet.overrides[key] !== undefined;
}

/**
 * Computes every derived stat for a sheet. PC sheets get the full 5e formulas
 * (totals = the sum of the same labeled parts the roll resolver uses) with per-key
 * overrides; NPC sheets pass their manual fields through unchanged so stat blocks
 * read exactly as entered.
 */
export function computeDerived(sheet: CharacterSheet, kind: SheetKind): Derived {
  const template = DEFAULT_SHEET_TEMPLATE;
  const base: Record<string, number> = {};

  if (kind === "npc") {
    base["prof"] = sheet.proficiencyBonus;
    base["init"] = sheet.initiative;
    base["carry-capacity"] = sheet.carryCapacity;
    base["hit-dice-max"] = sheet.hitDice.max;
    base["spell-attack"] = sheet.spellcasting.attackBonus;
    base["spell-dc"] = sheet.spellcasting.saveDc;
    for (const skill of template.skills) {
      const total =
        (skill.mode === "ability" ? mod(sheet, skill.abilityId) : 0) +
        (sheet.skillMods[skill.id] ?? 0);
      base[skill.id] = total;
      base[`passive-${skill.id}`] = 10 + total;
    }
    for (const save of template.saves) {
      base[save.id] =
        (save.mode === "ability" ? mod(sheet, save.abilityId) : 0) +
        (sheet.saveMods[save.id] ?? 0);
    }
    const slotMaxes: Record<string, number> = {};
    for (const [level, slot] of Object.entries(sheet.spellSlots)) {
      if (slot.max > 0) {
        slotMaxes[level] = slot.max;
      }
    }
    return { auto: false, values: { ...base }, base, slotMaxes };
  }

  const prof = effectiveProf(sheet);
  base["prof"] = proficiencyBonusForLevel(sheet.level);
  base["init"] = sumParts(initiativeModParts(sheet, prof));
  base["carry-capacity"] = Math.max(
    0,
    Math.round(
      score(sheet, "str") * 15 * (sheet.carryMultiplier || 1) * (traitOn(sheet, "powerful-build") ? 2 : 1),
    ),
  );
  base["hit-dice-max"] = Math.max(1, Math.round(sheet.level));
  const cast = castingMod(sheet);
  base["spell-attack"] = cast === null ? sheet.spellcasting.attackBonus : cast + prof;
  base["spell-dc"] =
    (cast === null ? sheet.spellcasting.saveDc : 8 + cast + prof) +
    traitNum(sheet, "global-spell-dc-bonus");
  // Template ids are already override keys ("skill-stealth", "save-dex").
  for (const skill of template.skills) {
    base[skill.id] = sumParts(skillModParts(sheet, skill.id, prof));
  }
  for (const save of template.saves) {
    base[save.id] = sumParts(saveModParts(sheet, save.id, prof));
  }

  // Overrides replace any base value they key; passives then derive from the FINAL
  // skill totals (a Stealth override moves passive Stealth with it). Observant adds
  // +5 to the two passives it names.
  const values: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(sheet.overrides)) {
    if (key in values) {
      values[key] = value;
    }
  }
  const observant = traitOn(sheet, "observant-feat") ? 5 : 0;
  for (const skill of template.skills) {
    const bonus =
      observant && (skill.id === "skill-perception" || skill.id === "skill-investigation") ? 5 : 0;
    base[`passive-${skill.id}`] = 10 + base[skill.id] + bonus;
    values[`passive-${skill.id}`] = 10 + values[skill.id] + bonus;
  }

  const casterType = sheet.spellcasting.casterType;
  const slotMaxes =
    casterType === "none"
      ? Object.fromEntries(
          Object.entries(sheet.spellSlots)
            .filter(([, slot]) => slot.max > 0)
            .map(([level, slot]) => [level, slot.max]),
        )
      : spellSlotMaxes(casterType, sheet.level);

  return { auto: true, values, base, slotMaxes };
}
