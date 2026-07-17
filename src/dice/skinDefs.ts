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

/** The dice tray well surface — pure CSS (index.css), listed here for the picker. */
export type TraySurfaceId = "wood" | "felt" | "leather";
export const TRAY_SURFACE_IDS: readonly TraySurfaceId[] = ["wood", "felt", "leather"];
export const TRAY_SURFACE_LABELS: Record<TraySurfaceId, string> = {
  wood: "Wood",
  felt: "Felt",
  leather: "Leather",
};

export interface DiceSkinDef {
  label: string;
  /** Image maps under /textures/dice/. Absent maps mean a flat-color body. */
  maps?: { color?: string; normal?: string; roughness?: string };
  /** Body color before the color map loads; also the flat body color for map-less skins. */
  color: string;
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
  marble: {
    label: "Marble",
    maps: { color: "/textures/dice/marble-color.jpg" },
    color: "#b9bac3",
    metalness: 0.0,
    roughness: 0.18,
    envMapIntensity: 0.6,
    numbers: { fill: "#2b2b33", highlight: "rgba(255, 255, 255, 0.75)", shadow: "rgba(0, 0, 0, 0.4)" },
    percentileTint: "#93a7cf",
  },
  wood: {
    label: "Wood",
    maps: { color: "/textures/dice/wood-color.jpg", normal: "/textures/dice/wood-normal.jpg" },
    color: "#6b5136",
    metalness: 0.0,
    roughness: 0.6,
    envMapIntensity: 0.35,
    normalScale: 0.6,
    numbers: { fill: "#f0e3c8", highlight: "rgba(255, 226, 170, 0.5)", shadow: "rgba(30, 16, 6, 0.7)" },
    percentileTint: "#8fa3c8",
  },
  glass: {
    label: "Glass",
    maps: { roughness: "/textures/dice/glass-frost-rough.jpg" },
    color: "#dfe9f2",
    metalness: 0.0,
    roughness: 0.45,
    envMapIntensity: 1.5,
    physical: {
      // Opaque frosted glass: the glassy read comes from iridescence + clearcoat +
      // the strong env map, not from see-through transparency.
      opacity: 1,
      iridescence: 1.0,
      iridescenceIOR: 1.35,
      clearcoat: 0.7,
      clearcoatRoughness: 0.25,
    },
    numbers: { fill: "#ffffff", highlight: "rgba(255, 255, 255, 0.6)", shadow: "rgba(40, 70, 110, 0.55)" },
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
    numbers: { fill: "rgb(14, 6, 1)", highlight: "rgba(255, 214, 150, 0.55)", shadow: "rgba(20, 12, 4, 0.75)" },
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
    roughness: 0.55,
    envMapIntensity: 0.7,
    normalScale: 0.5,
    numbers: { fill: "#4a3a1a", highlight: "rgba(255, 236, 180, 0.6)", shadow: "rgba(30, 20, 5, 0.5)" },
  },
  silver: {
    label: "Silver",
    maps: { normal: "/textures/dice/bronze-normal.jpg", roughness: "/textures/dice/metal-scratch-rough.jpg" },
    color: "#c9ced6",
    metalness: 0.95,
    roughness: 0.55,
    envMapIntensity: 0.7,
    normalScale: 0.5,
    numbers: { fill: "#3a3f4a", highlight: "rgba(255, 255, 255, 0.65)", shadow: "rgba(10, 14, 20, 0.5)" },
  },
  copper: {
    label: "Copper",
    maps: { normal: "/textures/dice/bronze-normal.jpg", roughness: "/textures/dice/metal-scratch-rough.jpg" },
    color: "#b0714a",
    metalness: 0.95,
    roughness: 0.55,
    envMapIntensity: 0.7,
    normalScale: 0.5,
    numbers: { fill: "#3f2418", highlight: "rgba(255, 210, 170, 0.6)", shadow: "rgba(25, 10, 4, 0.55)" },
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

export const DEFAULT_SKIN_PREFS: DiceSkinPrefs = { all: "classic", tray: "wood" };

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
