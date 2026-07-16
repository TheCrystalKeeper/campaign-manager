import {
  DEFAULT_ICON_CROP,
  SHEET_SECTIONS,
  SHEET_SECTION_FIELDS,
  createDefaultSheet,
  type CharacterSheet,
  type GameState,
  type ItemRecord,
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
function redactSheetRecord(record: SheetRecord, keepHp: boolean, concealPortrait: boolean): SheetRecord {
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
  // The portrait renders on every token linked to this sheet, so it is normally kept
  // (with its framing) even while identity is hidden, so player clients resolve token
  // art live. Exception: when EVERY visible token linking this sheet is
  // portrait-concealed and identity is unrevealed, the URL itself is the secret.
  if (!concealPortrait || record.revealed.identity) {
    data.iconUrl = record.data.iconUrl;
    data.iconCrop = record.data.iconCrop;
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
  // Only the active scene, with DM-only annotations (map pins) stripped.
  const scenes = state.scenes
    .filter((scene) => scene.id === state.activeSceneId)
    .map((scene) =>
      scene.annotations.some((annotation) => annotation.dmOnly)
        ? { ...scene, annotations: scene.annotations.filter((annotation) => !annotation.dmOnly) }
        : scene,
    );
  // Concealed identity/art: rewrite the label to "???" and withhold the image URL
  // (the client renders a "?" glyph off the kept flags). Done BEFORE anything below
  // derives data from tokens, so sheet/item lookups see the concealed view too.
  const tokens = state.tokens
    .filter((token) => !token.hidden && token.sceneId === state.activeSceneId)
    .map((token) =>
      token.nameConcealed || token.portraitConcealed
        ? {
            ...token,
            ...(token.nameConcealed ? { label: "???" } : {}),
            ...(token.portraitConcealed ? { imageUrl: null } : {}),
          }
        : token,
    );
  // When the DM has forced HP bars on for everyone, keep HP for every token-linked sheet;
  // otherwise only for tokens whose HP display was individually turned on.
  const hpVisibleSheetIds = new Set(
    tokens
      .filter((token) => (state.showAllTokenHp || token.showHp !== "none") && token.sheetId)
      .map((token) => token.sheetId as string),
  );
  // A sheet's portrait URL is withheld only when EVERY visible token linking it is
  // portrait-concealed (any unconcealed token already legitimately shows the art).
  const portraitConcealedSheetIds = new Set<string>();
  for (const token of tokens) {
    if (token.sheetId && token.portraitConcealed) {
      portraitConcealedSheetIds.add(token.sheetId);
    }
  }
  for (const token of tokens) {
    if (token.sheetId && !token.portraitConcealed) {
      portraitConcealedSheetIds.delete(token.sheetId);
    }
  }
  const sheets: Record<string, SheetRecord> = {};
  for (const [id, record] of Object.entries(state.sheets)) {
    sheets[id] = redactSheetRecord(record, hpVisibleSheetIds.has(id), portraitConcealedSheetIds.has(id));
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
  // Item tokens resolve their icon live from the catalog, so ship icon-only
  // stubs for the items visible tokens reference — never the DM's full catalog,
  // and never the item's real name/stats (the token label is what players see).
  // Like sheets, the catalog icon is withheld when EVERY visible token that
  // references the item is portrait-concealed.
  const iconConcealedItemIds = new Set<string>();
  for (const token of tokens) {
    if (token.itemId && token.portraitConcealed) {
      iconConcealedItemIds.add(token.itemId);
    }
  }
  for (const token of tokens) {
    if (token.itemId && !token.portraitConcealed) {
      iconConcealedItemIds.delete(token.itemId);
    }
  }
  const items: Record<string, ItemRecord> = {};
  for (const token of tokens) {
    if (!token.itemId || items[token.itemId]) {
      continue;
    }
    const item = state.items[token.itemId];
    if (item) {
      const concealIcon = iconConcealedItemIds.has(token.itemId);
      items[token.itemId] = {
        id: item.id,
        name: "",
        description: "",
        iconUrl: concealIcon ? null : item.iconUrl,
        iconCrop: concealIcon ? { ...DEFAULT_ICON_CROP } : item.iconCrop,
        folderId: null,
      };
    }
  }
  // Combatants tied to hidden or name-concealed tokens keep their slot in the
  // order but lose the name.
  const nameConcealedTokenIds = new Set(
    state.tokens.filter((token) => token.nameConcealed).map((token) => token.id),
  );
  const combat = state.combat
    ? {
        ...state.combat,
        entries: state.combat.entries.map((entry) =>
          entry.hidden || (entry.tokenId && nameConcealedTokenIds.has(entry.tokenId))
            ? { ...entry, name: "???" }
            : entry,
        ),
      }
    : null;
  // Directories are DM-side tools; sheets carry item-name copies for players.
  return { ...state, scenes, tokens, sheets, log, dmNotes: "", combat, folders: [], items };
}
