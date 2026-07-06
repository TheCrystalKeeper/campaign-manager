/// <summary>
/// Pure line-of-sight + collision geometry (Phase 6, revamped Phase 6.9). The visibility pass
/// is a classic angular sweep — cast rays at every wall endpoint (± a small epsilon so rays slip
/// past corners) — upgraded to understand per-channel restrictions:
///   • "normal"  walls block outright (nearest hit wins, as before).
///   • "limited" walls follow Foundry "terrain" semantics: a ray sees PAST one limited wall but
///     is stopped by a SECOND limited (or any normal) wall behind it.
///   • one-way walls ("left"/"right") only occlude when the origin is on their blocking side.
/// No dependencies, no DOM — unit-testable in isolation, and the collision helpers are imported
/// server-side too. O(rays × segments); fine for the ≤600-segment cap.
/// </summary>

export type Point = { x: number; y: number };
export type Segment = { x1: number; y1: number; x2: number; y2: number };

type WallChannel = "none" | "normal" | "limited" | "proximity";

/** A wall reduced to what the sweep needs on one channel. */
export type BlockingSegment = Segment & {
  /** "normal" stops the ray outright; "limited" only stops the 2nd-in-a-row. */
  restriction: "normal" | "limited";
  /** One-way occlusion: "both", or blocks only when the origin is on that side. */
  dir: "both" | "left" | "right";
  /** Proximity ("window"): if set, the wall only blocks when the origin is BEYOND this distance (px). */
  proximityPx?: number;
};

/** Minimal wall shape (structural) so this module needn't import the full types. */
type WallLike = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sight: WallChannel;
  light: WallChannel;
  move: WallChannel;
  dir?: "both" | "left" | "right";
  door?: "none" | "door" | "secret";
  state?: "closed" | "open" | "locked";
  threshold?: number;
};

/** Angular nudge (radians) so rays slip just past a corner on either side. */
const EPS = 1e-4;
/** Segment-parameter tolerance — must be ≪ the EPS ray displacement (see raySegment). */
const U_EPS = 1e-9;

/** An open door lets every channel through (movement, sight, light). */
function isOpenDoor(w: WallLike): boolean {
  return w.door !== undefined && w.door !== "none" && w.state === "open";
}

/// <summary>
/// Blocking segments for one occlusion channel ("sight" or "light"). Skips walls that don't
/// restrict the channel and skips open doors. Each segment carries its restriction + direction so
/// the sweep can apply "limited" and one-way logic. `proximity` walls block as "normal" but carry a
/// `proximityPx` gate (needs `ftToPx` to convert the wall's feet threshold to world px).
/// </summary>
export function wallsToSegments(
  walls: WallLike[],
  channel: "sight" | "light",
  ftToPx = 1,
): BlockingSegment[] {
  const out: BlockingSegment[] = [];
  for (const w of walls) {
    const r = w[channel];
    if (r === "none" || isOpenDoor(w)) {
      continue;
    }
    const seg: BlockingSegment = {
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      restriction: r === "limited" ? "limited" : "normal",
      dir: w.dir ?? "both",
    };
    if (r === "proximity") {
      seg.proximityPx = Math.max(0, (w.threshold ?? 10) * ftToPx);
    }
    out.push(seg);
  }
  return out;
}

/// <summary>Blocking segments for token movement. "limited" counts as a full block. </summary>
export function movementSegments(walls: WallLike[]): Segment[] {
  const out: Segment[] = [];
  for (const w of walls) {
    if (w.move === "none" || isOpenDoor(w)) {
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

/**
 * Whether a one-way segment blocks a ray/light originating at (ox, oy). The sign of the cross
 * product of the segment direction with (origin − endpoint) tells which side the origin is on.
 * Convention (shared with the editor arrow): "left" blocks when cross > 0, "right" when cross < 0.
 */
function directionBlocks(seg: BlockingSegment, ox: number, oy: number): boolean {
  if (seg.dir === "both") {
    return true;
  }
  const cross = (seg.x2 - seg.x1) * (oy - seg.y1) - (seg.y2 - seg.y1) * (ox - seg.x1);
  return seg.dir === "left" ? cross > 0 : cross < 0;
}

/// <summary>Shortest distance from a point to a segment (clamped to the segment's ends).</summary>
export function pointSegmentDistance(px: number, py: number, seg: Segment): number {
  const vx = seg.x2 - seg.x1;
  const vy = seg.y2 - seg.y1;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - seg.x1) * vx + (py - seg.y1) * vy) / len2)) : 0;
  return Math.hypot(px - (seg.x1 + t * vx), py - (seg.y1 + t * vy));
}

/**
 * Whether a segment actively occludes a source at (ox, oy) this frame — combines the one-way test
 * with the proximity ("window") gate: a proximity wall is transparent when the source is within
 * `proximityPx`, opaque beyond it.
 */
function segmentActive(seg: BlockingSegment, ox: number, oy: number): boolean {
  if (!directionBlocks(seg, ox, oy)) {
    return false;
  }
  if (seg.proximityPx !== undefined && pointSegmentDistance(ox, oy, seg) <= seg.proximityPx) {
    return false; // window is "open" — source is close enough to see/light through
  }
  return true;
}

/// <summary>
/// The visibility polygon seen from `origin`, occluded by `walls`, bounded by a square
/// of half-width `halfExtent` centered on the origin (so unobstructed rays terminate at
/// the box rather than shooting to infinity). Make `halfExtent` ≥ the largest vision/light
/// radius you intend to reveal inside the polygon. Returns the polygon vertices in
/// angular order (may be empty only if `halfExtent` ≤ 0).
///
/// A ray terminates at whichever comes first: the nearest "normal" wall, or the SECOND-nearest
/// "limited" wall (it sees past exactly one limited wall). One-way walls only participate when
/// the origin is on their blocking side.
/// </summary>
export function computeVisibility(
  origin: Point,
  walls: BlockingSegment[],
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
  const box: BlockingSegment[] = [
    { x1: bx0, y1: by0, x2: bx1, y2: by0, restriction: "normal", dir: "both" },
    { x1: bx1, y1: by0, x2: bx1, y2: by1, restriction: "normal", dir: "both" },
    { x1: bx1, y1: by1, x2: bx0, y2: by1, restriction: "normal", dir: "both" },
    { x1: bx0, y1: by1, x2: bx0, y2: by0, restriction: "normal", dir: "both" },
  ];

  // Per-origin prefilter: a one-way wall the origin can "see through", or a proximity window the
  // origin is close enough to, is dropped entirely (from occlusion AND angle seeding) — no silhouette.
  const active: BlockingSegment[] = [];
  for (const s of walls) {
    if (segmentActive(s, ox, oy)) {
      active.push(s);
    }
  }
  const segs = active.length > 0 ? [...active, ...box] : box;

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
    // Track the nearest "normal" hit and the two nearest "limited" hits: the ray is stopped by
    // whichever comes first — the nearest normal, or the 2nd limited (having passed the 1st).
    let tNormal = Infinity;
    let tLim1 = Infinity;
    let tLim2 = Infinity;
    for (const s of segs) {
      const t = raySegment(ox, oy, dx, dy, s);
      if (t === null) {
        continue;
      }
      if (s.restriction === "limited") {
        if (t < tLim1) {
          tLim2 = tLim1;
          tLim1 = t;
        } else if (t < tLim2) {
          tLim2 = t;
        }
      } else if (t < tNormal) {
        tNormal = t;
      }
    }
    const best = Math.min(tNormal, tLim2);
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

// ---------------------------------------------------------------------------
// Movement collision (Phase 6.9) — shared by the client drag path and the server guard.
// ---------------------------------------------------------------------------

/** Signed area ×2 of triangle (a, b, p): >0 = p left of a→b, <0 = right, 0 = collinear. */
function orient(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/// <summary>
/// Do segments A→B and C→D properly cross? (Collinear/endpoint grazes count as non-blocking —
/// acceptable for movement: a path that merely touches a wall corner slides by.)
/// </summary>
export function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/// <summary>
/// Clamp a token move against movement-blocking walls. If the straight path from `from` to `to`
/// crosses any blocking segment, the move is REJECTED (returns `from`) — a simple, predictable v1
/// that never traps a token (the token's CENTER just can't cross a wall). Radius-aware capsule
/// collision is a later refinement.
/// </summary>
export function clampMove(from: Point, to: Point, segs: Segment[]): Point {
  for (const s of segs) {
    if (segmentsIntersect(from.x, from.y, to.x, to.y, s.x1, s.y1, s.x2, s.y2)) {
      return from;
    }
  }
  return to;
}
