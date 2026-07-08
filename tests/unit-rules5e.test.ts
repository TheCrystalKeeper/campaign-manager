// Rules-engine unit test (AUTOMATION_PLAN Round A): derived formulas, override
// precedence, caster-type slot tables, and the NPC manual passthrough.
import { createDefaultSheet, type CharacterSheet } from "@lib/types";
import {
  autoAttackBonus,
  computeDerived,
  proficiencyBonusForLevel,
  spellSlotMaxes,
} from "@lib/rules5e";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- Proficiency bonus by level ----------------------------------------------
const profTable: Array<[number, number]> = [
  [1, 2],
  [4, 2],
  [5, 3],
  [8, 3],
  [9, 4],
  [12, 4],
  [13, 5],
  [16, 5],
  [17, 6],
  [20, 6],
];
check(
  "prof bonus: 2 + floor((level-1)/4) across all breakpoints",
  profTable.every(([level, bonus]) => proficiencyBonusForLevel(level) === bonus),
);

// --- PC sheet: Vex, level 3 rogue-ish ----------------------------------------
function vex(): CharacterSheet {
  const sheet = createDefaultSheet("Vex");
  sheet.level = 3;
  sheet.abilityScores = { str: 8, dex: 16, con: 12, wis: 15 };
  sheet.skillProfs = { "skill-stealth": 2, "skill-perception": 1 }; // expertise / proficient
  sheet.skillMods = { "skill-acrobatics": 1 }; // a misc bonus
  sheet.saveProfs = { "save-dex": 1 };
  sheet.initiative = 1; // misc init bonus
  sheet.carryMultiplier = 1;
  return sheet;
}

{
  const d = computeDerived(vex(), "pc");
  check("pc: auto flag", d.auto === true);
  check("pc: prof from level 3", d.values["prof"] === 2, `prof=${d.values["prof"]}`);
  check(
    "pc: expertise skill = dex3 + 2×prof2",
    d.values["skill-stealth"] === 3 + 4,
    `stealth=${d.values["skill-stealth"]}`,
  );
  check(
    "pc: proficient skill = wis2 + prof2",
    d.values["skill-perception"] === 2 + 2,
    `perception=${d.values["skill-perception"]}`,
  );
  check(
    "pc: unproficient skill = ability + misc",
    d.values["skill-acrobatics"] === 3 + 1,
    `acrobatics=${d.values["skill-acrobatics"]}`,
  );
  check("pc: passive = 10 + total", d.values["passive-skill-perception"] === 14);
  check("pc: save = dex3 + prof2", d.values["save-dex"] === 5, `save=${d.values["save-dex"]}`);
  check("pc: unproficient save = ability mod", d.values["save-wis"] === 2);
  check("pc: initiative = dex3 + misc1", d.values["init"] === 4, `init=${d.values["init"]}`);
  check(
    "pc: carry capacity = STR 8 × 15",
    d.values["carry-capacity"] === 120,
    `cap=${d.values["carry-capacity"]}`,
  );
  check("pc: hit dice max = level", d.values["hit-dice-max"] === 3);
}

// --- Level growth propagates --------------------------------------------------
{
  const sheet = vex();
  sheet.level = 9; // prof +4
  const d = computeDerived(sheet, "pc");
  check("pc: level 9 expertise = 3 + 2×4", d.values["skill-stealth"] === 11);
}

// --- Spellcasting: gated on abilityId ----------------------------------------
{
  const sheet = vex();
  sheet.spellcasting = { abilityId: "", attackBonus: 7, saveDc: 15, casterType: "none" };
  const manual = computeDerived(sheet, "pc");
  check("pc: no casting ability → manual attack/DC", manual.values["spell-attack"] === 7 && manual.values["spell-dc"] === 15);
  sheet.spellcasting = { abilityId: "wis", attackBonus: 7, saveDc: 15, casterType: "none" };
  const auto = computeDerived(sheet, "pc");
  check("pc: casting ability → attack = mod2 + prof2", auto.values["spell-attack"] === 4);
  check("pc: casting ability → DC = 8 + mod2 + prof2", auto.values["spell-dc"] === 12);
}

// --- Overrides: replace verbatim, feed downstream, base keeps formula ---------
{
  const sheet = vex();
  sheet.overrides = { "skill-stealth": 9, prof: 3 };
  const d = computeDerived(sheet, "pc");
  check("override: stat replaced verbatim", d.values["skill-stealth"] === 9);
  check("override: base keeps the formula (uses effective prof)", d.base["skill-stealth"] === 3 + 6);
  check("override: passive follows the overridden skill", d.values["passive-skill-stealth"] === 19);
  check("override: prof override feeds other skills", d.values["skill-perception"] === 2 + 3);
  check("override: base prof stays formula", d.base["prof"] === 2 && d.values["prof"] === 3);
}

// --- Auto attack bonus ---------------------------------------------------------
{
  const sheet = vex();
  sheet.spellcasting = { abilityId: "wis", attackBonus: 0, saveDc: 0, casterType: "none" };
  check("auto to-hit: dex + prof", autoAttackBonus(sheet, "dex", 2) === 5);
  check("auto to-hit: spell → casting ability + prof", autoAttackBonus(sheet, "spell", 2) === 4);
}

// --- Slot tables ----------------------------------------------------------------
{
  const eq = (a: Record<string, number>, b: Record<string, number>) =>
    JSON.stringify(a) === JSON.stringify(b);
  check("slots: full 1", eq(spellSlotMaxes("full", 1), { "1": 2 }));
  check("slots: full 3", eq(spellSlotMaxes("full", 3), { "1": 4, "2": 2 }));
  check(
    "slots: full 20",
    eq(spellSlotMaxes("full", 20), { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2, "7": 2, "8": 1, "9": 1 }),
  );
  check("slots: half 1 = none", eq(spellSlotMaxes("half", 1), {}));
  check("slots: half 2", eq(spellSlotMaxes("half", 2), { "1": 2 }));
  check("slots: half 9 (≙ full 5)", eq(spellSlotMaxes("half", 9), { "1": 4, "2": 3, "3": 2 }));
  check("slots: third 2 = none", eq(spellSlotMaxes("third", 2), {}));
  check("slots: third 7 (≙ full 3)", eq(spellSlotMaxes("third", 7), { "1": 4, "2": 2 }));
  check("slots: pact 1", eq(spellSlotMaxes("pact", 1), { "1": 1 }));
  check("slots: pact 5 = two lv3", eq(spellSlotMaxes("pact", 5), { "3": 2 }));
  check("slots: pact 17 = four lv5", eq(spellSlotMaxes("pact", 17), { "5": 4 }));
}

// --- Engine slotMaxes: casterType vs manual ------------------------------------
{
  const sheet = vex();
  sheet.spellSlots = { "1": { current: 1, max: 2 } };
  const manual = computeDerived(sheet, "pc");
  check("slots: manual casterType reads stored maxes", manual.slotMaxes["1"] === 2);
  sheet.spellcasting = { abilityId: "", attackBonus: 0, saveDc: 0, casterType: "full" };
  const auto = computeDerived(sheet, "pc");
  check("slots: full caster level 3 derives 4/2", auto.slotMaxes["1"] === 4 && auto.slotMaxes["2"] === 2);
}

// --- NPC passthrough: engine off, manual fields verbatim ------------------------
{
  const sheet = vex();
  sheet.proficiencyBonus = 4;
  sheet.initiative = 2;
  sheet.carryCapacity = 300;
  sheet.hitDice = { current: 2, max: 5, die: "d10" };
  sheet.spellcasting = { abilityId: "wis", attackBonus: 7, saveDc: 15, casterType: "full" };
  sheet.overrides = { "skill-stealth": 99 }; // must be IGNORED for NPCs
  const d = computeDerived(sheet, "npc");
  check("npc: auto flag off", d.auto === false);
  check("npc: prof = stored field", d.values["prof"] === 4);
  check("npc: skill = ability + misc only (dots decorative)", d.values["skill-stealth"] === 3);
  check("npc: overrides ignored", d.values["skill-stealth"] === 3);
  check("npc: init = stored flat", d.values["init"] === 2);
  check("npc: capacity/hit dice stored", d.values["carry-capacity"] === 300 && d.values["hit-dice-max"] === 5);
  check("npc: spell attack/DC stored even with abilityId", d.values["spell-attack"] === 7 && d.values["spell-dc"] === 15);
  check("npc: slot maxes stored even with casterType", Object.keys(d.slotMaxes).length === 0);
}

// --- Back-compat: default sheet (no dots) derives today's totals -----------------
{
  const sheet = createDefaultSheet("Plain");
  sheet.abilityScores = { dex: 16 };
  sheet.skillMods = { "skill-stealth": 2 }; // pre-automation hand-baked prof
  const d = computeDerived(sheet, "pc");
  check("compat: no dots → total = ability + misc (unchanged)", d.values["skill-stealth"] === 5);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
