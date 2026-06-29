import type { CampaignManifest } from "./campaignManifest";
import type { MapAnnotation } from "./mapAnnotation";
import { normalizeMapAnnotation } from "./mapAnnotation";

export type { MapAnnotation } from "./mapAnnotation";
export { ANNOTATION_DURATION_MS, normalizeMapAnnotation } from "./mapAnnotation";

export type Role = "dm" | "player";

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type MapLayer = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
};

export type Scene = {
  id: string;
  name: string;
  layers: MapLayer[];
  width: number;
  height: number;
  /** World-space reference center; independent of map image placement. */
  centerX: number;
  centerY: number;
  /** Grid units players may pan from center per axis; 0 = unlimited. */
  playerPanLimit: number;
  gridSize: number;
  showGrid: boolean;
  fogEnabled: boolean;
  fogDataUrl: string | null;
  defaultViewport: Viewport;
  backgroundColor: string;
};

export type TokenKind = "player" | "enemy";

export type Token = {
  id: string;
  sceneId: string;
  x: number;
  y: number;
  label: string;
  color: string;
  kind: TokenKind;
  imageUrl: string | null;
  ownerPlayerId: string | null;
};

export type CharacterSheet = {
  characterName: string;
  playerName: string;
  characterClass: string;
  subclass: string;
  level: number;
  xp: number;
  race: string;
  alignment: string;
  size: string;
  age: string;
  height: string;
  weight: string;
  eyes: string;
  skin: string;
  hair: string;
  backstoryPersonality: string;
  notes: string;
  iconUrl: string | null;
};

type LegacyCharacterSheet = Partial<CharacterSheet> & {
  name?: string;
  species?: string;
  campaign?: string;
  background?: string;
  deityPatron?: string;
  pronouns?: string;
  portraitUrl?: string | null;
  backstory?: string;
  personalityTraits?: string;
  ideals?: string;
  bonds?: string;
  flaws?: string;
  allies?: string;
  treasureGoals?: string;
  hp?: { current: number; max: number };
  ac?: number;
};

export type PlayerSlot = {
  id: string;
  name: string;
  visibleSceneIds: string[];
};

export type ConnectedPlayer = {
  clientId: string;
  playerId: string;
  displayName: string;
};

export type DiceRoll = {
  id: string;
  rollerName: string;
  rollerId: string;
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
  timestamp: number;
};

export type GameState = {
  roomId: string;
  dmClientId: string | null;
  activeSceneId: string;
  scenes: Scene[];
  tokens: Token[];
  viewport: Viewport;
  playerSlots: PlayerSlot[];
  characterSheets: Record<string, CharacterSheet>;
  connectedPlayers: ConnectedPlayer[];
  ping: { x: number; y: number; sceneId: string } | null;
  annotations: MapAnnotation[];
  publicDiceLog: DiceRoll[];
};

export type JoinMessage =
  | { type: "JOIN"; role: "dm"; displayName: string; roomKey: string }
  | { type: "JOIN"; role: "player"; slotId: string; roomKey: string };

export type ClientMessage =
  | JoinMessage
  | { type: "UPDATE_VIEWPORT"; viewport: Viewport }
  | { type: "SET_SCENE"; sceneId: string }
  | { type: "ADD_SCENE"; scene: Scene }
  | { type: "UPDATE_SCENE"; scene: Scene }
  | { type: "REMOVE_SCENE"; sceneId: string }
  | { type: "ADD_TOKEN"; token: Token }
  | { type: "MOVE_TOKEN"; tokenId: string; x: number; y: number }
  | { type: "UPDATE_TOKEN"; token: Token }
  | { type: "REMOVE_TOKEN"; tokenId: string }
  | { type: "UPDATE_MY_SHEET"; sheet: CharacterSheet }
  | { type: "SET_PING"; x: number; y: number }
  | { type: "CLEAR_PING" }
  | {
      type: "ADD_ANNOTATION";
      sceneId: string;
      points: number[];
      color: string;
    }
  | { type: "UPDATE_FOG"; sceneId: string; fogDataUrl: string }
  | { type: "IMPORT_CAMPAIGN"; manifest: CampaignManifest }
  | { type: "ADD_PLAYER_SLOT"; name: string }
  | { type: "UPDATE_PLAYER_SLOT"; slot: PlayerSlot }
  | { type: "REMOVE_PLAYER_SLOT"; slotId: string }
  | { type: "ROLL_DICE"; expression: string; private?: boolean };

export type ServerMessage =
  | { type: "STATE"; state: GameState; yourClientId: string; yourRole: Role | null }
  | { type: "ERROR"; message: string }
  | { type: "JOINED"; role: Role; playerId: string }
  | { type: "DM_DICE_ROLL"; roll: DiceRoll };

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export const DEFAULT_SCENE_BACKGROUND = "#0d0f14";

export const SCENE_BACKGROUND_PRESETS = [
  { label: "Dark", value: "#0d0f14" },
  { label: "Stone", value: "#1c1a18" },
  { label: "Parchment", value: "#2a2418" },
  { label: "Forest", value: "#0f1a14" },
  { label: "Ocean", value: "#0a1628" },
  { label: "Night", value: "#14101a" },
] as const;

export const TOKEN_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#ecf0f1",
];

export const TOKEN_PLAYER_COLOR = "#c9a227";
export const TOKEN_ENEMY_COLOR = "#c45c5c";

/// <summary>
/// Returns a distinct token color for a player slot.
/// </summary>
export function playerTokenColorForSlot(slotId: string, slots: PlayerSlot[]): string {
  const index = slots.findIndex((slot) => slot.id === slotId);
  const safeIndex = index < 0 ? 0 : index;
  return TOKEN_COLORS[safeIndex % TOKEN_COLORS.length] ?? TOKEN_PLAYER_COLOR;
}

/// <summary>
/// Syncs a player-owned token label, portrait, and color from slot and sheet data.
/// </summary>
export function syncPlayerTokenFromState(token: Token, state: GameState): Token {
  const normalized = normalizeToken(token);
  if (normalized.kind !== "player" || !normalized.ownerPlayerId) {
    return normalized;
  }

  const slot = state.playerSlots.find((item) => item.id === normalized.ownerPlayerId);
  const sheet = state.characterSheets[normalized.ownerPlayerId];
  return {
    ...normalized,
    color: playerTokenColorForSlot(normalized.ownerPlayerId, state.playerSlots),
    label: sheet?.characterName?.trim() || slot?.name || normalized.label,
    imageUrl: sheet?.iconUrl ?? normalized.imageUrl,
  };
}

/// <summary>
/// Ensures tokens include kind and image fields from older persisted rooms.
/// </summary>
export function normalizeToken(token: Token): Token {
  const kind = token.kind ?? (token.ownerPlayerId ? "player" : "enemy");
  return {
    ...token,
    kind,
    imageUrl: token.imageUrl ?? null,
    color: token.color || (kind === "enemy" ? TOKEN_ENEMY_COLOR : TOKEN_PLAYER_COLOR),
  };
}

export function createDefaultSheet(name: string): CharacterSheet {
  return {
    characterName: name,
    playerName: "",
    characterClass: "",
    subclass: "",
    level: 1,
    xp: 0,
    race: "",
    alignment: "",
    size: "",
    age: "",
    height: "",
    weight: "",
    eyes: "",
    skin: "",
    hair: "",
    backstoryPersonality: "",
    notes: "",
    iconUrl: null,
  };
}

/// <summary>
/// Combines older multi-field story sections into the current backstory field.
/// </summary>
function mergeLegacyStoryFields(sheet: LegacyCharacterSheet): string {
  return [
    sheet.backstoryPersonality,
    sheet.backstory,
    sheet.personalityTraits,
    sheet.ideals,
    sheet.bonds,
    sheet.flaws,
    sheet.allies,
    sheet.treasureGoals,
    sheet.background,
    sheet.deityPatron,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

/// <summary>
/// Returns whether two character sheets have the same field values.
/// </summary>
export function characterSheetsEqual(a: CharacterSheet, b: CharacterSheet): boolean {
  return (
    a.characterName === b.characterName &&
    a.playerName === b.playerName &&
    a.characterClass === b.characterClass &&
    a.subclass === b.subclass &&
    a.level === b.level &&
    a.xp === b.xp &&
    a.race === b.race &&
    a.alignment === b.alignment &&
    a.size === b.size &&
    a.age === b.age &&
    a.height === b.height &&
    a.weight === b.weight &&
    a.eyes === b.eyes &&
    a.skin === b.skin &&
    a.hair === b.hair &&
    a.backstoryPersonality === b.backstoryPersonality &&
    a.notes === b.notes &&
    a.iconUrl === b.iconUrl
  );
}

/// <summary>
/// Merges legacy and partial character sheets into the current schema.
/// </summary>
export function normalizeCharacterSheet(
  sheet: LegacyCharacterSheet | undefined,
  fallbackName: string,
): CharacterSheet {
  const defaults = createDefaultSheet(fallbackName);
  if (!sheet) {
    return defaults;
  }

  const legacyName = sheet.name ?? sheet.characterName;
  const legacyStory = mergeLegacyStoryFields(sheet);

  return {
    characterName: sheet.characterName ?? legacyName?.trim() ?? defaults.characterName,
    playerName: sheet.playerName ?? defaults.playerName,
    characterClass: sheet.characterClass ?? defaults.characterClass,
    subclass: sheet.subclass ?? defaults.subclass,
    level: typeof sheet.level === "number" && sheet.level > 0 ? sheet.level : defaults.level,
    xp: typeof sheet.xp === "number" && sheet.xp >= 0 ? sheet.xp : defaults.xp,
    race: sheet.race ?? sheet.species?.trim() ?? defaults.race,
    alignment: sheet.alignment ?? defaults.alignment,
    size: sheet.size ?? defaults.size,
    age: sheet.age ?? defaults.age,
    height: sheet.height ?? defaults.height,
    weight: sheet.weight ?? defaults.weight,
    eyes: sheet.eyes ?? defaults.eyes,
    skin: sheet.skin ?? defaults.skin,
    hair: sheet.hair ?? defaults.hair,
    backstoryPersonality:
      sheet.backstoryPersonality ?? (legacyStory || defaults.backstoryPersonality),
    notes: sheet.notes ?? defaults.notes,
    iconUrl: sheet.iconUrl ?? sheet.portraitUrl ?? null,
  };
}

/// <summary>
/// Creates a new player slot with a stable id for joining and character sheets.
/// </summary>
export function createPlayerSlot(name: string, sceneIds: string[]): PlayerSlot {
  return {
    id: `slot-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim() || "Player",
    visibleSceneIds: [...sceneIds],
  };
}

/// <summary>
/// Ensures a player slot has scene visibility defaults for older persisted rooms.
/// </summary>
export function normalizePlayerSlot(
  slot: PlayerSlot & { visibleSceneIds?: string[] },
  sceneIds: string[],
): PlayerSlot {
  const visible = slot.visibleSceneIds ?? sceneIds;
  return {
    ...slot,
    visibleSceneIds: visible.filter((id) => sceneIds.includes(id)),
  };
}

/// <summary>
/// Returns whether a player slot is allowed to view a scene.
/// </summary>
export function canPlayerSeeScene(slot: PlayerSlot, sceneId: string): boolean {
  return slot.visibleSceneIds.includes(sceneId);
}

/// <summary>
/// Returns scenes a player slot is allowed to view.
/// </summary>
export function getVisibleScenesForPlayer(state: GameState, slotId: string): Scene[] {
  const slot = state.playerSlots.find((item) => item.id === slotId);
  if (!slot) {
    return [];
  }
  return state.scenes.filter((scene) => canPlayerSeeScene(slot, scene.id));
}

/// <summary>
/// Picks a valid player viewing scene, preserving their choice when still allowed.
/// </summary>
export function resolvePlayerViewingSceneId(
  state: GameState,
  slotId: string,
  current: string | null,
): string | null {
  const visibleScenes = getVisibleScenesForPlayer(state, slotId);
  if (visibleScenes.length === 0) {
    return null;
  }
  if (current && visibleScenes.some((scene) => scene.id === current)) {
    return current;
  }
  if (visibleScenes.some((scene) => scene.id === state.activeSceneId)) {
    return state.activeSceneId;
  }
  return visibleScenes[0].id;
}

/// <summary>
/// Ensures game state includes the playerSlots array from older persisted rooms.
/// </summary>
export function normalizeGameState(state: GameState): GameState {
  const sceneIds = state.scenes.map((scene) => scene.id);
  const playerSlots = (state.playerSlots ?? []).map((slot) => normalizePlayerSlot(slot, sceneIds));
  const characterSheets: Record<string, CharacterSheet> = {};
  for (const slot of playerSlots) {
    characterSheets[slot.id] = normalizeCharacterSheet(state.characterSheets?.[slot.id], slot.name);
  }
  return {
    ...state,
    playerSlots,
    characterSheets,
    tokens: (state.tokens ?? []).map((token) =>
      syncPlayerTokenFromState(token, { ...state, playerSlots, characterSheets }),
    ),
    annotations: (state.annotations ?? []).map((annotation) => normalizeMapAnnotation(annotation)),
    publicDiceLog: state.publicDiceLog ?? [],
  };
}

export function createDefaultScenes(): Scene[] {
  return [
    {
      id: "scene-1",
      name: "Dungeon",
      layers: [
        {
          id: "scene-1-layer-1",
          url: "/maps/sample-dungeon.svg",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          label: "Dungeon",
        },
      ],
      width: 800,
      height: 600,
      centerX: 400,
      centerY: 300,
      playerPanLimit: 0,
      gridSize: 50,
      showGrid: true,
      fogEnabled: true,
      fogDataUrl: null,
      defaultViewport: { ...DEFAULT_VIEWPORT },
      backgroundColor: DEFAULT_SCENE_BACKGROUND,
    },
    {
      id: "scene-2",
      name: "Tavern",
      layers: [
        {
          id: "scene-2-layer-1",
          url: "/maps/sample-tavern.svg",
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          label: "Tavern",
        },
      ],
      width: 800,
      height: 600,
      centerX: 400,
      centerY: 300,
      playerPanLimit: 0,
      gridSize: 50,
      showGrid: true,
      fogEnabled: true,
      fogDataUrl: null,
      defaultViewport: { ...DEFAULT_VIEWPORT },
      backgroundColor: DEFAULT_SCENE_BACKGROUND,
    },
  ];
}

export function createInitialState(roomId: string): GameState {
  const scenes = createDefaultScenes();
  return {
    roomId,
    dmClientId: null,
    activeSceneId: scenes[0].id,
    scenes,
    tokens: [],
    viewport: { ...DEFAULT_VIEWPORT },
    playerSlots: [],
    characterSheets: {},
    connectedPlayers: [],
    ping: null,
    annotations: [],
    publicDiceLog: [],
  };
}
