import type { MapLayer, Scene, Viewport } from "./types";
import { DEFAULT_SCENE_BACKGROUND, DEFAULT_VIEWPORT } from "./types";

const DEFAULT_SCENE_WIDTH = 800;
const DEFAULT_SCENE_HEIGHT = 600;
const CANVAS_PADDING = 80;
const MAX_WS_IMAGE_BYTES = 280_000;

/// <summary>
/// Ensures a scene uses the multi-layer format, migrating legacy single-mapUrl scenes.
/// </summary>
export function normalizeScene(
  scene: Scene & { fogEnabled?: boolean; defaultViewport?: Viewport; backgroundColor?: string },
): Scene {
  const withDefaults = {
    ...scene,
    fogEnabled: scene.fogEnabled ?? Boolean(scene.fogDataUrl),
    defaultViewport: scene.defaultViewport ?? { ...DEFAULT_VIEWPORT },
    backgroundColor: scene.backgroundColor ?? DEFAULT_SCENE_BACKGROUND,
  };

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
  return recalcSceneBounds({
    ...scene,
    layers: [...scene.layers, layer],
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
/// Removes a map layer from the scene.
/// </summary>
export function removeMapLayer(scene: Scene, layerId: string): Scene {
  return recalcSceneBounds({
    ...scene,
    layers: scene.layers.filter((layer) => layer.id !== layerId),
  });
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
    gridSize: 50,
    showGrid: true,
    fogEnabled: false,
    fogDataUrl: null,
    defaultViewport: { ...DEFAULT_VIEWPORT },
    backgroundColor: DEFAULT_SCENE_BACKGROUND,
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
  const padding = 48;
  const scale = Math.min(
    (canvasWidth - padding * 2) / scene.width,
    (canvasHeight - padding * 2) / scene.height,
    2,
  );
  const clampedScale = Math.max(0.1, scale);
  return {
    scale: clampedScale,
    x: (canvasWidth - scene.width * clampedScale) / 2,
    y: (canvasHeight - scene.height * clampedScale) / 2,
  };
}
