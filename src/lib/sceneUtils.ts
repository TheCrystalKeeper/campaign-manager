import type { Scene, Viewport } from "./types";
import { normalizeScene } from "./types";

const DEFAULT_SCENE_WIDTH = 800;
const DEFAULT_SCENE_HEIGHT = 600;

export const STANDARD_GRID_ROWS = 20;
export const VIEWPORT_GRID_ROWS = 15;
export const MIN_VIEWPORT_SCALE = 0.2;
export const MAX_VIEWPORT_SCALE = 5;

/// <summary>
/// Clamps zoom scale to the board's zoom limits. The max deliberately exceeds native map
/// resolution (close-ups on a single token beat pixel-perfect fidelity).
/// </summary>
export function clampViewportScale(scale: number): number {
  return Math.min(MAX_VIEWPORT_SCALE, Math.max(MIN_VIEWPORT_SCALE, scale));
}

/// <summary>
/// Applies zoom limits to a viewport without changing pan position.
/// </summary>
export function clampViewport(viewport: Viewport): Viewport {
  return {
    ...viewport,
    scale: clampViewportScale(viewport.scale),
  };
}

/// <summary>
/// Minimum fraction of the viewport (per axis) that the map must always cover at the pan extremes,
/// so the map can be panned to explore its edges but never dragged off into the empty backdrop.
/// </summary>
export const PAN_VISIBLE_FRACTION = 0.2;

/// <summary>
/// Clamps a viewport's PAN (x/y) so the map can never be dragged (or zoomed) entirely off into the
/// empty backdrop — the fix for an otherwise-infinite pan. Scale is left untouched (see
/// `clampViewportScale`). The margin is a fraction of the VIEWPORT, so the guarantee is simple: at
/// the pan limit at least a `PAN_VISIBLE_FRACTION` strip of the screen is still covered by the map
/// on each axis (or the whole map, if it is smaller than that strip — in which case it can be
/// repositioned but never pushed off). `stageWidth`/`stageHeight` are the canvas size in screen px;
/// a not-yet-measured 0-size stage is returned unchanged.
/// </summary>
export function clampViewportPan(
  viewport: Viewport,
  sceneWidth: number,
  sceneHeight: number,
  stageWidth: number,
  stageHeight: number,
): Viewport {
  if (!(stageWidth > 0) || !(stageHeight > 0)) {
    return viewport;
  }
  const scale = viewport.scale > 0 ? viewport.scale : 1;
  const sceneScreenW = Math.max(sceneWidth, 0) * scale;
  const sceneScreenH = Math.max(sceneHeight, 0) * scale;
  const marginX = stageWidth * PAN_VISIBLE_FRACTION;
  const marginY = stageHeight * PAN_VISIBLE_FRACTION;
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  return {
    ...viewport,
    // x is the scene's left screen edge: the lower bound pins the scene's RIGHT edge at `marginX`
    // (map pulled left), the upper bound pins its LEFT edge at `stageWidth - marginX` (pulled
    // right). When the map is smaller than the viewport these bounds cross into a fully-in-view
    // band; the clamp still resolves to a sensible in-range position.
    x: clamp(viewport.x, marginX - sceneScreenW, stageWidth - marginX),
    y: clamp(viewport.y, marginY - sceneScreenH, stageHeight - marginY),
  };
}

/// <summary>
/// Quantizes the live viewport scale for image-cache sizing: the smallest power of √2 that is
/// ≥ scale (clamped to the zoom limits). Caches sized to this bucket are always drawn with a
/// downscale ratio in [1, √2) — comfortably inside the single-pass range the browser's cubic
/// filter handles cleanly — while re-rendering only when the zoom crosses a √2 step, not on
/// every wheel tick.
/// </summary>
export function imageScaleBucket(scale: number): number {
  const s = clampViewportScale(Number.isFinite(scale) && scale > 0 ? scale : 1);
  // Powers of √2: 2^(ceil(log2(s) · 2) / 2). `ceil` never undershoots (→ upscale blur).
  return Math.pow(2, Math.ceil(Math.log2(s) * 2) / 2);
}

/// <summary>
/// Snaps a world-space font size so the glyphs rasterize at an INTEGER device-pixel size at the
/// current zoom. Canvas text has no hinting or pixel-grid snapping — at fractional effective
/// sizes (fontSize × scale × dpr, which is fractional at almost every zoom step) the grayscale
/// anti-aliasing smears every stem across two pixel rows and the text reads as blurry. Rounding
/// the effective size to whole device pixels (≤ ±3% visual change) removes most of that smear.
/// </summary>
export function snapFontSize(worldPx: number, viewScale: number, pixelRatio: number): number {
  const density = viewScale * pixelRatio;
  if (!Number.isFinite(density) || density <= 0 || !Number.isFinite(worldPx) || worldPx <= 0) {
    return worldPx;
  }
  return Math.max(1, Math.round(worldPx * density)) / density;
}

/// <summary>
/// Loads an image URL into an HTMLImageElement.
/// </summary>
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

/// <summary>
/// Shared URL→image cache so a given asset is fetched and DECODED exactly once, then reused by
/// every token / panel / scene that shows it. Without this, `useImage` builds a fresh Image() on
/// every remount (and the element-keyed downscale cache re-runs), so a scene switch or panel
/// toggle re-decodes multi-MB uploads from scratch. Keyed by URL. data:/blob: URLs are NOT
/// cached (their keys would be huge and their lifetimes are transient). Bounded by a simple LRU
/// so a long session can't grow the cache without limit.
/// </summary>
const sharedImageCache = new Map<string, Promise<HTMLImageElement>>();
const SHARED_IMAGE_CACHE_MAX = 160;

function isCacheableImageUrl(url: string): boolean {
  return !url.startsWith("data:") && !url.startsWith("blob:");
}

/// <summary>
/// Loads an image for Konva without breaking data URLs or same-origin static assets, reusing a
/// shared decode per URL (see `sharedImageCache`).
/// </summary>
export function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  const cacheable = isCacheableImageUrl(url);
  if (cacheable) {
    const hit = sharedImageCache.get(url);
    if (hit) {
      // Refresh LRU recency so hot assets survive eviction.
      sharedImageCache.delete(url);
      sharedImageCache.set(url, hit);
      return hit;
    }
  }
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (cacheable && url.startsWith("http")) {
      const resolved = new URL(url, window.location.origin);
      if (resolved.origin !== window.location.origin) {
        img.crossOrigin = "anonymous";
      }
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      // A failed load must not poison the cache — drop it so a later attempt can retry.
      sharedImageCache.delete(url);
      reject(new Error(`Failed to load image: ${url}`));
    };
    img.src = url;
  });
  if (cacheable) {
    sharedImageCache.set(url, promise);
    if (sharedImageCache.size > SHARED_IMAGE_CACHE_MAX) {
      const oldest = sharedImageCache.keys().next().value;
      if (oldest !== undefined) sharedImageCache.delete(oldest);
    }
  }
  return promise;
}

/// <summary>
/// Warms the shared cache for a URL (fire-and-forget) so a likely-next asset — the party's
/// portraits, the active scene's tokens, other scenes' maps — is already decoded before it's
/// shown. Safe to call repeatedly; de-duped by `loadImageForCanvas`.
/// </summary>
export function prefetchImage(url: string | null | undefined): void {
  if (!url) return;
  loadImageForCanvas(url).catch(() => {});
}

/// <summary>
/// Returns a copy of an image downscaled so its longest side is at most `maxSide`,
/// resampled in halving steps with high-quality smoothing. Browsers downsample a large
/// image into a tiny canvas region in one low-quality pass, which makes token portraits
/// look soft/low-res; pre-shrinking with stepped, high-quality smoothing keeps them crisp.
/// Images already within `maxSide` are returned untouched (no needless re-encode).
/// </summary>
export function downscaleImage(
  source: HTMLImageElement,
  maxSide: number,
): HTMLImageElement | HTMLCanvasElement {
  const longest = Math.max(source.width, source.height);
  if (!(longest > maxSide) || !Number.isFinite(maxSide) || maxSide <= 0) {
    return source;
  }
  const scale = maxSide / longest;
  const targetW = Math.max(1, Math.round(source.width * scale));
  const targetH = Math.max(1, Math.round(source.height * scale));

  let current: HTMLImageElement | HTMLCanvasElement = source;
  let w = source.width;
  let h = source.height;
  // Halve repeatedly until one more halving would undershoot the target, then do the
  // final exact step. Each pass loses little detail, unlike a single big minification.
  while (w > targetW * 2 && h > targetH * 2) {
    w = Math.max(targetW, Math.round(w / 2));
    h = Math.max(targetH, Math.round(h / 2));
    current = drawToCanvas(current, w, h);
  }
  return drawToCanvas(current, targetW, targetH);
}

/**
 * Per-source memo of `downscaleImage` results keyed by requested `maxSide`. Cache sizing is
 * zoom-bucketed (see `imageScaleBucket`), so zooming re-requests the same handful of quantized
 * sizes per image — memoizing them makes bucket crossings free after the first visit. Sizes
 * halve geometrically, so all entries together stay under ~2× the largest copy's memory; the
 * WeakMap releases everything when the source image is dropped.
 */
const downscaleCache = new WeakMap<HTMLImageElement, Map<number, HTMLImageElement | HTMLCanvasElement>>();

/// <summary>
/// `downscaleImage` with per-(source, maxSide) memoization — use for repeated calls with
/// zoom-bucketed sizes (token portraits, the map background).
/// </summary>
export function downscaleImageCached(
  source: HTMLImageElement,
  maxSide: number,
): HTMLImageElement | HTMLCanvasElement {
  let sizes = downscaleCache.get(source);
  if (!sizes) {
    sizes = new Map();
    downscaleCache.set(source, sizes);
  }
  const hit = sizes.get(maxSide);
  if (hit) {
    return hit;
  }
  const result = downscaleImage(source, maxSide);
  sizes.set(maxSide, result);
  return result;
}

function drawToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}

/// <summary>
/// Loads an image file and returns its pixel dimensions.
/// </summary>
export function loadImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return loadImageElement(url).then((img) => ({ width: img.width, height: img.height }));
}

/// <summary>
/// Reads a file as a data URL string.
/// </summary>
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/// <summary>
/// Reads an image file for upload. With no `options`, returns the original bytes unchanged
/// (full backward compatibility). With `options.maxSide`, downscales to that cap (stepped,
/// high-quality) and re-encodes as WebP — dramatically smaller files for faster decode and a
/// lighter storage budget. Falls back to the raw bytes if the encode fails or WebP isn't smaller
/// (e.g. an already-tiny PNG, or a browser without WebP canvas export).
/// </summary>
export async function readImageFromFile(
  file: File,
  options?: { maxSide?: number; webpQuality?: number },
): Promise<{ dataUrl: string; width: number; height: number }> {
  const rawUrl = await readFileAsDataUrl(file);
  if (!options?.maxSide) {
    const dims = await loadImageDimensions(rawUrl).catch(() => ({
      width: DEFAULT_SCENE_WIDTH,
      height: DEFAULT_SCENE_HEIGHT,
    }));
    return { dataUrl: rawUrl, width: dims.width, height: dims.height };
  }
  try {
    const img = await loadImageElement(rawUrl);
    const scaled = downscaleImage(img, options.maxSide);
    const w = scaled instanceof HTMLImageElement ? scaled.naturalWidth || scaled.width : scaled.width;
    const h = scaled instanceof HTMLImageElement ? scaled.naturalHeight || scaled.height : scaled.height;
    const canvas = drawToCanvas(scaled, w, h);
    const webpUrl = canvas.toDataURL("image/webp", options.webpQuality ?? 0.85);
    // toDataURL silently yields PNG if WebP export is unsupported — only accept a real, smaller WebP.
    if (webpUrl.startsWith("data:image/webp") && webpUrl.length < rawUrl.length) {
      return { dataUrl: webpUrl, width: w, height: h };
    }
    return {
      dataUrl: rawUrl,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
  } catch {
    const dims = await loadImageDimensions(rawUrl).catch(() => ({
      width: DEFAULT_SCENE_WIDTH,
      height: DEFAULT_SCENE_HEIGHT,
    }));
    return { dataUrl: rawUrl, width: dims.width, height: dims.height };
  }
}

/// <summary>
/// Returns whether two scenes have identical persisted fields.
/// </summary>
export function scenesEqual(a: Scene, b: Scene): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// <summary>
/// Creates an empty scene with default dimensions and no map image.
/// </summary>
export function createEmptyScene(name: string): Scene {
  return normalizeScene({
    id: `scene-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim() || "Scene",
    mapUrl: null,
    width: DEFAULT_SCENE_WIDTH,
    height: DEFAULT_SCENE_HEIGHT,
  });
}

/// <summary>
/// Derives grid cell size so a map image is exactly STANDARD_GRID_ROWS cells tall.
/// </summary>
export function gridSizeForMapHeight(mapHeightPx: number): number {
  return Math.max(10, Math.round(mapHeightPx / STANDARD_GRID_ROWS));
}

/// <summary>
/// Token diameter in world pixels (half of one grid cell).
/// </summary>
export function tokenDiameterForGridSize(gridSize: number): number {
  return gridSize / 2;
}

/// <summary>
/// Token radius in world pixels for a token spanning `sizeCells` grid cells (diameter).
/// A size-1 (Medium) token is ~0.9 of a cell so it sits inside its square without overlapping.
/// </summary>
export function tokenRadius(gridSize: number, sizeCells = 1): number {
  return (gridSize / 2) * Math.max(sizeCells, 0.1) * 0.9;
}

/** Default (size-1) token radius. */
export function tokenRadiusForGridSize(gridSize: number): number {
  return tokenRadius(gridSize, 1);
}

/// <summary>
/// Returns true when a viewport has never been customized for a scene.
/// </summary>
export function isDefaultViewport(viewport: Viewport): boolean {
  return viewport.x === 0 && viewport.y === 0 && viewport.scale === 1;
}

/// <summary>
/// Computes a viewport that fits the scene inside the canvas, centered on the map.
/// </summary>
export function fitViewportToScene(
  scene: Scene,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  const width = scene.width || DEFAULT_SCENE_WIDTH;
  const height = scene.height || DEFAULT_SCENE_HEIGHT;
  const padding = 48;
  const gridSize = scene.gridSize > 0 ? scene.gridSize : 50;
  const normalizedScale = (canvasHeight - padding * 2) / (VIEWPORT_GRID_ROWS * gridSize);
  const scale = clampViewportScale(Math.min(normalizedScale, MAX_VIEWPORT_SCALE));
  return {
    scale,
    x: canvasWidth / 2 - (width / 2) * scale,
    y: canvasHeight / 2 - (height / 2) * scale,
  };
}
