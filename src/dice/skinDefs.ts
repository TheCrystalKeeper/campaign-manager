import {
  COIN_SKIN_IDS,
  DICE_SKIN_IDS,
  type CoinSkinId,
  type DiceSkinId,
} from "../lib/dice3d";

/// <summary>
/// THREE-free dice skin data: the registry of looks, pref shapes, and resolvers. Kept
/// separate from skins.ts (the THREE material/texture factory) so the main bundle —
/// DiceTray's picker UI and useDiceOverlay — can use skin ids/labels/prefs without
/// pulling three.js out of its lazy-loaded chunk.
/// </summary>

export type { CoinSkinId, DiceSkinId };
export { COIN_SKIN_IDS, DICE_SKIN_IDS };

/** Colors used to render an engraved-looking number decal. */
export interface NumberStyle {
  /** Glyph body color. */
  fill: string;
  /** Lit lower lip of the inset cut. */
  highlight: string;
  /** Dark upper recess of the inset cut. */
  shadow: string;
}

/** The dice tray well surface — pure CSS (index.css), listed here for the picker.
 *  "default" is the app's own paper/ink surface (follows day/night theme). */
export type TraySurfaceId =
  | "default"
  | "wood"
  | "ebony"
  | "felt"
  | "felt-red"
  | "felt-purple"
  | "felt-blue"
  | "leather"
  | "leather-light"
  | "hide";
export const TRAY_SURFACE_IDS: readonly TraySurfaceId[] = [
  "default",
  "wood",
  "ebony",
  "leather",
  "leather-light",
  "hide",
  "felt",
  "felt-red",
  "felt-purple",
  "felt-blue",
];
export const TRAY_SURFACE_LABELS: Record<TraySurfaceId, string> = {
  default: "Default (matches theme)",
  wood: "Wood",
  ebony: "Black Wood",
  felt: "Green Felt",
  "felt-red": "Red Felt",
  "felt-purple": "Purple Felt",
  "felt-blue": "Blue Felt",
  leather: "Dark Leather",
  "leather-light": "Light Leather",
  hide: "Animal Hide",
};

export interface DiceSkinDef {
  label: string;
  /** Image maps under /textures/dice/. Absent maps mean a flat-color body. */
  maps?: { color?: string; normal?: string; roughness?: string };
  /** Body color before the color map loads; also the flat body color for map-less skins.
   *  NOTE: once a color map loads it replaces this — use `mapTint` to darken/tint a
   *  mapped skin. */
  color: string;
  /** Multiply tint applied over the color map (default white = map as-is). The knob for
   *  brightening/darkening a skin that uses a color texture. */
  mapTint?: string;
  metalness: number;
  roughness: number;
  /** Explicit so scene.environment never silently changes a skin's brightness. */
  envMapIntensity: number;
  normalScale?: number;
  /** Present = frosted-glass style MeshPhysicalMaterial (deliberately no `transmission`
   *  — it would add a whole extra render pass; opacity + iridescence + env map instead). */
  physical?: {
    opacity: number;
    iridescence: number;
    iridescenceIOR: number;
    clearcoat: number;
    clearcoatRoughness: number;
  };
  numbers: NumberStyle;
  /** Multiply tint for the percentile (tens) d10 so a d100 pair stays readable. */
  percentileTint?: string;
}

const CLASSIC_NUMBERS: NumberStyle = {
  fill: "#f5f3ec",
  highlight: "rgba(255, 255, 255, 0.35)",
  shadow: "rgba(0, 0, 0, 0.55)",
};

export const DICE_SKINS: Record<DiceSkinId, DiceSkinDef> = {
  // The pre-skins look, kept pixel-close: flat dark red (blue tens d10), low env pickup.
  classic: {
    label: "Classic",
    color: "#7b2d3a",
    metalness: 0.15,
    roughness: 0.45,
    envMapIntensity: 0.25,
    numbers: CLASSIC_NUMBERS,
  },
  white: {
    label: "White",
    // Standard casino-style white die with black numbers. No color map — the subtle
    // surface life comes from the frost roughness map (sheen variation) and a faint
    // normal relief, so it isn't a perfectly smooth plastic white.
    maps: {
      normal: "/textures/dice/bronze-normal.jpg",
      roughness: "/textures/dice/glass-frost-rough.jpg",
    },
    color: "#f0eee7",
    metalness: 0.0,
    roughness: 0.55,
    envMapIntensity: 0.4,
    normalScale: 0.3,
    numbers: { fill: "#1c1c1e", highlight: "rgba(255, 255, 255, 0.55)", shadow: "rgba(0, 0, 0, 0.35)" },
    percentileTint: "#a9bede",
  },
  marble: {
    label: "Marble",
    maps: { color: "/textures/dice/marble-color.jpg" },
    color: "rgb(185, 195, 192)",
    metalness: 0.0,
    roughness: 0.18,
    envMapIntensity: 0.6,
    numbers: { fill: "rgb(190, 151, 51)", highlight: "rgba(255, 255, 255, 0.75)", shadow: "rgba(0, 0, 0, 0.4)" },
    percentileTint: "#93a7cf",
  },
  wood: {
    label: "Ebony Wood",
    maps: { color: "/textures/dice/ebony-color.jpg", normal: "/textures/dice/ebony-normal.jpg" },
    color: "#463327",
    metalness: 0.0,
    // Matte, barely reflective, with deep grain relief — reads as raw dark wood
    // instead of lacquered veneer.
    roughness: 0.85,
    envMapIntensity: 0.15,
    normalScale: 1.5,
    numbers: { fill: "#e3b84f", highlight: "rgba(255, 232, 165, 0.6)", shadow: "rgba(0, 0, 0, 0.65)" },
    percentileTint: "#8fa3c8",
  },
  glass: {
    label: "Prismatic Frosted Glass",
    // Prismatic frosted glass: a milky body with soft pastel rainbow washes (the color
    // map is generated in-repo — see scratch script note in SOURCES.txt), matte frost
    // from the roughness map, and iridescence for the angle-dependent rainbow sheen.
    maps: {
      color: "/textures/dice/glass-prismatic-frosted.png",
      roughness: "/textures/dice/glass-frost-rough.jpg",
    },
    color: "#c9cedb",
    mapTint: "rgba(184, 191, 204, 1)",
    metalness: 0.0,
    roughness: 0.8,
    envMapIntensity: 0.5,
    physical: {
      opacity: 0.98,
      iridescence: 0.8,
      iridescenceIOR: 1.35,
      clearcoat: 0.4,
      clearcoatRoughness: 0.35,
    },
    numbers: { fill: "rgb(46, 113, 212)", highlight: "rgba(200, 220, 255, 0.7)", shadow: "rgba(120, 110, 170, 0.5)" },
    percentileTint: "#a8c4e8",
  },
  bronze: {
    label: "Bronze",
    // No roughness map here on purpose: Metal008's map has large polished (dark)
    // regions that stay mirror-bright whatever the base roughness — a flat high
    // roughness keeps the whole die consistently matte.
    maps: {
      color: "/textures/dice/bronze-color.jpg",
      normal: "/textures/dice/bronze-normal.jpg",
      roughness: "/textures/dice/bronze-rough.jpg",
    },
    color: "#8a5a2c",
    metalness: 0.8,
    roughness: 0.85,
    envMapIntensity: 0.65,
    normalScale: 0.8,
    numbers: { fill: "rgba(14, 6, 1, 0.28)", highlight: "rgba(255, 214, 150, 0.55)", shadow: "rgba(20, 12, 4, 0.75)" },
    percentileTint: "#9fb0d6",
  },
};

/// Worn minted metals for the coin. All three share the scratch roughness + subtle
/// normal relief; the minted raised-rim read comes from a procedural ring canvas
/// (skins.ts coinFaceTexture) multiplied into the tint, so no extra image downloads.
export const COIN_SKINS: Record<CoinSkinId, DiceSkinDef> = {
  gold: {
    label: "Gold",
    maps: { normal: "/textures/dice/bronze-normal.jpg", roughness: "/textures/dice/metal-scratch-rough.jpg" },
    color: "#d9b64a",
    metalness: 0.95,
    roughness: 0.35,
    envMapIntensity: 1.1,
    normalScale: 0.5,
    numbers: { fill: "#4a3a1a", highlight: "rgba(255, 236, 180, 0.6)", shadow: "rgba(30, 20, 5, 0.5)" },
  },
  silver: {
    label: "Silver",
    maps: { normal: "/textures/dice/bronze-normal.jpg", roughness: "/textures/dice/metal-scratch-rough.jpg" },
    color: "#c9ced6",
    metalness: 0.95,
    roughness: 0.35,
    envMapIntensity: 1.1,
    normalScale: 0.5,
    numbers: { fill: "#3a3f4a", highlight: "rgba(255, 255, 255, 0.65)", shadow: "rgba(10, 14, 20, 0.5)" },
  },
  copper: {
    label: "Copper",
    maps: { normal: "/textures/dice/bronze-normal.jpg", roughness: "/textures/dice/metal-scratch-rough.jpg" },
    color: "#b0714a",
    metalness: 0.95,
    roughness: 0.35,
    envMapIntensity: 1.1,
    normalScale: 0.5,
    numbers: { fill: "#3f2418", highlight: "rgba(255, 210, 170, 0.6)", shadow: "rgba(25, 10, 4, 0.55)" },
  },
  oxidized: {
    label: "Oxidized Copper",
    maps: { normal: "/textures/dice/bronze-normal.jpg", roughness: "/textures/dice/metal-scratch-rough.jpg" },
    // Verdigris patina: green-teal tint, duller metal (patina isn't reflective).
    color: "#79a58f",
    metalness: 0.55,
    roughness: 0.7,
    envMapIntensity: 0.7,
    normalScale: 0.5,
    numbers: { fill: "#22392f", highlight: "rgba(205, 240, 222, 0.5)", shadow: "rgba(8, 22, 16, 0.6)" },
  },
};

/** Per-user cosmetic prefs: one skin for all dice, optional per-die-size overrides,
 *  plus the coin finish and tray surface. Persisted as JSON (localStorage). */
export interface DiceSkinPrefs {
  all: DiceSkinId;
  /** Keyed by die size (4, 6, 8, 10, 12, 20, 100). Absent = inherit `all`. */
  perDie?: Partial<Record<number, DiceSkinId>>;
  coin?: CoinSkinId;
  tray?: TraySurfaceId;
}

export const DEFAULT_SKIN_PREFS: DiceSkinPrefs = { all: "classic", tray: "default" };

/** Die sizes that can carry a per-die skin override, in tray order. */
export const SKINNABLE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;

/// <summary>Registry lookup for the styling (incl. number colors) of a die/coin skin.</summary>
export function skinDef(skin: string | undefined, coin: boolean): DiceSkinDef {
  if (coin) {
    return COIN_SKINS[(skin as CoinSkinId) ?? "gold"] ?? COIN_SKINS.gold;
  }
  return DICE_SKINS[(skin as DiceSkinId) ?? "classic"] ?? DICE_SKINS.classic;
}

/** One immutably-updated prefs object with `target` changed to `value` (null clears
 *  back to the default/inherited look). Shared by the picker (hover previews) and the
 *  overlay hook (committed changes). */
export function mergeSkinPref(
  prefs: DiceSkinPrefs,
  target: "all" | "coin" | "tray" | number,
  value: string | null,
): DiceSkinPrefs {
  if (target === "all") {
    return { ...prefs, all: (value ?? "classic") as DiceSkinId };
  }
  if (target === "coin") {
    const next = { ...prefs };
    if (value === null) delete next.coin;
    else next.coin = value as CoinSkinId;
    return next;
  }
  if (target === "tray") {
    const next = { ...prefs };
    if (value === null) delete next.tray;
    else next.tray = value as TraySurfaceId;
    return next;
  }
  const perDie = { ...prefs.perDie };
  if (value === null) delete perDie[target];
  else perDie[target] = value as DiceSkinId;
  return { ...prefs, perDie };
}

/// <summary>Skin for one die size under the given prefs (sides 2 = the coin).</summary>
export function resolveSkinForSides(prefs: DiceSkinPrefs, sides: number): string {
  if (sides === 2) {
    return prefs.coin ?? "gold";
  }
  return prefs.perDie?.[sides] ?? prefs.all;
}

/// <summary>
/// Attaches resolved skins to freshly built throw specs (in place; returns the array).
/// A percentile d10 immediately followed by its unit d10 is one d100 (decomposeDie
/// order), so both halves take the d100 override. Defaults ("classic"/"gold") are left
/// off the spec to keep payloads lean and old-server compatible. Custom crystal dice
/// are never skinned.
/// </summary>
export function applySkinsToSpecs<
  T extends { kind: string; percentile: boolean; sides?: number; skin?: string },
>(specs: T[], prefs: DiceSkinPrefs): T[] {
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (spec.kind === "custom") {
      continue;
    }
    if (spec.kind === "coin") {
      const coin = prefs.coin ?? "gold";
      if (coin !== "gold") {
        spec.skin = coin;
      }
      continue;
    }
    let sides = Number.parseInt(spec.kind.slice(1), 10);
    if (spec.kind === "d10" && spec.percentile) {
      sides = 100;
    } else if (
      spec.kind === "d10" &&
      i > 0 &&
      specs[i - 1].kind === "d10" &&
      specs[i - 1].percentile
    ) {
      // The unit half of a d100 pair.
      sides = 100;
    }
    const skin = resolveSkinForSides(prefs, sides);
    if (skin !== "classic") {
      spec.skin = skin;
    }
  }
  return specs;
}
