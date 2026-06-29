export const ANNOTATION_DURATION_MS = 10_000;
export const ANNOTATION_MIN_LENGTH = 24;
export const ANNOTATION_SAMPLE_DISTANCE = 48;
export const ANNOTATION_DRAFT_SAMPLE_DISTANCE = 10;
export const ANNOTATION_MAX_POINTS = 120;
export const MAX_ACTIVE_ANNOTATIONS_PER_PLAYER = 4;

export type MapAnnotation = {
  id: string;
  sceneId: string;
  playerId: string;
  playerName: string;
  color: string;
  /** Flat polyline [x1, y1, x2, y2, ...] in world coordinates. */
  points: number[];
  createdAt: number;
};

/// <summary>
/// Returns true when a flat point array is valid for a shared annotation.
/// </summary>
export function isValidAnnotationPoints(points: unknown): points is number[] {
  return (
    Array.isArray(points) &&
    points.length >= 4 &&
    points.length % 2 === 0 &&
    points.every((value) => Number.isFinite(value))
  );
}

/// <summary>
/// Total length of a flat annotation polyline.
/// </summary>
export function annotationPathLength(points: number[]): number {
  let length = 0;
  for (let index = 2; index < points.length; index += 2) {
    length += Math.hypot(
      points[index] - points[index - 2],
      points[index + 1] - points[index - 1],
    );
  }
  return length;
}

/// <summary>
/// Returns true when an annotation polyline has reached the configured point cap.
/// </summary>
export function isAnnotationAtMaxPoints(points: number[]): boolean {
  return points.length >= ANNOTATION_MAX_POINTS;
}

/// <summary>
/// Appends a world point when it is far enough from the previous sample.
/// </summary>
export function appendAnnotationSample(
  points: number[],
  x: number,
  y: number,
  minDistance = ANNOTATION_SAMPLE_DISTANCE,
): number[] {
  if (isAnnotationAtMaxPoints(points)) {
    return points;
  }
  if (points.length < 2) {
    return [x, y];
  }
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  if (Math.hypot(x - lastX, y - lastY) < minDistance) {
    return points;
  }
  return [...points, x, y];
}

/// <summary>
/// Appends a dense draft sample without applying the server point cap.
/// </summary>
function appendDraftSample(
  points: number[],
  x: number,
  y: number,
  minDistance: number,
): number[] {
  if (points.length < 2) {
    return [x, y];
  }
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  if (Math.hypot(x - lastX, y - lastY) < minDistance) {
    return points;
  }
  return [...points, x, y];
}

/// <summary>
/// Appends a dense local preview sample without the server point cap.
/// </summary>
export function appendDraftAnnotationSample(
  points: number[],
  x: number,
  y: number,
  minDistance = ANNOTATION_DRAFT_SAMPLE_DISTANCE,
): number[] {
  return appendDraftSample(points, x, y, minDistance);
}

/// <summary>
/// Appends the live cursor to a draft preview so the stroke follows the pointer smoothly.
/// </summary>
export function withAnnotationCursorTip(
  points: number[],
  cursorX: number,
  cursorY: number,
): number[] {
  if (points.length < 2) {
    return [cursorX, cursorY];
  }
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  if (Math.hypot(cursorX - lastX, cursorY - lastY) < 1) {
    return points;
  }
  return [...points, cursorX, cursorY];
}

/// <summary>
/// Builds the local-only annotation preview path while drawing.
/// </summary>
export function buildAnnotationDraftPreview(
  sparsePoints: number[],
  draftPoints: number[],
  cursorX: number,
  cursorY: number,
  atMaxPoints: boolean,
): number[] {
  const base = draftPoints.length >= 2 ? draftPoints : sparsePoints;
  if (atMaxPoints) {
    return base;
  }
  if (base.length < 2) {
    return [cursorX, cursorY];
  }
  return withAnnotationCursorTip(base, cursorX, cursorY);
}

/// <summary>
/// Trims an annotation polyline to the configured max point count.
/// </summary>
export function trimAnnotationPoints(points: number[]): number[] {
  if (points.length <= 4) {
    return points;
  }
  if (points.length <= ANNOTATION_MAX_POINTS) {
    return points;
  }
  return points.slice(0, ANNOTATION_MAX_POINTS);
}

/// <summary>
/// Coerces persisted annotation timestamps into a finite epoch milliseconds value.
/// </summary>
export function normalizeAnnotationCreatedAt(createdAt: unknown): number {
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    return createdAt;
  }
  if (typeof createdAt === "string") {
    const parsed = Number(createdAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

/// <summary>
/// Returns true when an annotation has exceeded its visible lifetime.
/// </summary>
export function isAnnotationExpired(createdAt: number, now = Date.now()): boolean {
  return now - normalizeAnnotationCreatedAt(createdAt) >= ANNOTATION_DURATION_MS;
}

/// <summary>
/// Returns how many milliseconds remain before an annotation should be removed.
/// </summary>
export function annotationRemainingMs(createdAt: number, now = Date.now()): number {
  return Math.max(0, ANNOTATION_DURATION_MS - (now - normalizeAnnotationCreatedAt(createdAt)));
}

/// <summary>
/// Normalizes one shared annotation record from persisted or network state.
/// </summary>
export function normalizeMapAnnotation(annotation: MapAnnotation): MapAnnotation {
  return {
    ...annotation,
    createdAt: normalizeAnnotationCreatedAt(annotation.createdAt),
  };
}

/// <summary>
/// Returns opacity for an annotation based on age (1 → 0 over ANNOTATION_DURATION_MS).
/// </summary>
export function annotationOpacity(createdAt: number, now = Date.now()): number {
  const age = now - normalizeAnnotationCreatedAt(createdAt);
  if (age >= ANNOTATION_DURATION_MS) {
    return 0;
  }
  if (age < ANNOTATION_DURATION_MS * 0.7) {
    return 1;
  }
  const fadeWindow = ANNOTATION_DURATION_MS * 0.3;
  return 1 - (age - ANNOTATION_DURATION_MS * 0.7) / fadeWindow;
}
