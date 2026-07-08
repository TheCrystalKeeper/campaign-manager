// ROLL_CHECK resolver unit test: color-coded parts sum to the total. Round A of the
// rules engine: PC checks derive proficiency from dots × level-based prof (the manual
// box is a Misc bonus); NPC checks read manual fields verbatim; overrides replace the
// breakdown with one flat part.
import { createDefaultSheet, type CharacterSheet } from "@lib/types";
import { partsFromExpression, resolveCheck } from "@lib/rollCheck";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Deterministic randInt: pops from a queue (returns 0-based like secureRandInt). */
function queued(values: number[]): (n: number) => number {
  const q = [...values];
  return () => (q.length ? q.shift()! : 0);
}

const sumParts = (parts: { value: number }[]) => parts.reduce((s, p) => s + p.value, 0);

function makeSheet(): CharacterSheet {
  const sheet = createDefaultSheet("Vex");
  sheet.abilityScores = { dex: 16, str: 8, wis: 15 };
  sheet.skillMods = { "skill-stealth": 2 };
  sheet.saveMods = { "save-wis": 1 };
  sheet.initiative = 3;
  sheet.spellcasting = { abilityId: "wis", attackBonus: 4, saveDc: 12, casterType: "none" };
  sheet.attacks = [{ id: "atk-1", name: "Shortsword", toHit: 5, damage: "1d6+3", damageType: "piercing" }];
  sheet.inventory = [
    { id: "inv-mace", itemId: null, name: "Mace", qty: 1, note: "", category: "weapon", equipped: true, toHit: 4, damage: "1d6+1" },
  ];
  return sheet;
}
const base = makeSheet();

// --- Skill (no dot): d20 + ability(DEX +3) + Misc(+2) — totals unchanged pre/post engine
const stealth = resolveCheck(base, { kind: "skill", statId: "skill-stealth" }, undefined, queued([14]));
check("skill: d20 rolled from randInt", stealth.rolls[0] === 15, `d20=${stealth.rolls[0]}`);
check("skill: parts sum to total", sumParts(stealth.parts) === stealth.total && stealth.total === 20, `total=${stealth.total}`);
check("skill: die + ability + misc(flat) parts", stealth.parts.map((p) => p.kind).join(",") === "die,ability,flat", stealth.parts.map((p) => p.kind).join(","));
check("skill: label derived server-side", stealth.label === "Stealth check", stealth.label);

// --- Skill with proficiency dot: prof part appears (level 1 → +2) -------------
{
  const sheet = makeSheet();
  sheet.skillProfs = { "skill-stealth": 1 };
  sheet.skillMods = {};
  const r = resolveCheck(sheet, { kind: "skill", statId: "skill-stealth" }, undefined, queued([9]));
  check("skill+dot: total = 10 + 3 + 2", r.total === 15, `total=${r.total}`);
  check("skill+dot: parts die,ability,prof", r.parts.map((p) => p.kind).join(",") === "die,ability,prof");
}

// --- Expertise dot doubles prof; prof grows with level -------------------------
{
  const sheet = makeSheet();
  sheet.level = 5; // prof +3
  sheet.skillProfs = { "skill-stealth": 2 };
  sheet.skillMods = {};
  const r = resolveCheck(sheet, { kind: "skill", statId: "skill-stealth" }, undefined, queued([9]));
  check("expertise: total = 10 + 3 + 2×3", r.total === 19, `total=${r.total}`);
  check("expertise: prof part labeled", r.parts.some((p) => p.kind === "prof" && p.value === 6 && p.label === "Expertise"));
}

// --- Override: one flat part replaces the whole breakdown ----------------------
{
  const sheet = makeSheet();
  sheet.skillProfs = { "skill-stealth": 2 };
  sheet.overrides = { "skill-stealth": 9 };
  const r = resolveCheck(sheet, { kind: "skill", statId: "skill-stealth" }, undefined, queued([9]));
  check("override: total = 10 + 9", r.total === 19, `total=${r.total}`);
  check("override: single flat Override part", r.parts.map((p) => p.kind).join(",") === "die,flat" && r.parts[1]?.label === "Override");
}

// --- NPC: manual fields verbatim (dots decorative, manual mod kind=prof) --------
{
  const sheet = makeSheet();
  sheet.skillProfs = { "skill-stealth": 2 }; // must be ignored
  const r = resolveCheck(sheet, { kind: "skill", statId: "skill-stealth" }, undefined, queued([14]), { kind: "npc" });
  check("npc skill: total = 15 + 3 + 2 (dot ignored)", r.total === 20, `total=${r.total}`);
  check("npc skill: legacy parts die,ability,prof", r.parts.map((p) => p.kind).join(",") === "die,ability,prof");
}

// --- Ability check: d20 + ability only --------------------------------------
const dexCheck = resolveCheck(base, { kind: "ability", abilityId: "dex" }, undefined, queued([9]));
check("ability: total = 10 + 3", dexCheck.total === 13 && sumParts(dexCheck.parts) === 13);

// --- Save: d20 + ability(WIS +2) + Misc(+1) ---------------------------------
const wisSave = resolveCheck(base, { kind: "save", statId: "save-wis" }, undefined, queued([10]));
check("save: total = 11 + 2 + 1", wisSave.total === 14, `total=${wisSave.total}`);

// --- Save with dot: + prof ---------------------------------------------------
{
  const sheet = makeSheet();
  sheet.saveProfs = { "save-dex": 1 };
  const r = resolveCheck(sheet, { kind: "save", statId: "save-dex" }, undefined, queued([10]));
  check("save+dot: total = 11 + 3 + 2", r.total === 16, `total=${r.total}`);
}

// --- Attack (manual): d20 + item(toHit +5) -----------------------------------
const attack = resolveCheck(base, { kind: "attack", rowId: "atk-1" }, undefined, queued([7]));
check("attack: total = 8 + 5", attack.total === 13 && attack.parts[1]?.kind === "item", `total=${attack.total}`);

// --- Attack (auto to-hit): ability mod + prof ---------------------------------
{
  const sheet = makeSheet();
  sheet.attacks[0].toHitAbility = "dex";
  const r = resolveCheck(sheet, { kind: "attack", rowId: "atk-1" }, undefined, queued([7]));
  check("auto attack: total = 8 + 3 + 2 (manual toHit ignored)", r.total === 13, `total=${r.total}`);
  check("auto attack: ability + prof parts", r.parts.map((p) => p.kind).join(",") === "die,ability,prof");
}

// --- Attack from an equipped inventory weapon (inv: prefix) ------------------
const invAttack = resolveCheck(base, { kind: "attack", rowId: "inv:inv-mace" }, undefined, queued([11]));
check("attack: resolves inventory weapon via inv: prefix", invAttack.total === 12 + 4, `total=${invAttack.total}`);

// --- Damage: no d20, parse expression 1d6+3 ---------------------------------
const dmg = resolveCheck(base, { kind: "damage", rowId: "atk-1" }, undefined, queued([3]));
check("damage: no d20 (first part is the damage die)", dmg.parts[0]?.label === "d6" && dmg.rolls[0] === 4);
check("damage: parts sum to total (4 + 3)", sumParts(dmg.parts) === dmg.total && dmg.total === 7, `total=${dmg.total}`);
check("damage: modifier labeled as item (weapon name)", dmg.parts[1]?.kind === "item");

// --- Advantage: keeps the higher d20, reports the dropped total -------------
const adv = resolveCheck(base, { kind: "ability", abilityId: "dex" }, "adv", queued([5, 18]));
check("adv: keeps higher d20", adv.rolls[0] === 19, `kept=${adv.rolls[0]}`);
check("adv: reports dropped total", adv.otherTotal === 6 + 3, `other=${adv.otherTotal}`);

// --- Spell attack (PC, ability set): derives mod(+2) + prof(+2) --------------
const spell = resolveCheck(base, { kind: "spell-attack" }, undefined, queued([12]));
check("spell-attack: total = 13 + 2 + 2", spell.total === 17);
check("spell-attack: ability + prof parts", spell.parts.map((p) => p.kind).join(",") === "die,ability,prof");

// --- Spell attack (NPC): stored bonus verbatim --------------------------------
{
  const r = resolveCheck(base, { kind: "spell-attack" }, undefined, queued([12]), { kind: "npc" });
  check("npc spell-attack: total = 13 + 4 (stored)", r.total === 17 && r.parts[1]?.kind === "item");
}

// --- Initiative (PC): d20 + DEX(+3) + Misc(+3) --------------------------------
const init = resolveCheck(base, { kind: "initiative" }, undefined, queued([9]));
check("initiative: total = 10 + 3 + 3 (dex + misc, matches tracker)", init.total === 16, `total=${init.total}`);

// --- Initiative (NPC): flat stored field only ---------------------------------
{
  const r = resolveCheck(base, { kind: "initiative" }, undefined, queued([9]), { kind: "npc" });
  check("npc initiative: total = 10 + 3 (flat)", r.total === 13, `total=${r.total}`);
}

// --- partsFromExpression (freeform ROLL_DICE) -------------------------------
const freeform = partsFromExpression([4, 5], 3, "2d6+3");
check("freeform: die parts + flat modifier", freeform.length === 3 && freeform[0].label === "d6" && freeform[2].kind === "flat");
check("freeform: parts sum matches", sumParts(freeform) === 12);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
