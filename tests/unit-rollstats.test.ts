// Roll-archive unit tests (Stats page): buildRollRecord extraction (parts vs
// expression fallback, adv/dis natural recovery, coins, masked entries),
// deriveRollCategory heuristics, and the aggregation math the page renders.
// Runs against the real src/lib code.
import {
  buildRollRecord,
  categoryBreakdown,
  d20Histogram,
  deriveRollCategory,
  dieTypeBreakdown,
  rollsByDay,
  summarizeRollers,
  type RollLogEntry,
} from "@lib/rollStats";
import type { RollRecord } from "@lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function rollEntry(overrides: Partial<RollLogEntry> & { roll?: Partial<RollLogEntry["roll"]> }): RollLogEntry {
  const { roll, ...rest } = overrides;
  return {
    id: "log-1",
    t: 1000,
    kind: "roll",
    actor: { name: "Vex" },
    ...rest,
    roll: {
      id: "roll-1",
      rollerName: "Vex",
      rollerId: "p1",
      expression: "1d20",
      rolls: [10],
      modifier: 0,
      total: 10,
      timestamp: 1000,
      ...roll,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. buildRollRecord — parts path
// ---------------------------------------------------------------------------
const fromParts = buildRollRecord(
  rollEntry({
    label: "Stealth check",
    roll: {
      expression: "1d20+5",
      rolls: [7],
      modifier: 5,
      total: 12,
      parts: [
        { kind: "die", value: 7, label: "d20" },
        { kind: "ability", value: 3, label: "DEX" },
        { kind: "prof", value: 2 },
      ],
    },
  }),
)!;
check("parts path: one d20 extracted", fromParts.dice.length === 1 && fromParts.dice[0][0] === 20 && fromParts.dice[0][1] === 7, JSON.stringify(fromParts.dice));
check("parts path: mod folds all bonuses (total − dice)", fromParts.mod === 5 && fromParts.total === 12);
check("parts path: label heuristic → check", fromParts.cat === "check");
check("record identity: who/name/t from entry", fromParts.who === "p1" && fromParts.name === "Vex" && fromParts.t === 1000);

// ---------------------------------------------------------------------------
// 2. buildRollRecord — expression fallback (no parts, e.g. initiative rolls)
// ---------------------------------------------------------------------------
const fromExpr = buildRollRecord(
  rollEntry({
    roll: { expression: "2d6+1d8+3", rolls: [4, 5, 6], modifier: 3, total: 18 },
  }),
)!;
check(
  "expression fallback: 2d6+1d8 zipped in order",
  fromExpr.dice.length === 3 &&
    fromExpr.dice[0][0] === 6 && fromExpr.dice[1][0] === 6 && fromExpr.dice[2][0] === 8 &&
    fromExpr.dice.map(([, v]) => v).join(",") === "4,5,6",
  JSON.stringify(fromExpr.dice),
);
check("expression fallback: mod = total − dice sum", fromExpr.mod === 3);

const mismatch = buildRollRecord(
  rollEntry({ roll: { expression: "weird", rolls: [3, 9], modifier: 0, total: 12 } }),
)!;
check("unparsable expression: values kept with sides 0", mismatch.dice.length === 2 && mismatch.dice.every(([s]) => s === 0));

// ---------------------------------------------------------------------------
// 3. Advantage: discarded natural recovered for single-d20 rolls only
// ---------------------------------------------------------------------------
const advSingle = buildRollRecord(
  rollEntry({
    roll: { expression: "1d20+5", rolls: [18], modifier: 5, total: 23, adv: "adv", otherTotal: 7 },
  }),
)!;
check("adv single d20: discarded natural recovered (7−5=2)", advSingle.adv === "adv" && advSingle.other === 2, JSON.stringify(advSingle));

const advMulti = buildRollRecord(
  rollEntry({
    roll: { expression: "2d6", rolls: [3, 4], modifier: 0, total: 7, adv: "adv", otherTotal: 5 },
  }),
)!;
check("adv multi-die roll: no discarded-natural guess", advMulti.other === undefined);

const advOutOfRange = buildRollRecord(
  rollEntry({
    roll: { expression: "1d20+5", rolls: [18], modifier: 5, total: 23, adv: "adv", otherTotal: 40 },
  }),
)!;
check("adv implausible otherTotal: dropped", advOutOfRange.other === undefined);

// ---------------------------------------------------------------------------
// 4. Coins + masked entries
// ---------------------------------------------------------------------------
const coin = buildRollRecord(
  rollEntry({
    label: "🪙 Coin flip",
    roll: {
      expression: "Coin flip",
      rolls: [1],
      modifier: 0,
      total: 1,
      parts: [{ kind: "flat", value: 1, label: "Heads" }],
    },
  }),
)!;
check("coin flip: cat coin, dice [[2, value]]", coin.cat === "coin" && coin.dice.length === 1 && coin.dice[0][0] === 2 && coin.dice[0][1] === 1, JSON.stringify(coin));

const masked = buildRollRecord(
  rollEntry({ masked: true, roll: { expression: "?", rolls: [], total: 0 } }),
);
check("masked player-side copy → null (no fake zero records)", masked === null);

const secret = buildRollRecord(rollEntry({ dmOnly: true }))!;
check("dmOnly roll → secret flag", secret.secret === true);

// ---------------------------------------------------------------------------
// 5. deriveRollCategory
// ---------------------------------------------------------------------------
const catCases: Array<[string | undefined, string]> = [
  ["Death saving throw (success)", "death"],
  ["Initiative", "initiative"],
  ["Longsword damage (CRIT)", "damage"],
  ["DEX save", "save"],
  ["Longsword attack", "attack"],
  ["Spell attack", "attack"],
  ["Stealth check", "check"],
  ["Thieves' tools", "check"],
  [undefined, "other"],
];
for (const [label, expected] of catCases) {
  const got = deriveRollCategory(rollEntry(label ? { label } : {}));
  check(`category: ${label ?? "(no label)"} → ${expected}`, got === expected, `got ${got}`);
}
const explicit = deriveRollCategory(rollEntry({ label: "Longsword damage", category: "attack" }));
check("explicit server category wins over label heuristics", explicit === "attack");

// ---------------------------------------------------------------------------
// 6. Aggregations
// ---------------------------------------------------------------------------
const rec = (over: Partial<RollRecord>): RollRecord => ({
  id: Math.random().toString(36).slice(2),
  t: Date.UTC(2026, 6, 15, 18, 0, 0),
  who: "p1",
  name: "Vex",
  cat: "check",
  dice: [[20, 10]],
  mod: 0,
  total: 10,
  ...over,
});

const records: RollRecord[] = [
  rec({ dice: [[20, 20]], total: 25, mod: 5, crit: true }),
  rec({ dice: [[20, 1]], total: 6, mod: 5 }),
  rec({ dice: [[20, 15]], total: 20, mod: 5, adv: "adv", other: 3 }),
  rec({ who: "dm", name: "DM", dice: [[6, 4], [6, 2]], mod: 0, total: 6, cat: "damage" }),
  rec({ who: "dm", name: "DM", cat: "coin", dice: [[2, 1]], mod: 0, total: 1 }),
];

const summaries = summarizeRollers(records);
const vex = summaries.find((s) => s.who === "p1")!;
check("summary: roll + d20 counts", vex.count === 3 && vex.d20Count === 3);
check("summary: avg natural d20 = (20+1+15)/3", Math.abs((vex.avgD20 ?? 0) - 12) < 1e-9, `avg=${vex.avgD20}`);
check("summary: luck = avg − 10.5", Math.abs((vex.luck ?? 0) - 1.5) < 1e-9);
check("summary: nat20/nat1/crit/adv tallies", vex.nat20 === 1 && vex.nat1 === 1 && vex.crits === 1 && vex.advCount === 1);
check("summary: avgTotal includes bonuses", Math.abs((vex.avgTotal ?? 0) - 17) < 1e-9, `avgTotal=${vex.avgTotal}`);

const dmRow = summaries.find((s) => s.who === "dm")!;
check("summary: coins counted separately, no d20 average", dmRow.coinCount === 1 && dmRow.avgD20 === null && dmRow.count === 2);

const minGate = summarizeRollers(records, 10).find((s) => s.who === "p1")!;
check("summary: small samples gate avg/luck to null", minGate.avgD20 === null && minGate.luck === null);

const hist = d20Histogram(records);
check("histogram: kept + discarded naturals binned", hist[19] === 1 && hist[0] === 1 && hist[14] === 1 && hist[2] === 1, JSON.stringify(hist));
const histKept = d20Histogram(records, false);
check("histogram: discarded excluded on demand", histKept[2] === 0);

const dieTypes = dieTypeBreakdown(records);
const d6 = dieTypes.find((d) => d.sides === 6)!;
check("die breakdown: d6 count/avg/expected", d6.count === 2 && Math.abs(d6.avg - 3) < 1e-9 && d6.expected === 3.5);
check("die breakdown: coins excluded", !dieTypes.some((d) => d.sides === 2));

const days = rollsByDay(records);
check("rolls by day: single bucket, per-roller counts", days.length === 1 && days[0].total === 5 && days[0].counts["p1"] === 3 && days[0].counts["dm"] === 2, JSON.stringify(days));

const cats = categoryBreakdown(records);
check(
  "category breakdown: ordered, zero categories dropped",
  cats.map((c) => c.cat).join(",") === "check,damage,coin" &&
    cats.find((c) => c.cat === "check")!.count === 3,
  JSON.stringify(cats),
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
