// Phase 6.5 unit test: fog brush sanitization + inverted fog, the scene-editor
// staging reducer (applySceneMessage), and active-scene-only player redaction.
// Runs against real src/lib code via esbuild (see tests/README.md).
import {
  createInitialState,
  MAX_FOG_BRUSH_POINTS,
  MAX_FOG_REVEALS,
  MAX_LIGHTS,
  MAX_WALLS,
  normalizeGameState,
  normalizeScene,
  sanitizeFogReveal,
  type ClientMessage,
  type GameState,
  type Scene,
  type Token,
} from "@lib/types";
import { applySceneMessage, sceneMessageSceneId } from "@lib/sceneMessages";
import { redactStateFor } from "@lib/redact";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. sanitizeFogReveal: brush shapes + modes
// ---------------------------------------------------------------------------
{
  const brush = sanitizeFogReveal({ kind: "brush", points: [0, 0, 10, 10], r: 20 });
  check("valid brush accepted", brush?.kind === "brush" && brush.r === 20);
  check(
    "brush without mode stays reveal (mode omitted)",
    brush !== null && !("mode" in brush && (brush as { mode?: string }).mode),
  );
  const cover = sanitizeFogReveal({ kind: "brush", points: [0, 0, 10, 10], r: 20, mode: "cover" });
  check("cover mode kept on brush", cover !== null && (cover as { mode?: string }).mode === "cover");
  const coverRect = sanitizeFogReveal({ kind: "rect", x: 0, y: 0, w: 5, h: 5, mode: "cover" });
  check(
    "cover mode kept on rect",
    coverRect !== null && (coverRect as { mode?: string }).mode === "cover",
  );
  check("odd point count rejected", sanitizeFogReveal({ kind: "brush", points: [0, 0, 1], r: 9 }) === null);
  check("too-short points rejected", sanitizeFogReveal({ kind: "brush", points: [0, 0], r: 9 }) === null);
  check(
    "non-finite points rejected",
    sanitizeFogReveal({ kind: "brush", points: [0, 0, Infinity, 1], r: 9 }) === null,
  );
  const long = sanitizeFogReveal({
    kind: "brush",
    points: Array.from({ length: 400 }, (_, i) => i),
    r: 9,
  });
  check(
    `brush points capped at ${MAX_FOG_BRUSH_POINTS}`,
    long?.kind === "brush" && long.points.length === MAX_FOG_BRUSH_POINTS,
    `len=${long?.kind === "brush" ? long.points.length : "?"}`,
  );
  const clamped = sanitizeFogReveal({ kind: "brush", points: [0, 0, 5, 5], r: 99999 });
  check("brush radius clamped", clamped?.kind === "brush" && clamped.r === 2000);
}

// ---------------------------------------------------------------------------
// 2. normalizeScene: fog.inverted round-trip + legacy default
// ---------------------------------------------------------------------------
{
  const inverted = normalizeScene({ id: "s1", fog: { enabled: true, reveals: [], inverted: true } });
  check("fog.inverted round-trips", inverted.fog.inverted === true);
  const legacy = normalizeScene({ id: "s2", fog: { enabled: true, reveals: [] } as never });
  check("legacy fog defaults to not-inverted", legacy.fog.inverted === false);
}

// ---------------------------------------------------------------------------
// 3. applySceneMessage: coverage + caps + same-reference misses
// ---------------------------------------------------------------------------
{
  const scene: Scene = normalizeScene({ id: "sc" });
  const other: ClientMessage = { type: "SET_WALLS", sceneId: "elsewhere", walls: [] };
  check("mismatched scene id returns same reference", applySceneMessage(scene, other) === scene);
  const nonScene: ClientMessage = { type: "COMBAT_NEXT" };
  check("non-scene message returns same reference", applySceneMessage(scene, nonScene) === scene);
  check("sceneMessageSceneId null for non-scene msg", sceneMessageSceneId(nonScene) === null);
  check(
    "sceneMessageSceneId reads UPDATE_SCENE scene.id",
    sceneMessageSceneId({ type: "UPDATE_SCENE", scene }) === "sc",
  );

  // Walls: set, cap, toggle door (door-only).
  const manyWalls = Array.from({ length: MAX_WALLS + 5 }, (_, i) => ({
    id: `w${i}`, x1: i, y1: 0, x2: i, y2: 10, kind: "wall" as const,
  }));
  const walled = applySceneMessage(scene, { type: "SET_WALLS", sceneId: "sc", walls: manyWalls });
  check(`SET_WALLS caps at ${MAX_WALLS}`, walled.walls.length === MAX_WALLS);
  const withDoor = applySceneMessage(scene, {
    type: "SET_WALLS",
    sceneId: "sc",
    walls: [
      { id: "w1", x1: 0, y1: 0, x2: 10, y2: 0, kind: "wall" },
      { id: "d1", x1: 10, y1: 0, x2: 10, y2: 10, kind: "door" },
    ],
  });
  const doorToggled = applySceneMessage(withDoor, { type: "TOGGLE_DOOR", sceneId: "sc", wallId: "d1" });
  check("TOGGLE_DOOR opens the door", doorToggled.walls.find((w) => w.id === "d1")?.open === true);
  const wallToggled = applySceneMessage(withDoor, { type: "TOGGLE_DOOR", sceneId: "sc", wallId: "w1" });
  check("TOGGLE_DOOR ignores plain walls", wallToggled === withDoor);

  // Lights: add, cap, update, remove.
  let lit = scene;
  for (let i = 0; i < MAX_LIGHTS + 3; i += 1) {
    lit = applySceneMessage(lit, {
      type: "ADD_LIGHT",
      sceneId: "sc",
      light: { id: `L${i}`, x: i, y: 0, brightR: 10, dimR: 20, enabled: true },
    });
  }
  check(`ADD_LIGHT caps at ${MAX_LIGHTS}`, lit.lights.length === MAX_LIGHTS);
  const updated = applySceneMessage(lit, {
    type: "UPDATE_LIGHT",
    sceneId: "sc",
    light: { id: "L0", x: 1, y: 1, brightR: 33, dimR: 44, enabled: false },
  });
  check("UPDATE_LIGHT replaces by id", updated.lights.find((l) => l.id === "L0")?.brightR === 33);
  const removed = applySceneMessage(updated, { type: "REMOVE_LIGHT", sceneId: "sc", lightId: "L0" });
  check("REMOVE_LIGHT filters", !removed.lights.some((l) => l.id === "L0"));

  // Fog: set (+inverted), reveal cap, reset.
  const fogged = applySceneMessage(scene, {
    type: "FOG_SET", sceneId: "sc", enabled: true, inverted: true,
  });
  check("FOG_SET applies enabled + inverted", fogged.fog.enabled && fogged.fog.inverted);
  let revealed = fogged;
  for (let i = 0; i < MAX_FOG_REVEALS + 4; i += 1) {
    revealed = applySceneMessage(revealed, {
      type: "FOG_REVEAL", sceneId: "sc", shape: { kind: "circle", x: i, y: 0, r: 10 },
    });
  }
  check(
    `FOG_REVEAL caps at ${MAX_FOG_REVEALS} (oldest dropped)`,
    revealed.fog.reveals.length === MAX_FOG_REVEALS,
  );
  const resetFog = applySceneMessage(revealed, { type: "FOG_RESET", sceneId: "sc" });
  check("FOG_RESET clears shapes, keeps inverted", resetFog.fog.reveals.length === 0 && resetFog.fog.inverted);

  // Annotations: add + dedupe + remove + clear.
  const ann = {
    id: "a1", authorId: "dm", kind: "stroke" as const, points: [0, 0, 5, 5],
    color: "#fff", width: 2, createdAt: 1, ephemeral: false,
  };
  const annotated = applySceneMessage(scene, { type: "ADD_ANNOTATION", sceneId: "sc", annotation: ann });
  check("ADD_ANNOTATION adds", annotated.annotations.length === 1);
  check(
    "duplicate annotation id ignored",
    applySceneMessage(annotated, { type: "ADD_ANNOTATION", sceneId: "sc", annotation: ann }) === annotated,
  );
  const cleared = applySceneMessage(annotated, { type: "CLEAR_ANNOTATIONS", sceneId: "sc" });
  check("CLEAR_ANNOTATIONS empties", cleared.annotations.length === 0);

  // UPDATE_SCENE renormalizes wholesale (the Apply path).
  const applied = applySceneMessage(scene, {
    type: "UPDATE_SCENE",
    scene: { ...withDoor, fog: { enabled: true, reveals: [{ kind: "circle", x: 1, y: 1, r: 5 }], inverted: true } },
  });
  check(
    "UPDATE_SCENE carries walls + fog wholesale",
    applied.walls.length === 2 && applied.fog.inverted && applied.fog.reveals.length === 1,
  );
}

// ---------------------------------------------------------------------------
// 4. Redaction: players receive only the active scene + its tokens
// ---------------------------------------------------------------------------
{
  const base = createInitialState("room-r");
  const live = base.scenes[0];
  const prep = normalizeScene({ id: "scene-prep", name: "Ambush!" });
  const mkToken = (id: string, sceneId: string, extra: Partial<Token> = {}): Token => ({
    id, sceneId, x: 0, y: 0, label: id, color: "#fff", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
    ...extra,
  });
  const state: GameState = normalizeGameState({
    ...base,
    playerSlots: [{ id: "p1", name: "Vex" }],
    scenes: [live, prep],
    activeSceneId: live.id,
    tokens: [
      mkToken("tok-live", live.id),
      mkToken("tok-live-hidden", live.id, { hidden: true }),
      mkToken("tok-prep", prep.id),
    ],
  } as GameState);

  const playerView = redactStateFor(state, { role: "player", playerId: "p1" });
  check(
    "player receives exactly the active scene",
    playerView.scenes.length === 1 && playerView.scenes[0].id === live.id,
    playerView.scenes.map((s) => s.id).join(","),
  );
  check(
    "player tokens = active scene minus hidden",
    playerView.tokens.length === 1 && playerView.tokens[0].id === "tok-live",
    playerView.tokens.map((t) => t.id).join(","),
  );
  const dmView = redactStateFor(state, { role: "dm" });
  check("DM keeps all scenes + tokens", dmView.scenes.length === 2 && dmView.tokens.length === 3);
  const lobbyView = redactStateFor(state, null);
  check("lobby still gets no scenes", lobbyView.scenes.length === 0);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) {
  process.exit(1);
}
