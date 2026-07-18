// Assets page logic: findAssetUsage records where each stored image is used, and assetSection
// groups usage-first by what the image *depicts* — a character's portrait and that same
// character's map token both land under "characters" instead of split across portraits/tokens.
// Real src/lib code.
import { createInitialState, normalizeGameState, type GameState } from "@lib/types";
import { assetSection, findAssetUsage } from "@lib/assetUsage";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const MAP = "/maps/room--scene.webp";
const BACKDROP = "/tokens/room--asset-bd.webp";
const PC_PORTRAIT = "/portraits/room--slot-1.webp";
const NPC_PORTRAIT = "/portraits/room--npc-1.webp";
const ITEM_ICON = "/tokens/room--item-1.webp";
const PLAYER_TOKEN = "/tokens/room--asset-ptok.webp"; // standalone player token art
const ENEMY_TOKEN = "/tokens/room--asset-etok.webp"; // standalone enemy token art
const ITEM_TOKEN = "/tokens/room--asset-itok.webp"; // standalone item token art
const HANDOUT = "/tokens/room--asset-letter.gif";
const DUAL = "/tokens/room--asset-dual.webp"; // used as both a player token AND a handout
const ICON = "/icons/room--campaign.webp";
const ORPHAN = "/tokens/room--asset-orphan.webp";

const base = createInitialState("room-assets");
const sceneId = base.scenes[0]!.id;
const state = normalizeGameState({
  ...base,
  playerSlots: [{ id: "slot-1", name: "Aria" }],
  // A sheet keyed by a slot id normalizes to a PC; any other id is an NPC.
  sheets: {
    "slot-1": { id: "slot-1", data: { characterName: "Aria", iconUrl: PC_PORTRAIT } },
    "npc-1": { id: "npc-1", data: { characterName: "Goblin Boss", iconUrl: NPC_PORTRAIT } },
  },
  items: {
    "item-1": { id: "item-1", name: "Longsword", iconUrl: ITEM_ICON },
  },
  scenes: [{ ...base.scenes[0]!, mapUrl: MAP, boardBgImageUrl: BACKDROP }],
  tokens: [
    { id: "t-enemy", sceneId, x: 0, y: 0, label: "Goblin", color: "#c45c5c", kind: "enemy", imageUrl: ENEMY_TOKEN },
    { id: "t-player", sceneId, x: 0, y: 0, label: "Wolf", color: "#5c8cc4", kind: "player", ownerPlayerId: null, sheetId: null, imageUrl: PLAYER_TOKEN },
    { id: "t-item", sceneId, x: 0, y: 0, label: "Chest", color: "#c4a35c", kind: "item", itemId: null, imageUrl: ITEM_TOKEN },
    // Mirrors the PC sheet's portrait — must NOT double-count as its own reference.
    { id: "t-mirror", sceneId, x: 0, y: 0, label: "Aria", color: "#5c8cc4", kind: "player", ownerPlayerId: "slot-1", imageUrl: PC_PORTRAIT },
    { id: "t-dual", sceneId, x: 0, y: 0, label: "Battle pic", color: "#5c8cc4", kind: "player", ownerPlayerId: null, sheetId: null, imageUrl: DUAL },
  ],
  handouts: [
    { id: "h1", name: "Sealed letter", imageUrl: HANDOUT, visibleTo: "all", createdAt: 1 },
    { id: "h2", name: "Battle map pic", imageUrl: DUAL, visibleTo: "all", createdAt: 2 },
  ],
} as unknown as GameState);

// --- findAssetUsage: kind (delete-warning label) + group (section) --------------------------
const bd = findAssetUsage(state, BACKDROP);
check(
  "backdrop image detected as used (kind 'backdrop', group 'maps')",
  bd.length === 1 && bd[0]!.kind === "backdrop" && bd[0]!.id === sceneId && bd[0]!.group === "maps",
  JSON.stringify(bd),
);
const map = findAssetUsage(state, MAP);
check(
  "scene map detected as 'scene' → group 'maps'",
  map.length === 1 && map[0]!.kind === "scene" && map[0]!.group === "maps",
);
const pc = findAssetUsage(state, PC_PORTRAIT);
check(
  "PC portrait detected once (mirror token not double-counted) → group 'characters'",
  pc.length === 1 && pc[0]!.kind === "sheet" && pc[0]!.group === "characters",
  JSON.stringify(pc),
);
const npc = findAssetUsage(state, NPC_PORTRAIT);
check(
  "NPC portrait → group 'npcs'",
  npc.length === 1 && npc[0]!.kind === "sheet" && npc[0]!.group === "npcs",
);
const item = findAssetUsage(state, ITEM_ICON);
check(
  "item icon → group 'items'",
  item.length === 1 && item[0]!.kind === "item" && item[0]!.group === "items",
);
const ptok = findAssetUsage(state, PLAYER_TOKEN);
check(
  "standalone player token art → kind 'token', group 'characters'",
  ptok.length === 1 && ptok[0]!.kind === "token" && ptok[0]!.group === "characters",
  JSON.stringify(ptok),
);
const etok = findAssetUsage(state, ENEMY_TOKEN);
check(
  "standalone enemy token art → group 'npcs'",
  etok.length === 1 && etok[0]!.kind === "token" && etok[0]!.group === "npcs",
);
const itok = findAssetUsage(state, ITEM_TOKEN);
check(
  "standalone item token art → group 'items'",
  itok.length === 1 && itok[0]!.kind === "token" && itok[0]!.group === "items",
);
const hand = findAssetUsage(state, HANDOUT);
check(
  "handout image → kind 'handout' (labeled by name), group 'handouts'",
  hand.length === 1 && hand[0]!.kind === "handout" && hand[0]!.label === "Sealed letter" && hand[0]!.group === "handouts",
  JSON.stringify(hand),
);
check("an unreferenced URL has no usage", findAssetUsage(state, ORPHAN).length === 0);
const iconUse = findAssetUsage(state, ICON, ICON);
check(
  "campaign icon → kind 'campaign-icon', group 'icons'",
  iconUse.length === 1 && iconUse[0]!.kind === "campaign-icon" && iconUse[0]!.group === "icons",
);

// --- assetSection: entity-based, usage-first grouping ---------------------------------------
check("unused image → 'unused' section", assetSection([]) === "unused");
check("scene backdrop → 'maps'", assetSection(findAssetUsage(state, BACKDROP)) === "maps");
check("scene map → 'maps'", assetSection(findAssetUsage(state, MAP)) === "maps");
check("PC portrait → 'characters'", assetSection(findAssetUsage(state, PC_PORTRAIT)) === "characters");
check("player token art → 'characters'", assetSection(findAssetUsage(state, PLAYER_TOKEN)) === "characters");
check("NPC portrait → 'npcs'", assetSection(findAssetUsage(state, NPC_PORTRAIT)) === "npcs");
check("enemy token art → 'npcs'", assetSection(findAssetUsage(state, ENEMY_TOKEN)) === "npcs");
check("item icon → 'items'", assetSection(findAssetUsage(state, ITEM_ICON)) === "items");
check("item token art → 'items'", assetSection(findAssetUsage(state, ITEM_TOKEN)) === "items");
check("handout-only image → 'handouts'", assetSection(findAssetUsage(state, HANDOUT)) === "handouts");
check("campaign icon → 'icons'", assetSection(findAssetUsage(state, ICON, ICON)) === "icons");
check(
  "image used as a token AND a handout → 'characters' (real art wins over handout)",
  assetSection(findAssetUsage(state, DUAL)) === "characters",
  JSON.stringify(findAssetUsage(state, DUAL)),
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
