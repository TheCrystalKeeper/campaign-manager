// UX round 2 unit test: masked secret rolls, folder/item normalization,
// inventory sanitization, directory redaction. Runs against real src/lib code.
import {
  createInitialState,
  createNpcSheetRecord,
  normalizeGameState,
  type GameState,
  type LogEntry,
} from "@lib/types";
import { redactStateFor } from "@lib/redact";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. Masked secret rolls
// ---------------------------------------------------------------------------
const secretRoll: LogEntry = {
  id: "log-1",
  t: 111,
  kind: "roll",
  dmOnly: true,
  label: "Goblin Boss attack",
  actor: { name: "Goblin Boss", sheetId: "sheet-gob" },
  roll: {
    id: "roll-1", rollerName: "DM", rollerId: "dm", expression: "1d20+6",
    rolls: [17], modifier: 6, total: 23, timestamp: 111,
  },
};
const secretEvent: LogEntry = { id: "log-2", t: 112, kind: "event", text: "hidden", dmOnly: true };
const publicRoll: LogEntry = {
  id: "log-3", t: 113, kind: "roll",
  actor: { name: "Vex" },
  roll: { id: "roll-2", rollerName: "Vex", rollerId: "p1", expression: "1d20", rolls: [4], modifier: 0, total: 4, timestamp: 113 },
};

const state: GameState = {
  ...createInitialState("room-x"),
  playerSlots: [{ id: "p1", name: "Vex" }],
  log: [secretRoll, secretEvent, publicRoll],
};
const normalized = normalizeGameState(state);
const playerView = redactStateFor(normalized, { role: "player", playerId: "p1" });

const maskedEntry = playerView.log.find((e) => e.id === "log-1");
check("secret roll still visible to player as an entry", !!maskedEntry && maskedEntry.kind === "roll");
if (maskedEntry && maskedEntry.kind === "roll") {
  check(
    "masked roll leaks nothing",
    maskedEntry.masked === true &&
      maskedEntry.actor.name === "DM" &&
      !("label" in maskedEntry && maskedEntry.label) &&
      maskedEntry.actor.sheetId === undefined &&
      maskedEntry.roll.expression === "?" &&
      maskedEntry.roll.rolls.length === 0 &&
      maskedEntry.roll.total === 0,
    JSON.stringify(maskedEntry),
  );
}
check("dmOnly event fully hidden from player", !playerView.log.some((e) => e.id === "log-2"));
check("public roll untouched", playerView.log.some((e) => e.id === "log-3"));
const dmView = redactStateFor(normalized, { role: "dm" });
const dmEntry = dmView.log.find((e) => e.id === "log-1");
check(
  "DM still sees full secret roll",
  dmEntry?.kind === "roll" && dmEntry.roll.total === 23 && dmEntry.label === "Goblin Boss attack",
);

// ---------------------------------------------------------------------------
// 2. Folders + items normalization
// ---------------------------------------------------------------------------
const npc = createNpcSheetRecord("sheet-a", "A");
npc.folderId = "folder-gone";
const withDirs = normalizeGameState({
  ...createInitialState("room-y"),
  folders: [
    { id: "folder-1", name: "Bandits", kind: "actor" },
    { id: "bad", name: 5, kind: "actor" },
    { id: "folder-2", name: "Loot", kind: "item" },
  ],
  sheets: { "sheet-a": npc },
  items: {
    "item-1": { id: "item-1", name: "Sword", description: "sharp", iconUrl: null, folderId: "folder-2" },
    "item-2": { id: "item-2", name: "Rope", description: "", iconUrl: null, folderId: "folder-gone" },
  },
} as unknown as GameState);
check("invalid folders dropped", withDirs.folders.length === 2);
check("orphan sheet folderId nulled", withDirs.sheets["sheet-a"]!.folderId === null);
check(
  "item folder links: valid kept, orphan nulled",
  withDirs.items["item-1"]!.folderId === "folder-2" && withDirs.items["item-2"]!.folderId === null,
);

// ---------------------------------------------------------------------------
// 3. Inventory sanitization
// ---------------------------------------------------------------------------
const messySheet = {
  ...createNpcSheetRecord("sheet-b", "B"),
  data: {
    inventory: [
      { itemId: "item-1", name: "Sword", qty: 2.7, note: "worn" },
      { name: "Bare minimum" },
      { qty: 3 },              // no name → dropped
      "garbage",
    ],
  },
};
const withInv = normalizeGameState({
  ...createInitialState("room-z"),
  sheets: { "sheet-b": messySheet },
} as unknown as GameState);
const inv = withInv.sheets["sheet-b"]!.data.inventory;
check(
  "inventory sanitized (non-objects dropped, qty floored, name/category defaulted, ids backfilled)",
  inv.length === 3 &&
    inv[0]!.qty === 2 &&
    inv[0]!.id === "inv-0" &&
    inv[1]!.name === "Bare minimum" &&
    inv[1]!.qty === 1 &&
    inv[1]!.category === "equipment" &&
    inv[2]!.name === "Item", // nameless row kept with a default name (not dropped mid-edit)
  JSON.stringify(inv),
);

// ---------------------------------------------------------------------------
// 4. Directories are DM-only
// ---------------------------------------------------------------------------
const dirsPlayerView = redactStateFor(withDirs, { role: "player", playerId: "p1" });
check(
  "players receive no folders or items",
  dirsPlayerView.folders.length === 0 && Object.keys(dirsPlayerView.items).length === 0,
);
const lobbyView = redactStateFor(withDirs, null);
check(
  "lobby receives no folders or items",
  lobbyView.folders.length === 0 && Object.keys(lobbyView.items).length === 0,
);
check("DM keeps directories", redactStateFor(withDirs, { role: "dm" }).folders.length === 2);

// ---------------------------------------------------------------------------
// 5. Token art is never a secret: NPC portraits survive redaction, and items
//    referenced by visible tokens ship as icon-only stubs.
// ---------------------------------------------------------------------------
const artNpc = createNpcSheetRecord("sheet-npc", "Goblin Boss");
artNpc.data.iconUrl = "/portraits/goblin.png";
artNpc.data.iconCrop = { x: 0.2, y: 0.8, zoom: 2 };
const artBase = normalizeGameState({
  ...createInitialState("room-art"),
  sheets: { "sheet-npc": artNpc },
  items: {
    "item-chest": {
      id: "item-chest", name: "Bag of Holding", description: "secret loot",
      iconUrl: "/tokens/chest.png", iconCrop: { x: 0.4, y: 0.6, zoom: 1.5 }, folderId: null,
    },
    "item-unplaced": {
      id: "item-unplaced", name: "Vorpal Sword", description: "",
      iconUrl: "/tokens/sword.png", iconCrop: { x: 0.5, y: 0.5, zoom: 1 }, folderId: null,
    },
  },
} as unknown as GameState);
artBase.tokens = [
  { id: "tok-npc", sceneId: artBase.activeSceneId, x: 0, y: 0, label: "???", color: "#c45c5c", kind: "enemy", sheetId: "sheet-npc" },
  { id: "tok-item", sceneId: artBase.activeSceneId, x: 1, y: 1, label: "Chest", color: "#8a7a5c", kind: "item", itemId: "item-chest" },
  { id: "tok-hidden", sceneId: artBase.activeSceneId, x: 2, y: 2, label: "?", color: "#8a7a5c", kind: "item", itemId: "item-unplaced", hidden: true },
] as unknown as GameState["tokens"];
const artState = normalizeGameState(artBase);
const artPlayerView = redactStateFor(artState, { role: "player", playerId: "p1" });
const redactedNpc = artPlayerView.sheets["sheet-npc"];
check(
  "unrevealed NPC sheet keeps portrait + crop but stays redacted",
  redactedNpc?.redacted === true &&
    redactedNpc.data.iconUrl === "/portraits/goblin.png" &&
    redactedNpc.data.iconCrop.x === 0.2 &&
    redactedNpc.data.characterName === "",
  JSON.stringify(redactedNpc?.data.iconCrop),
);
const itemStub = artPlayerView.items["item-chest"];
check(
  "item on a visible token ships as an icon-only stub",
  itemStub?.iconUrl === "/tokens/chest.png" &&
    itemStub.iconCrop.x === 0.4 &&
    itemStub.name === "" &&
    itemStub.description === "",
  JSON.stringify(itemStub),
);
check(
  "items only referenced by hidden tokens stay hidden",
  !("item-unplaced" in artPlayerView.items),
);
check(
  "DM keeps the full item record",
  redactStateFor(artState, { role: "dm" }).items["item-chest"]!.name === "Bag of Holding",
);

// ---------------------------------------------------------------------------
// 6. Concealed name/portrait: players get "???" labels and no art URLs; the DM
//    view is untouched. Sheet/item icon URLs are withheld only when EVERY
//    visible linking token is concealed.
// ---------------------------------------------------------------------------
const conNpc = createNpcSheetRecord("sheet-con", "Mind Flayer");
conNpc.data.iconUrl = "/portraits/flayer.png";
const conBase = normalizeGameState({
  ...createInitialState("room-con"),
  sheets: { "sheet-con": conNpc },
  items: {
    "item-orb": {
      id: "item-orb", name: "Orb", description: "", iconUrl: "/tokens/orb.png",
      iconCrop: { x: 0.5, y: 0.5, zoom: 1 }, folderId: null,
    },
  },
} as unknown as GameState);
conBase.tokens = [
  {
    id: "tok-con", sceneId: conBase.activeSceneId, x: 0, y: 0, label: "Mind Flayer",
    color: "#c45c5c", kind: "enemy", sheetId: "sheet-con",
    nameConcealed: true, portraitConcealed: true, imageUrl: "/portraits/flayer.png",
  },
  {
    id: "tok-orb", sceneId: conBase.activeSceneId, x: 1, y: 1, label: "Orb",
    color: "#8a7a5c", kind: "item", itemId: "item-orb", portraitConcealed: true,
  },
] as unknown as GameState["tokens"];
conBase.combat = {
  round: 1,
  turnIndex: 0,
  entries: [
    { id: "ce-1", tokenId: "tok-con", sheetId: "sheet-con", name: "Mind Flayer", initiative: 12, dexScore: 10, hasRolled: true },
  ],
};
const conState = normalizeGameState(conBase);
const conPlayer = redactStateFor(conState, { role: "player", playerId: "p1" });
const conTok = conPlayer.tokens.find((t) => t.id === "tok-con");
check(
  "concealed token: label ???, no image URL, flags kept for the ? glyph",
  conTok?.label === "???" &&
    conTok.imageUrl === null &&
    conTok.nameConcealed === true &&
    conTok.portraitConcealed === true,
  JSON.stringify(conTok),
);
check(
  "sheet portrait URL withheld when its only visible token is concealed",
  !conPlayer.sheets["sheet-con"]!.data.iconUrl,
  JSON.stringify(conPlayer.sheets["sheet-con"]!.data.iconUrl),
);
check(
  "item stub icon withheld when its only visible token is concealed",
  conPlayer.items["item-orb"]!.iconUrl === null,
);
check(
  "combat entry for a name-concealed token masks to ???",
  conPlayer.combat?.entries[0]?.name === "???",
);
const conDm = redactStateFor(conState, { role: "dm" });
check(
  "DM keeps real label, art, and combat name",
  conDm.tokens.find((t) => t.id === "tok-con")?.label === "Mind Flayer" &&
    conDm.sheets["sheet-con"]!.data.iconUrl === "/portraits/flayer.png" &&
    conDm.combat?.entries[0]?.name === "Mind Flayer",
);
// A second, unconcealed token linking the same sheet makes the art public again.
const conState2 = normalizeGameState({
  ...conState,
  tokens: [
    ...conState.tokens,
    {
      id: "tok-con2", sceneId: conState.activeSceneId, x: 3, y: 3, label: "Also Flayer",
      color: "#c45c5c", kind: "enemy", sheetId: "sheet-con",
    },
  ],
} as unknown as GameState);
const conPlayer2 = redactStateFor(conState2, { role: "player", playerId: "p1" });
check(
  "sheet portrait survives when ANY visible linking token is unconcealed",
  conPlayer2.sheets["sheet-con"]!.data.iconUrl === "/portraits/flayer.png",
);

// ---------------------------------------------------------------------------
// 7. "Show all health bars" flag: HP for a hidden NPC is normally stripped from
//    players, but the DM's global toggle keeps it so the bar can draw. A per-token
//    "bar" still reveals HP with the flag off; the DM always sees HP either way.
// ---------------------------------------------------------------------------
const hpNpc = createNpcSheetRecord("sheet-hp", "Ogre"); // all sections unrevealed → redacted
hpNpc.data.hp = { current: 20, max: 30 };
const hpRaw = createInitialState("room-hp");
hpRaw.playerSlots = [{ id: "p1", name: "Vex" }];
hpRaw.sheets["sheet-hp"] = hpNpc;
hpRaw.tokens = [
  { id: "tok-hp", sceneId: hpRaw.activeSceneId, x: 0, y: 0, label: "Ogre", color: "#c45c5c", kind: "enemy", sheetId: "sheet-hp", showHp: "none" },
] as unknown as GameState["tokens"];

const hpOff = normalizeGameState({ ...hpRaw, showAllTokenHp: false } as GameState);
const hpOn = normalizeGameState({ ...hpRaw, showAllTokenHp: true } as GameState);
check(
  "flag off + token showHp none: hidden NPC HP stripped from players",
  redactStateFor(hpOff, { role: "player", playerId: "p1" }).sheets["sheet-hp"]!.data.hp.max === 0,
);
const hpOnPV = redactStateFor(hpOn, { role: "player", playerId: "p1" }).sheets["sheet-hp"]!.data.hp;
check(
  "flag on: players receive the NPC's HP for every token",
  hpOnPV.max === 30 && hpOnPV.current === 20,
  JSON.stringify(hpOnPV),
);
const perToken = normalizeGameState({
  ...hpRaw,
  showAllTokenHp: false,
  tokens: [{ ...(hpRaw.tokens[0] as object), showHp: "bar" }],
} as unknown as GameState);
check(
  "flag off: a per-token 'bar' still reveals that token's HP",
  redactStateFor(perToken, { role: "player", playerId: "p1" }).sheets["sheet-hp"]!.data.hp.max === 30,
);
check(
  "DM always sees NPC HP regardless of the flag",
  redactStateFor(hpOff, { role: "dm" }).sheets["sheet-hp"]!.data.hp.max === 30,
);

// ---------------------------------------------------------------------------
// 8. Handouts: players receive only the ones granted to them ("all" or their
//    slot id); the lobby stub carries none; the DM keeps the full library.
//    Migration: pre-handout saves normalize to an empty library.
// ---------------------------------------------------------------------------
const handoutState = normalizeGameState({
  ...createInitialState("room-h"),
  playerSlots: [
    { id: "p1", name: "Vex" },
    { id: "p2", name: "Kit" },
  ],
  handouts: [
    { id: "h-all", name: "Town notice", imageUrl: "/tokens/a.webp", visibleTo: "all", createdAt: 1 },
    { id: "h-p1", name: "Secret letter", imageUrl: "/tokens/b.webp", visibleTo: ["p1"], createdAt: 2 },
    { id: "h-both", name: "Shared clue", imageUrl: "/tokens/d.webp", visibleTo: ["p1", "p2"], createdAt: 3 },
    { id: "h-dm", name: "Unshared map", imageUrl: "/tokens/c.webp", visibleTo: [], createdAt: 4 },
  ],
} as unknown as GameState);
const p1Handouts = redactStateFor(handoutState, { role: "player", playerId: "p1" }).handouts;
const p2Handouts = redactStateFor(handoutState, { role: "player", playerId: "p2" }).handouts;
check(
  "player p1 receives 'all' + own grants, never the unshared handout",
  p1Handouts.length === 3 &&
    p1Handouts.some((h) => h.id === "h-all") &&
    p1Handouts.some((h) => h.id === "h-p1") &&
    p1Handouts.some((h) => h.id === "h-both"),
  JSON.stringify(p1Handouts.map((h) => h.id)),
);
check(
  "player p2 never receives p1's letter",
  p2Handouts.length === 2 && !p2Handouts.some((h) => h.id === "h-p1"),
  JSON.stringify(p2Handouts.map((h) => h.id)),
);
check(
  "subset grant lists collapse to the viewer (co-recipients stay secret)",
  p1Handouts.every((h) => h.visibleTo === "all" || (h.visibleTo.length === 1 && h.visibleTo[0] === "p1")),
  JSON.stringify(p1Handouts.map((h) => h.visibleTo)),
);
check("lobby stub carries no handouts", redactStateFor(handoutState, null).handouts.length === 0);
check("DM keeps the full handout library (untouched grant lists)", (() => {
  const dmHandouts = redactStateFor(handoutState, { role: "dm" }).handouts;
  return dmHandouts.length === 4 &&
    JSON.stringify(dmHandouts.find((h) => h.id === "h-both")?.visibleTo) === JSON.stringify(["p1", "p2"]);
})());
const legacyState = { ...createInitialState("room-l") } as GameState & { handouts?: unknown };
delete legacyState.handouts;
check(
  "pre-handout save normalizes to an empty library",
  Array.isArray(normalizeGameState(legacyState as GameState).handouts) &&
    normalizeGameState(legacyState as GameState).handouts.length === 0,
);

// ---------------------------------------------------------------------------
// 9. Multi-scene viewing: a scene flagged playerVisible reaches players alongside
//    the active one (tokens included, dmOnly pins stripped); unflagged scenes and
//    their tokens stay invisible; pre-flag saves normalize to false.
// ---------------------------------------------------------------------------
const msBase = createInitialState("room-ms");
const msState = normalizeGameState({
  ...msBase,
  playerSlots: [{ id: "p1", name: "Vex" }],
  scenes: [
    ...msBase.scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            playerVisible: true,
            annotations: [
              { id: "pin-s", kind: "pin", x: 1, y: 1, text: "secret", dmOnly: true, authorId: "dm" },
            ],
          }
        : scene,
    ),
    { id: "scene-prep", name: "Prep", mapUrl: null, width: 800, height: 600 },
  ],
  tokens: [
    { id: "tok-flagged", sceneId: msBase.scenes[1].id, x: 0, y: 0, label: "Side", color: "#c45c5c", kind: "enemy" },
    { id: "tok-prep", sceneId: "scene-prep", x: 0, y: 0, label: "Prep", color: "#c45c5c", kind: "enemy" },
  ],
} as unknown as GameState);
const msView = redactStateFor(msState, { role: "player", playerId: "p1" });
check(
  "player receives active + flagged scenes, never unflagged prep",
  msView.scenes.length === 2 &&
    msView.scenes.some((s) => s.id === msState.activeSceneId) &&
    msView.scenes.some((s) => s.id === msBase.scenes[1].id) &&
    !msView.scenes.some((s) => s.id === "scene-prep"),
  JSON.stringify(msView.scenes.map((s) => s.id)),
);
check(
  "flagged scene's tokens arrive; prep tokens stay stripped; dmOnly pins stripped",
  msView.tokens.some((t) => t.id === "tok-flagged") &&
    !msView.tokens.some((t) => t.id === "tok-prep") &&
    msView.scenes.every((s) => s.annotations.every((a) => !a.dmOnly)),
  JSON.stringify(msView.tokens.map((t) => t.id)),
);
check(
  "playerVisible normalizes to false when absent (pre-flag saves unchanged)",
  normalizeGameState(createInitialState("room-old")).scenes.every(
    (s) => s.playerVisible === false,
  ),
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
