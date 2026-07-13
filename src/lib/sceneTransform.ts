import { normalizeScene, type Annotation, type FogReveal, type Scene, type Token } from "./types";

/// <summary>
/// Pure 90°-clockwise scene rotation (shared client/server; server applies it for
/// ROTATE_SCENE). The map image itself is not re-encoded: the scene stores a
/// `mapRotation` the renderer applies to the image node only, while every piece of
/// world geometry (walls, lights, fog, annotations, grid offset — and, via
/// `rotateTokenCW`, the scene's tokens) is transformed into the rotated frame.
/// </summary>

/**
 * Rotates a world point 90° clockwise within a scene whose PRE-rotation height is
 * `oldH`: the left edge becomes the top, so (x, y) → (oldH − y, x).
 */
export function rotatePointCW(x: number, y: number, oldH: number): { x: number; y: number } {
  return { x: oldH - y, y: x };
}

/** Rotates a flat [x0,y0,x1,y1,…] coordinate list in place order (new array). */
function rotateFlatPointsCW(points: number[], oldH: number): number[] {
  const out: number[] = new Array(points.length);
  for (let i = 0; i + 1 < points.length; i += 2) {
    out[i] = oldH - points[i + 1];
    out[i + 1] = points[i];
  }
  return out;
}

function rotateFogRevealCW(reveal: FogReveal, oldH: number): FogReveal {
  switch (reveal.kind) {
    case "rect":
      // The rect's top-left maps from its pre-rotation BOTTOM-left corner; w/h swap.
      return { ...reveal, x: oldH - reveal.y - reveal.h, y: reveal.x, w: reveal.h, h: reveal.w };
    case "circle": {
      const p = rotatePointCW(reveal.x, reveal.y, oldH);
      return { ...reveal, x: p.x, y: p.y };
    }
    case "brush":
    case "poly":
      return { ...reveal, points: rotateFlatPointsCW(reveal.points, oldH) };
  }
}

function rotateAnnotationCW(annotation: Annotation, oldH: number): Annotation {
  const next: Annotation = { ...annotation };
  if (next.points) {
    next.points = rotateFlatPointsCW(next.points, oldH);
  }
  if (typeof annotation.x === "number" && typeof annotation.y === "number") {
    // Rect-ish annotations anchor at their top-left: like fog rects, the new anchor
    // comes from the pre-rotation bottom-left corner (h = 0 for point anchors).
    const h = typeof annotation.h === "number" ? annotation.h : 0;
    next.x = oldH - annotation.y - h;
    next.y = annotation.x;
    if (typeof annotation.w === "number" || typeof annotation.h === "number") {
      next.w = annotation.h ?? 0;
      next.h = annotation.w ?? 0;
    }
  }
  return next;
}

/**
 * Returns the scene rotated 90° clockwise: width/height swapped, `mapRotation`
 * advanced, and all world geometry mapped through `rotatePointCW`. Tokens live in
 * GameState (not the scene) — rotate them alongside with `rotateTokenCW`.
 */
export function rotateSceneCW(scene: Scene): Scene {
  const oldH = scene.height;
  const g = scene.gridSize;
  const nextRotation = (((scene.mapRotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
  return normalizeScene({
    ...scene,
    width: scene.height,
    height: scene.width,
    mapRotation: nextRotation === 0 ? undefined : nextRotation,
    // Grid lines swap families: horizontal lines (y = offsetY + k·g) become vertical
    // ones at x' = oldH − y ≡ (oldH − offsetY) mod g, and vertical lines
    // (x = offsetX + k·g) become horizontal ones at y' = x ≡ offsetX mod g.
    gridOffsetX: g > 0 ? (((oldH - scene.gridOffsetY) % g) + g) % g : scene.gridOffsetY,
    gridOffsetY: g > 0 ? ((scene.gridOffsetX % g) + g) % g : scene.gridOffsetX,
    walls: scene.walls.map((wall) => {
      const a = rotatePointCW(wall.x1, wall.y1, oldH);
      const b = rotatePointCW(wall.x2, wall.y2, oldH);
      // Endpoint order is preserved, so the segment's left/right sides rotate with it
      // and one-way `dir` walls keep facing the same rooms.
      return { ...wall, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }),
    lights: scene.lights.map((light) => {
      const p = rotatePointCW(light.x, light.y, oldH);
      return {
        ...light,
        x: p.x,
        y: p.y,
        // Directional wedges turn with the map (rotation only matters when angle < 360).
        ...(light.rotation !== undefined ? { rotation: (light.rotation + 90) % 360 } : {}),
      };
    }),
    fog: { ...scene.fog, reveals: scene.fog.reveals.map((reveal) => rotateFogRevealCW(reveal, oldH)) },
    annotations: scene.annotations.map((annotation) => rotateAnnotationCW(annotation, oldH)),
  });
}

/** Rotates a token into the scene's post-`rotateSceneCW` frame (position + facing). */
export function rotateTokenCW(token: Token, oldH: number): Token {
  const p = rotatePointCW(token.x, token.y, oldH);
  return {
    ...token,
    x: p.x,
    y: p.y,
    ...(token.facing !== undefined ? { facing: (token.facing + 90) % 360 } : {}),
  };
}
