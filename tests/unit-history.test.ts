// Undo/redo unit test: the command/inverse builder for scene edits + token ops.
// Runs against real src/lib code via esbuild (see tests/README.md).
import {
  createInitialState,
  normalizeGameState,
  normalizeToken,
  type ClientMessage,
  type GameState,
  type Token,
} from "@lib/types";
import { buildInverse } from "@lib/history";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const mkToken = (id: string, x: number, y: number): Token =>
  normalizeToken({
    id, sceneId: "scene-1", x, y, label: id, color: "#fff", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
  } as Token);

const state: GameState = normalizeGameState({
  ...createInitialState("room-h"),
  tokens: [mkToken("t1", 10, 20)],
} as GameState);
const sceneId = state.scenes[0].id;

// ---------------------------------------------------------------------------
// 1. Scene edits all invert to UPDATE_SCENE(preScene); redo = original message.
// ---------------------------------------------------------------------------
{
  const msg: ClientMessage = {
    type: "FOG_REVEAL",
    sceneId,
    shape: { kind: "circle", x: 1, y: 1, r: 5 },
  };
  const inv = buildInverse(state, msg);
  check(
    "scene edit → UPDATE_SCENE(preScene) undo",
    inv?.undo.type === "UPDATE_SCENE" &&
      inv.undo.scene.id === sceneId &&
      inv.redo === msg,
  );
  const wallsMsg: ClientMessage = { type: "SET_WALLS", sceneId, walls: [] };
  const wInv = buildInverse(state, wallsMsg);
  check(
    "SET_WALLS also inverts to UPDATE_SCENE",
    wInv?.undo.type === "UPDATE_SCENE" && wInv.redo === wallsMsg,
  );
  check(
    "scene edit for a missing scene → null",
    buildInverse(state, { type: "FOG_RESET", sceneId: "nope" }) === null,
  );
}

// ---------------------------------------------------------------------------
// 2. Token ops invert per kind.
// ---------------------------------------------------------------------------
{
  const added = mkToken("t2", 0, 0);
  const addInv = buildInverse(state, { type: "ADD_TOKEN", token: added });
  check(
    "ADD_TOKEN → REMOVE_TOKEN(id)",
    addInv?.undo.type === "REMOVE_TOKEN" &&
      (addInv.undo as Extract<ClientMessage, { type: "REMOVE_TOKEN" }>).tokenId === "t2",
  );

  const rmInv = buildInverse(state, { type: "REMOVE_TOKEN", tokenId: "t1" });
  check(
    "REMOVE_TOKEN → ADD_TOKEN(preToken)",
    rmInv?.undo.type === "ADD_TOKEN" &&
      (rmInv.undo as Extract<ClientMessage, { type: "ADD_TOKEN" }>).token.id === "t1" &&
      (rmInv.undo as Extract<ClientMessage, { type: "ADD_TOKEN" }>).token.x === 10,
  );
  check(
    "REMOVE_TOKEN for a missing token → null",
    buildInverse(state, { type: "REMOVE_TOKEN", tokenId: "gone" }) === null,
  );

  const moveInv = buildInverse(state, { type: "MOVE_TOKEN", tokenId: "t1", x: 99, y: 88 });
  check(
    "MOVE_TOKEN → UPDATE_TOKEN(preToken at old position)",
    moveInv?.undo.type === "UPDATE_TOKEN" &&
      (moveInv.undo as Extract<ClientMessage, { type: "UPDATE_TOKEN" }>).token.x === 10 &&
      (moveInv.undo as Extract<ClientMessage, { type: "UPDATE_TOKEN" }>).token.y === 20,
  );

  const upInv = buildInverse(state, {
    type: "UPDATE_TOKEN",
    token: { ...state.tokens[0], label: "renamed" },
  });
  check(
    "UPDATE_TOKEN → UPDATE_TOKEN(preToken)",
    upInv?.undo.type === "UPDATE_TOKEN" &&
      (upInv.undo as Extract<ClientMessage, { type: "UPDATE_TOKEN" }>).token.label === "t1",
  );
}

// ---------------------------------------------------------------------------
// 3. Untracked messages produce no history entry.
// ---------------------------------------------------------------------------
{
  check("SET_SCENE not recorded", buildInverse(state, { type: "SET_SCENE", sceneId }) === null);
  check("ROLL_DICE not recorded", buildInverse(state, { type: "ROLL_DICE", expression: "1d20" }) === null);
  check("COMBAT_NEXT not recorded", buildInverse(state, { type: "COMBAT_NEXT" }) === null);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) {
  process.exit(1);
}
