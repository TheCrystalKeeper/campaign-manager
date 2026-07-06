// Phase 6 + 6.9 unit test: the line-of-sight visibility polygon and movement collision (pure
// geometry). Runs against real src/lib code via esbuild (see tests/README.md).
import {
  clampMove,
  computeVisibility,
  movementSegments,
  pointInPolygon,
  segmentsIntersect,
  wallsToSegments,
  type BlockingSegment,
  type Point,
} from "@lib/visibility";
import { sanitizeWall, type Wall } from "@lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Terse BlockingSegment builder (defaults: solid, two-way). */
const seg = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  restriction: "normal" | "limited" = "normal",
  dir: "both" | "left" | "right" = "both",
): BlockingSegment => ({ x1, y1, x2, y2, restriction, dir });

/** Full Wall with sensible channel defaults. */
const mkWall = (over: Partial<Wall> & Pick<Wall, "x1" | "y1" | "x2" | "y2">): Wall => ({
  id: "w",
  sight: "normal",
  light: "normal",
  move: "normal",
  ...over,
});

/** Can `origin` see `target`? (target inside the visibility polygon). */
function canSee(origin: Point, walls: BlockingSegment[], target: Point, halfExtent = 2000): boolean {
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
// 2. A normal wall blocks sight of a point directly behind it.
// ---------------------------------------------------------------------------
{
  const walls = [seg(100, -50, 100, 50)];
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
  const walls = [seg(100, 0, 100, 200)];
  check("corner peek sees past a wall edge", canSee({ x: 0, y: -20 }, walls, { x: 200, y: -10 }));
  check("deep-behind point stays hidden", !canSee({ x: 0, y: -20 }, walls, { x: 200, y: 150 }));
}

// ---------------------------------------------------------------------------
// 4. Limited (terrain) walls: see PAST one, blocked by the second.
// ---------------------------------------------------------------------------
{
  const one = [seg(100, -50, 100, 50, "limited")];
  check("sight passes through a single limited wall", canSee({ x: 0, y: 0 }, one, { x: 200, y: 0 }));

  const two = [seg(100, -50, 100, 50, "limited"), seg(150, -50, 150, 50, "limited")];
  check("two stacked limited walls block", !canSee({ x: 0, y: 0 }, two, { x: 250, y: 0 }));
  // A point between the two limited walls is still visible (only one crossed).
  check("point between two limited walls is visible", canSee({ x: 0, y: 0 }, two, { x: 125, y: 0 }));

  const limitedThenNormal = [seg(100, -50, 100, 50, "limited"), seg(150, -50, 150, 50, "normal")];
  check(
    "limited then normal blocks (normal stops it)",
    !canSee({ x: 0, y: 0 }, limitedThenNormal, { x: 200, y: 0 }),
  );
  check(
    "point past the single limited but before the normal is visible",
    canSee({ x: 0, y: 0 }, limitedThenNormal, { x: 125, y: 0 }),
  );
}

// ---------------------------------------------------------------------------
// 5. One-way (directional) walls: block from one side only.
// ---------------------------------------------------------------------------
{
  // Vertical wall x=100, y=-50..50, dir "left". Convention: cross>0 blocks for "left".
  // Origin at (0,0) is on the cross>0 side → blocked; origin at (200,0) sees through.
  const left = [seg(100, -50, 100, 50, "normal", "left")];
  const blockedFrom = canSee({ x: 0, y: 0 }, left, { x: 200, y: 0 });
  const passesFrom = canSee({ x: 200, y: 0 }, left, { x: 0, y: 0 });
  check("one-way wall blocks from its blocking side", !blockedFrom);
  check("one-way wall is transparent from the other side", passesFrom);
  // The mirror direction flips which side blocks.
  const right = [seg(100, -50, 100, 50, "normal", "right")];
  check("dir=right blocks the opposite side", !canSee({ x: 200, y: 0 }, right, { x: 0, y: 0 }));
  check("dir=right transparent from the left", canSee({ x: 0, y: 0 }, right, { x: 200, y: 0 }));
}

// ---------------------------------------------------------------------------
// 6. Per-channel segment sets + doors via the new model.
// ---------------------------------------------------------------------------
{
  // A window: blocks light (normal) but only limits sight.
  const windowWall = mkWall({ x1: 100, y1: -50, x2: 100, y2: 50, sight: "limited", light: "normal" });
  const sightSegs = wallsToSegments([windowWall], "sight");
  const lightSegs = wallsToSegments([windowWall], "light");
  check("window emits a limited sight segment", sightSegs.length === 1 && sightSegs[0].restriction === "limited");
  check("window emits a normal light segment", lightSegs.length === 1 && lightSegs[0].restriction === "normal");

  // An ethereal wall blocks sight/light but not movement; a "none" sight channel is dropped.
  const invisible = mkWall({ x1: 0, y1: 0, x2: 10, y2: 0, sight: "none", light: "none", move: "normal" });
  check("sight channel drops a sight:none wall", wallsToSegments([invisible], "sight").length === 0);
  check("light channel drops a light:none wall", wallsToSegments([invisible], "light").length === 0);

  // Doors: closed blocks, open passes, on both sight and movement channels.
  const closed = [mkWall({ x1: 100, y1: -50, x2: 100, y2: 50, door: "door", state: "closed" })];
  const open = [mkWall({ x1: 100, y1: -50, x2: 100, y2: 50, door: "door", state: "open" })];
  check("closed door blocks sight", !canSee({ x: 0, y: 0 }, wallsToSegments(closed, "sight"), { x: 200, y: 0 }));
  check("open door lets sight through", canSee({ x: 0, y: 0 }, wallsToSegments(open, "sight"), { x: 200, y: 0 }));
  check("wallsToSegments drops the open door", wallsToSegments(open, "sight").length === 0);
  check("wallsToSegments keeps the closed door", wallsToSegments(closed, "sight").length === 1);
  check("open door does not block movement", movementSegments(open).length === 0);
  check("closed door blocks movement", movementSegments(closed).length === 1);
}

// ---------------------------------------------------------------------------
// 6b. Proximity "window" walls: block a far source, pass a near one (sight/light only).
// ---------------------------------------------------------------------------
{
  // Window wall at x=100 (y −50..50) with a 60px proximity range (ftToPx = 1, threshold = 60).
  const win = [mkWall({ x1: 100, y1: -50, x2: 100, y2: 50, sight: "proximity", light: "proximity", threshold: 60 })];
  const sightSegs = wallsToSegments(win, "sight", 1);
  check("proximity emits a normal segment tagged with proximityPx", sightSegs.length === 1 && sightSegs[0].proximityPx === 60);
  check("far source is blocked by a window (beyond range)", !canSee({ x: 0, y: 0 }, sightSegs, { x: 200, y: 0 }));
  check("near source sees through a window (within range)", canSee({ x: 50, y: 0 }, sightSegs, { x: 200, y: 0 }));
  // Windows still block movement (proximity is sight/light only).
  check("window blocks movement", movementSegments(win).length === 1);
}

// ---------------------------------------------------------------------------
// 7. Corridor: two collinear segments leaving a doorway gap.
// ---------------------------------------------------------------------------
{
  const walls = [seg(100, -200, 100, -20), seg(100, 20, 100, 200)];
  check("sight passes through the gap", canSee({ x: 0, y: 0 }, walls, { x: 200, y: 0 }));
  check("sight blocked beside the gap", !canSee({ x: 0, y: 0 }, walls, { x: 200, y: 100 }));
}

// ---------------------------------------------------------------------------
// 8. Movement collision: clampMove / movementSegments / segmentsIntersect.
// ---------------------------------------------------------------------------
{
  const wall = mkWall({ x1: 100, y1: -50, x2: 100, y2: 50, move: "normal" });
  const segs = movementSegments([wall]);
  check("crossing a movement wall is rejected (returns start)", clampMove({ x: 0, y: 0 }, { x: 200, y: 0 }, segs).x === 0);
  const ok = clampMove({ x: 0, y: 0 }, { x: 50, y: 0 }, segs);
  check("a move not crossing a wall is allowed", ok.x === 50 && ok.y === 0);
  const parallel = clampMove({ x: 0, y: 200 }, { x: 200, y: 200 }, segs);
  check("a move clear of the wall span is allowed", parallel.x === 200);

  // move:"none" walls never block; move:"limited" counts as blocking.
  check("movementSegments drops move:none", movementSegments([mkWall({ x1: 0, y1: 0, x2: 10, y2: 0, move: "none" })]).length === 0);
  check("movementSegments keeps move:limited", movementSegments([mkWall({ x1: 0, y1: 0, x2: 10, y2: 0, move: "limited" })]).length === 1);

  check("segmentsIntersect true for a proper crossing", segmentsIntersect(0, 0, 200, 0, 100, -50, 100, 50));
  check("segmentsIntersect false for non-crossing", !segmentsIntersect(0, 0, 50, 0, 100, -50, 100, 50));
}

// ---------------------------------------------------------------------------
// 9. Legacy migration parity: v1 walls sanitize to the new all-normal model.
// ---------------------------------------------------------------------------
{
  const legacyWall = sanitizeWall({ id: "a", x1: 0, y1: 0, x2: 100, y2: 0, kind: "wall" });
  check(
    "legacy wall → all-normal channels, no door",
    !!legacyWall &&
      legacyWall.sight === "normal" &&
      legacyWall.light === "normal" &&
      legacyWall.move === "normal" &&
      legacyWall.door === undefined,
    JSON.stringify(legacyWall),
  );
  const legacyDoor = sanitizeWall({ id: "b", x1: 0, y1: 0, x2: 100, y2: 0, kind: "door", open: true });
  check(
    "legacy open door → door:'door', state:'open'",
    !!legacyDoor && legacyDoor.door === "door" && legacyDoor.state === "open",
    JSON.stringify(legacyDoor),
  );
  const legacyClosedDoor = sanitizeWall({ id: "c", x1: 0, y1: 0, x2: 100, y2: 0, kind: "door" });
  check(
    "legacy closed door → state:'closed'",
    !!legacyClosedDoor && legacyClosedDoor.door === "door" && legacyClosedDoor.state === "closed",
  );
  // Migrated all-normal walls occlude identically to a hand-built normal segment.
  const migrated = wallsToSegments([legacyWall as Wall], "sight");
  check("migrated legacy wall occludes on the sight channel", migrated.length === 1 && migrated[0].restriction === "normal");
}

// ---------------------------------------------------------------------------
// 10. Degenerate: halfExtent 0 → empty polygon (no crash).
// ---------------------------------------------------------------------------
check("zero extent yields empty polygon", computeVisibility({ x: 0, y: 0 }, [], 0).length === 0);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) {
  process.exit(1);
}
