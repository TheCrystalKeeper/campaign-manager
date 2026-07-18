/// <summary>
/// Unit checks for the cosmetic dice-skin layer: sanitizeThrow's skin normalization
/// (unknown/mistyped skins are stripped, never rejected — mixed client versions must
/// keep working) and skinDefs' prefs resolution (per-die overrides, d100 pairing,
/// defaults left off the wire).
/// Run: npx esbuild tests/unit-dice-skins.test.ts --bundle --format=esm --platform=node
///        --outfile=<tmp>/t.mjs && node <tmp>/t.mjs
/// </summary>

import { sanitizeThrow, type DieSpec, type DiceTrack } from "../src/lib/dice3d";
import { applySkinsToSpecs, mergeSkinPref, resolveSkinForSides, DEFAULT_SKIN_PREFS } from "../src/dice/skinDefs";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

function track(specs: DieSpec[]): DiceTrack {
  return {
    fps: 30,
    frames: 1,
    dice: specs.map((s) => ({ id: s.id, samples: [0, 0, 0, 0, 0, 0, 1] })),
    impacts: [],
  };
}

// --- sanitizeThrow skin normalization -------------------------------------------

{
  const specs: DieSpec[] = [
    { id: "a", kind: "d20", percentile: false, skin: "marble" },
    { id: "b", kind: "d6", percentile: false, skin: "hacked-skin" },
    { id: "c", kind: "coin", percentile: false, skin: "silver" },
    { id: "d", kind: "coin", percentile: false, skin: "marble" }, // dice skin on a coin
    { id: "e", kind: "d8", percentile: false }, // old client: no skin
  ];
  const out = sanitizeThrow(specs, track(specs));
  check("sanitizeThrow accepts a throw with skins", out !== null);
  check("valid dice skin preserved", out?.specs[0].skin === "marble");
  check("unknown skin stripped (not rejected)", out !== null && out.specs[1].skin === undefined);
  check("valid coin skin preserved", out?.specs[2].skin === "silver");
  check("dice skin on a coin stripped", out !== null && out.specs[3].skin === undefined);
  check("absent skin stays absent", out !== null && !("skin" in out.specs[4]));
}

{
  const specs: DieSpec[] = [
    { id: "a", kind: "d20", percentile: false, skin: 42 as unknown as string },
  ];
  const out = sanitizeThrow(specs, track(specs));
  check("non-string skin stripped, throw still valid", out !== null && out.specs[0].skin === undefined);
}

// --- skinDefs prefs resolution ---------------------------------------------------

{
  const prefs = mergeSkinPref(
    mergeSkinPref(mergeSkinPref(DEFAULT_SKIN_PREFS, "all", "marble"), 20, "glass"),
    "coin",
    "silver",
  );
  check("resolve: per-die override wins", resolveSkinForSides(prefs, 20) === "glass");
  check("resolve: others inherit all", resolveSkinForSides(prefs, 6) === "marble");
  check("resolve: coin finish", resolveSkinForSides(prefs, 2) === "silver");

  const cleared = mergeSkinPref(prefs, 20, null);
  check("merge: null clears an override", resolveSkinForSides(cleared, 20) === "marble");

  // decomposeDie order: a d100 is [tens d10, unit d10]; a coin is its own spec.
  const specs = applySkinsToSpecs(
    [
      { kind: "d10", percentile: true },
      { kind: "d10", percentile: false },
      { kind: "d10", percentile: false }, // standalone d10 (not part of the pair)
      { kind: "coin", percentile: false },
      { kind: "custom", percentile: false, sides: 77 },
    ] as { kind: string; percentile: boolean; sides?: number; skin?: string }[],
    mergeSkinPref(prefs, 100, "bronze"),
  );
  check("d100 pair: tens die takes the d100 override", specs[0].skin === "bronze");
  check("d100 pair: unit die takes the d100 override", specs[1].skin === "bronze");
  check("standalone d10 keeps its own resolution", specs[2].skin === "marble");
  check("coin gets the coin finish", specs[3].skin === "silver");
  check("custom crystal follows the all-dice variant", specs[4].skin === "marble");
}

{
  // Defaults stay off the wire: classic dice + gold coin attach no skin field.
  const specs = applySkinsToSpecs(
    [
      { kind: "d20", percentile: false },
      { kind: "coin", percentile: false },
      { kind: "custom", percentile: false, sides: 35 },
    ] as { kind: string; percentile: boolean; sides?: number; skin?: string }[],
    DEFAULT_SKIN_PREFS,
  );
  check("classic default attaches no skin", specs[0].skin === undefined);
  check("gold coin default attaches no skin", specs[1].skin === undefined);
  check("classic custom crystal attaches no skin", specs[2].skin === undefined);
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
