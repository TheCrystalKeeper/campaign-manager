// Compendium unit test: generated data shape, mapper caps, class autofill, and the
// all-monsters sheet-size guarantee. Run per tests/README.md:
//   npx esbuild tests/unit-compendium.test.ts --bundle --format=esm --platform=node \
//     --outfile=<tmp>/unit-compendium.mjs --alias:@lib=./src/lib && node <tmp>/unit-compendium.mjs
import { readFileSync } from "node:fs";
import {
  MAX_SHEET_BYTES,
  createDefaultSheet,
  normalizeCharacterSheet,
} from "@lib/types";
import type {
  CompendiumClass,
  CompendiumEquipment,
  CompendiumMagicItem,
  CompendiumMonster,
  CompendiumSpecies,
  CompendiumSpell,
} from "@lib/compendium";
import { searchCompendium } from "@lib/compendium";
import {
  classAutofillPatch,
  featureRowFromFeat,
  inventoryRowFromEquipment,
  inventoryRowFromMagicItem,
  monsterSheetPatch,
  speciesAutofillPatch,
  spellEntryFromCompendium,
} from "@lib/compendiumMap";
import { computeDerived } from "@lib/rules5e";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Run from the repo root (like the other unit tests) so the data files resolve.
const load = <T>(name: string): T[] =>
  JSON.parse(readFileSync(`public/compendium/${name}.json`, "utf8"));

const classes = load<CompendiumClass>("classes");
const species = load<CompendiumSpecies>("species");
const spells = load<CompendiumSpell>("spells");
const equipment = load<CompendiumEquipment>("equipment");
const magicItems = load<CompendiumMagicItem>("magic-items");
const monsters = load<CompendiumMonster>("monsters");

// --- generated data shape ----------------------------------------------------
check("data: 12 classes / 9 species / 339 spells / 331 monsters",
  classes.length === 12 && species.length === 9 && spells.length === 339 && monsters.length === 331,
  `${classes.length}/${species.length}/${spells.length}/${monsters.length}`);
check("data: every class has 2 saves + multiclass prereqs",
  classes.every((c) => c.saves.length === 2 && c.multiclass.prereqs.length > 0));
check("data: every spell has description + level 0-9",
  spells.every((s) => s.description.length > 0 && s.level >= 0 && s.level <= 9));

// --- class autofill ----------------------------------------------------------
const wizard = classes.find((c) => c.id === "wizard")!;
{
  const sheet = createDefaultSheet("Test");
  const namesOnly = classAutofillPatch(wizard, { autofill: false, subclassName: "Evoker", sheet });
  check("class names-only: writes exactly characterClass + subclass",
    Object.keys(namesOnly).sort().join(",") === "characterClass,subclass" &&
      namesOnly.characterClass === "Wizard" && namesOnly.subclass === "Evoker");

  const full = classAutofillPatch(wizard, {
    autofill: true,
    chosenSkills: ["skill-arcana", "skill-history"],
    sheet,
  });
  check("class autofill: d6 hit die", full.hitDice?.die === "d6");
  check("class autofill: INT/WIS save dots",
    full.saveProfs?.["save-int"] === 1 && full.saveProfs?.["save-wis"] === 1);
  check("class autofill: INT full caster",
    full.spellcasting?.abilityId === "int" && full.spellcasting?.casterType === "full");
  check("class autofill: chosen skill dots",
    full.skillProfs?.["skill-arcana"] === 1 && full.skillProfs?.["skill-history"] === 1);
  check("class autofill: additive — existing profs kept",
    (() => {
      const s2 = createDefaultSheet("T2");
      s2.weaponProfs = ["Firearms"];
      const p = classAutofillPatch(wizard, { autofill: true, sheet: s2 });
      return (p.weaponProfs ?? []).includes("Firearms") && (p.weaponProfs ?? []).includes("Simple Weapons");
    })());
}

// --- spell mapping -----------------------------------------------------------
const fireball = spells.find((s) => s.id === "fireball")!;
{
  const row = spellEntryFromCompendium(fireball);
  check("fireball: level 3, roll 8d6", row.level === 3 && row.roll === "8d6");
  check("fireball: caps respected",
    (row.time ?? "").length <= 40 && (row.range ?? "").length <= 40 &&
      (row.components ?? "").length <= 40 && (row.description ?? "").length <= 1000);
  check("fireball: school tag in description", (row.description ?? "").startsWith("Evocation"));
}

// --- equipment / magic item mapping ------------------------------------------
{
  const longsword = equipment.find((e) => e.id === "longsword")!;
  const row = inventoryRowFromEquipment(longsword);
  check("longsword: weapon row 1d8 slashing, 15 gp, str to-hit, unequipped",
    row.category === "weapon" && row.damage === "1d8" && row.damageType === "slashing" &&
      row.price === "15 gp" && row.toHitAbility === "str" && row.equipped === false);
  const dagger = equipment.find((e) => e.id === "dagger")!;
  check("dagger: finesse → dex to-hit", inventoryRowFromEquipment(dagger).toHitAbility === "dex");
  const attuned = magicItems.find((m) => m.attunement)!;
  check("magic item: attunement note", inventoryRowFromMagicItem(attuned).note === "Requires attunement");
}

// --- species autofill --------------------------------------------------------
const elf = species.find((s) => s.id === "elf")!;
{
  const sheet = createDefaultSheet("Test");
  const namesOnly = speciesAutofillPatch(elf, { autofill: false, sheet });
  check("species names-only: writes exactly race",
    Object.keys(namesOnly).join(",") === "race" && namesOnly.race === "Elf");
  const full = speciesAutofillPatch(elf, { autofill: true, sheet });
  check("species autofill: size/speed set", full.size === "Medium" && full.speed === 30);
  check("species autofill: 5 species trait rows",
    (full.features ?? []).filter((f) => f.source === "species").length === 5);
  const drow = speciesAutofillPatch(elf, { autofill: true, subspeciesId: "elven-lineage-drow", sheet });
  check("species subspecies: display name + extra traits",
    drow.race === "Elf (Drow)" && (drow.features ?? []).length > 5);
}

// --- feats -------------------------------------------------------------------
{
  const feats = load<{ id: string; name: string; category: string; description: string }>("feats");
  const alert = feats.find((f) => f.id === "alert")!;
  const row = featureRowFromFeat(alert);
  check("feat row: source feat + capped description",
    row.source === "feat" && row.name === "Alert" && row.description.length <= 1000);
}

// --- monsters: every stat block fits a sheet ---------------------------------
{
  let oversized = 0;
  let worst = { id: "", bytes: 0 };
  for (const m of monsters) {
    const patch = monsterSheetPatch(m);
    const sheet = normalizeCharacterSheet({ ...createDefaultSheet(m.name), ...patch }, m.name);
    const bytes = JSON.stringify(sheet).length;
    if (bytes >= MAX_SHEET_BYTES) oversized += 1;
    if (bytes > worst.bytes) worst = { id: m.id, bytes };
  }
  check(`monsters: all ${monsters.length} sheets under ${MAX_SHEET_BYTES}B`,
    oversized === 0, `worst ${worst.id} = ${worst.bytes}B`);
}

// --- goblin boss round-trip: displayed numbers match the stat block ----------
{
  const gob = monsters.find((m) => m.id === "goblin-boss")!;
  const patch = monsterSheetPatch(gob);
  const sheet = normalizeCharacterSheet({ ...createDefaultSheet(gob.name), ...patch }, gob.name);
  check("goblin boss: AC 17, HP 21, CR 1", sheet.ac === 17 && sheet.hp.max === 21 && sheet.cr === "1");
  const derived = computeDerived(sheet, "npc");
  check("goblin boss: derived Stealth +6 via skillMods delta",
    derived.values["skill-stealth"] === 6, `stealth=${derived.values["skill-stealth"]}`);
  check("goblin boss: derived WIS save -1 (stat block value)",
    derived.values["save-wis"] === -1, `save-wis=${derived.values["save-wis"]}`);
  check("goblin boss: scimitar attack row parsed",
    sheet.attacks.some((a) => a.name === "Scimitar" && a.toHit === 4 && a.damage === "1d6+2"));
}

// --- search ------------------------------------------------------------------
{
  const results = searchCompendium(spells, "fire");
  check("search: prefix matches first",
    results.length > 0 && results[0].name.toLowerCase().startsWith("fire"),
    results[0]?.name);
  check("search: empty query returns all", searchCompendium(spells, " ").length === spells.length);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
