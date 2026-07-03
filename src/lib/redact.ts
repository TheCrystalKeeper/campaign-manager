import {
  SHEET_SECTIONS,
  SHEET_SECTION_FIELDS,
  createDefaultSheet,
  type CharacterSheet,
  type GameState,
  type LogEntry,
  type SheetRecord,
} from "./types";

/**
 * Who a state snapshot is being prepared for. `null` means an unjoined/lobby
 * connection that has not authenticated as any role yet.
 */
export type StateView = { role: "dm" } | { role: "player"; playerId: string } | null;

/// <summary>
/// Strips an NPC sheet's unrevealed sections, replacing them with blank defaults
/// and setting the `redacted` marker so the client renders "???" instead of
/// zero-filled values. PC sheets pass through untouched (party transparency).
/// `keepHp` is the deliberate exception for tokens whose HP display the DM
/// turned on — players need the numbers to draw the bar.
/// </summary>
function redactSheetRecord(record: SheetRecord, keepHp: boolean): SheetRecord {
  if (record.kind !== "npc") {
    return record;
  }
  if (SHEET_SECTIONS.every((section) => record.revealed[section.id])) {
    return record;
  }

  const data = createDefaultSheet("");
  for (const section of SHEET_SECTIONS) {
    if (!record.revealed[section.id]) {
      continue;
    }
    for (const field of SHEET_SECTION_FIELDS[section.id]) {
      // Safe: both sides are CharacterSheet, iterating its own keys.
      (data as Record<keyof CharacterSheet, unknown>)[field] = record.data[field];
    }
  }
  if (keepHp && !record.revealed.combat) {
    data.hp = { ...record.data.hp };
  }
  return { ...record, data, redacted: true };
}

/// <summary>
/// Strips state the viewer must not receive before it is sent over the wire.
/// UI-level hiding is never enough — every secret leaves the server through here.
/// Rules grow per feature phase (DM-only log entries, whispers, hidden tokens,
/// LOS-invisible tokens).
/// </summary>
export function redactStateFor(state: GameState, view: StateView): GameState {
  if (view?.role === "dm") {
    return state;
  }

  if (view === null) {
    // Lobby connections only need enough to pick a character slot and show
    // live player counts — not the campaign content.
    return {
      ...state,
      scenes: [],
      tokens: [],
      sheets: {},
      log: [],
      dmNotes: "",
      combat: null,
      folders: [],
      items: {},
    };
  }

  // Joined players: hide the DM's notes, hidden tokens, unrevealed NPC sheet
  // sections, secret rolls/events, whispers addressed to someone else — and every
  // NON-ACTIVE scene (prep must be invisible until "Set Live", not merely unrendered;
  // Phase 6.5). Hidden tokens are stripped entirely — UI hiding is never enough.
  const scenes = state.scenes.filter((scene) => scene.id === state.activeSceneId);
  const tokens = state.tokens.filter(
    (token) => !token.hidden && token.sceneId === state.activeSceneId,
  );
  const hpVisibleSheetIds = new Set(
    tokens
      .filter((token) => token.showHp !== "none" && token.sheetId)
      .map((token) => token.sheetId as string),
  );
  const sheets: Record<string, SheetRecord> = {};
  for (const [id, record] of Object.entries(state.sheets)) {
    sheets[id] = redactSheetRecord(record, hpVisibleSheetIds.has(id));
  }
  const log: LogEntry[] = [];
  for (const entry of state.log) {
    if (entry.kind === "chat") {
      const visible =
        !entry.whisperTo ||
        entry.whisperTo === view.playerId ||
        entry.fromId === view.playerId;
      if (visible) {
        log.push(entry);
      }
      continue;
    }
    if (!entry.dmOnly) {
      log.push(entry);
      continue;
    }
    if (entry.kind === "roll") {
      // Players see THAT the DM rolled in secret, never what — no label
      // (it could leak "Goblin Boss attack"), no expression, no values.
      log.push({
        id: entry.id,
        t: entry.t,
        kind: "roll",
        masked: true,
        actor: { name: "DM" },
        roll: {
          id: entry.roll.id,
          rollerName: "DM",
          rollerId: "dm",
          expression: "?",
          rolls: [],
          modifier: 0,
          total: 0,
          timestamp: entry.t,
        },
      });
    }
    // dmOnly events stay fully hidden.
  }
  // Combatants tied to hidden tokens keep their slot in the order but lose the name.
  const combat = state.combat
    ? {
        ...state.combat,
        entries: state.combat.entries.map((entry) =>
          entry.hidden ? { ...entry, name: "???" } : entry,
        ),
      }
    : null;
  // Directories are DM-side tools; sheets carry item-name copies for players.
  return { ...state, scenes, tokens, sheets, log, dmNotes: "", combat, folders: [], items: {} };
}
