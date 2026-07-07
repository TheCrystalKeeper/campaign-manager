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
  normalizeItem,
  normalizeScene,
  normalizeSheetRecord,
  normalizeToken,
  normalizeTokenShapeDefaults,
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

  // Walls: set, cap, toggle door (door-only). Legacy {kind} payloads exercise migration.
  const manyWalls = Array.from({ length: MAX_WALLS + 5 }, (_, i) => ({
    id: `w${i}`, x1: i, y1: 0, x2: i, y2: 10, kind: "wall" as const,
  }));
  const walled = applySceneMessage(scene, { type: "SET_WALLS", sceneId: "sc", walls: manyWalls });
  check(`SET_WALLS caps at ${MAX_WALLS}`, walled.walls.length === MAX_WALLS);
  check("legacy wall migrates to normal sight channel", walled.walls[0]?.sight === "normal");
  const withDoor = applySceneMessage(scene, {
    type: "SET_WALLS",
    sceneId: "sc",
    walls: [
      { id: "w1", x1: 0, y1: 0, x2: 10, y2: 0, kind: "wall" },
      { id: "d1", x1: 10, y1: 0, x2: 10, y2: 10, kind: "door" },
    ],
  });
  check("legacy door migrates to door:'door'", withDoor.walls.find((w) => w.id === "d1")?.door === "door");
  const doorToggled = applySceneMessage(withDoor, { type: "TOGGLE_DOOR", sceneId: "sc", wallId: "d1" });
  check("TOGGLE_DOOR opens the door", doorToggled.walls.find((w) => w.id === "d1")?.state === "open");
  const wallToggled = applySceneMessage(withDoor, { type: "TOGGLE_DOOR", sceneId: "sc", wallId: "w1" });
  check("TOGGLE_DOOR ignores plain walls", wallToggled === withDoor);
  // SET_DOOR_STATE (DM) can lock a door; a locked door won't toggle.
  const locked = applySceneMessage(withDoor, { type: "SET_DOOR_STATE", sceneId: "sc", wallId: "d1", state: "locked" });
  check("SET_DOOR_STATE locks the door", locked.walls.find((w) => w.id === "d1")?.state === "locked");
  const lockedToggle = applySceneMessage(locked, { type: "TOGGLE_DOOR", sceneId: "sc", wallId: "d1" });
  check("TOGGLE_DOOR ignores a locked door", lockedToggle === locked);
  // Granular ADD/UPDATE/REMOVE_WALL round-trip.
  const addedWall = applySceneMessage(scene, {
    type: "ADD_WALL",
    sceneId: "sc",
    wall: { id: "gw", x1: 0, y1: 0, x2: 20, y2: 0, sight: "limited", light: "normal", move: "none" },
  });
  check("ADD_WALL appends a wall", addedWall.walls.some((w) => w.id === "gw" && w.sight === "limited"));
  const updatedWall = applySceneMessage(addedWall, {
    type: "UPDATE_WALL",
    sceneId: "sc",
    wall: { id: "gw", x1: 0, y1: 0, x2: 20, y2: 0, sight: "normal", light: "normal", move: "normal" },
  });
  check("UPDATE_WALL replaces by id", updatedWall.walls.find((w) => w.id === "gw")?.sight === "normal");
  const removedWall = applySceneMessage(updatedWall, { type: "REMOVE_WALL", sceneId: "sc", wallId: "gw" });
  check("REMOVE_WALL drops the wall", !removedWall.walls.some((w) => w.id === "gw"));

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
  const edited = applySceneMessage(annotated, {
    type: "UPDATE_ANNOTATION", sceneId: "sc", annotationId: "a1", text: "trap here",
  });
  check("UPDATE_ANNOTATION edits text in place", edited.annotations[0].text === "trap here");
  const moved = applySceneMessage(annotated, {
    type: "UPDATE_ANNOTATION", sceneId: "sc", annotationId: "a1", x: 42, y: 99,
  });
  check(
    "UPDATE_ANNOTATION moves the annotation, leaving text untouched",
    moved.annotations[0].x === 42 && moved.annotations[0].y === 99 && moved.annotations[0].text === undefined,
  );
  check(
    "UPDATE_ANNOTATION caps text at 200",
    applySceneMessage(annotated, {
      type: "UPDATE_ANNOTATION", sceneId: "sc", annotationId: "a1", text: "x".repeat(300),
    }).annotations[0].text?.length === 200,
  );
  check(
    "UPDATE_ANNOTATION on a missing id is a no-op",
    applySceneMessage(annotated, {
      type: "UPDATE_ANNOTATION", sceneId: "sc", annotationId: "nope", text: "x",
    }) === annotated,
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
// 3b. Phase 6.6 lighting: new light fields round-trip/clamp + scene darkness migration
// ---------------------------------------------------------------------------
{
  const scene: Scene = normalizeScene({ id: "lit" });
  const added = applySceneMessage(scene, {
    type: "ADD_LIGHT",
    sceneId: "lit",
    light: {
      id: "L", x: 0, y: 0, brightR: 10, dimR: 20, enabled: true,
      color: "#ff9900", colorIntensity: 0.7, angle: 90, rotation: 45, gradual: false,
      animation: { type: "flicker", speed: 2, intensity: 0.8 },
    } as never,
  });
  const light = added.lights.find((l) => l.id === "L");
  check("light color/intensity/angle/rotation round-trip",
    light?.color === "#ff9900" && light?.colorIntensity === 0.7 && light?.angle === 90 && light?.rotation === 45);
  check("light gradual=false round-trips", light?.gradual === false);
  check("light animation round-trips",
    light?.animation?.type === "flicker" && light?.animation?.speed === 2 && light?.animation?.intensity === 0.8);

  const clamped = applySceneMessage(scene, {
    type: "ADD_LIGHT",
    sceneId: "lit",
    light: {
      id: "C", x: 0, y: 0, brightR: 10, dimR: 20, enabled: true,
      colorIntensity: 5, angle: 999, rotation: -30,
      animation: { type: "bogus", speed: 99, intensity: 9 },
    } as never,
  });
  const c = clamped.lights.find((l) => l.id === "C");
  check("colorIntensity clamps to 1", c?.colorIntensity === 1);
  check("angle clamps to 360", c?.angle === 360);
  check("rotation wraps into [0,360)", c?.rotation === 330);
  check("unknown animation type falls back to none", c?.animation?.type === "none");
  check("animation speed clamps to 10", c?.animation?.speed === 10);

  const day = normalizeScene({ id: "d", globalIllumination: true });
  check("globalIllumination true → darkness 0", day.darkness === 0);
  check("lightBlendMode defaults to screen", day.lightBlendMode === "screen");
  const blended = normalizeScene({ id: "b", lightBlendMode: "plus-lighter" } as never);
  check("lightBlendMode round-trips", blended.lightBlendMode === "plus-lighter");
  const badBlend = normalizeScene({ id: "bb", lightBlendMode: "difference" } as never);
  check("invalid lightBlendMode falls back to screen", badBlend.lightBlendMode === "screen");
  const fogOnly = normalizeScene({ id: "fo", lightBlendMode: "none" } as never);
  check("lightBlendMode none (fog-only) round-trips", fogOnly.lightBlendMode === "none");
  const night = normalizeScene({ id: "n", globalIllumination: false });
  check("globalIllumination false → darkness 1", night.darkness === 1);
  const explicit = normalizeScene({ id: "e", globalIllumination: false, darkness: 0.35 } as never);
  check("explicit darkness wins over the boolean", explicit.darkness === 0.35);
  const over = normalizeScene({ id: "o", darkness: 9 } as never);
  check("darkness clamps to [0,1]", over.darkness === 1);
}

// ---------------------------------------------------------------------------
// 3c. Phase 6.7 tokens & items: new Token/Item fields + token shape defaults
// ---------------------------------------------------------------------------
{
  const itemTok = normalizeToken({
    id: "t", sceneId: "s", x: 0, y: 0, label: "Sword", color: "", kind: "item",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
    shape: "hexagon", imageFit: "raw", itemId: "item-1",
  } as never);
  check("item token kind kept", itemTok.kind === "item");
  check("item token has no default vision", itemTok.vision === undefined);
  check("token shape whitelisted", itemTok.shape === "hexagon");
  check("token imageFit raw kept", itemTok.imageFit === "raw");
  check("token itemId kept", itemTok.itemId === "item-1");
  check("item token default color", itemTok.color === "#8a7a5c");

  const badShape = normalizeToken({
    id: "t2", sceneId: "s", x: 0, y: 0, label: "x", color: "#fff", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
    shape: "blob", imageFit: "weird",
  } as never);
  check("invalid shape dropped", badShape.shape === undefined);
  check("invalid imageFit dropped", badShape.imageFit === undefined);

  const unknownKind = normalizeToken({
    id: "t3", sceneId: "s", x: 0, y: 0, label: "x", color: "", kind: "bogus",
    imageUrl: null, ownerPlayerId: "slot-1", sheetId: null, conditions: [], showHp: "none",
  } as never);
  check("unknown kind with owner → player", unknownKind.kind === "player");

  const item = normalizeItem({
    id: "i1", name: "Flametongue", description: "burns", iconUrl: null, folderId: null,
    type: "weapon", rarity: "rare", quantity: 1, weight: 3, value: "5000 gp", attunement: true,
  } as never);
  check("item type/rarity round-trip", item.type === "weapon" && item.rarity === "rare");
  check("item quantity/weight/value/attunement round-trip",
    item.quantity === 1 && item.weight === 3 && item.value === "5000 gp" && item.attunement === true);
  const badItem = normalizeItem({ id: "i2", name: "X", type: "sock", rarity: "shiny", quantity: -5 } as never);
  check("invalid item type/rarity dropped", badItem.type === undefined && badItem.rarity === undefined);
  check("negative quantity clamped to 0", badItem.quantity === 0);

  const sized = normalizeToken({
    id: "sz", sceneId: "s", x: 0, y: 0, label: "x", color: "#fff", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none", size: 3,
  } as never);
  check("token size kept", sized.size === 3);
  const overSized = normalizeToken({
    id: "sz2", sceneId: "s", x: 0, y: 0, label: "x", color: "#fff", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none", size: 999,
  } as never);
  check("token size clamps to 10", overSized.size === 10);

  const defs = normalizeTokenShapeDefaults({ player: "square", enemy: "bogus", item: "octagon" });
  check("token shape defaults: valid kept", defs.player === "square" && defs.item === "octagon");
  check("token shape defaults: invalid → built-in", defs.enemy === "circle");
  const emptyDefs = normalizeTokenShapeDefaults(undefined);
  check("token shape defaults: absent → all built-ins",
    emptyDefs.player === "circle" && emptyDefs.enemy === "circle" && emptyDefs.item === "diamond");
}

// ---------------------------------------------------------------------------
// 3d. Independent folder trees: sheet carries npcFolderId separately from folderId
// ---------------------------------------------------------------------------
{
  const rec = normalizeSheetRecord(
    { id: "sheet-1", kind: "npc", folderId: "actor-fold", npcFolderId: "npc-fold", npcSortOrder: 3 } as never,
    "NPC",
  );
  check("actor-tree folderId kept", rec.folderId === "actor-fold");
  check("npc-tree npcFolderId kept (independent)", rec.npcFolderId === "npc-fold");
  check("npcSortOrder kept", rec.npcSortOrder === 3);
  const bare = normalizeSheetRecord({ id: "sheet-2", kind: "npc" } as never, "NPC");
  check("absent npcFolderId → undefined", bare.npcFolderId === undefined);

  // Folder sortOrder (drag-to-reorder) survives normalization.
  const withFolders = normalizeGameState({
    ...createInitialState("room-f"),
    folders: [
      { id: "f1", name: "B", kind: "npc", sortOrder: 20 },
      { id: "f2", name: "A", kind: "npc", sortOrder: 10 },
    ],
  } as never);
  const f1 = withFolders.folders.find((f) => f.id === "f1");
  check("folder sortOrder preserved", f1?.sortOrder === 20);
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
