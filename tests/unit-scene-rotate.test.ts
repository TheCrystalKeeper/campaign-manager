// ROTATE_SCENE unit test: rotateSceneCW/rotateTokenCW transform every piece of
// scene geometry consistently, four quarter-turns are the identity, and the new
// Annotation.origin tag round-trips sanitization. Runs against real src/lib code.
import { rotatePointCW, rotateSceneCW, rotateTokenCW } from "@lib/sceneTransform";
import {
  normalizeScene,
  sanitizeAnnotation,
  type Scene,
  type Token,
} from "@lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// ---------------------------------------------------------------------------
// 1. Point rotation basics (400x300 scene): corners land where expected.
// ---------------------------------------------------------------------------
check("origin → top-right edge", JSON.stringify(rotatePointCW(0, 0, 300)) === JSON.stringify({ x: 300, y: 0 }));
check("bottom-left corner → origin", JSON.stringify(rotatePointCW(0, 300, 300)) === JSON.stringify({ x: 0, y: 0 }));

// ---------------------------------------------------------------------------
// 2. Full scene rotation: dimensions swap, geometry follows, ×4 = identity.
// ---------------------------------------------------------------------------
const scene: Scene = normalizeScene({
  id: "scene-rot",
  name: "Rot",
  mapUrl: "/maps/test.png",
  width: 400,
  height: 300,
  gridSize: 50,
  gridOffsetX: 10,
  gridOffsetY: 20,
  feetPerSquare: 5,
  walls: [
    { id: "w1", x1: 40, y1: 60, x2: 200, y2: 60, sight: "normal", light: "normal", move: "normal" },
  ],
  lights: [
    { id: "l1", x: 100, y: 50, brightR: 20, dimR: 40, enabled: true, angle: 90, rotation: 45 },
  ],
  fog: {
    enabled: true,
    inverted: false,
    reveals: [
      { kind: "rect", x: 30, y: 40, w: 60, h: 20 },
      { kind: "circle", x: 70, y: 80, r: 25 },
      { kind: "brush", points: [0, 0, 10, 10, 20, 30, 40, 50], r: 12 },
      { kind: "poly", points: [5, 5, 50, 5, 50, 40, 5, 40], mode: "cover" },
    ],
  },
  annotations: [
    {
      id: "ann-1", authorId: "dm", kind: "stroke", points: [10, 20, 30, 40],
      color: "#7cc4ff", width: 2, createdAt: 1, ephemeral: false, origin: "template",
    },
  ],
} as unknown as Partial<Scene> & Record<string, unknown>);

const r1 = rotateSceneCW(scene);
check("dimensions swap", r1.width === 300 && r1.height === 400);
check("mapRotation advances to 90", r1.mapRotation === 90);
const w = r1.walls[0]!;
check(
  "wall endpoints rotate in order (winding preserved)",
  close(w.x1, 300 - 60) && close(w.y1, 40) && close(w.x2, 300 - 60) && close(w.y2, 200),
  JSON.stringify(w),
);
const l = r1.lights[0]!;
check("light position + wedge rotation follow", close(l.x, 250) && close(l.y, 100) && l.rotation === 135);
const rect = r1.fog.reveals[0]!;
check(
  "fog rect rotates (anchor from old bottom-left, w/h swap)",
  rect.kind === "rect" && close(rect.x, 300 - 40 - 20) && close(rect.y, 30) && rect.w === 20 && rect.h === 60,
  JSON.stringify(rect),
);
const circle = r1.fog.reveals[1]!;
check("fog circle center rotates", circle.kind === "circle" && close(circle.x, 220) && close(circle.y, 70) && circle.r === 25);
const brush = r1.fog.reveals[2]!;
check(
  "fog brush points rotate pairwise",
  brush.kind === "brush" && JSON.stringify(brush.points) === JSON.stringify([300, 0, 290, 10, 270, 20, 250, 40]),
  JSON.stringify((brush as { points?: number[] }).points),
);
const poly = r1.fog.reveals[3]!;
check("fog poly keeps cover mode", poly.kind === "poly" && poly.mode === "cover");
const ann = r1.annotations[0]!;
check(
  "annotation points rotate and origin tag survives",
  ann.origin === "template" && JSON.stringify(ann.points) === JSON.stringify([280, 10, 260, 30]),
  JSON.stringify(ann),
);
// Grid: a vertical line was at x=10 (offsetX) → becomes horizontal at y ≡ 10; a
// horizontal line at y=20 (offsetY) → becomes vertical at x ≡ (300−20) mod 50 = 30.
check("grid offsets swap families", close(r1.gridOffsetX, 30) && close(r1.gridOffsetY, 10), `${r1.gridOffsetX},${r1.gridOffsetY}`);

const r4 = rotateSceneCW(rotateSceneCW(rotateSceneCW(r1)));
check("four rotations restore dimensions", r4.width === 400 && r4.height === 300);
check("four rotations clear mapRotation (undefined, not 0)", r4.mapRotation === undefined);
check(
  "four rotations restore wall geometry exactly",
  close(r4.walls[0]!.x1, 40) && close(r4.walls[0]!.y1, 60) && close(r4.walls[0]!.x2, 200) && close(r4.walls[0]!.y2, 60),
);
check("four rotations restore grid offsets", close(r4.gridOffsetX, 10) && close(r4.gridOffsetY, 20));

// ---------------------------------------------------------------------------
// 3. Tokens rotate alongside (position + facing), ×4 = identity.
// ---------------------------------------------------------------------------
const token = {
  id: "tok-1", sceneId: "scene-rot", x: 120, y: 90, label: "Goblin", color: "#c45c5c",
  kind: "enemy", imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [],
  showHp: "none", facing: 300,
} as unknown as Token;
const t1 = rotateTokenCW(token, scene.height);
check("token position rotates", close(t1.x, 210) && close(t1.y, 120));
check("token facing advances 90°", t1.facing === 30);
const t4 = rotateTokenCW(rotateTokenCW(rotateTokenCW(t1, r1.height), rotateSceneCW(r1).height), rotateSceneCW(rotateSceneCW(r1)).height);
check("token ×4 restores position + facing", close(t4.x, 120) && close(t4.y, 90) && t4.facing === 300);

// ---------------------------------------------------------------------------
// 4. sanitizeAnnotation round-trips the template origin tag (and drops junk).
// ---------------------------------------------------------------------------
const tagged = sanitizeAnnotation({
  id: "ann-t", authorId: "dm", kind: "stroke", points: [0, 0, 5, 5],
  color: "#7cc4ff", width: 2, createdAt: 1, ephemeral: false, origin: "template",
});
check("origin: template survives sanitization", tagged?.origin === "template");
const junk = sanitizeAnnotation({
  id: "ann-j", authorId: "dm", kind: "stroke", points: [0, 0, 5, 5],
  color: "#fff", width: 2, createdAt: 1, ephemeral: false, origin: "evil",
});
check("unknown origin values are dropped", junk !== null && !("origin" in junk));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
