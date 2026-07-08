// Tier 2 unit test (AUTOMATION_PLAN Round B): every Special-Traits switch wired into
// the engine/resolver, token conditions imposing disadvantage, the 5e adv/dis
// cancellation rule, crit thresholds, and engine↔resolver consistency.
import { createDefaultSheet, type CharacterSheet, type CheckSpec } from "@lib/types";
import { computeDerived, sumParts, skillModParts, saveModParts, initiativeModParts } from "@lib/rules5e";
import { resolveCheck } from "@lib/rollCheck";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function queued(values: number[]): (n: number) => number {
  const q = [...values];
  return () => (q.length ? q.shift()! : 0);
}

/** Level 5 (prof +3), DEX 16 / STR 14 / WIS 12, proficient Stealth. */
function makeSheet(traits: Record<string, boolean | number> = {}): CharacterSheet {
  const sheet = createDefaultSheet("Vex");
  sheet.level = 5;
  sheet.abilityScores = { str: 14, dex: 16, con: 10, int: 10, wis: 12, cha: 8 };
  sheet.skillProfs = { "skill-stealth": 1 };
  sheet.traits = traits;
  return sheet;
}

const roll = (
  sheet: CharacterSheet,
  spec: CheckSpec,
  dice: number[],
  adv?: "adv" | "dis",
  conditions: string[] = [],
  kind: "pc" | "npc" = "pc",
) => resolveCheck(sheet, spec, adv, queued(dice), { kind, conditions });

// ---- Feats -------------------------------------------------------------------

// diamond-soul: proficiency on ALL saves.
{
  const d = computeDerived(makeSheet({ "diamond-soul": true }), "pc");
  check("diamond-soul: unproficient save gains prof", d.values["save-cha"] === -1 + 3);
}

// enhanced-dual-wielding / tavern-brawler: informational only — no math changes.
{
  const plain = computeDerived(makeSheet(), "pc");
  const toggled = computeDerived(makeSheet({ "enhanced-dual-wielding": true, "tavern-brawler-feat": true }), "pc");
  check(
    "enhanced-dual-wielding/tavern-brawler: no numeric effect",
    JSON.stringify(plain.values) === JSON.stringify(toggled.values),
  );
}

// advantage-initiative: initiative rolls advantaged without a modifier click.
{
  const r = roll(makeSheet({ "advantage-initiative": true }), { kind: "initiative" }, [4, 17]);
  check("advantage-initiative: rolls 2 dice keep high", r.rolls[0] === 18 && r.adv === "adv", `kept=${r.rolls[0]}`);
}

// alert-feat: proficiency added to initiative.
{
  const d = computeDerived(makeSheet({ "alert-feat": true }), "pc");
  check("alert-feat: init = dex3 + prof3", d.values["init"] === 6, `init=${d.values["init"]}`);
}

// jack-of-all-trades: half prof (floor) on unproficient checks, not proficient ones.
{
  const d = computeDerived(makeSheet({ "jack-of-all-trades": true }), "pc");
  check("jack: unproficient skill +⌊prof/2⌋", d.values["skill-arcana"] === 0 + 1, `arcana=${d.values["skill-arcana"]}`);
  check("jack: proficient skill unchanged", d.values["skill-stealth"] === 3 + 3);
  check("jack: initiative +⌊prof/2⌋", d.values["init"] === 3 + 1);
}

// observant-feat: +5 passive Perception/Investigation, actual totals unchanged.
{
  const d = computeDerived(makeSheet({ "observant-feat": true }), "pc");
  check("observant: passive perception +5", d.values["passive-skill-perception"] === 10 + 1 + 5);
  check("observant: perception total unchanged", d.values["skill-perception"] === 1);
}

// reliable-talent: proficient skill d20 below 10 counts as 10.
{
  const r = roll(makeSheet({ "reliable-talent": true }), { kind: "skill", statId: "skill-stealth" }, [3]);
  check("reliable-talent: kept die floors at 10", r.rolls[0] === 10 && r.total === 10 + 6, `total=${r.total}`);
  const unprof = roll(makeSheet({ "reliable-talent": true }), { kind: "skill", statId: "skill-arcana" }, [3]);
  check("reliable-talent: unproficient skill unaffected", unprof.rolls[0] === 4);
}

// remarkable-athlete: half prof (ceil) on unproficient STR/DEX/CON checks + initiative.
{
  const d = computeDerived(makeSheet({ "remarkable-athlete": true }), "pc");
  check("athlete: STR skill +⌈prof/2⌉", d.values["skill-athletics"] === 2 + 2);
  check("athlete: INT skill unchanged", d.values["skill-arcana"] === 0);
  check("athlete: initiative +⌈prof/2⌉", d.values["init"] === 3 + 2);
}

// weapon/spell crit thresholds.
{
  const sheet = makeSheet({ "weapon-crit-threshold": 19 });
  sheet.attacks = [{ id: "a1", name: "Sword", toHit: 5, damage: "1d8+3" }];
  const r = roll(sheet, { kind: "attack", rowId: "a1" }, [18]);
  check("weapon-crit-threshold 19: natural 19 crits", r.crit === true);
  const spellSheet = makeSheet({ "weapon-crit-threshold": 19 });
  spellSheet.spellcasting = { abilityId: "wis", attackBonus: 0, saveDc: 0, casterType: "none" };
  const s = roll(spellSheet, { kind: "spell-attack" }, [18]);
  check("weapon threshold does NOT apply to spell attacks", s.crit !== true);
  const s2Sheet = makeSheet({ "spell-crit-threshold": 19 });
  s2Sheet.spellcasting = { abilityId: "wis", attackBonus: 0, saveDc: 0, casterType: "none" };
  const s2 = roll(s2Sheet, { kind: "spell-attack" }, [18]);
  check("spell-crit-threshold 19: spell attack crits at 19", s2.crit === true);
  const natural = roll(makeSheet(), { kind: "attack", rowId: "a1" }, [19]);
  void natural; // row missing → label fallback; natural-20 case below
  const sheet20 = makeSheet();
  sheet20.attacks = [{ id: "a1", name: "Sword", toHit: 5, damage: "1d8" }];
  check("natural 20 always crits", roll(sheet20, { kind: "attack", rowId: "a1" }, [19]).crit === true);
  check("natural 18 does not crit by default", roll(sheet20, { kind: "attack", rowId: "a1" }, [17]).crit !== true);
}

// melee-crit-damage-dice: crit damage rolls extra weapon dice on melee rows.
{
  const sheet = makeSheet({ "melee-crit-damage-dice": 1 });
  sheet.attacks = [{ id: "a1", name: "Sword", toHit: 5, damage: "1d6+3", range: "melee" }];
  const r = roll(sheet, { kind: "damage", rowId: "a1", crit: true }, [2, 3, 4]);
  check("crit damage: 1 base + 1 doubled + 1 trait = 3 dice", r.rolls.length === 3, `dice=${r.rolls.length}`);
  check("crit damage: total = 3+4+5 + 3", r.total === 15, `total=${r.total}`);
  const plain = makeSheet();
  plain.attacks = [{ id: "a1", name: "Sword", toHit: 5, damage: "1d6+3", range: "melee" }];
  const p = roll(plain, { kind: "damage", rowId: "a1", crit: true }, [2, 3]);
  check("crit damage without trait: dice doubled only", p.rolls.length === 2);
}

// ---- Species traits ------------------------------------------------------------

// elven-accuracy: 3 dice on advantage for DEX/INT/WIS/CHA rolls.
{
  const r = roll(makeSheet({ "elven-accuracy": true }), { kind: "skill", statId: "skill-stealth" }, [4, 17, 11], "adv");
  check("elven-accuracy: 3 dice keep highest", r.rolls[0] === 18, `kept=${r.rolls[0]}`);
  const strRoll = roll(makeSheet({ "elven-accuracy": true }), { kind: "skill", statId: "skill-athletics" }, [4, 17, 11], "adv");
  check("elven-accuracy: STR checks stay 2 dice", strRoll.rolls[0] === 18 && strRoll.otherTotal !== undefined);
}

// halfling-lucky: natural 1s rerolled once.
{
  const r = roll(makeSheet({ "halfling-lucky": true }), { kind: "skill", statId: "skill-stealth" }, [0, 13]);
  check("halfling-lucky: natural 1 rerolled", r.rolls[0] === 14, `kept=${r.rolls[0]}`);
  check("halfling-lucky: die labeled rerolled", r.parts[0]?.label === "d20 (rerolled 1)");
}

// powerful-build: carry capacity doubled.
{
  const d = computeDerived(makeSheet({ "powerful-build": true }), "pc");
  check("powerful-build: capacity = 14×15×2", d.values["carry-capacity"] === 420);
}

// ---- Global bonuses (the 12 numeric traits) -------------------------------------
{
  const sheet = makeSheet({
    "melee-weapon-attack-bonus": 1,
    "melee-weapon-damage-bonus": 2,
    "ranged-weapon-attack-bonus": 3,
    "ranged-weapon-damage-bonus": 4,
    "melee-spell-attack-bonus": 5,
    "melee-spell-damage-bonus": 6,
    "ranged-spell-attack-bonus": 7,
    "ranged-spell-damage-bonus": 8,
  });
  sheet.spellcasting = { abilityId: "wis", attackBonus: 0, saveDc: 0, casterType: "none" };
  sheet.attacks = [
    { id: "mw", name: "Sword", toHit: 5, damage: "1d6", range: "melee" },
    { id: "rw", name: "Bow", toHit: 5, damage: "1d6", range: "ranged" },
    { id: "ms", name: "Shocking Grasp", toHit: 0, damage: "1d8", toHitAbility: "spell", range: "melee" },
    { id: "rs", name: "Fire Bolt", toHit: 0, damage: "1d10", toHitAbility: "spell", range: "ranged" },
    { id: "untagged", name: "Club", toHit: 5, damage: "1d4" },
  ];
  const total = (rowId: string) => roll(sheet, { kind: "attack", rowId }, [9]).total;
  check("global: melee weapon attack +1", total("mw") === 10 + 5 + 1, `t=${total("mw")}`);
  check("global: ranged weapon attack +3", total("rw") === 10 + 5 + 3);
  check("global: melee spell attack +5 (wis1 + prof3)", total("ms") === 10 + 1 + 3 + 5, `t=${total("ms")}`);
  check("global: ranged spell attack +7", total("rs") === 10 + 1 + 3 + 7);
  check("global: untagged row skips melee/ranged bonuses", total("untagged") === 10 + 5);
  const dmg = (rowId: string) => roll(sheet, { kind: "damage", rowId }, [3]).total;
  check("global: melee weapon damage +2", dmg("mw") === 4 + 2);
  check("global: ranged weapon damage +4", dmg("rw") === 4 + 4);
  check("global: melee spell damage +6", dmg("ms") === 4 + 6);
  check("global: ranged spell damage +8", dmg("rs") === 4 + 8);
}
{
  const d = computeDerived(
    (() => {
      const sheet = makeSheet({
        "global-ability-check-bonus": 1,
        "global-saving-throw-bonus": 2,
        "global-skill-check-bonus": 3,
        "global-spell-dc-bonus": 4,
      });
      sheet.spellcasting = { abilityId: "wis", attackBonus: 0, saveDc: 0, casterType: "none" };
      return sheet;
    })(),
    "pc",
  );
  check("global: skill gets ability-check + skill-check bonus", d.values["skill-arcana"] === 0 + 1 + 3);
  check("global: save +2", d.values["save-wis"] === 1 + 2);
  check("global: initiative counts as ability check (+1)", d.values["init"] === 3 + 1);
  check("global: spell DC +4", d.values["spell-dc"] === 8 + 1 + 3 + 4);
}

// ---- Conditions → disadvantage ---------------------------------------------------
{
  const sheet = makeSheet();
  sheet.attacks = [{ id: "a1", name: "Sword", toHit: 5, damage: "1d6" }];
  const atk = roll(sheet, { kind: "attack", rowId: "a1" }, [15, 3], undefined, ["poisoned"]);
  check("poisoned: attack disadvantaged (keeps low)", atk.adv === "dis" && atk.rolls[0] === 4, `kept=${atk.rolls[0]}`);
  check("poisoned: label notes the cause", atk.label.includes("dis: poisoned"), atk.label);
  const skill = roll(sheet, { kind: "skill", statId: "skill-stealth" }, [15, 3], undefined, ["exhaustion"]);
  check("exhaustion: ability checks disadvantaged", skill.adv === "dis");
  const dexSave = roll(sheet, { kind: "save", statId: "save-dex" }, [15, 3], undefined, ["restrained"]);
  check("restrained: DEX save disadvantaged", dexSave.adv === "dis");
  const wisSave = roll(sheet, { kind: "save", statId: "save-wis" }, [15], undefined, ["restrained"]);
  check("restrained: WIS save unaffected", wisSave.adv === undefined);
  const proneAtk = roll(sheet, { kind: "attack", rowId: "a1" }, [15, 3], undefined, ["prone"]);
  check("prone: attack disadvantaged", proneAtk.adv === "dis");
  const npcAtk = roll(sheet, { kind: "attack", rowId: "a1" }, [15, 3], undefined, ["blinded"], "npc");
  check("conditions apply to NPCs too", npcAtk.adv === "dis");
}

// ---- 5e stacking: adv + dis cancel to a plain roll --------------------------------
{
  const sheet = makeSheet();
  sheet.attacks = [{ id: "a1", name: "Sword", toHit: 5, damage: "1d6" }];
  const r = roll(sheet, { kind: "attack", rowId: "a1" }, [15], "adv", ["poisoned"]);
  check("adv click + poisoned = plain roll", r.adv === undefined && r.rolls.length === 1);
  check("cancelled noted in label", r.label.includes("cancelled"), r.label);
  const init = roll(makeSheet({ "advantage-initiative": true }), { kind: "initiative" }, [15], undefined, ["poisoned"]);
  check("trait adv + condition dis = cancelled", init.adv === undefined);
}

// ---- Engine ↔ resolver consistency (parts sum to the displayed total) -------------
{
  const sheet = makeSheet({
    "jack-of-all-trades": true,
    "diamond-soul": true,
    "alert-feat": true,
    "global-skill-check-bonus": 2,
    "global-saving-throw-bonus": 1,
    "global-ability-check-bonus": 1,
  });
  const d = computeDerived(sheet, "pc");
  const prof = d.values["prof"];
  for (const statId of ["skill-stealth", "skill-arcana"]) {
    check(
      `consistency: ${statId} total = sum of roll parts`,
      d.values[statId] === sumParts(skillModParts(sheet, statId, prof)),
    );
  }
  check(
    "consistency: save total = sum of roll parts",
    d.values["save-cha"] === sumParts(saveModParts(sheet, "save-cha", prof)),
  );
  check(
    "consistency: init total = sum of roll parts",
    d.values["init"] === sumParts(initiativeModParts(sheet, prof)),
  );
  const rolled = roll(sheet, { kind: "skill", statId: "skill-arcana" }, [9]);
  check(
    "consistency: rolled total = 10 + displayed modifier",
    rolled.total === 10 + d.values["skill-arcana"],
    `rolled=${rolled.total} shown=${d.values["skill-arcana"]}`,
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
