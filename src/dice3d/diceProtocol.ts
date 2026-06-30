/// <summary>
/// Transport types and pure result logic shared by the client dice engine and the
/// PartyKit server. No DOM or Three.js imports here so the server can use it too.
/// </summary>

/**
 * The physical die shapes the engine can render. d100 is built from two d10s.
 * "custom" is a blank crystal/gem die for non-standard sizes (e.g. d77); its side count
 * lives on the spec's `sides` field since the shape can't encode it.
 */
export type DieKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "custom";

export type StandardDieKind = Exclude<DieKind, "custom">;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * A point in shared map/world coordinates (the same space Konva uses for tokens/pings).
 * Used to anchor a roll's dice to the map so every client renders them at the same map
 * location regardless of window size or zoom.
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
}

/** Max dice in one throw (matches the server-side cap). */
export const MAX_DICE_PER_THROW = 20;

/** How many grid cells the dice tray anchor may sit past each map edge. */
export const ROLL_REGION_BORDER_CELLS = 3;

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

/** Lightweight transform sample broadcast live while a die is grabbed/shaken. */
export interface DieTransform {
  id: string;
  p: Vec3;
  q: Quat;
}

/** Roller cursor position in shared map/world coordinates, projected per-viewer. */
export type CursorPoint = WorldPoint;

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
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
};

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
/// Builds a human-readable expression label (e.g. "1d20", "1d100", "2d6") from the
/// physical dice, for the shared roll log.
/// </summary>
export function buildExpressionLabel(specs: DieSpec[], modifier: number): string {
  let base: string;
  if (isPercentileSet(specs)) {
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
