// Live-name test: `syncCombatNames` re-derives initiative-tracker names from the current
// token/sheet so a mid-combat rename propagates, and the healing stays server-side so a
// client re-normalizing a redacted frame can never unmask a "???" combatant.
// Runs against real src/lib code (bundle with esbuild, see tests/README.md).
import {
  createInitialState,
  createNpcSheetRecord,
  createPcSheetRecord,
  normalizeGameState,
  syncCombatNames,
  type CombatState,
  type GameState,
} from "@lib/types";
import { redactStateFor } from "@lib/redact";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// broadcastState's sequence: heal derived state, then re-derive combat names off the result.
function broadcast(raw: GameState): GameState {
  const state = normalizeGameState(raw);
  state.combat = syncCombatNames(state.combat, state.tokens, state.sheets);
  return state;
}

const scene = createInitialState("room-seq").activeSceneId;

// ---------------------------------------------------------------------------
// 1. Player renames via their character sheet mid-combat → entry follows.
// ---------------------------------------------------------------------------
const playerState = broadcast({
  ...createInitialState("room-pc"),
  playerSlots: [{ id: "p1", name: "Player 1" }],
  sheets: { p1: createPcSheetRecord("p1", "Aragorn") },
  tokens: [
    { id: "tok-p1", sceneId: scene, x: 0, y: 0, label: "Player 1", color: "#6ea8fe", kind: "player", ownerPlayerId: "p1" },
  ],
  combat: {
    round: 1,
    turnIndex: 0,
    entries: [{ id: "ce-p1", tokenId: "tok-p1", sheetId: "p1", name: "Player 1", initiative: 15, dexScore: 12, hasRolled: true }],
  },
} as unknown as GameState);
check(
  "player token label heals to characterName (normalize)",
  playerState.tokens.find((t) => t.id === "tok-p1")?.label === "Aragorn",
);
check(
  "combat entry follows the sheet rename via its token",
  playerState.combat?.entries[0]?.name === "Aragorn",
  JSON.stringify(playerState.combat?.entries[0]?.name),
);

// ---------------------------------------------------------------------------
// 2. NPC/monster renamed via its sheet → entry follows through the token.
// ---------------------------------------------------------------------------
const npcRecord = createNpcSheetRecord("sheet-npc", "Bandit Captain");
const npcState = broadcast({
  ...createInitialState("room-npc"),
  sheets: { "sheet-npc": npcRecord },
  tokens: [
    { id: "tok-npc", sceneId: scene, x: 1, y: 1, label: "Goblin", color: "#c45c5c", kind: "enemy", sheetId: "sheet-npc" },
  ],
  combat: {
    round: 1,
    turnIndex: 0,
    entries: [{ id: "ce-npc", tokenId: "tok-npc", sheetId: "sheet-npc", name: "Goblin", initiative: 9, dexScore: 10, hasRolled: true }],
  },
} as unknown as GameState);
check(
  "NPC combat entry heals to the linked sheet's characterName",
  npcState.combat?.entries[0]?.name === "Bandit Captain",
  JSON.stringify(npcState.combat?.entries[0]?.name),
);

// ---------------------------------------------------------------------------
// 3. Direct label edit on an unlinked monster token → entry follows the label.
// ---------------------------------------------------------------------------
const unlinkedState = broadcast({
  ...createInitialState("room-unlinked"),
  tokens: [
    { id: "tok-boss", sceneId: scene, x: 2, y: 2, label: "The Big Bad", color: "#c45c5c", kind: "enemy" },
  ],
  combat: {
    round: 1,
    turnIndex: 0,
    entries: [{ id: "ce-boss", tokenId: "tok-boss", sheetId: null, name: "Skeleton", initiative: 7, dexScore: 8, hasRolled: true }],
  },
} as unknown as GameState);
check(
  "unlinked token entry heals to the edited token label",
  unlinkedState.combat?.entries[0]?.name === "The Big Bad",
  JSON.stringify(unlinkedState.combat?.entries[0]?.name),
);

// ---------------------------------------------------------------------------
// 4. Token removed mid-combat → fall back to the linked sheet's name.
// ---------------------------------------------------------------------------
const gone = syncCombatNames(
  {
    round: 1,
    turnIndex: 0,
    entries: [{ id: "ce-gone", tokenId: "tok-missing", sheetId: "sheet-lich", name: "Old Lich Name", initiative: 20, dexScore: 14, hasRolled: true }],
  },
  [], // token no longer on the board
  { "sheet-lich": createNpcSheetRecord("sheet-lich", "Acererak") },
);
check(
  "entry with a removed token falls back to its sheet name",
  gone?.entries[0]?.name === "Acererak",
  JSON.stringify(gone?.entries[0]?.name),
);

// ---------------------------------------------------------------------------
// 5. No live source left → keep the stored name; null combat stays null.
// ---------------------------------------------------------------------------
const orphan = syncCombatNames(
  {
    round: 1,
    turnIndex: 0,
    entries: [{ id: "ce-ghost", tokenId: null, sheetId: null, name: "Nameless Ghost", initiative: 3, dexScore: 6, hasRolled: true }],
  },
  [],
  {},
);
check("orphan entry keeps its stored name", orphan?.entries[0]?.name === "Nameless Ghost");
check("null combat stays null", syncCombatNames(null, [], {}) === null);

// Idempotent: an already-synced entry returns byref-equal (no needless rewrites/broadcasts).
const already: CombatState = {
  round: 1,
  turnIndex: 0,
  entries: [{ id: "ce-x", tokenId: "tok-boss", sheetId: null, name: "The Big Bad", initiative: 7, dexScore: 8, hasRolled: true }],
};
const resynced = syncCombatNames(already, unlinkedState.tokens, unlinkedState.sheets);
check("already-current entry is returned unchanged (byref)", resynced?.entries[0] === already.entries[0]);

// ---------------------------------------------------------------------------
// 6. Redaction ordering: server heals full truth, then per-client redaction masks a
//    name-concealed combatant to "???". Crucially, a client re-normalizing the redacted
//    frame must NOT resurface the real name — the healing is server-only, so normalizeCombat
//    (client path) leaves the mask intact.
// ---------------------------------------------------------------------------
const concealNpc = createNpcSheetRecord("sheet-con", "Mind Flayer");
const truth = broadcast({
  ...createInitialState("room-con"),
  playerSlots: [{ id: "p1", name: "Vex" }],
  sheets: { "sheet-con": concealNpc },
  tokens: [
    { id: "tok-con", sceneId: scene, x: 0, y: 0, label: "Mind Flayer", color: "#c45c5c", kind: "enemy", sheetId: "sheet-con", nameConcealed: true },
  ],
  combat: {
    round: 1,
    turnIndex: 0,
    entries: [{ id: "ce-con", tokenId: "tok-con", sheetId: "sheet-con", name: "Illithid", initiative: 12, dexScore: 15, hasRolled: true }],
  },
} as unknown as GameState);
check(
  "DM sees the healed real name",
  redactStateFor(truth, { role: "dm" }).combat?.entries[0]?.name === "Mind Flayer",
);
const playerFrame = redactStateFor(truth, { role: "player", playerId: "p1" });
check("player sees the concealed entry masked", playerFrame.combat?.entries[0]?.name === "???");
// The client re-normalizes every incoming frame; the mask must survive it.
check(
  "client re-normalize of the redacted frame keeps the mask (no unmask)",
  normalizeGameState(playerFrame as GameState).combat?.entries[0]?.name === "???",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
