// Phase 6 unit test: the line-of-sight visibility polygon (pure geometry).
// Runs against real src/lib code via esbuild (see tests/README.md).
import {
  computeVisibility,
  pointInPolygon,
  wallsToSegments,
  type Point,
  type Segment,
} from "@lib/visibility";
import type { Wall } from "@lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Can `origin` see `target`? (target inside the visibility polygon). */
function canSee(origin: Point, walls: Segment[], target: Point, halfExtent = 2000): boolean {
  const poly = computeVisibility(origin, walls, halfExtent);
  return pointInPolygon(target, poly);
}

// ---------------------------------------------------------------------------
// 1. Open field: everything within the box is visible.
// ---------------------------------------------------------------------------
{
  const poly = computeVisibility({ x: 0, y: 0 }, [], 500);
  check("open field yields a polygon", poly.length >= 4, `len=${poly.length}`);
  check("open field sees a near point", canSee({ x: 0, y: 0 }, [], { x: 100, y: 100 }, 500));
}

// ---------------------------------------------------------------------------
// 2. A wall blocks sight of a point directly behind it.
// ---------------------------------------------------------------------------
{
  // Vertical wall at x=100 spanning y=-50..50; viewer at origin, target at (200,0).
  const walls: Segment[] = [{ x1: 100, y1: -50, x2: 100, y2: 50 }];
  check("wall blocks the point behind it", !canSee({ x: 0, y: 0 }, walls, { x: 200, y: 0 }));
  check("viewer still sees a point in front of the wall", canSee({ x: 0, y: 0 }, walls, { x: 50, y: 0 }));
  check(
    "viewer sees around the wall (off-axis, past the wall's end)",
    canSee({ x: 0, y: 0 }, walls, { x: 200, y: 200 }),
  );
}

// ---------------------------------------------------------------------------
// 3. Corner-peek: a viewer past the edge of a wall can see behind it.
// ---------------------------------------------------------------------------
{
  const walls: Segment[] = [{ x1: 100, y1: 0, x2: 100, y2: 200 }];
  // Viewer above the wall's top end can see a point on the far side, high up.
  check("corner peek sees past a wall edge", canSee({ x: 0, y: -20 }, walls, { x: 200, y: -10 }));
  // But a point deep behind the wall (low) stays hidden from that viewer.
  check("deep-behind point stays hidden", !canSee({ x: 0, y: -20 }, walls, { x: 200, y: 150 }));
}

// ---------------------------------------------------------------------------
// 4. Doors: closed doors block; open doors let sight through.
// ---------------------------------------------------------------------------
{
  const closed: Wall[] = [{ id: "d", x1: 100, y1: -50, x2: 100, y2: 50, kind: "door" }];
  const open: Wall[] = [{ id: "d", x1: 100, y1: -50, x2: 100, y2: 50, kind: "door", open: true }];
  check(
    "closed door blocks sight",
    !canSee({ x: 0, y: 0 }, wallsToSegments(closed), { x: 200, y: 0 }),
  );
  check(
    "open door lets sight through",
    canSee({ x: 0, y: 0 }, wallsToSegments(open), { x: 200, y: 0 }),
  );
  check("wallsToSegments drops the open door", wallsToSegments(open).length === 0);
  check("wallsToSegments keeps the closed door", wallsToSegments(closed).length === 1);
}

// ---------------------------------------------------------------------------
// 5. Corridor: a long room with a doorway gap — sight passes through the gap.
// ---------------------------------------------------------------------------
{
  // Two collinear wall segments on x=100 leaving a gap y=-20..20.
  const walls: Segment[] = [
    { x1: 100, y1: -200, x2: 100, y2: -20 },
    { x1: 100, y1: 20, x2: 100, y2: 200 },
  ];
  check("sight passes through the gap", canSee({ x: 0, y: 0 }, walls, { x: 200, y: 0 }));
  check("sight blocked beside the gap", !canSee({ x: 0, y: 0 }, walls, { x: 200, y: 100 }));
}

// ---------------------------------------------------------------------------
// 6. Degenerate: halfExtent 0 → empty polygon (no crash).
// ---------------------------------------------------------------------------
check("zero extent yields empty polygon", computeVisibility({ x: 0, y: 0 }, [], 0).length === 0);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) {
  process.exit(1);
}
