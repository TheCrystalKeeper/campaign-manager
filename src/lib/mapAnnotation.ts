import { EPHEMERAL_ANNOTATION_TTL_MS, MAX_ANNOTATION_POINTS } from "./types";

/// <summary>
/// Pure geometry + fade helpers for the shift-drag "pointer arrow" (recovered from the
/// pre-revamp v1 annotation system, git e23a632). The committed polyline is sampled
/// sparsely for the network; a denser draft drives the smooth local preview. Ephemeral
/// annotations fade over the last 30% of their lifetime, matching the server TTL.
/// </summary>

/** Lifetime of an ephemeral annotation — kept in lockstep with the server TTL. */
export const ANNOTATION_DURATION_MS = EPHEMERAL_ANNOTATION_TTL_MS;
/** Shortest path (world px) that commits as an arrow — shorter drags are ignored. */
export const ANNOTATION_MIN_LENGTH = 24;
/** Min spacing between committed (networked) samples. */
export const ANNOTATION_SAMPLE_DISTANCE = 48;
/** Min spacing for the dense local preview samples. */
export const ANNOTATION_DRAFT_SAMPLE_DISTANCE = 10;

/// <summary>Total length of a flat [x,y,...] polyline.</summary>
export function annotationPathLength(points: number[]): number {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) {
    length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  }
  return length;
}

/// <summary>Whether a polyline has reached the shared point cap.</summary>
export function isAnnotationAtMaxPoints(points: number[]): boolean {
  return points.length >= MAX_ANNOTATION_POINTS;
}

/// <summary>Trims a polyline to the shared point cap.</summary>
export function trimAnnotationPoints(points: number[]): number[] {
  return points.length <= MAX_ANNOTATION_POINTS ? points : points.slice(0, MAX_ANNOTATION_POINTS);
}

function appendSample(points: number[], x: number, y: number, minDistance: number): number[] {
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

/// <summary>Appends a sparse (networked) sample when far enough from the last one.</summary>
export function appendAnnotationSample(
  points: number[],
  x: number,
  y: number,
  minDistance = ANNOTATION_SAMPLE_DISTANCE,
): number[] {
  if (isAnnotationAtMaxPoints(points)) {
    return points;
  }
  return appendSample(points, x, y, minDistance);
}

/// <summary>Appends a dense local-preview sample (no server cap).</summary>
export function appendDraftAnnotationSample(
  points: number[],
  x: number,
  y: number,
  minDistance = ANNOTATION_DRAFT_SAMPLE_DISTANCE,
): number[] {
  return appendSample(points, x, y, minDistance);
}

/// <summary>Appends the live cursor tip so the draft stroke follows the pointer.</summary>
function withCursorTip(points: number[], cursorX: number, cursorY: number): number[] {
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

/// <summary>Builds the local-only preview path while drawing (dense base + live tip).</summary>
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
  return withCursorTip(base, cursorX, cursorY);
}

/// <summary>
/// Opacity for an ephemeral annotation by age: full for the first 70% of its lifetime,
/// then a linear fade to 0 over the final 30% (1 → 0 across ANNOTATION_DURATION_MS).
/// </summary>
export function annotationOpacity(createdAt: number, now = Date.now()): number {
  const age = now - createdAt;
  if (age >= ANNOTATION_DURATION_MS) {
    return 0;
  }
  if (age < ANNOTATION_DURATION_MS * 0.7) {
    return 1;
  }
  return 1 - (age - ANNOTATION_DURATION_MS * 0.7) / (ANNOTATION_DURATION_MS * 0.3);
}
