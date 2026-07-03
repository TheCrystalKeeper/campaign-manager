import type { CampaignManifest } from "./campaignManifest";
import type { DiceTrack, DieSpec, WorldPoint } from "./dice3d";

export type Role = "dm" | "player";

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

/**
 * A drawn map annotation. The Draw tool creates "stroke" (DM-persistent / player-fading);
 * the shift-drag pointer gesture creates "arrow" (always ephemeral, dashed, arrowhead).
 * rect/circle/text render but have no tool yet.
 */
export type Annotation = {
  id: string;
  /** playerId or "dm" — authors (and the DM) may remove their own. */
  authorId: string;
  kind: "stroke" | "arrow" | "rect" | "circle" | "text";
  /** Flat [x0,y0,x1,y1,…] world coords for strokes/arrows. */
  points?: number[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
  color: string;
  width: number;
  createdAt: number;
  /** Auto-removed by the server ~10s after creation. Forced true for players. */
  ephemeral: boolean;
};

/**
 * A fog-of-war shape (world coords), applied in painter's order over the base:
 * `mode` absent/"reveal" cuts fog away, "cover" paints fog back in. Sanitizers only
 * ever EMIT `mode: "cover"` (reveal stays implicit) to keep persisted shapes small.
 */
export type FogReveal =
  | { kind: "rect"; x: number; y: number; w: number; h: number; mode?: "reveal" | "cover" }
  | { kind: "circle"; x: number; y: number; r: number; mode?: "reveal" | "cover" }
  /** Freehand brush stroke: flat [x0,y0,x1,y1,…]; stroke width = 2r, round caps. */
  | { kind: "brush"; points: number[]; r: number; mode?: "reveal" | "cover" };

export type SceneFog = {
  enabled: boolean;
  reveals: FogReveal[];
  /** false = map starts fully covered (reveals cut); true = starts clear (cover paints fog in). */
  inverted: boolean;
};

/** A sight-blocking segment. Doors block only while closed (`open` false/absent). */
export type Wall = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "wall" | "door";
  open?: boolean;
};

/** A light source. Radii are in FEET (converted to world px via the scene grid). */
export type Light = {
  id: string;
  x: number;
  y: number;
  /** Bright-light radius (fully lit). */
  brightR: number;
  /** Dim-light radius (outer reach); should be ≥ brightR. */
  dimR: number;
  color?: string;
  enabled: boolean;
};

export const MAX_SCENE_ANNOTATIONS = 200;
export const MAX_ANNOTATION_POINTS = 240; // flat x,y numbers → 120 sampled points
export const EPHEMERAL_ANNOTATION_TTL_MS = 10_000;
/** How long an annotation fades out (client-local ghost fade after it's removed). */
export const ANNOTATION_FADE_MS = 600;
/** Live pointer arrows one author may have at once — older ones fade first. */
export const MAX_POINTER_ARROWS_PER_AUTHOR = 5;
export const MAX_FOG_REVEALS = 300;
/** Flat x,y numbers per fog brush stroke (60 samples) — 300×120 ≈ 290KB worst case. */
export const MAX_FOG_BRUSH_POINTS = 120;
export const MAX_MEASURE_NUMBERS = 48; // flat x,y numbers → 24 ruler points
export const MAX_WALLS = 600;
export const MAX_LIGHTS = 50;

/// <summary>
/// A scene is a single background map image (drawn at world origin) plus a grid,
/// annotations, and manual fog-of-war.
/// </summary>
export type Scene = {
  id: string;
  name: string;
  mapUrl: string | null;
  width: number;
  height: number;
  gridSize: number;
  /** Grid origin offset (world px) so the grid can align to commercial maps. */
  gridOffsetX: number;
  gridOffsetY: number;
  /** Real-world feet per grid square (5e default 5). */
  feetPerSquare: number;
  gridColor: string;
  gridOpacity: number;
  showGrid: boolean;
  backgroundColor: string;
  defaultViewport: Viewport;
  /** DM strokes persist; player strokes are ephemeral. Capped server-side. */
  annotations: Annotation[];
  fog: SceneFog;
  /** Phase 6 dynamic vision: sight-blocking walls/doors. */
  walls: Wall[];
  /** Phase 6 dynamic vision: light sources. */
  lights: Light[];
  /** When true (default), the scene is lit everywhere — the vision pass is skipped. */
  globalIllumination: boolean;
};

export type TokenKind = "player" | "enemy";

/** How a token's HP (from its linked sheet) is shown to players. DM always sees bars. */
export type TokenHpDisplay = "none" | "bar" | "values";

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
  /** Linked sheet. Player tokens auto-link to their owner's PC sheet. */
  sheetId: string | null;
  /** Active condition ids from CONDITIONS. */
  conditions: string[];
  showHp: TokenHpDisplay;
  /** DM-hidden: stripped from player frames entirely; DM sees it ghosted. */
  hidden?: boolean;
  /** Phase 6 vision: this token sees in the dark up to `rangeFt` (0 = only lit areas). */
  vision?: TokenVision;
};

export type TokenVision = {
  enabled: boolean;
  /** Darkvision range in feet; 0 = sees lit areas only. */
  rangeFt: number;
};

export const CONDITIONS = [
  { id: "blinded", label: "Blinded", emoji: "🙈" },
  { id: "charmed", label: "Charmed", emoji: "💘" },
  { id: "frightened", label: "Frightened", emoji: "😱" },
  { id: "grappled", label: "Grappled", emoji: "✊" },
  { id: "invisible", label: "Invisible", emoji: "👻" },
  { id: "paralyzed", label: "Paralyzed", emoji: "⚡" },
  { id: "poisoned", label: "Poisoned", emoji: "🤢" },
  { id: "prone", label: "Prone", emoji: "🛌" },
  { id: "restrained", label: "Restrained", emoji: "⛓️" },
  { id: "stunned", label: "Stunned", emoji: "💫" },
  { id: "unconscious", label: "Unconscious", emoji: "💤" },
  { id: "concentrating", label: "Concentrating", emoji: "🎯" },
] as const;

const CONDITION_IDS = new Set<string>(CONDITIONS.map((condition) => condition.id));

/** One combatant in the initiative order. */
export type CombatEntry = {
  id: string;
  tokenId: string | null;
  sheetId: string | null;
  name: string;
  /** null until rolled — unrolled entries sort last with a "waiting" badge. */
  initiative: number | null;
  /** Tiebreaker: higher DEX score acts first on equal initiative. */
  dexScore: number;
  hasRolled: boolean;
  /** Masked to "???" for players (hidden tokens, Phase 5). */
  hidden?: boolean;
};

export type CombatState = {
  round: number;
  turnIndex: number;
  entries: CombatEntry[];
};

export type HitPoints = { current: number; max: number };

/** Directory folder for organizing actors (sheets) or items. Flat for now. */
export type Folder = {
  id: string;
  name: string;
  kind: "actor" | "item";
};

/** A catalog item (DM-side library). Dragging one onto a sheet copies its name. */
export type ItemRecord = {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  folderId: string | null;
  /** Manual directory ordering (fractional insertion); unset sorts last by name. */
  sortOrder?: number;
};

/** One row of a sheet's inventory. `name` is a copy, so catalog deletions are safe. */
export type InventoryEntry = {
  itemId: string | null;
  name: string;
  qty: number;
  note: string;
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
  inventory: InventoryEntry[];
  iconUrl: string | null;
  /** Combat block (game-loop resources kept outside the sheet template). */
  hp: HitPoints;
  ac: number;
  initiative: number;
  /** Player-entered ability scores keyed by AbilityDef.id (e.g. 16). */
  abilityScores: Record<string, number>;
  /** Manual modifiers added to each skill, keyed by DerivedStatDef.id. */
  skillMods: Record<string, number>;
  /** Manual modifiers added to each saving throw, keyed by DerivedStatDef.id. */
  saveMods: Record<string, number>;
};

export type AbilityDef = {
  id: string;
  name: string;
  abbr: string;
};

/// <summary>
/// A skill or saving throw definition. Tagged union on `mode` so new computation
/// modes (e.g. a future "formula") can be added without reworking call sites.
/// </summary>
export type DerivedStatDef =
  | { id: string; name: string; mode: "ability"; abilityId: string }
  | { id: string; name: string; mode: "constant" };

export type SheetTemplate = {
  abilities: AbilityDef[];
  skills: DerivedStatDef[];
  saves: DerivedStatDef[];
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

/** The reveal/collapse granularity of a character sheet. */
export type SheetSectionId =
  | "identity"
  | "combat"
  | "abilities"
  | "saves"
  | "skills"
  | "inventory"
  | "notes";

export const SHEET_SECTIONS: Array<{ id: SheetSectionId; label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "combat", label: "Combat" },
  { id: "abilities", label: "Abilities" },
  { id: "saves", label: "Saving throws" },
  { id: "skills", label: "Skills" },
  { id: "inventory", label: "Inventory" },
  { id: "notes", label: "Notes" },
];

/** Which CharacterSheet fields belong to each section — drives server-side redaction. */
export const SHEET_SECTION_FIELDS: Record<SheetSectionId, Array<keyof CharacterSheet>> = {
  identity: [
    "characterName",
    "playerName",
    "characterClass",
    "subclass",
    "level",
    "xp",
    "race",
    "alignment",
    "size",
    "age",
    "height",
    "weight",
    "eyes",
    "skin",
    "hair",
    "iconUrl",
  ],
  combat: ["hp", "ac", "initiative"],
  abilities: ["abilityScores"],
  saves: ["saveMods"],
  skills: ["skillMods"],
  inventory: ["inventory"],
  notes: ["notes", "backstoryPersonality"],
};

export type SheetKind = "pc" | "npc";

/// <summary>
/// A first-class sheet entity. PC sheets keep id === slotId; NPC sheets are
/// DM-created and hidden from players section-by-section until revealed.
/// Multiple tokens may share one sheet (six goblins, one stat block).
/// </summary>
export type SheetRecord = {
  id: string;
  kind: SheetKind;
  ownerSlotId: string | null;
  data: CharacterSheet;
  /** Per-section player visibility. PC sheets are always fully revealed. */
  revealed: Record<SheetSectionId, boolean>;
  /** Actors-directory folder, or null for the root. */
  folderId: string | null;
  /** Manual directory ordering (fractional insertion); unset sorts last by name. */
  sortOrder?: number;
  /** Set only on outbound copies whose hidden sections were stripped server-side. */
  redacted?: boolean;
};

export function createRevealedFlags(value: boolean): Record<SheetSectionId, boolean> {
  const flags = {} as Record<SheetSectionId, boolean>;
  for (const section of SHEET_SECTIONS) {
    flags[section.id] = value;
  }
  return flags;
}

export function createPcSheetRecord(slotId: string, name: string): SheetRecord {
  return {
    id: slotId,
    kind: "pc",
    ownerSlotId: slotId,
    data: createDefaultSheet(name),
    revealed: createRevealedFlags(true),
    folderId: null,
  };
}

export function createNpcSheetRecord(id: string, name: string): SheetRecord {
  return {
    id,
    kind: "npc",
    ownerSlotId: null,
    data: createDefaultSheet(name),
    revealed: createRevealedFlags(false),
    folderId: null,
  };
}

/// <summary>
/// Normalizes a persisted sheet record: fills missing reveal flags and forces
/// PC sheets fully revealed. Preserves the outbound `redacted` marker so the
/// client can render hidden sections honestly instead of as zero-filled data.
/// </summary>
export function normalizeSheetRecord(
  record: Partial<SheetRecord> & { id: string },
  fallbackName: string,
): SheetRecord {
  const kind: SheetKind = record.kind === "npc" ? "npc" : "pc";
  const revealed = createRevealedFlags(kind === "pc");
  if (kind === "npc" && record.revealed && typeof record.revealed === "object") {
    for (const section of SHEET_SECTIONS) {
      revealed[section.id] = Boolean(record.revealed[section.id]);
    }
  }
  return {
    id: record.id,
    kind,
    ownerSlotId: kind === "pc" ? (record.ownerSlotId ?? record.id) : null,
    data: normalizeCharacterSheet(record.data, fallbackName),
    revealed,
    folderId: typeof record.folderId === "string" ? record.folderId : null,
    ...(typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
      ? { sortOrder: record.sortOrder }
      : {}),
    ...(record.redacted ? { redacted: true } : {}),
  };
}

/// <summary>
/// Validates a persisted catalog item.
/// </summary>
export function normalizeItem(item: Partial<ItemRecord> & { id: string }): ItemRecord {
  return {
    id: item.id,
    name: typeof item.name === "string" && item.name.trim() ? item.name : "Item",
    description: typeof item.description === "string" ? item.description : "",
    iconUrl: typeof item.iconUrl === "string" ? item.iconUrl : null,
    folderId: typeof item.folderId === "string" ? item.folderId : null,
    ...(typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder)
      ? { sortOrder: item.sortOrder }
      : {}),
  };
}

export type PlayerSlot = {
  id: string;
  name: string;
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
  /** Advantage/disadvantage: the expression was rolled twice, best/worst total kept. */
  adv?: "adv" | "dis";
  /** The discarded roll's total when adv/dis was used. */
  otherTotal?: number;
};

/** One entry in the unified roll/action/chat log. */
export type LogEntry =
  | {
      id: string;
      t: number;
      kind: "roll";
      roll: DiceRoll;
      /** Who the roll was made as (the character), not necessarily who clicked. */
      actor: { name: string; sheetId?: string };
      /** e.g. "Stealth check" for sheet-integrated rolls. */
      label?: string;
      /** Secret DM roll — values masked in player frames. */
      dmOnly?: boolean;
      /** Set on outbound player copies of secret rolls: values are blanked. */
      masked?: boolean;
    }
  | { id: string; t: number; kind: "event"; text: string; dmOnly?: boolean }
  | {
      id: string;
      t: number;
      kind: "chat";
      from: string;
      /** Stable sender id (playerId or "dm") — drives whisper visibility. */
      fromId: string;
      text: string;
      /** Whisper target (slotId or "dm"); visible only to sender, target, and DM. */
      whisperTo?: string;
    };

export type GameState = {
  roomId: string;
  dmClientId: string | null;
  activeSceneId: string;
  scenes: Scene[];
  tokens: Token[];
  viewport: Viewport;
  playerSlots: PlayerSlot[];
  /** All sheets (PC + NPC) keyed by sheet id. PC sheet ids equal their slot ids. */
  sheets: Record<string, SheetRecord>;
  connectedPlayers: ConnectedPlayer[];
  /** Unified roll/action/chat log, capped at MAX_LOG_ENTRIES server-side. */
  log: LogEntry[];
  /** DM-only scratchpad — redacted to "" for players. */
  dmNotes: string;
  /** Active combat/initiative tracker, or null out of combat. */
  combat: CombatState | null;
  /** Actor/item directory folders (DM-only; stripped for players). */
  folders: Folder[];
  /** Item catalog (DM-only; sheets copy item names into their inventories). */
  items: Record<string, ItemRecord>;
  /**
   * Whether players may use the Draw tool (persistent/scribble annotations). Off by
   * default; the shift-drag pointer arrow is always allowed regardless of this.
   */
  playersCanDraw: boolean;
};

export const MAX_LOG_ENTRIES = 100;

/** Pre-Phase-1/2 persisted states: slot-keyed sheets, roll-only dice log. */
type LegacyGameStateFields = {
  characterSheets?: Record<string, CharacterSheet>;
  publicDiceLog?: DiceRoll[];
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
  | { type: "UPDATE_SHEET"; sheetId: string; sheet: CharacterSheet }
  | { type: "CREATE_SHEET"; sheetId: string; name: string }
  | { type: "DUPLICATE_SHEET"; sheetId: string; newSheetId: string }
  | { type: "DELETE_SHEET"; sheetId: string }
  | { type: "SET_SHEET_REVEAL"; sheetId: string; section: SheetSectionId; revealed: boolean }
  | { type: "SET_SHEET_FOLDER"; sheetId: string; folderId: string | null; sortOrder?: number }
  | { type: "CREATE_FOLDER"; folderId: string; kind: Folder["kind"]; name: string }
  | { type: "RENAME_FOLDER"; folderId: string; name: string }
  | { type: "DELETE_FOLDER"; folderId: string }
  | { type: "CREATE_ITEM"; itemId: string; name: string }
  | { type: "UPDATE_ITEM"; item: ItemRecord }
  | { type: "DELETE_ITEM"; itemId: string }
  | { type: "UPDATE_DM_NOTES"; notes: string }
  | { type: "IMPORT_CAMPAIGN"; manifest: CampaignManifest }
  | { type: "ADD_PLAYER_SLOT"; name: string }
  | { type: "UPDATE_PLAYER_SLOT"; slot: PlayerSlot }
  | { type: "REMOVE_PLAYER_SLOT"; slotId: string }
  | { type: "KICK_PLAYER"; playerId: string }
  | {
      type: "ROLL_DICE";
      expression: string;
      private?: boolean;
      /** Roll attributed to a sheet (DM: any sheet; player: own only). */
      context?: { sheetId?: string; label?: string };
      adv?: "adv" | "dis";
    }
  | { type: "SEND_CHAT"; text: string; whisperTo?: string }
  | {
      /** A physical 3D throw: the roller pre-simulated and recorded the exact motion. */
      type: "DICE_THROW_REQUEST";
      rollId: string;
      specs: DieSpec[];
      track: DiceTrack;
      modifier: number;
      trayCenter: WorldPoint;
      /** Roller's world-units-per-physics-unit — shared so every client places the
       *  dice at the same world footprint (dice are map-glued after landing). */
      worldScale?: number;
      context?: { sheetId?: string; label?: string };
      private?: boolean;
    }
  | { type: "COMBAT_START"; tokenIds: string[] }
  | { type: "COMBAT_ROLL_INITIATIVE" }
  | { type: "COMBAT_SET_INITIATIVE"; entryId: string; value: number }
  | { type: "COMBAT_NEXT" }
  | { type: "COMBAT_PREV" }
  | { type: "COMBAT_END" }
  /** Live ruler points (world coords, flat x,y) — transient relay, null = cleared. */
  | { type: "MEASURE"; sceneId: string; points: number[] | null }
  | { type: "ADD_ANNOTATION"; sceneId: string; annotation: Annotation }
  | { type: "REMOVE_ANNOTATION"; sceneId: string; annotationId: string }
  | { type: "CLEAR_ANNOTATIONS"; sceneId: string }
  | { type: "FOG_SET"; sceneId: string; enabled: boolean; inverted?: boolean }
  | { type: "FOG_REVEAL"; sceneId: string; shape: FogReveal }
  | { type: "FOG_RESET"; sceneId: string }
  | { type: "SET_PLAYERS_CAN_DRAW"; enabled: boolean }
  /** Replace a scene's wall set (batched on edit-commit — no per-segment spam). */
  | { type: "SET_WALLS"; sceneId: string; walls: Wall[] }
  | { type: "TOGGLE_DOOR"; sceneId: string; wallId: string }
  | { type: "ADD_LIGHT"; sceneId: string; light: Light }
  | { type: "UPDATE_LIGHT"; sceneId: string; light: Light }
  | { type: "REMOVE_LIGHT"; sceneId: string; lightId: string };

export type ServerMessage =
  | { type: "STATE"; state: GameState; yourClientId: string; yourRole: Role | null }
  /** Lightweight DM pan/zoom delta — never triggers a full STATE broadcast. */
  | { type: "VIEWPORT"; viewport: Viewport }
  /**
   * A validated 3D throw for every client to replay. `faceValues` are the server's
   * CSPRNG results; they are OMITTED on non-DM copies of secret throws so those
   * clients render blank dice. Transient — never part of GameState.
   */
  | {
      type: "DICE_THROW";
      rollId: string;
      actorName: string;
      specs: DieSpec[];
      track: DiceTrack;
      trayCenter: WorldPoint;
      worldScale?: number;
      faceValues?: number[];
      secret?: boolean;
    }
  /** Another client's live ruler (transient; null points = ruler cleared). */
  | {
      type: "MEASURE";
      clientId: string;
      name: string;
      color: string;
      sceneId: string;
      points: number[] | null;
    }
  | { type: "ERROR"; message: string }
  | { type: "JOINED"; role: Role; playerId: string }
  | { type: "KICKED"; message: string };

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
/// Syncs a player-owned token label, portrait, color, and sheet link from slot
/// and sheet data. Player tokens always link to their owner's PC sheet.
/// </summary>
export function syncPlayerTokenFromState(token: Token, state: GameState): Token {
  const normalized = normalizeToken(token);
  if (normalized.kind !== "player" || !normalized.ownerPlayerId) {
    return normalized;
  }

  const slot = state.playerSlots.find((item) => item.id === normalized.ownerPlayerId);
  const sheet = state.sheets[normalized.ownerPlayerId]?.data;
  return {
    ...normalized,
    sheetId: normalized.ownerPlayerId,
    color: playerTokenColorForSlot(normalized.ownerPlayerId, state.playerSlots),
    label: sheet?.characterName?.trim() || slot?.name || normalized.label,
    imageUrl: sheet?.iconUrl ?? normalized.imageUrl,
  };
}

/// <summary>
/// Ensures tokens include kind, image, sheet-link, and combat fields from older
/// persisted rooms. Unknown condition ids are dropped.
/// </summary>
export function normalizeToken(token: Token): Token {
  const kind = token.kind ?? (token.ownerPlayerId ? "player" : "enemy");
  // Player-owned tokens default to sight (see lit areas; 0ft darkvision) so a player
  // isn't stranded in the dark the moment the DM turns on dynamic lighting. The DM can
  // still turn it off or add darkvision per token. Enemies default to no vision.
  const vision = token.vision
    ? sanitizeTokenVision(token.vision)
    : token.ownerPlayerId
      ? { enabled: true, rangeFt: 0 }
      : undefined;
  return {
    ...token,
    kind,
    imageUrl: token.imageUrl ?? null,
    sheetId: token.sheetId ?? null,
    conditions: Array.isArray(token.conditions)
      ? token.conditions.filter((id) => CONDITION_IDS.has(id))
      : [],
    showHp: token.showHp === "bar" || token.showHp === "values" ? token.showHp : "none",
    color: token.color || (kind === "enemy" ? TOKEN_ENEMY_COLOR : TOKEN_PLAYER_COLOR),
    ...(token.hidden ? { hidden: true } : { hidden: undefined }),
    ...(vision ? { vision } : {}),
  };
}

/// <summary>
/// Validates persisted combat state; clamps the turn pointer into range.
/// </summary>
export function normalizeCombat(combat: CombatState | null | undefined): CombatState | null {
  if (!combat || typeof combat !== "object" || !Array.isArray(combat.entries)) {
    return null;
  }
  const entries: CombatEntry[] = combat.entries
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id,
      tokenId: entry.tokenId ?? null,
      sheetId: entry.sheetId ?? null,
      name: typeof entry.name === "string" ? entry.name : "Combatant",
      initiative:
        typeof entry.initiative === "number" && Number.isFinite(entry.initiative)
          ? entry.initiative
          : null,
      dexScore:
        typeof entry.dexScore === "number" && Number.isFinite(entry.dexScore)
          ? entry.dexScore
          : DEFAULT_ABILITY_SCORE,
      hasRolled: Boolean(entry.hasRolled),
      ...(entry.hidden ? { hidden: true } : {}),
    }));
  if (entries.length === 0) {
    return null;
  }
  const round = typeof combat.round === "number" && combat.round >= 1 ? combat.round : 1;
  const turnIndex = Math.min(Math.max(combat.turnIndex ?? 0, 0), entries.length - 1);
  return { round, turnIndex, entries };
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
    inventory: [],
    iconUrl: null,
    hp: { current: 0, max: 0 },
    ac: 0,
    initiative: 0,
    abilityScores: {},
    skillMods: {},
    saveMods: {},
  };
}

/// Baseline ability score used when a player hasn't entered one yet (modifier +0).
export const DEFAULT_ABILITY_SCORE = 10;

/// <summary>
/// Standard 5e ability modifier: floor((score - 10) / 2).
/// </summary>
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/// <summary>
/// Computes a skill or saving throw total: ability modifier plus the player's manual
/// modifier, or just the manual modifier for constant stats.
/// </summary>
export function derivedStatTotal(
  def: DerivedStatDef,
  manual: number,
  abilityScores: Record<string, number>,
): number {
  switch (def.mode) {
    case "ability":
      return abilityModifier(abilityScores[def.abilityId] ?? DEFAULT_ABILITY_SCORE) + manual;
    case "constant":
      return manual;
  }
}

/// <summary>
/// Formats a modifier with an explicit sign (e.g. +2, 0, -1).
/// </summary>
export function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/// <summary>
/// Builds the standard D&D 5e sheet template: 6 abilities, 18 skills, 6 saving throws.
/// </summary>
export function createDefaultSheetTemplate(): SheetTemplate {
  const abilities: AbilityDef[] = [
    { id: "str", name: "Strength", abbr: "STR" },
    { id: "dex", name: "Dexterity", abbr: "DEX" },
    { id: "con", name: "Constitution", abbr: "CON" },
    { id: "int", name: "Intelligence", abbr: "INT" },
    { id: "wis", name: "Wisdom", abbr: "WIS" },
    { id: "cha", name: "Charisma", abbr: "CHA" },
  ];

  const skillMap: Array<[string, string, string]> = [
    ["skill-acrobatics", "Acrobatics", "dex"],
    ["skill-animal-handling", "Animal Handling", "wis"],
    ["skill-arcana", "Arcana", "int"],
    ["skill-athletics", "Athletics", "str"],
    ["skill-deception", "Deception", "cha"],
    ["skill-history", "History", "int"],
    ["skill-insight", "Insight", "wis"],
    ["skill-intimidation", "Intimidation", "cha"],
    ["skill-investigation", "Investigation", "int"],
    ["skill-medicine", "Medicine", "wis"],
    ["skill-nature", "Nature", "int"],
    ["skill-perception", "Perception", "wis"],
    ["skill-performance", "Performance", "cha"],
    ["skill-persuasion", "Persuasion", "cha"],
    ["skill-religion", "Religion", "int"],
    ["skill-sleight-of-hand", "Sleight of Hand", "dex"],
    ["skill-stealth", "Stealth", "dex"],
    ["skill-survival", "Survival", "wis"],
  ];

  const skills: DerivedStatDef[] = skillMap.map(([id, name, abilityId]) => ({
    id,
    name,
    mode: "ability",
    abilityId,
  }));

  const saves: DerivedStatDef[] = abilities.map((ability) => ({
    id: `save-${ability.id}`,
    name: ability.name,
    mode: "ability",
    abilityId: ability.id,
  }));

  return { abilities, skills, saves };
}

/// Hard-coded 5e sheet template used everywhere (no in-app editor in the bare-bones build).
export const DEFAULT_SHEET_TEMPLATE: SheetTemplate = createDefaultSheetTemplate();

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
/// Returns whether two numeric records have the same keys and values.
/// </summary>
function numberRecordsEqual(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/// <summary>
/// Returns whether two character sheets have the same field values.
/// </summary>
export function characterSheetsEqual(a: CharacterSheet, b: CharacterSheet): boolean {
  return (
    a.hp.current === b.hp.current &&
    a.hp.max === b.hp.max &&
    a.ac === b.ac &&
    a.initiative === b.initiative &&
    numberRecordsEqual(a.abilityScores, b.abilityScores) &&
    numberRecordsEqual(a.skillMods, b.skillMods) &&
    numberRecordsEqual(a.saveMods, b.saveMods) &&
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
    inventory: sanitizeInventory(sheet.inventory),
    iconUrl: sheet.iconUrl ?? sheet.portraitUrl ?? null,
    hp: {
      current: numberOr(sheet.hp?.current, defaults.hp.current),
      max: numberOr(sheet.hp?.max, defaults.hp.max),
    },
    ac: numberOr(sheet.ac, defaults.ac),
    initiative: numberOr(sheet.initiative, defaults.initiative),
    abilityScores: sanitizeNumberRecord(sheet.abilityScores),
    skillMods: sanitizeNumberRecord(sheet.skillMods),
    saveMods: sanitizeNumberRecord(sheet.saveMods),
  };
}

/// <summary>
/// Returns a finite number, or the fallback when the value is missing or invalid.
/// </summary>
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/// <summary>
/// Keeps only well-formed inventory rows (capped at 200 per sheet).
/// </summary>
function sanitizeInventory(inventory: InventoryEntry[] | undefined): InventoryEntry[] {
  if (!Array.isArray(inventory)) {
    return [];
  }
  return inventory
    .filter((entry) => entry && typeof entry === "object" && typeof entry.name === "string")
    .slice(0, 200)
    .map((entry) => ({
      itemId: typeof entry.itemId === "string" ? entry.itemId : null,
      name: entry.name.slice(0, 200),
      qty:
        typeof entry.qty === "number" && Number.isFinite(entry.qty) && entry.qty > 0
          ? Math.floor(entry.qty)
          : 1,
      note: typeof entry.note === "string" ? entry.note.slice(0, 500) : "",
    }));
}

/// <summary>
/// Keeps only finite numeric entries from a persisted record (defaults to empty).
/// </summary>
function sanitizeNumberRecord(
  record: Record<string, number> | undefined,
): Record<string, number> {
  if (!record || typeof record !== "object") {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return result;
}

/// <summary>
/// Creates a new player slot with a stable id for joining and character sheets.
/// </summary>
export function createPlayerSlot(name: string): PlayerSlot {
  return {
    id: `slot-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim() || "Player",
  };
}

/// <summary>
/// Ensures a player slot has an id and name from older persisted rooms.
/// </summary>
export function normalizePlayerSlot(slot: PlayerSlot): PlayerSlot {
  return {
    id: slot.id,
    name: slot.name?.trim() || "Player",
  };
}

/// <summary>
/// Validates a client-supplied annotation. Returns null when malformed. Shared by the
/// server handler and scene normalization so persisted and inbound data obey one shape.
/// </summary>
export function sanitizeAnnotation(annotation: unknown): Annotation | null {
  const a = annotation as Partial<Annotation> | null;
  if (!a || typeof a !== "object" || typeof a.id !== "string") {
    return null;
  }
  const kind =
    a.kind === "stroke" ||
    a.kind === "arrow" ||
    a.kind === "rect" ||
    a.kind === "circle" ||
    a.kind === "text"
      ? a.kind
      : null;
  if (!kind) {
    return null;
  }
  let points: number[] | undefined;
  if (kind === "stroke" || kind === "arrow") {
    if (!Array.isArray(a.points) || a.points.length < 4 || a.points.length % 2 !== 0) {
      return null;
    }
    points = a.points.slice(0, MAX_ANNOTATION_POINTS).map((v) => numberOr(v, 0));
  }
  return {
    id: a.id.slice(0, 40),
    authorId: typeof a.authorId === "string" ? a.authorId.slice(0, 40) : "dm",
    kind,
    ...(points ? { points } : {}),
    ...(typeof a.x === "number" && Number.isFinite(a.x) ? { x: a.x } : {}),
    ...(typeof a.y === "number" && Number.isFinite(a.y) ? { y: a.y } : {}),
    ...(typeof a.w === "number" && Number.isFinite(a.w) ? { w: a.w } : {}),
    ...(typeof a.h === "number" && Number.isFinite(a.h) ? { h: a.h } : {}),
    ...(typeof a.text === "string" ? { text: a.text.slice(0, 200) } : {}),
    color: typeof a.color === "string" ? a.color.slice(0, 32) : "#ffd166",
    width: Math.min(Math.max(numberOr(a.width, 3), 1), 12),
    createdAt: numberOr(a.createdAt, Date.now()),
    ephemeral: Boolean(a.ephemeral),
  };
}

/// <summary>Validates a fog shape (rect, circle, or brush stroke in world coords).</summary>
export function sanitizeFogReveal(shape: unknown): FogReveal | null {
  const s = shape as Partial<
    FogReveal & { x: number; y: number; w: number; h: number; r: number; points: number[] }
  > | null;
  if (!s || typeof s !== "object") {
    return null;
  }
  // Only "cover" is ever stored — absent mode means reveal (keeps payloads small).
  const cover = s.mode === "cover" ? ({ mode: "cover" } as const) : {};
  if (s.kind === "brush") {
    if (
      !Array.isArray(s.points) ||
      s.points.length < 4 ||
      s.points.length % 2 !== 0 ||
      !s.points.every((value) => Number.isFinite(value))
    ) {
      return null;
    }
    const r = numberOr(s.r, NaN);
    if (!Number.isFinite(r)) {
      return null;
    }
    return {
      kind: "brush",
      points: s.points.slice(0, MAX_FOG_BRUSH_POINTS).map((value) => numberOr(value, 0)),
      r: Math.min(Math.max(r, 4), 2000),
      ...cover,
    };
  }
  const x = numberOr(s.x, NaN);
  const y = numberOr(s.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (s.kind === "rect") {
    const w = numberOr(s.w, NaN);
    const h = numberOr(s.h, NaN);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      return null;
    }
    return { kind: "rect", x, y, w, h, ...cover };
  }
  if (s.kind === "circle") {
    const r = numberOr(s.r, NaN);
    if (!Number.isFinite(r) || r <= 0) {
      return null;
    }
    return { kind: "circle", x, y, r, ...cover };
  }
  return null;
}

function sanitizeFog(fog: unknown): SceneFog {
  const f = fog as Partial<SceneFog> | null;
  const reveals = Array.isArray(f?.reveals)
    ? f.reveals
        .map((shape) => sanitizeFogReveal(shape))
        .filter((shape): shape is FogReveal => shape !== null)
        .slice(-MAX_FOG_REVEALS)
    : [];
  return { enabled: Boolean(f?.enabled), reveals, inverted: f?.inverted === true };
}

/// <summary>Validates a wall/door segment (world coords, finite, non-degenerate).</summary>
export function sanitizeWall(wall: unknown): Wall | null {
  const w = wall as Partial<Wall> | null;
  if (!w || typeof w !== "object" || typeof w.id !== "string") {
    return null;
  }
  const x1 = numberOr(w.x1, NaN);
  const y1 = numberOr(w.y1, NaN);
  const x2 = numberOr(w.x2, NaN);
  const y2 = numberOr(w.y2, NaN);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  if (Math.hypot(x2 - x1, y2 - y1) < 1) {
    return null; // degenerate (zero-length) segment
  }
  const kind = w.kind === "door" ? "door" : "wall";
  return {
    id: w.id.slice(0, 40),
    x1,
    y1,
    x2,
    y2,
    kind,
    ...(kind === "door" && w.open ? { open: true } : {}),
  };
}

/// <summary>Validates a light source; radii clamped to sane feet ranges.</summary>
export function sanitizeLight(light: unknown): Light | null {
  const l = light as Partial<Light> | null;
  if (!l || typeof l !== "object" || typeof l.id !== "string") {
    return null;
  }
  const x = numberOr(l.x, NaN);
  const y = numberOr(l.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const brightR = Math.min(Math.max(numberOr(l.brightR, 20), 0), 1000);
  const dimR = Math.min(Math.max(numberOr(l.dimR, 40), brightR), 1000);
  return {
    id: l.id.slice(0, 40),
    x,
    y,
    brightR,
    dimR,
    ...(typeof l.color === "string" ? { color: l.color.slice(0, 32) } : {}),
    enabled: l.enabled !== false,
  };
}

/// <summary>Validates a token's vision block.</summary>
export function sanitizeTokenVision(vision: unknown): TokenVision | undefined {
  const v = vision as Partial<TokenVision> | null;
  if (!v || typeof v !== "object") {
    return undefined;
  }
  return {
    enabled: Boolean(v.enabled),
    rangeFt: Math.min(Math.max(numberOr(v.rangeFt, 0), 0), 1000),
  };
}

/// <summary>
/// Normalizes a persisted scene into the single-image schema, migrating legacy
/// multi-layer / single-mapUrl scenes and filling grid/annotation/fog defaults.
/// </summary>
export function normalizeScene(scene: Partial<Scene> & Record<string, unknown>): Scene {
  const legacyLayers = Array.isArray(scene.layers)
    ? (scene.layers as Array<{ url?: string; width?: number; height?: number }>)
    : [];
  const firstLayer = legacyLayers[0];
  const mapUrl =
    (typeof scene.mapUrl === "string" ? scene.mapUrl : null) ?? firstLayer?.url ?? null;
  const width = numberOr(scene.width, numberOr(firstLayer?.width, 800));
  const height = numberOr(scene.height, numberOr(firstLayer?.height, 600));
  const annotations = Array.isArray(scene.annotations)
    ? scene.annotations
        .map((annotation) => sanitizeAnnotation(annotation))
        .filter((annotation): annotation is Annotation => annotation !== null)
        .slice(-MAX_SCENE_ANNOTATIONS)
    : [];
  const walls = Array.isArray(scene.walls)
    ? scene.walls
        .map((wall) => sanitizeWall(wall))
        .filter((wall): wall is Wall => wall !== null)
        .slice(-MAX_WALLS)
    : [];
  const lights = Array.isArray(scene.lights)
    ? scene.lights
        .map((light) => sanitizeLight(light))
        .filter((light): light is Light => light !== null)
        .slice(-MAX_LIGHTS)
    : [];
  return {
    id: typeof scene.id === "string" ? scene.id : `scene-${crypto.randomUUID().slice(0, 8)}`,
    name: typeof scene.name === "string" ? scene.name : "Scene",
    mapUrl,
    width,
    height,
    gridSize: numberOr(scene.gridSize, 50),
    gridOffsetX: numberOr(scene.gridOffsetX, 0),
    gridOffsetY: numberOr(scene.gridOffsetY, 0),
    feetPerSquare: Math.max(numberOr(scene.feetPerSquare, 5), 1),
    gridColor: typeof scene.gridColor === "string" ? scene.gridColor.slice(0, 32) : "#ffffff",
    gridOpacity: Math.min(Math.max(numberOr(scene.gridOpacity, 0.09), 0), 1),
    showGrid: scene.showGrid ?? true,
    backgroundColor:
      typeof scene.backgroundColor === "string" ? scene.backgroundColor : DEFAULT_SCENE_BACKGROUND,
    defaultViewport:
      scene.defaultViewport && typeof scene.defaultViewport === "object"
        ? (scene.defaultViewport as Viewport)
        : { ...DEFAULT_VIEWPORT },
    annotations,
    fog: sanitizeFog(scene.fog),
    walls,
    lights,
    // Default ON so existing scenes stay fully lit until the DM opts into dynamic vision.
    globalIllumination: scene.globalIllumination !== false,
  };
}

/// <summary>
/// Normalizes full game state (fills missing arrays, syncs player tokens) on load.
/// Migrates legacy `characterSheets` (keyed by slot) into first-class `sheets`
/// records, and preserves NPC sheets alongside per-slot PC sheets.
/// </summary>
export function normalizeGameState(state: GameState & LegacyGameStateFields): GameState {
  const playerSlots = (state.playerSlots ?? []).map((slot) => normalizePlayerSlot(slot));
  const slotIds = new Set(playerSlots.map((slot) => slot.id));

  const sheets: Record<string, SheetRecord> = {};
  for (const [id, record] of Object.entries(state.sheets ?? {})) {
    if (!record || typeof record !== "object") {
      continue;
    }
    // A sheet keyed by a slot id is that slot's PC sheet regardless of stored kind.
    const kind: SheetKind = slotIds.has(id) ? "pc" : "npc";
    const fallbackName =
      kind === "pc" ? (playerSlots.find((slot) => slot.id === id)?.name ?? "Character") : "NPC";
    sheets[id] = normalizeSheetRecord({ ...record, id, kind }, fallbackName);
  }
  for (const slot of playerSlots) {
    if (!sheets[slot.id]) {
      // Legacy migration: fold characterSheets[slotId] into a PC record.
      const legacy = state.characterSheets?.[slot.id];
      sheets[slot.id] = normalizeSheetRecord(
        { id: slot.id, kind: "pc", data: legacy },
        slot.name,
      );
    }
  }

  // Legacy migration: fold the roll-only publicDiceLog into the unified log.
  const log: LogEntry[] = Array.isArray(state.log)
    ? state.log
    : (state.publicDiceLog ?? []).map((roll) => ({
        id: `log-${roll.id}`,
        t: roll.timestamp,
        kind: "roll" as const,
        roll,
        actor: { name: roll.rollerName },
      }));

  const folders: Folder[] = (Array.isArray(state.folders) ? state.folders : []).filter(
    (folder): folder is Folder =>
      Boolean(folder) &&
      typeof folder.id === "string" &&
      typeof folder.name === "string" &&
      (folder.kind === "actor" || folder.kind === "item"),
  );
  const folderIds = new Set(folders.map((folder) => folder.id));

  const items: Record<string, ItemRecord> = {};
  for (const [id, item] of Object.entries(state.items ?? {})) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const normalized = normalizeItem({ ...item, id });
    // Drop references to folders that no longer exist.
    items[id] = folderIds.has(normalized.folderId ?? "")
      ? normalized
      : { ...normalized, folderId: null };
  }
  for (const record of Object.values(sheets)) {
    if (record.folderId && !folderIds.has(record.folderId)) {
      record.folderId = null;
    }
  }

  const scenes = (state.scenes ?? []).map((scene) => normalizeScene(scene));
  const base: GameState = {
    roomId: state.roomId,
    dmClientId: state.dmClientId ?? null,
    activeSceneId: state.activeSceneId,
    scenes,
    viewport: state.viewport ?? { ...DEFAULT_VIEWPORT },
    playerSlots,
    sheets,
    connectedPlayers: state.connectedPlayers ?? [],
    log: log.slice(-MAX_LOG_ENTRIES),
    dmNotes: typeof state.dmNotes === "string" ? state.dmNotes : "",
    combat: normalizeCombat(state.combat),
    folders,
    items,
    playersCanDraw: Boolean(state.playersCanDraw),
    tokens: [],
  };
  base.tokens = (state.tokens ?? []).map((token) => {
    const synced = syncPlayerTokenFromState(token, base);
    // Drop links to sheets that no longer exist.
    return synced.sheetId && !sheets[synced.sheetId] ? { ...synced, sheetId: null } : synced;
  });
  return base;
}

export function createDefaultScenes(): Scene[] {
  return [
    normalizeScene({
      id: "scene-1",
      name: "Dungeon",
      mapUrl: "/maps/sample-dungeon.svg",
      width: 800,
      height: 600,
    }),
    normalizeScene({
      id: "scene-2",
      name: "Tavern",
      mapUrl: "/maps/sample-tavern.svg",
      width: 800,
      height: 600,
    }),
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
    sheets: {},
    connectedPlayers: [],
    log: [],
    dmNotes: "",
    combat: null,
    folders: [],
    items: {},
    playersCanDraw: false,
  };
}
