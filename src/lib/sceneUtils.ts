import type { MapLayer, Scene, Viewport } from "./types";
import { DEFAULT_SCENE_BACKGROUND, DEFAULT_VIEWPORT } from "./types";

const DEFAULT_SCENE_WIDTH = 800;
const DEFAULT_SCENE_HEIGHT = 600;
const CANVAS_PADDING = 80;
const MAX_WS_IMAGE_BYTES = 280_000;

export const STANDARD_GRID_ROWS = 20;
export const VIEWPORT_GRID_ROWS = 15;

/// <summary>
/// Fills in scene center coordinates when missing from persisted data.
/// </summary>
export function withSceneCenter(scene: Scene): Scene {
  const width = scene.width || DEFAULT_SCENE_WIDTH;
  const height = scene.height || DEFAULT_SCENE_HEIGHT;
  return {
    ...scene,
    centerX: scene.centerX ?? Math.round(width / 2),
    centerY: scene.centerY ?? Math.round(height / 2),
    playerPanLimit: scene.playerPanLimit ?? 0,
  };
}

/// <summary>
/// Ensures a scene uses the multi-layer format, migrating legacy single-mapUrl scenes.
/// </summary>
export function normalizeScene(
  scene: Scene & { fogEnabled?: boolean; defaultViewport?: Viewport; backgroundColor?: string },
): Scene {
  const withDefaults = withSceneCenter({
    ...scene,
    fogEnabled: scene.fogEnabled ?? Boolean(scene.fogDataUrl),
    defaultViewport: scene.defaultViewport ?? { ...DEFAULT_VIEWPORT },
    backgroundColor: scene.backgroundColor ?? DEFAULT_SCENE_BACKGROUND,
  });

  if (withDefaults.layers.length > 0) {
    return recalcSceneBounds(withDefaults);
  }

  const legacyMapUrl = (scene as Scene & { mapUrl?: string }).mapUrl;
  if (legacyMapUrl) {
    return recalcSceneBounds({
      ...withDefaults,
      layers: [
        {
          id: `${scene.id}-layer-1`,
          url: legacyMapUrl,
          x: 0,
          y: 0,
          width: scene.width || DEFAULT_SCENE_WIDTH,
          height: scene.height || DEFAULT_SCENE_HEIGHT,
          label: "Map",
        },
      ],
      width: scene.width || DEFAULT_SCENE_WIDTH,
      height: scene.height || DEFAULT_SCENE_HEIGHT,
    });
  }

  return recalcSceneBounds({
    ...withDefaults,
    width: scene.width || DEFAULT_SCENE_WIDTH,
    height: scene.height || DEFAULT_SCENE_HEIGHT,
  });
}

/// <summary>
/// Expands scene width and height to fit all placed map layers plus padding.
/// </summary>
export function recalcSceneBounds(scene: Scene): Scene {
  if (scene.layers.length === 0) {
    return {
      ...scene,
      width: scene.width || DEFAULT_SCENE_WIDTH,
      height: scene.height || DEFAULT_SCENE_HEIGHT,
    };
  }

  let maxX = 0;
  let maxY = 0;
  for (const layer of scene.layers) {
    maxX = Math.max(maxX, layer.x + layer.width);
    maxY = Math.max(maxY, layer.y + layer.height);
  }

  return {
    ...scene,
    width: Math.max(maxX + CANVAS_PADDING, DEFAULT_SCENE_WIDTH),
    height: Math.max(maxY + CANVAS_PADDING, DEFAULT_SCENE_HEIGHT),
  };
}

/// <summary>
/// Creates a new map layer positioned after existing scene content.
/// </summary>
export function createMapLayer(
  url: string,
  width: number,
  height: number,
  scene: Scene,
  label?: string,
  layerId?: string,
): MapLayer {
  const anchorX =
    scene.layers.length > 0
      ? Math.max(...scene.layers.map((layer) => layer.x + layer.width))
      : 0;

  return {
    id: layerId ?? `layer-${crypto.randomUUID().slice(0, 8)}`,
    url,
    x: anchorX,
    y: 0,
    width,
    height,
    label: label ?? `Image ${scene.layers.length + 1}`,
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
/// Renders an image to a data URL, shrinking only until it fits WebSocket payload limits.
/// </summary>
function compressImageToDataUrl(
  img: HTMLImageElement,
  width: number,
  height: number,
  preferPng: boolean,
): { dataUrl: string; width: number; height: number } {
  let targetWidth = width;
  let targetHeight = height;
  let quality = 0.82;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not available");
    }
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = preferPng
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", quality);

    if (dataUrl.length <= MAX_WS_IMAGE_BYTES) {
      return { dataUrl, width: targetWidth, height: targetHeight };
    }

    if (!preferPng && quality > 0.45) {
      quality -= 0.1;
      continue;
    }

    targetWidth = Math.round(targetWidth * 0.85);
    targetHeight = Math.round(targetHeight * 0.85);
    quality = 0.82;
  }

  throw new Error("Image is too large. Try a smaller file or use localhost dev mode.");
}

/// <summary>
/// Prepares an uploaded image for WebSocket sync, compressing only when the file is too large.
/// </summary>
export async function prepareImageFromFile(
  file: File,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const original = await readImageFromFile(file);

  if (original.dataUrl.length <= MAX_WS_IMAGE_BYTES) {
    return original;
  }

  if (file.type === "image/svg+xml") {
    throw new Error("SVG is too large. Simplify the file, export as PNG, or use localhost dev mode.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const preferPng = file.type === "image/png";
    return compressImageToDataUrl(img, original.width, original.height, preferPng);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/// <summary>
/// Adds a new image layer to a scene and recalculates bounds.
/// </summary>
export function addImageLayerToScene(
  scene: Scene,
  url: string,
  width: number,
  height: number,
  label?: string,
  layerId?: string,
): Scene {
  const layer = createMapLayer(url, width, height, scene, label, layerId);
  const nextLayers = [...scene.layers, layer];
  const tallestLayer = Math.max(...nextLayers.map((item) => item.height));
  return recalcSceneBounds({
    ...scene,
    layers: nextLayers,
    gridSize: gridSizeForMapHeight(tallestLayer),
  });
}

/// <summary>
/// Updates a layer position and recalculates scene bounds.
/// </summary>
export function moveMapLayer(scene: Scene, layerId: string, x: number, y: number): Scene {
  return recalcSceneBounds({
    ...scene,
    layers: scene.layers.map((layer) =>
      layer.id === layerId ? { ...layer, x, y } : layer,
    ),
  });
}

/// <summary>
/// Updates a layer size and recalculates scene bounds.
/// </summary>
export function resizeMapLayer(
  scene: Scene,
  layerId: string,
  width: number,
  height: number,
): Scene {
  const nextWidth = Math.max(10, Math.round(width));
  const nextHeight = Math.max(10, Math.round(height));

  return recalcSceneBounds({
    ...scene,
    layers: scene.layers.map((layer) =>
      layer.id === layerId ? { ...layer, width: nextWidth, height: nextHeight } : layer,
    ),
  });
}

/// <summary>
/// Removes a map layer from the scene.
/// </summary>
export function removeMapLayer(scene: Scene, layerId: string): Scene {
  return recalcSceneBounds({
    ...scene,
    layers: scene.layers.filter((layer) => layer.id !== layerId),
  });
}

/// <summary>
/// Updates the scene reference center without moving map layers or tokens.
/// </summary>
export function moveSceneCenter(scene: Scene, centerX: number, centerY: number): Scene {
  return {
    ...scene,
    centerX,
    centerY,
  };
}

/// <summary>
/// Returns whether two scenes have identical persisted fields.
/// </summary>
export function scenesEqual(a: Scene, b: Scene): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/// <summary>
/// Creates an empty scene with default dimensions.
/// </summary>
export function createEmptyScene(name: string): Scene {
  return {
    id: `scene-${crypto.randomUUID().slice(0, 8)}`,
    name,
    layers: [],
    width: DEFAULT_SCENE_WIDTH,
    height: DEFAULT_SCENE_HEIGHT,
    centerX: Math.round(DEFAULT_SCENE_WIDTH / 2),
    centerY: Math.round(DEFAULT_SCENE_HEIGHT / 2),
    playerPanLimit: 0,
    gridSize: 50,
    showGrid: true,
    fogEnabled: false,
    fogDataUrl: null,
    defaultViewport: { ...DEFAULT_VIEWPORT },
    backgroundColor: DEFAULT_SCENE_BACKGROUND,
  };
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
/// Token radius in world pixels (half of one grid cell diameter).
/// </summary>
export function tokenRadiusForGridSize(gridSize: number): number {
  return gridSize / 4;
}

/// <summary>
/// Returns true when a viewport has never been customized for a scene.
/// </summary>
export function isDefaultViewport(viewport: Viewport): boolean {
  return viewport.x === 0 && viewport.y === 0 && viewport.scale === 1;
}

/// <summary>
/// Computes a viewport with VIEWPORT_GRID_ROWS on screen, centered on the scene reference point.
/// </summary>
export function viewportForNormalizedScene(
  scene: Scene,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  const resolved = withSceneCenter(scene);
  const padding = 48;
  const gridSize = resolved.gridSize > 0 ? resolved.gridSize : 50;
  const normalizedScale =
    (canvasHeight - padding * 2) / (VIEWPORT_GRID_ROWS * gridSize);
  const scale = Math.min(normalizedScale, 2);
  const clampedScale = Math.max(0.05, scale);
  return {
    scale: clampedScale,
    x: canvasWidth / 2 - resolved.centerX * clampedScale,
    y: canvasHeight / 2 - resolved.centerY * clampedScale,
  };
}

/// <summary>
/// Computes a viewport that fits the entire scene inside the canvas with padding.
/// </summary>
export function fitViewportToScene(
  scene: Scene,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  return viewportForNormalizedScene(scene, canvasWidth, canvasHeight);
}

/// <summary>
/// Clamps a player viewport so the screen center stays within playerPanLimit grid units of scene center.
/// </summary>
export function clampPlayerViewport(
  viewport: Viewport,
  scene: Scene,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  const resolved = withSceneCenter(scene);
  const limitCells = resolved.playerPanLimit;
  if (limitCells <= 0) {
    return viewport;
  }

  const gridSize = resolved.gridSize > 0 ? resolved.gridSize : 50;
  const maxOffset = limitCells * gridSize;
  const worldCenterX = (canvasWidth / 2 - viewport.x) / viewport.scale;
  const worldCenterY = (canvasHeight / 2 - viewport.y) / viewport.scale;
  const clampedWorldX = Math.max(
    resolved.centerX - maxOffset,
    Math.min(resolved.centerX + maxOffset, worldCenterX),
  );
  const clampedWorldY = Math.max(
    resolved.centerY - maxOffset,
    Math.min(resolved.centerY + maxOffset, worldCenterY),
  );

  return {
    scale: viewport.scale,
    x: canvasWidth / 2 - clampedWorldX * viewport.scale,
    y: canvasHeight / 2 - clampedWorldY * viewport.scale,
  };
}
