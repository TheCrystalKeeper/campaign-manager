/// <summary>
/// Pure line-of-sight computation (Phase 6). A classic angular sweep: cast rays at
/// every wall endpoint (± a small epsilon so rays slip past corners), keep the nearest
/// hit per ray, and sort by angle into a visibility polygon. No dependencies, no DOM —
/// unit-testable in isolation. O(rays × segments); fine for the ≤600-segment cap.
/// </summary>

export type Point = { x: number; y: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };

/** Minimal wall shape (structural) so this module needn't import the full types. */
type WallLike = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "wall" | "door";
  open?: boolean;
};

/** Angular nudge (radians) so rays slip just past a corner on either side. */
const EPS = 1e-4;
/** Segment-parameter tolerance — must be ≪ the EPS ray displacement (see raySegment). */
const U_EPS = 1e-9;

/// <summary>Blocking segments = all walls plus closed doors (open doors let sight through).</summary>
export function wallsToSegments(walls: WallLike[]): Segment[] {
  const out: Segment[] = [];
  for (const w of walls) {
    if (w.kind === "door" && w.open) {
      continue;
    }
    out.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
  }
  return out;
}

/// <summary>
/// Nearest hit of a ray (origin O, unit dir D) against a segment. Returns the ray
/// parameter t ≥ 0 (distance along the ray) at the crossing, or null if it misses.
/// </summary>
function raySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  seg: Segment,
): number | null {
  const sdx = seg.x2 - seg.x1;
  const sdy = seg.y2 - seg.y1;
  const denom = dx * sdy - dy * sdx;
  if (Math.abs(denom) < 1e-9) {
    return null; // parallel
  }
  const t = ((seg.x1 - ox) * sdy - (seg.y1 - oy) * sdx) / denom; // along the ray
  const u = ((seg.x1 - ox) * dy - (seg.y1 - oy) * dx) / denom; // along the segment
  // The u-bound must be far tighter than the angular epsilon's displacement, or the
  // "just past the corner" rays graze an endpoint instead of slipping past it.
  if (t >= 0 && u >= -U_EPS && u <= 1 + U_EPS) {
    return t;
  }
  return null;
}

/// <summary>
/// The visibility polygon seen from `origin`, occluded by `walls`, bounded by a square
/// of half-width `halfExtent` centered on the origin (so unobstructed rays terminate at
/// the box rather than shooting to infinity). Make `halfExtent` ≥ the largest vision/light
/// radius you intend to reveal inside the polygon. Returns the polygon vertices in
/// angular order (may be empty only if `halfExtent` ≤ 0).
/// </summary>
export function computeVisibility(
  origin: Point,
  walls: Segment[],
  halfExtent: number,
): Point[] {
  const ox = origin.x;
  const oy = origin.y;
  if (!(halfExtent > 0)) {
    return [];
  }

  const bx0 = ox - halfExtent;
  const by0 = oy - halfExtent;
  const bx1 = ox + halfExtent;
  const by1 = oy + halfExtent;
  const box: Segment[] = [
    { x1: bx0, y1: by0, x2: bx1, y2: by0 },
    { x1: bx1, y1: by0, x2: bx1, y2: by1 },
    { x1: bx1, y1: by1, x2: bx0, y2: by1 },
    { x1: bx0, y1: by1, x2: bx0, y2: by0 },
  ];
  const segs = walls.length > 0 ? [...walls, ...box] : box;

  const angles: number[] = [];
  for (const s of segs) {
    const a1 = Math.atan2(s.y1 - oy, s.x1 - ox);
    const a2 = Math.atan2(s.y2 - oy, s.x2 - ox);
    angles.push(a1 - EPS, a1, a1 + EPS, a2 - EPS, a2, a2 + EPS);
  }

  const hits: Array<{ angle: number; x: number; y: number }> = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) {
      const t = raySegment(ox, oy, dx, dy, s);
      if (t !== null && t < best) {
        best = t;
      }
    }
    if (best < Infinity) {
      hits.push({ angle: a, x: ox + dx * best, y: oy + dy * best });
    }
  }

  hits.sort((p, q) => p.angle - q.angle);
  return hits.map((h) => ({ x: h.x, y: h.y }));
}

/// <summary>Is `point` inside the polygon? Ray-casting parity test (for unit checks/LOS).</summary>
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}
