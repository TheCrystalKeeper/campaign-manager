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
  addMulticlassPatch,
  classAutofillPatch,
  featureRowFromFeat,
  inventoryRowFromEquipment,
  inventoryRowFromMagicItem,
  monsterSheetPatch,
  multiclassPrereqFailures,
  speciesAutofillPatch,
  spellEntryFromCompendium,
} from "@lib/compendiumMap";
import { computeDerived, multiclassSlotMaxes } from "@lib/rules5e";

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
  check("class names-only: writes exactly characterClass + subclass + classes",
    Object.keys(namesOnly).sort().join(",") === "characterClass,classes,subclass" &&
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

// --- multiclassing -----------------------------------------------------------
{
  // Migration: legacy single-class sheets seed the classes array.
  const legacy = normalizeCharacterSheet(
    { ...createDefaultSheet("Legacy"), characterClass: "Wizard", subclass: "Evoker", level: 5 },
    "Legacy",
  );
  check("migration: legacy sheet seeds classes[]",
    legacy.classes.length === 1 && legacy.classes[0].className === "Wizard" &&
      legacy.classes[0].level === 5 && legacy.classes[0].isFirstClass,
    JSON.stringify(legacy.classes));

  // Manual (typed) homebrew class: co-writing characterClass/subclass + classes[0]
  // survives normalization (proves the inline-edit path isn't clobbered).
  const homebrew = normalizeCharacterSheet(
    {
      ...createDefaultSheet("HB"),
      characterClass: "Blood Hunter",
      subclass: "Order of the Lycan",
      level: 1,
      classes: [
        { id: "cls-0", className: "Blood Hunter", subclassName: "Order of the Lycan", level: 1, isFirstClass: true },
      ],
    },
    "HB",
  );
  check("manual class: typed homebrew round-trips without clobbering",
    homebrew.characterClass === "Blood Hunter" && homebrew.subclass === "Order of the Lycan" &&
      homebrew.classes.length === 1 && homebrew.classes[0].className === "Blood Hunter");

  // Multiclass sync: level becomes the sum; display fields mirror the first class.
  const multi = normalizeCharacterSheet(
    {
      ...createDefaultSheet("Multi"),
      level: 1,
      classes: [
        { id: "a", className: "Fighter", subclassName: "Champion", level: 3, isFirstClass: true },
        { id: "b", className: "Rogue", subclassName: "", level: 2, isFirstClass: false },
      ],
    },
    "Multi",
  );
  check("sync: multiclass level = sum, display = first class",
    multi.level === 5 && multi.characterClass === "Fighter" && multi.subclass === "Champion");

  // Single entry: the level-ring stays authoritative and the entry mirrors it.
  const single = normalizeCharacterSheet(
    {
      ...createDefaultSheet("Single"),
      level: 4,
      characterClass: "Wizard",
      classes: [{ id: "a", className: "Wizard", subclassName: "", level: 2, isFirstClass: true }],
    },
    "Single",
  );
  check("sync: single-class entry mirrors sheet.level", single.classes[0].level === 4 && single.level === 4);

  // classAutofillPatch writes the classes array (replace path).
  const sheet = createDefaultSheet("Test");
  const setPatch = classAutofillPatch(wizard, { autofill: false, sheet });
  check("classAutofillPatch: writes single classes entry",
    setPatch.classes?.length === 1 && setPatch.classes[0].isFirstClass);

  // addMulticlassPatch: appends at level 1, never touches saving throws.
  const fighterSheet = normalizeCharacterSheet(
    { ...createDefaultSheet("F"), characterClass: "Fighter", level: 3 },
    "F",
  );
  const cleric = classes.find((c) => c.id === "cleric")!;
  const addPatch = addMulticlassPatch(cleric, {
    autofill: true,
    chosenSkills: ["skill-insight", "skill-religion"],
    sheet: fighterSheet,
  });
  check("addMulticlassPatch: appends level-1 entry, level = sum",
    addPatch.classes?.length === 2 && addPatch.classes[1].level === 1 &&
      !addPatch.classes[1].isFirstClass && addPatch.level === 4);
  check("addMulticlassPatch: never writes saveProfs", !("saveProfs" in addPatch));
  check("addMulticlassPatch: multiclass armor profs applied",
    (addPatch.armorProfs ?? []).some((p) => /light armor/i.test(p)));
  check("addMulticlassPatch: skill choice capped at the multiclass grant (cleric: none)",
    !("skillProfs" in addPatch));

  // Slot pooling.
  const entry = (className: string, level: number, subclassName = "", isFirstClass = false) => ({
    id: className, className, subclassName, level, isFirstClass,
  });
  check("slots: single caster source uses its own table (Champion contributes 0)",
    JSON.stringify(multiclassSlotMaxes([entry("Fighter", 3, "Champion", true), entry("Wizard", 2)])) ===
      JSON.stringify({ "1": 3 }));
  check("slots: Eldritch Knight third-caster exception pools floor(5/3)+2 = caster level 3",
    JSON.stringify(multiclassSlotMaxes([entry("Fighter", 5, "Eldritch Knight", true), entry("Wizard", 2)])) ===
      JSON.stringify({ "1": 4, "2": 2 }));
  check("slots: full+full pool (Wizard 3 + Cleric 2 = caster level 5)",
    JSON.stringify(multiclassSlotMaxes([entry("Wizard", 3, "", true), entry("Cleric", 2)])) ===
      JSON.stringify({ "1": 4, "2": 3, "3": 2 }));
  const pact = multiclassSlotMaxes([entry("Warlock", 3, "", true), entry("Wizard", 2)]);
  check("slots: pact pool separate then merged for display (Warlock 3 + Wizard 2)",
    pact["1"] === 3 && pact["2"] === 2, JSON.stringify(pact));
  const derivedMulti = computeDerived(
    normalizeCharacterSheet(
      {
        ...createDefaultSheet("MC"),
        classes: [entry("Fighter", 3, "Champion", true), entry("Wizard", 2)],
      },
      "MC",
    ),
    "pc",
  );
  check("computeDerived: multiclass sheets use pooled slotMaxes",
    JSON.stringify(derivedMulti.slotMaxes) === JSON.stringify({ "1": 3 }));

  // Prereq soft check.
  const scores = { str: 8, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };
  const fails = multiclassPrereqFailures(
    [{ className: "Fighter" }, { className: "Paladin" }],
    scores,
    classes,
  );
  check("prereqs: Fighter passes via DEX-or-STR, Paladin fails STR+CHA",
    fails.length > 0 && fails.every((f) => f.className === "Paladin"),
    JSON.stringify(fails));
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
