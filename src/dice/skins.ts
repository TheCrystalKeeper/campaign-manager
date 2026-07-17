import * as THREE from "three";
import {
  COIN_SKINS,
  DICE_SKINS,
  skinDef,
  type DiceSkinDef,
} from "./skinDefs";

/// <summary>
/// Cosmetic dice skins, THREE side: the shared texture cache and the body-material
/// factory. The registry/prefs data lives in skinDefs.ts (THREE-free, safe for the main
/// bundle); this module re-exports it so the lazy dice chunk imports from one place.
/// geometry.ts funnels every die body through createSkinMaterial, so the engine (thrown
/// dice) and the tray (idle dice) render identically. Cached textures are shared across
/// materials and never disposed — per-die material disposal is safe because
/// Material.dispose() does not touch texture maps.
/// </summary>

export * from "./skinDefs";

/* ---------------------------------------------------------------------------------
 * Texture cache. Entries are created on first request, load asynchronously, and are
 * never disposed (they're shared across every die material in both GL scenes).
 * ------------------------------------------------------------------------------- */

interface TextureEntry {
  texture: THREE.Texture;
  loaded: boolean;
  pending: ((texture: THREE.Texture) => void)[];
}

const textureCache = new Map<string, TextureEntry>();
const loader = new THREE.TextureLoader();
const loadListeners = new Set<() => void>();

/// <summary>
/// Subscribes to "a skin texture finished loading" — both dice scenes render on demand,
/// so they need a poke to repaint when an async map arrives. Returns an unsubscribe.
/// </summary>
export function onSkinTextureLoaded(callback: () => void): () => void {
  loadListeners.add(callback);
  return () => loadListeners.delete(callback);
}

function notifyTextureLoaded(): void {
  for (const listener of loadListeners) {
    listener();
  }
}

/// <summary>Cached async texture load; color maps are sRGB, everything repeats.</summary>
function getSkinTexture(path: string, srgb: boolean): TextureEntry {
  const cached = textureCache.get(path);
  if (cached) {
    return cached;
  }
  const entry: TextureEntry = { texture: null!, loaded: false, pending: [] };
  entry.texture = loader.load(path, () => {
    entry.loaded = true;
    for (const assign of entry.pending.splice(0)) {
      assign(entry.texture);
    }
    notifyTextureLoaded();
  });
  entry.texture.wrapS = THREE.RepeatWrapping;
  entry.texture.wrapT = THREE.RepeatWrapping;
  entry.texture.anisotropy = 4;
  if (srgb) {
    entry.texture.colorSpace = THREE.SRGBColorSpace;
  }
  textureCache.set(path, entry);
  return entry;
}

/** Runs `assign` with the texture now if loaded, or once it arrives. */
function assignWhenLoaded(entry: TextureEntry, assign: (texture: THREE.Texture) => void): void {
  if (entry.loaded) {
    assign(entry.texture);
  } else {
    entry.pending.push(assign);
  }
}

function preloadDef(def: DiceSkinDef): void {
  if (def.maps?.color) getSkinTexture(def.maps.color, true);
  if (def.maps?.normal) getSkinTexture(def.maps.normal, false);
  if (def.maps?.roughness) getSkinTexture(def.maps.roughness, false);
}

/// <summary>
/// Warms the cache for every skin + coin finish. Called when the skin picker opens so
/// hover previews apply without a texture pop. (Own-pref textures need no explicit
/// preload — building the tray dice requests them via createSkinMaterial.)
/// </summary>
export function preloadAllSkinTextures(): void {
  for (const def of Object.values(DICE_SKINS)) preloadDef(def);
  for (const def of Object.values(COIN_SKINS)) preloadDef(def);
}

/* ---------------------------------------------------------------------------------
 * Coin face: a procedural minted-rim ring multiplied into the metal tint. Generated
 * once per coin finish and cached; the coin's planar cap UVs map it continuously.
 * ------------------------------------------------------------------------------- */

const coinFaceCache = new Map<string, THREE.CanvasTexture>();

function coinFaceTexture(tint: string): THREE.CanvasTexture {
  const cached = coinFaceCache.get(tint);
  if (cached) {
    return cached;
  }
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  // The cap circle spans the full canvas (UV r=0.5 -> canvas r=128). A top-down metal
  // cap reflects one uniform env direction, so the minted read has to come from this
  // map: strong worn darkening toward the edge, a bright raised-rim ring with a dark
  // groove outside it, a faint field ring, and a soft off-center sheen.
  const vignette = ctx.createRadialGradient(cx, cx, size * 0.26, cx, cx, size * 0.5);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.7, "rgba(0, 0, 0, 0.12)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(255, 255, 235, 0.45)";
  ctx.lineWidth = size * 0.025;
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.405, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.445, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.14)";
  ctx.lineWidth = size * 0.015;
  ctx.beginPath();
  ctx.arc(cx, cx, size * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  const sheen = ctx.createRadialGradient(cx * 0.8, cx * 0.8, 0, cx, cx, size * 0.45);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  coinFaceCache.set(tint, texture);
  return texture;
}

/* ---------------------------------------------------------------------------------
 * Material factory.
 * ------------------------------------------------------------------------------- */

/// <summary>
/// Builds the body material for one die. Always a fresh material instance (the engine
/// mutates per-die opacity during roll fade-out) referencing shared cached textures.
/// Image maps are attached when their async load completes; until then the body shows
/// the skin's stand-in color, and onSkinTextureLoaded pokes the scenes to repaint.
/// </summary>
export function createSkinMaterial(
  skin: string | undefined,
  opts: { percentile?: boolean; coin?: boolean } = {},
): THREE.MeshStandardMaterial {
  const def = skinDef(skin, opts.coin ?? false);

  // Classic keeps its dedicated percentile blue; textured skins tint the whole map
  // (the skin's mapTint brightness dial × the percentile pair tint).
  const isClassic = !opts.coin && (skin === undefined || skin === "classic");
  const tint = new THREE.Color(def.mapTint ?? "#ffffff");
  if (opts.percentile && def.percentileTint) {
    tint.multiply(new THREE.Color(def.percentileTint));
  }
  const baseColor = isClassic
    ? new THREE.Color(opts.percentile ? "#2d4a7b" : def.color)
    : new THREE.Color(def.color).multiply(tint);

  const params: THREE.MeshStandardMaterialParameters = {
    color: baseColor,
    metalness: def.metalness,
    roughness: def.roughness,
    envMapIntensity: def.envMapIntensity,
    flatShading: true,
  };

  let material: THREE.MeshStandardMaterial;
  if (def.physical) {
    const opacity = def.physical.opacity;
    const physical = new THREE.MeshPhysicalMaterial({
      ...params,
      // Fully opaque skins stay out of the transparent render pass entirely.
      transparent: opacity < 1,
      opacity,
      iridescence: def.physical.iridescence,
      iridescenceIOR: def.physical.iridescenceIOR,
      clearcoat: def.physical.clearcoat,
      clearcoatRoughness: def.physical.clearcoatRoughness,
      side: THREE.FrontSide,
    });
    if (opacity < 1) {
      // The engine's roll fade multiplies against this so a translucent skin never
      // pops opaque when the fade starts.
      physical.userData.baseOpacity = opacity;
    }
    material = physical;
  } else {
    material = new THREE.MeshStandardMaterial(params);
  }

  if (opts.coin) {
    material.map = coinFaceTexture(def.color);
    material.color.set("#ffffff");
  } else if (def.maps?.color) {
    assignWhenLoaded(getSkinTexture(def.maps.color, true), (texture) => {
      material.map = texture;
      material.color.copy(tint);
      material.needsUpdate = true;
    });
  }
  if (def.maps?.normal) {
    const scale = def.normalScale ?? 1;
    assignWhenLoaded(getSkinTexture(def.maps.normal, false), (texture) => {
      material.normalMap = texture;
      material.normalScale.set(scale, scale);
      material.needsUpdate = true;
    });
  }
  if (def.maps?.roughness) {
    assignWhenLoaded(getSkinTexture(def.maps.roughness, false), (texture) => {
      material.roughnessMap = texture;
      material.needsUpdate = true;
    });
  }

  return material;
}
