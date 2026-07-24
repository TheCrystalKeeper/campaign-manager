import {
  TOKEN_ENEMY_COLOR,
  TOKEN_PLAYER_COLOR,
  createInitialState,
  createNpcSheetRecord,
  createPcSheetRecord,
  type GameState,
  type SheetRecord,
  type Token,
} from "./types";

/**
 * Ephemeral walkthrough rooms. Room ids with this prefix get a pre-seeded sandbox
 * state, are never persisted to durable storage, bypass the room password, and are
 * never registered in the campaign registry — they evaporate when everyone leaves.
 * Shared by the lobby buttons (client) and the PartyKit server (like redact.ts).
 */
export const TUTORIAL_PREFIX = "tutorial-";

/** Which perspective the walkthrough teaches. */
export type TutorialMode = "dm" | "player";

/** The single pre-seeded player slot every tutorial room has. */
export const TUTORIAL_SLOT_ID = "hero";

export function isTutorialRoomId(roomId: string): boolean {
  return roomId.startsWith(TUTORIAL_PREFIX);
}

/** Unique per visit so concurrent tutorial users never contend for the DM seat. */
export function generateTutorialRoomId(): string {
  return `${TUTORIAL_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Aria Brightblade — the sample PC. An Eldritch Knight so the sheet's Spells page
 * has real content for the player tour. All row ids are fixed literals: a tutorial
 * room re-seeded after DO eviction must reproduce byte-identical state.
 */
function buildHeroSheet(): SheetRecord {
  const record = createPcSheetRecord(TUTORIAL_SLOT_ID, "Aria Brightblade");
  const data = record.data;
  data.playerName = "You";
  data.characterClass = "Fighter";
  data.subclass = "Eldritch Knight";
  data.classes = [
    {
      id: "tut-class-fighter",
      className: "Fighter",
      subclassName: "Eldritch Knight",
      level: 3,
      isFirstClass: true,
    },
  ];
  data.level = 3;
  data.race = "Human";
  data.background = "Soldier";
  data.creatureType = "Humanoid";
  data.alignment = "Neutral Good";
  data.size = "Medium";
  data.appearance = "A steady-eyed sellsword with a rune-etched longsword.";
  data.backstoryPersonality =
    "Aria took up the blade to protect her village, then discovered the blade could learn magic.";
  data.hp = { current: 26, max: 26 };
  data.ac = 16;
  data.speed = 30;
  data.proficiencyBonus = 2;
  data.hitDice = { current: 3, max: 3, die: "d10" };
  data.senses = "Passive Perception 13";
  data.abilityScores = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 };
  data.saveProfs = { "save-str": 1, "save-con": 1 };
  data.skillProfs = { "skill-athletics": 1, "skill-perception": 1, "skill-intimidation": 1 };
  data.languages = ["Common"];
  data.weaponProfs = ["Simple weapons", "Martial weapons"];
  data.armorProfs = ["All armor", "Shields"];
  data.currency = { cp: 0, sp: 0, ep: 0, gp: 15, pp: 0 };
  data.attacks = [
    {
      id: "tut-atk-longsword",
      name: "Longsword",
      toHit: 5,
      damage: "1d8+3",
      damageType: "slashing",
      range: "melee",
      notes: "Versatile · Action",
    },
  ];
  data.features = [
    {
      id: "tut-feat-second-wind",
      name: "Second Wind",
      source: "class",
      uses: { current: 1, max: 1 },
      recovery: "sr",
      description: "Bonus action: regain 1d10 + fighter level hit points.",
    },
    {
      id: "tut-feat-action-surge",
      name: "Action Surge",
      source: "class",
      uses: { current: 1, max: 1 },
      recovery: "sr",
      description: "Take one additional action on your turn.",
    },
  ];
  data.spells = [
    { id: "tut-spell-firebolt", name: "Fire Bolt", level: 0, time: "Action", range: "120 ft", roll: "1d10", description: "Hurl a mote of fire." },
    { id: "tut-spell-bladeward", name: "Blade Ward", level: 0, time: "Action", range: "Self", description: "Resist weapon damage until your next turn." },
    { id: "tut-spell-shield", name: "Shield", level: 1, time: "Reaction", range: "Self", description: "+5 AC until the start of your next turn." },
    { id: "tut-spell-magicmissile", name: "Magic Missile", level: 1, time: "Action", range: "120 ft", roll: "3d4+3", description: "Three darts that always hit." },
    { id: "tut-spell-burninghands", name: "Burning Hands", level: 1, time: "Action", range: "15 ft cone", roll: "3d6", description: "A cone of flame; DEX save for half." },
  ];
  data.spellSlots = { "1": { current: 2, max: 2 } };
  data.spellcasting = { abilityId: "int", attackBonus: 0, saveDc: 0, casterType: "third" };
  data.inventory = [
    {
      id: "tut-inv-longsword",
      itemId: null,
      name: "Longsword",
      qty: 1,
      note: "",
      category: "weapon",
      weight: 3,
      damage: "1d8+3",
      damageType: "slashing",
      toHit: 5,
      range: "melee",
      equipped: true,
    },
    {
      id: "tut-inv-shield",
      itemId: null,
      name: "Shield",
      qty: 1,
      note: "+2 AC",
      category: "equipment",
      weight: 6,
      equipped: true,
    },
    { id: "tut-inv-rope", itemId: null, name: "Rope (50 ft)", qty: 1, note: "", category: "equipment", weight: 10 },
    { id: "tut-inv-torch", itemId: null, name: "Torch", qty: 3, note: "", category: "equipment", weight: 1 },
    {
      id: "tut-inv-potion",
      itemId: null,
      name: "Potion of Healing",
      qty: 2,
      note: "2d4+2 HP",
      category: "consumable",
      weight: 0.5,
      price: "50 gp",
      charges: { current: 2, max: 2 },
    },
  ];
  return record;
}

function buildBarkeepSheet(): SheetRecord {
  const record = createNpcSheetRecord("tut-npc-barkeep", "Old Toby the Barkeep");
  const data = record.data;
  data.creatureType = "Humanoid";
  data.cr = "0";
  data.hp = { current: 9, max: 9 };
  data.ac = 10;
  data.speed = 30;
  data.abilityScores = { str: 10, dex: 10, con: 12, int: 11, wis: 14, cha: 13 };
  data.notes = "Knows every rumor in town. Waters down the ale.";
  return record;
}

function buildGoblinSheet(): SheetRecord {
  const record = createNpcSheetRecord("tut-npc-goblin", "Goblin Skirmisher");
  const data = record.data;
  data.creatureType = "Humanoid";
  data.cr = "1/4";
  data.hp = { current: 7, max: 7 };
  data.ac = 13;
  data.speed = 30;
  data.abilityScores = { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 };
  data.senses = "Darkvision 60 ft";
  data.attacks = [
    {
      id: "tut-atk-scimitar",
      name: "Scimitar",
      toHit: 4,
      damage: "1d6+2",
      damageType: "slashing",
      range: "melee",
    },
  ];
  return record;
}

function tutorialToken(
  id: string,
  sceneId: string,
  x: number,
  y: number,
  overrides: Partial<Token> & Pick<Token, "label" | "kind">,
): Token {
  return {
    id,
    sceneId,
    x,
    y,
    color: overrides.kind === "player" ? TOKEN_PLAYER_COLOR : TOKEN_ENEMY_COLOR,
    imageUrl: null,
    ownerPlayerId: null,
    sheetId: null,
    conditions: [],
    showHp: "none",
    ...overrides,
  };
}

/**
 * The complete sandbox: both default scenes (Tavern active, Dungeon peekable),
 * one open player slot with a filled-in PC, two NPC statblocks, tokens on both
 * maps, and two handouts. Player-facing permissive flags are on so the player
 * tour can demonstrate drawing and the Stats page.
 */
export function buildTutorialState(roomId: string): GameState {
  const state = createInitialState(roomId);
  state.activeSceneId = "scene-2";
  state.scenes = state.scenes.map((scene) =>
    scene.id === "scene-1" ? { ...scene, playerVisible: true } : scene,
  );
  state.playerSlots = [{ id: TUTORIAL_SLOT_ID, name: "Aria Brightblade" }];
  const hero = buildHeroSheet();
  const barkeep = buildBarkeepSheet();
  const goblin = buildGoblinSheet();
  state.sheets = { [hero.id]: hero, [barkeep.id]: barkeep, [goblin.id]: goblin };
  state.tokens = [
    tutorialToken("tut-token-hero", "scene-2", 275, 325, {
      label: "Aria Brightblade",
      kind: "player",
      ownerPlayerId: TUTORIAL_SLOT_ID,
      vision: { enabled: true, rangeFt: 60 },
    }),
    tutorialToken("tut-token-barkeep", "scene-2", 525, 275, {
      label: "Old Toby the Barkeep",
      kind: "enemy",
      sheetId: "tut-npc-barkeep",
    }),
    tutorialToken("tut-token-hero-dungeon", "scene-1", 175, 425, {
      label: "Aria Brightblade",
      kind: "player",
      ownerPlayerId: TUTORIAL_SLOT_ID,
      vision: { enabled: true, rangeFt: 60 },
    }),
    tutorialToken("tut-token-goblin-1", "scene-1", 475, 275, {
      label: "Goblin Skirmisher",
      kind: "enemy",
      sheetId: "tut-npc-goblin",
    }),
    tutorialToken("tut-token-goblin-2", "scene-1", 575, 325, {
      label: "Goblin Skirmisher",
      kind: "enemy",
      sheetId: "tut-npc-goblin",
    }),
  ];
  state.handouts = [
    {
      id: "tut-handout-map",
      name: "Tattered dungeon map",
      imageUrl: "/maps/sample-dungeon.svg",
      visibleTo: "all",
      createdAt: Date.now(),
    },
    {
      id: "tut-handout-ledger",
      name: "Barkeep's ledger",
      imageUrl: "/maps/sample-tavern.svg",
      visibleTo: [],
      createdAt: Date.now(),
    },
  ];
  state.playersCanSeeStats = true;
  state.playersCanDraw = true;
  state.log = [
    {
      id: "tut-log-welcome",
      t: Date.now(),
      kind: "event",
      text: "Welcome to the tutorial table. Nothing here is saved.",
    },
  ];
  return state;
}
