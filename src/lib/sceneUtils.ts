import type { Scene, Viewport } from "./types";
import { normalizeScene } from "./types";

const DEFAULT_SCENE_WIDTH = 800;
const DEFAULT_SCENE_HEIGHT = 600;

export const STANDARD_GRID_ROWS = 20;
export const VIEWPORT_GRID_ROWS = 15;
export const MIN_VIEWPORT_SCALE = 0.2;
export const MAX_VIEWPORT_SCALE = 2;

/// <summary>
/// Clamps zoom scale so map images are not stretched past native resolution.
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
/// Loads an image for Konva without breaking data URLs or same-origin static assets.
/// </summary>
export function loadImageForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const isDataOrBlob = url.startsWith("data:") || url.startsWith("blob:");
    if (!isDataOrBlob && url.startsWith("http")) {
      const resolved = new URL(url, window.location.origin);
      if (resolved.origin !== window.location.origin) {
        img.crossOrigin = "anonymous";
      }
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
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
/// Reads an image file at full quality and returns its data URL and dimensions.
/// </summary>
export async function readImageFromFile(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = await readFileAsDataUrl(file);
  const dims = await loadImageDimensions(dataUrl).catch(() => ({
    width: DEFAULT_SCENE_WIDTH,
    height: DEFAULT_SCENE_HEIGHT,
  }));
  return { dataUrl, width: dims.width, height: dims.height };
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
