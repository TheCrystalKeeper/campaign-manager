/**
 * Pure mappers from compendium entries to sheet/catalog rows. Every string is
 * pre-trimmed to the same caps `normalizeCharacterSheet` enforces server-side, so
 * the optimistic local draft matches the normalized broadcast byte-for-byte.
 */

import type {
  CompendiumBackground,
  CompendiumClass,
  CompendiumEquipment,
  CompendiumFeat,
  CompendiumMagicItem,
  CompendiumMonster,
  CompendiumMonsterAction,
  CompendiumSpecies,
  CompendiumSpell,
  CompendiumTrait,
} from "./compendium";
import {
  DEFAULT_ABILITY_SCORE,
  DEFAULT_SHEET_TEMPLATE,
  DESC_CAP,
  NAME_CAP,
  PILL_CAP,
  SHEET_ROW_CAPS,
  SHEET_SOFT_WARN_BYTES,
  SHORT_CAP,
  abilityModifier,
  createInventoryRow,
  inventoryCategoryForItemType,
  rowId,
  type AttackEntry,
  type CharacterSheet,
  type FeatureEntry,
  type InventoryEntry,
  type ItemRecord,
  type SpellEntry,
  type ToolEntry,
} from "./types";

const cap = (value: string, max: number) => value.trim().slice(0, max);

/** skill id -> governing ability id, from the sheet template ("skill-stealth" -> "dex"). */
const SKILL_ABILITY: Record<string, string> = Object.fromEntries(
  DEFAULT_SHEET_TEMPLATE.skills.flatMap((s) => (s.mode === "ability" ? [[s.id, s.abilityId]] : [])),
);

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

export function spellEntryFromCompendium(spell: CompendiumSpell): SpellEntry {
  const tags: string[] = [];
  if (spell.school) tags.push(spell.school);
  if (spell.concentration) tags.push(`Concentration, ${spell.duration}`);
  else if (spell.duration && spell.duration !== "instantaneous") tags.push(`Duration: ${spell.duration}`);
  if (spell.ritual) tags.push("Ritual");
  return {
    id: rowId("spell"),
    name: cap(spell.name, NAME_CAP),
    level: spell.level,
    components: cap(spell.components, SHORT_CAP),
    time: cap(spell.time, SHORT_CAP),
    range: cap(spell.range, SHORT_CAP),
    ...(spell.roll ? { roll: cap(spell.roll, SHORT_CAP) } : {}),
    description: cap([tags.join(" · "), spell.description].filter(Boolean).join("\n"), DESC_CAP),
  };
}

// ---------------------------------------------------------------------------
// Equipment / magic items
// ---------------------------------------------------------------------------

function equipmentDescription(eq: CompendiumEquipment): string {
  const parts: string[] = [];
  if (eq.properties?.length) parts.push(eq.properties.join(", "));
  if (eq.acBase != null) {
    const dex = eq.acDexBonus ? ` + Dex${eq.acMaxBonus ? ` (max ${eq.acMaxBonus})` : ""}` : "";
    parts.push(`AC ${eq.acBase}${dex}`);
  }
  if (eq.strMin) parts.push(`Str ${eq.strMin} required`);
  if (eq.stealthDisadvantage) parts.push("Stealth disadvantage");
  if (eq.description) parts.push(eq.description);
  return parts.join("\n");
}

/** Auto to-hit ability for a weapon row: ranged/finesse -> dex, melee -> str. */
function weaponToHitAbility(eq: CompendiumEquipment): string | undefined {
  if (eq.itemType !== "weapon" || !eq.damage) return undefined;
  const finesse = eq.properties?.some((p) => /finesse/i.test(p));
  return eq.range === "ranged" || finesse ? "dex" : "str";
}

export function inventoryRowFromEquipment(eq: CompendiumEquipment): InventoryEntry {
  const toHitAbility = weaponToHitAbility(eq);
  return createInventoryRow({
    name: cap(eq.name, NAME_CAP),
    category: inventoryCategoryForItemType(eq.itemType),
    ...(typeof eq.weight === "number" ? { weight: eq.weight } : {}),
    ...(eq.cost ? { price: cap(eq.cost, SHORT_CAP) } : {}),
    ...(eq.damage ? { damage: cap(eq.damage, SHORT_CAP) } : {}),
    ...(eq.damageType ? { damageType: cap(eq.damageType, SHORT_CAP) } : {}),
    ...(eq.range ? { range: eq.range } : {}),
    ...(toHitAbility ? { toHitAbility } : {}),
    ...(eq.itemType === "weapon" || eq.itemType === "armor" ? { equipped: false } : {}),
    ...(equipmentDescription(eq) ? { description: cap(equipmentDescription(eq), DESC_CAP) } : {}),
  });
}

export function inventoryRowFromMagicItem(mi: CompendiumMagicItem): InventoryEntry {
  return createInventoryRow({
    name: cap(mi.name, NAME_CAP),
    category: inventoryCategoryForItemType(mi.itemType),
    ...(mi.attunement ? { note: "Requires attunement" } : {}),
    ...(mi.itemType === "weapon" || mi.itemType === "armor" ? { equipped: false } : {}),
    description: cap(mi.description, DESC_CAP),
  });
}

/** Patch applied after dm.createItem() — fills catalog fields from an equipment entry. */
export function itemPatchFromEquipment(eq: CompendiumEquipment): Partial<ItemRecord> & { name: string } {
  return {
    name: cap(eq.name, NAME_CAP),
    type: eq.itemType,
    ...(typeof eq.weight === "number" ? { weight: eq.weight } : {}),
    ...(eq.cost ? { value: cap(eq.cost, SHORT_CAP) } : {}),
    ...(eq.damage ? { damage: cap(eq.damage, SHORT_CAP) } : {}),
    ...(eq.damageType ? { damageType: cap(eq.damageType, SHORT_CAP) } : {}),
    ...(eq.properties?.length ? { properties: eq.properties.map((p) => cap(p, PILL_CAP)) } : {}),
    equippable: eq.itemType === "weapon" || eq.itemType === "armor",
    description: cap(equipmentDescription(eq), DESC_CAP),
  };
}

export function itemPatchFromMagicItem(mi: CompendiumMagicItem): Partial<ItemRecord> & { name: string } {
  return {
    name: cap(mi.name, NAME_CAP),
    type: mi.itemType,
    ...(mi.rarity !== "varies" ? { rarity: mi.rarity } : {}),
    ...(mi.attunement ? { attunement: true } : {}),
    equippable: mi.itemType === "weapon" || mi.itemType === "armor",
    description: cap(
      [mi.rarityText ? `Rarity: ${mi.rarityText}` : "", mi.description].filter(Boolean).join("\n"),
      DESC_CAP,
    ),
  };
}

// ---------------------------------------------------------------------------
// Class autofill
// ---------------------------------------------------------------------------

/** Case-insensitive union of pill arrays, respecting the server pill caps. */
function unionPills(existing: string[], added: string[] | undefined): string[] {
  const out = [...existing];
  const seen = new Set(existing.map((p) => p.toLowerCase()));
  for (const pill of added ?? []) {
    const trimmed = cap(pill, PILL_CAP);
    if (!seen.has(trimmed.toLowerCase()) && out.length < SHEET_ROW_CAPS.pills) {
      out.push(trimmed);
      seen.add(trimmed.toLowerCase());
    }
  }
  return out;
}

function appendMissingTools(existing: ToolEntry[], names: string[]): ToolEntry[] {
  const out = [...existing];
  const seen = new Set(existing.map((t) => t.name.toLowerCase()));
  for (const name of names) {
    const trimmed = cap(name, NAME_CAP);
    if (!seen.has(trimmed.toLowerCase()) && out.length < SHEET_ROW_CAPS.tools) {
      out.push({ id: rowId("tool"), name: trimmed, mod: 0 });
      seen.add(trimmed.toLowerCase());
    }
  }
  return out;
}

export type ClassPickOptions = {
  subclassName?: string;
  /** false = names only (the default picker behavior). */
  autofill: boolean;
  /** Skill ids chosen from cls.skillChoices (may be empty = skip). */
  chosenSkills?: string[];
  sheet: CharacterSheet;
};

export function classAutofillPatch(cls: CompendiumClass, opts: ClassPickOptions): Partial<CharacterSheet> {
  const className = cap(cls.name, NAME_CAP);
  const subclassName = opts.subclassName ? cap(opts.subclassName, NAME_CAP) : "";
  const patch: Partial<CharacterSheet> = {
    characterClass: className,
    subclass: subclassName,
    // Replaces the class list — this is the "set/replace class" path. Adding a
    // second class goes through addMulticlassPatch instead.
    classes: [
      {
        id: opts.sheet.classes[0]?.id ?? rowId("cls"),
        className,
        subclassName,
        level: Math.max(1, opts.sheet.level),
        isFirstClass: true,
      },
    ],
  };
  if (!opts.autofill) return patch;
  const sheet = opts.sheet;
  patch.hitDice = { ...sheet.hitDice, die: `d${cls.hitDie}` };
  const saveProfs = { ...sheet.saveProfs };
  for (const abilityId of cls.saves) {
    const key = `save-${abilityId}`;
    saveProfs[key] = Math.max(1, saveProfs[key] ?? 0);
  }
  patch.saveProfs = saveProfs;
  if (cls.armorProfs?.length) patch.armorProfs = unionPills(sheet.armorProfs, cls.armorProfs);
  if (cls.weaponProfs?.length) patch.weaponProfs = unionPills(sheet.weaponProfs, cls.weaponProfs);
  if (cls.toolProfs?.length) patch.tools = appendMissingTools(sheet.tools, cls.toolProfs);
  if (cls.spellcasting) {
    patch.spellcasting = {
      ...sheet.spellcasting,
      abilityId: cls.spellcasting.abilityId,
      casterType: cls.spellcasting.casterType,
    };
  }
  if (opts.chosenSkills?.length) {
    const skillProfs = { ...sheet.skillProfs };
    for (const id of opts.chosenSkills) skillProfs[id] = Math.max(1, skillProfs[id] ?? 0);
    patch.skillProfs = skillProfs;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Multiclassing
// ---------------------------------------------------------------------------

export type MulticlassAddOptions = {
  subclassName?: string;
  /** false = just append the class entry; true = also apply multiclass proficiencies. */
  autofill: boolean;
  /** At most one skill id, from cls.multiclass.skillChoice (bard/ranger/rogue). */
  chosenSkills?: string[];
  sheet: CharacterSheet;
};

/**
 * Adds `cls` as an additional class at level 1 (spec §3: multiclass proficiencies
 * only — NEVER saving throws, and only the 1-skill choice when the source grants one).
 * The spellcasting ability is filled only if the sheet has none yet; slot maximums
 * derive from the class list itself once multiclassed (rules engine).
 */
export function addMulticlassPatch(cls: CompendiumClass, opts: MulticlassAddOptions): Partial<CharacterSheet> {
  const sheet = opts.sheet;
  const entry = {
    id: rowId("cls"),
    className: cap(cls.name, NAME_CAP),
    subclassName: opts.subclassName ? cap(opts.subclassName, NAME_CAP) : "",
    level: 1,
    isFirstClass: false,
  };
  const classes = [...sheet.classes, entry];
  const patch: Partial<CharacterSheet> = {
    classes,
    level: classes.reduce((sum, c) => sum + c.level, 0),
  };
  if (!opts.autofill) return patch;
  const mc = cls.multiclass;
  if (mc.armorProfs?.length) patch.armorProfs = unionPills(sheet.armorProfs, mc.armorProfs);
  if (mc.weaponProfs?.length) patch.weaponProfs = unionPills(sheet.weaponProfs, mc.weaponProfs);
  if (mc.toolProfs?.length) patch.tools = appendMissingTools(sheet.tools, mc.toolProfs);
  if (cls.spellcasting && !sheet.spellcasting.abilityId) {
    patch.spellcasting = { ...sheet.spellcasting, abilityId: cls.spellcasting.abilityId };
  }
  const allowed = mc.skillChoice?.choose ?? 0;
  const chosen = (opts.chosenSkills ?? []).slice(0, allowed);
  if (chosen.length) {
    const skillProfs = { ...sheet.skillProfs };
    for (const id of chosen) skillProfs[id] = Math.max(1, skillProfs[id] ?? 0);
    patch.skillProfs = skillProfs;
  }
  return patch;
}

export type PrereqFailure = { className: string; requirement: string };

/**
 * Soft multiclass prerequisite check (spec §6): every class the character would have —
 * existing AND the candidate — must meet its 13+ ability minimums. Classes whose name
 * doesn't match the compendium (homebrew) are skipped. Returns human-readable failures.
 */
export function multiclassPrereqFailures(
  entries: Array<{ className: string }>,
  abilityScores: Record<string, number>,
  compendium: CompendiumClass[],
): PrereqFailure[] {
  const byName = new Map(compendium.map((c) => [c.name.toLowerCase(), c]));
  const failures: PrereqFailure[] = [];
  for (const entry of entries) {
    const cls = byName.get(entry.className.trim().toLowerCase());
    if (!cls) continue;
    for (const prereq of cls.multiclass.prereqs) {
      const meets = (id: string) => (abilityScores[id] ?? 10) >= prereq.min;
      const ok = prereq.mode === "or" ? prereq.abilityIds.some(meets) : prereq.abilityIds.every(meets);
      if (!ok) {
        failures.push({
          className: cls.name,
          requirement: prereq.abilityIds.map((id) => `${id.toUpperCase()} ${prereq.min}`).join(prereq.mode === "or" ? " or " : " and "),
        });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Species autofill
// ---------------------------------------------------------------------------

function featureRowsFromTraits(traits: CompendiumTrait[], source: FeatureEntry["source"]): FeatureEntry[] {
  return traits.map((t) => ({
    id: rowId("feat"),
    name: cap(t.name, NAME_CAP),
    source,
    description: cap(t.description, DESC_CAP),
  }));
}

export type SpeciesPickOptions = {
  subspeciesId?: string;
  autofill: boolean;
  sheet: CharacterSheet;
};

export function speciesAutofillPatch(sp: CompendiumSpecies, opts: SpeciesPickOptions): Partial<CharacterSheet> {
  const sub = sp.subspecies?.find((s) => s.id === opts.subspeciesId);
  const displayName = sub ? `${sp.name} (${sub.name.replace(/^.*?:\s*/, "")})` : sp.name;
  const patch: Partial<CharacterSheet> = { race: cap(displayName, NAME_CAP) };
  if (!opts.autofill) return patch;
  const sheet = opts.sheet;
  patch.size = cap(sp.size, SHORT_CAP);
  patch.speed = sp.speed;
  // On autofill, the new species owns the creature type (switching species updates it).
  patch.creatureType = cap(sp.creatureType, SHORT_CAP);
  // Replace, don't append: drop all existing species features and lay down this
  // species' full set, so switching species doesn't leave the old one's rows behind.
  const newRows = featureRowsFromTraits([...sp.traits, ...(sub?.traits ?? [])], "species");
  patch.features = [...sheet.features.filter((f) => f.source !== "species"), ...newRows].slice(
    0,
    SHEET_ROW_CAPS.features,
  );
  return patch;
}

export function featureRowFromFeat(feat: CompendiumFeat): FeatureEntry {
  return {
    id: rowId("feat"),
    name: cap(feat.name, NAME_CAP),
    source: "feat",
    description: cap(feat.description, DESC_CAP),
  };
}

// ---------------------------------------------------------------------------
// Background autofill
// ---------------------------------------------------------------------------

export type BackgroundPickOptions = {
  /** false = just set the background name; true = also grant its skill proficiencies. */
  autofill: boolean;
  sheet: CharacterSheet;
};

export function backgroundAutofillPatch(bg: CompendiumBackground, opts: BackgroundPickOptions): Partial<CharacterSheet> {
  const patch: Partial<CharacterSheet> = { background: cap(bg.name, NAME_CAP) };
  if (!opts.autofill) return patch;
  const skillProfs = { ...opts.sheet.skillProfs };
  for (const id of bg.skills) skillProfs[id] = Math.max(1, skillProfs[id] ?? 0);
  patch.skillProfs = skillProfs;
  return patch;
}

// ---------------------------------------------------------------------------
// Monster → NPC sheet
// ---------------------------------------------------------------------------

function attackRow(action: CompendiumMonsterAction, descCap: number): AttackEntry {
  const range = /ranged/i.test(action.description.slice(0, 40)) ? "ranged" : "melee";
  return {
    id: rowId("atk"),
    name: cap(action.name, NAME_CAP),
    toHit: action.toHit ?? 0,
    damage: action.damage ? cap(action.damage, SHORT_CAP) : "",
    ...(action.damageType ? { damageType: cap(action.damageType, SHORT_CAP) } : {}),
    ...(action.uses ? { uses: action.uses } : {}),
    ...(action.toHit != null ? { range } : {}),
    notes: cap(action.description, descCap),
  };
}

function featureRow(action: CompendiumMonsterAction, prefix: string, descCap: number): FeatureEntry {
  return {
    id: rowId("feat"),
    name: cap(prefix ? `${prefix}: ${action.name}` : action.name, NAME_CAP),
    source: "other",
    ...(action.uses ? { uses: action.uses } : {}),
    description: cap(action.description, descCap),
  };
}

const splitPills = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[;,]/)
    .map((s) => cap(s, PILL_CAP))
    .filter(Boolean)
    .slice(0, SHEET_ROW_CAPS.pills);

function buildMonsterPatch(m: CompendiumMonster, descCap: number): Partial<CharacterSheet> {
  const dexMod = abilityModifier(m.abilities["dex"] ?? 10);
  const saveMods: Record<string, number> = {};
  for (const [abilityId, stated] of Object.entries(m.saves)) {
    const delta = stated - abilityModifier(m.abilities[abilityId] ?? 10);
    if (delta !== 0) saveMods[`save-${abilityId}`] = delta;
  }
  const skillMods: Record<string, number> = {};
  for (const [skillId, stated] of Object.entries(m.skills)) {
    const abilityId = SKILL_ABILITY[skillId];
    if (!abilityId) continue;
    const delta = stated - abilityModifier(m.abilities[abilityId] ?? 10);
    if (delta !== 0) skillMods[skillId] = delta;
  }

  const attacks: AttackEntry[] = [];
  const features: FeatureEntry[] = [];
  for (const t of m.traits ?? []) features.push(featureRow({ name: t.name, description: t.description }, "", descCap));
  // Non-attack actions (Multiattack, saves-based abilities) keep toHit 0 with the text in notes.
  for (const a of m.actions ?? []) attacks.push(attackRow(a, descCap));
  for (const a of m.bonusActions ?? []) {
    if (a.toHit != null) attacks.push(attackRow(a, descCap));
    else features.push(featureRow(a, "Bonus Action", descCap));
  }
  for (const a of m.reactions ?? []) features.push(featureRow(a, "Reaction", descCap));
  for (const a of m.legendary ?? []) features.push(featureRow(a, "Legendary", descCap));

  const sensesParts: string[] = [];
  const walkOnly = m.speedLine === `${m.walkSpeed} ft.`;
  if (m.speedLine && !walkOnly) sensesParts.push(`Speed ${m.speedLine}`);
  if (m.senses) sensesParts.push(m.senses);
  if (m.acNote) sensesParts.push(`AC (${m.acNote})`);

  const count = m.hitDiceCount ?? Math.max(1, Math.round(m.hp / 7));
  return {
    characterName: cap(m.name, NAME_CAP),
    creatureType: cap(m.type, SHORT_CAP),
    size: cap(m.size, SHORT_CAP),
    alignment: m.alignment ? cap(m.alignment, SHORT_CAP) : "",
    cr: cap(m.cr, SHORT_CAP),
    ...(m.xp != null ? { xp: m.xp } : {}),
    source: cap(m.source ?? "Monster Manual 2024", SHORT_CAP),
    ac: m.ac,
    hp: { current: m.hp, max: m.hp },
    hitDice: { current: count, max: count, die: m.hitDie ?? "d8" },
    speed: m.walkSpeed,
    proficiencyBonus: m.profBonus,
    initiative: m.initiative ?? dexMod,
    abilityScores: { ...m.abilities },
    saveMods,
    skillMods,
    senses: cap(sensesParts.join(" · "), DESC_CAP),
    languages: splitPills(m.languages),
    vulnerabilities: (m.vulnerabilities ?? []).map((s) => cap(s, PILL_CAP)),
    resistances: (m.resistances ?? []).map((s) => cap(s, PILL_CAP)),
    immunities: (m.immunities ?? []).map((s) => cap(s, PILL_CAP)),
    conditionImmunities: (m.conditionImmunities ?? []).map((s) => cap(s, PILL_CAP)),
    attacks: attacks.slice(0, SHEET_ROW_CAPS.attacks),
    features: features.slice(0, SHEET_ROW_CAPS.features),
  };
}

/** Full NPC-sheet patch from a monster stat block, re-trimmed if it nears the sheet byte cap. */
export function monsterSheetPatch(m: CompendiumMonster): Partial<CharacterSheet> {
  let patch = buildMonsterPatch(m, DESC_CAP);
  if (JSON.stringify(patch).length > SHEET_SOFT_WARN_BYTES) {
    patch = buildMonsterPatch(m, 500);
  }
  return patch;
}

/**
 * How `statblockPatch` applies a monster to an *existing* NPC:
 * - "replace": the monster's lists overwrite the NPC's.
 * - "add":     the monster's list rows are appended on top of the NPC's.
 * - "stats":   the NPC's lists are left untouched; only singular stats change.
 * In every mode the singular stats (HP/AC/abilities/speed/CR/...) are replaced and
 * the NPC's own `characterName`/`alignment` are preserved.
 */
export type StatblockApplyMode = "replace" | "add" | "stats";

// The "add/remove" collections a monster patch can carry. Everything else in the
// patch is a singular stat and is always replaced.
const STATBLOCK_LIST_KEYS = [
  "attacks",
  "features",
  "languages",
  "resistances",
  "immunities",
  "conditionImmunities",
  "vulnerabilities",
] as const;

/**
 * Apply a monster stat block onto an *existing* NPC sheet (see `StatblockApplyMode`).
 * Unlike `monsterSheetPatch` (used to spawn a fresh NPC), this preserves the NPC's
 * name and alignment and lets the caller control how the list collections merge.
 */
export function statblockPatch(
  existing: CharacterSheet,
  m: CompendiumMonster,
  mode: StatblockApplyMode,
): Partial<CharacterSheet> {
  const base = monsterSheetPatch(m);
  // Always keep the NPC's own name + alignment.
  const { characterName: _name, alignment: _alignment, ...patch } = base;
  if (mode === "replace") return patch;
  if (mode === "stats") {
    for (const key of STATBLOCK_LIST_KEYS) delete (patch as Record<string, unknown>)[key];
    return patch;
  }
  // "add": append the monster's list rows on top of the NPC's existing ones.
  return {
    ...patch,
    attacks: [...existing.attacks, ...(patch.attacks ?? [])].slice(0, SHEET_ROW_CAPS.attacks),
    features: [...existing.features, ...(patch.features ?? [])].slice(0, SHEET_ROW_CAPS.features),
    languages: unionPills(existing.languages, patch.languages),
    resistances: unionPills(existing.resistances, patch.resistances),
    immunities: unionPills(existing.immunities, patch.immunities),
    conditionImmunities: unionPills(existing.conditionImmunities, patch.conditionImmunities),
    vulnerabilities: unionPills(existing.vulnerabilities, patch.vulnerabilities),
  };
}

/**
 * True when an NPC already carries meaningful content that a stat block would
 * overwrite — any actions, any features, or non-default ability scores. Used to
 * decide whether to prompt for an apply mode or just replace outright.
 */
export function npcHasContent(s: CharacterSheet): boolean {
  return (
    s.attacks.length > 0 ||
    s.features.length > 0 ||
    DEFAULT_SHEET_TEMPLATE.abilities.some(
      (a) => (s.abilityScores[a.id] ?? DEFAULT_ABILITY_SCORE) !== DEFAULT_ABILITY_SCORE,
    )
  );
}
