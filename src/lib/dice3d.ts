/// <summary>
/// 3D-dice transport types and pure result logic shared by the client engine and the
/// PartyKit server. No DOM or Three.js imports here so the server can use it too.
/// Recovered from the v1 dice system (git e23a632) with the live-motion relay types
/// removed (that feature is a later stretch).
/// </summary>

/**
 * The physical die shapes the engine can render. d100 is built from two d10s.
 * "custom" is a blank crystal/gem die for non-standard sizes (e.g. d77); its side count
 * lives on the spec's `sides` field since the shape can't encode it.
 */
export type DieKind = "coin" | "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "custom";

export type StandardDieKind = Exclude<DieKind, "custom">;

/**
 * Cosmetic dice skins. Purely visual — a spec's `skin` travels with the throw so other
 * clients render the roller's dice the same way. Unknown values normalize to undefined
 * (= classic look) so mixed client/server versions stay compatible.
 */
export type DiceSkinId = "classic" | "marble" | "wood" | "glass" | "bronze";
export const DICE_SKIN_IDS: readonly DiceSkinId[] = ["classic", "marble", "wood", "glass", "bronze"];

/** Cosmetic coin finishes (the coin is skinned separately from the dice). */
export type CoinSkinId = "gold" | "silver" | "copper";
export const COIN_SKIN_IDS: readonly CoinSkinId[] = ["gold", "silver", "copper"];

const DICE_SKIN_SET = new Set<string>(DICE_SKIN_IDS);
const COIN_SKIN_SET = new Set<string>(COIN_SKIN_IDS);

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * A point in shared map/world coordinates (the same space Konva uses for tokens).
 * A throw is anchored at the roller's view center so every client renders the dice at
 * the same board location.
 */
export type WorldPoint = [number, number];

/** A single physical die in a throw. */
export interface DieSpec {
  id: string;
  kind: DieKind;
  /** A "tens" d10 (labelled 00..90) used together with a unit d10 to make a d100. */
  percentile: boolean;
  /** Side count for a "custom" die (ignored for standard kinds). */
  sides?: number;
  /**
   * Cosmetic skin chosen by the roller — a DiceSkinId on dice, a CoinSkinId on coins.
   * Absent/unknown renders as the classic look (dice) or gold (coin).
   */
  skin?: string;
}

/** Max dice in one throw (matches the server-side cap). */
export const MAX_DICE_PER_THROW = 20;

/** Server-side track caps: reject absurd or oversized recordings. */
export const MAX_TRACK_FRAMES = 400;
export const MAX_TRACK_IMPACTS = 200;

/** Initial kinematic state for one die at the moment of release. */
export interface DieThrowState {
  id: string;
  /** Position. */
  p: Vec3;
  /** Orientation quaternion. */
  q: Quat;
  /** Linear velocity. */
  lin: Vec3;
  /** Angular velocity. */
  ang: Vec3;
}

/** Recorded per-frame motion for one die. samples = flat [px,py,pz,qx,qy,qz,qw] per frame. */
export interface DieFrames {
  id: string;
  samples: number[];
}

/** A die-on-surface impact at a given frame, used to drive sound on playback. */
export interface DiceImpact {
  frame: number;
  strength: number;
}

/**
 * The exact recorded motion of a throw. Captured once by the roller (hidden pre-sim) and
 * broadcast so every client replays an identical tumble and landing.
 */
export interface DiceTrack {
  fps: number;
  frames: number;
  dice: DieFrames[];
  impacts: DiceImpact[];
}

const TRACK_QUANT = 1000;

/** Quantizes a float to 3 decimals to keep broadcast tracks small. */
export function quantize(value: number): number {
  return Math.round(value * TRACK_QUANT) / TRACK_QUANT;
}

export const DIE_SIDES: Record<StandardDieKind, number> = {
  coin: 2,
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
};

/** Coin face-value → result label (1 = Heads, 2 = Tails). */
export function coinFaceLabel(value: number): string {
  return value === 1 ? "Heads" : "Tails";
}

/// <summary>Side count for a die, reading `sides` for custom crystal dice.</summary>
export function sidesOf(spec: Pick<DieSpec, "kind" | "sides">): number {
  return spec.kind === "custom" ? Math.max(2, spec.sides ?? 2) : DIE_SIDES[spec.kind];
}

/// <summary>
/// Returns the most efficient set of physical dice for a requested die size.
/// d100 becomes a percentile d10 (tens) plus a unit d10; standard sizes use their real
/// shape; any other size becomes a single blank "custom" crystal carrying its side count.
/// </summary>
export function decomposeDie(sides: number): Omit<DieSpec, "id">[] {
  if (sides === 100) {
    return [
      { kind: "d10", percentile: true },
      { kind: "d10", percentile: false },
    ];
  }
  if (sides === 2) {
    return [{ kind: "coin", percentile: false }];
  }
  const kind = `d${sides}` as DieKind;
  if (kind !== "custom" && kind in DIE_SIDES) {
    return [{ kind, percentile: false }];
  }
  return [{ kind: "custom", percentile: false, sides }];
}

const DICE_EXPRESSION = /^(\d*)d(\d+)([+-]\d+)?$/i;

/// <summary>
/// Parses a dice expression (e.g. "1d20", "2d6+3", "1d77") into physical dice specs and a
/// modifier. Returns null for invalid input or too many dice.
/// </summary>
export function parseDiceExpression(
  expression: string,
): { specs: Omit<DieSpec, "id">[]; modifier: number } | null {
  const match = expression.trim().replace(/\s+/g, "").match(DICE_EXPRESSION);
  if (!match) {
    return null;
  }
  const count = match[1] ? Number.parseInt(match[1], 10) : 1;
  const sides = Number.parseInt(match[2], 10);
  const modifier = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    return null;
  }
  if (!Number.isFinite(sides) || sides < 2 || sides > 1000) {
    return null;
  }
  const perDie = decomposeDie(sides);
  const specs: Omit<DieSpec, "id">[] = [];
  for (let i = 0; i < count; i += 1) {
    for (const spec of perDie) {
      specs.push({ ...spec });
    }
  }
  if (specs.length > MAX_DICE_PER_THROW) {
    return null;
  }
  return { specs, modifier };
}

const DIE_KINDS = new Set<string>(["coin", "d4", "d6", "d8", "d10", "d12", "d20", "custom"]);

/// <summary>
/// Server-side validation of a client-supplied throw: sane specs and a track whose
/// shape matches them. Returns null when anything is off.
/// </summary>
export function sanitizeThrow(
  specs: DieSpec[],
  track: DiceTrack,
): { specs: DieSpec[]; track: DiceTrack } | null {
  if (!Array.isArray(specs) || specs.length === 0 || specs.length > MAX_DICE_PER_THROW) {
    return null;
  }
  for (const spec of specs) {
    if (!spec || typeof spec.id !== "string" || !DIE_KINDS.has(spec.kind)) {
      return null;
    }
    if (spec.kind === "custom") {
      const sides = spec.sides ?? 0;
      if (!Number.isFinite(sides) || sides < 2 || sides > 1000) {
        return null;
      }
    }
    // Skins are cosmetic: normalize instead of rejecting so payloads from older or newer
    // clients (no skin / a skin this build doesn't know) still validate.
    if (spec.skin !== undefined) {
      const valid = spec.kind === "coin" ? COIN_SKIN_SET : DICE_SKIN_SET;
      if (typeof spec.skin !== "string" || !valid.has(spec.skin)) {
        delete spec.skin;
      }
    }
  }
  if (!track || typeof track !== "object") {
    return null;
  }
  const fps = track.fps;
  const frames = track.frames;
  if (!Number.isFinite(fps) || fps < 10 || fps > 60) {
    return null;
  }
  if (!Number.isFinite(frames) || frames < 1 || frames > MAX_TRACK_FRAMES) {
    return null;
  }
  if (!Array.isArray(track.dice) || track.dice.length !== specs.length) {
    return null;
  }
  for (const die of track.dice) {
    if (!die || typeof die.id !== "string" || !Array.isArray(die.samples)) {
      return null;
    }
    if (die.samples.length !== frames * 7 || die.samples.some((v) => !Number.isFinite(v))) {
      return null;
    }
  }
  if (!Array.isArray(track.impacts) || track.impacts.length > MAX_TRACK_IMPACTS) {
    return null;
  }
  return { specs, track };
}

/// <summary>
/// Detects the percentile d10 + unit d10 pairing that represents a d100.
/// </summary>
function isPercentileSet(specs: DieSpec[]): boolean {
  return (
    specs.length === 2 &&
    specs[0].percentile &&
    specs[0].kind === "d10" &&
    !specs[1].percentile &&
    specs[1].kind === "d10"
  );
}

/// <summary>
/// Rolls a uniform face value (1..sides) for each die using the supplied integer RNG.
/// `randInt(n)` must return an integer in [0, n).
/// </summary>
export function rollFaceValues(specs: DieSpec[], randInt: (n: number) => number): number[] {
  return specs.map((spec) => randInt(sidesOf(spec)) + 1);
}

/// <summary>
/// Converts per-die face values into the displayed per-die rolls and the total,
/// applying d100 percentile semantics. Modifier is not applied here.
/// </summary>
export function interpretRoll(specs: DieSpec[], faceValues: number[]): { rolls: number[]; total: number } {
  if (isPercentileSet(specs)) {
    const tens = (faceValues[0] - 1) * 10; // 0,10,...,90
    const unit = faceValues[1] % 10; // 1..9, or 0 when the unit die shows its "0" face
    let total = tens + unit;
    if (total === 0) {
      total = 100;
    }
    return { rolls: [total], total };
  }

  const rolls = specs.map((spec, i) => {
    const face = faceValues[i];
    if (spec.percentile) {
      return (face - 1) * 10;
    }
    // Standalone d10 counts its "0" face as 10; all other dice show their face value.
    return face;
  });
  const total = rolls.reduce((sum, value) => sum + value, 0);
  return { rolls, total };
}

/// <summary>
/// Per-displayed-roll labels matching interpretRoll's output shape: the d100 pair
/// collapses to a single "d100"; every other die is labeled by its own size. Fixes
/// mixed pools (e.g. 2d6 + 1d8) whose parts used to all inherit the expression's
/// FIRST die size.
/// </summary>
export function rollPartLabels(specs: DieSpec[]): string[] {
  if (isPercentileSet(specs)) {
    return ["d100"];
  }
  return specs.map((spec) => (spec.kind === "coin" ? "coin" : `d${sidesOf(spec)}`));
}

/// <summary>
/// Builds a human-readable expression label (e.g. "1d20", "1d100", "2d6") from the
/// physical dice, for the shared roll log.
/// </summary>
export function buildExpressionLabel(specs: DieSpec[], modifier: number): string {
  let base: string;
  if (specs.length > 0 && specs.every((spec) => spec.kind === "coin")) {
    base = specs.length === 1 ? "Coin flip" : `${specs.length} coins`;
  } else if (isPercentileSet(specs)) {
    base = "1d100";
  } else {
    const counts = new Map<number, number>();
    for (const spec of specs) {
      const sides = sidesOf(spec);
      counts.set(sides, (counts.get(sides) ?? 0) + 1);
    }
    base = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sides, count]) => `${count}d${sides}`)
      .join(" + ");
  }
  if (modifier > 0) {
    return `${base}+${modifier}`;
  }
  if (modifier < 0) {
    return `${base}${modifier}`;
  }
  return base;
}
