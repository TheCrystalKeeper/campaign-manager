import type * as Party from "partykit/server";
import {
  abilityModifier,
  CONDITIONS,
  createInitialState,
  createNpcSheetRecord,
  createPcSheetRecord,
  DEFAULT_ICON_CROP,
  createPlayerSlot,
  DEFAULT_ABILITY_SCORE,
  EPHEMERAL_ANNOTATION_TTL_MS,
  MAX_FOG_REVEALS,
  MAX_HANDOUTS,
  MAX_LIGHTS,
  MAX_LOG_ENTRIES,
  MAX_MEASURE_NUMBERS,
  MAX_CAMPAIGN_BYTES,
  MAX_POINTER_ARROWS_PER_AUTHOR,
  MAX_ROLL_PARTS,
  MAX_SCENE_ANNOTATIONS,
  MAX_SHEET_BYTES,
  MAX_TEMPLATE_EXTENT,
  MAX_WALLS,
  TEMPLATE_KINDS,
  type CampaignExport,
  type TemplateShape,
  normalizeCharacterSheet,
  normalizeFacing,
  normalizeGameState,
  normalizeHandout,
  normalizeItem,
  normalizeScene,
  normalizeToken,
  normalizeTokenShapeDefaults,
  normalizeUiOverride,
  clampTokenSize,
  playerTokenColorForSlot,
  sanitizeAnnotation,
  sanitizeFogReveal,
  sanitizeLight,
  sanitizeWall,
  SHEET_SECTIONS,
  syncTokenFromState,
  type ClientMessage,
  type CombatEntry,
  type ConnectedPlayer,
  type DiceRoll,
  type GameState,
  type LogEntry,
  type Role,
  type Scene,
  type ServerMessage,
  type SheetRecord,
} from "../src/lib/types";
import { clampMove, movementSegments } from "../src/lib/visibility";
import { rotateSceneCW, rotateTokenCW } from "../src/lib/sceneTransform";
import { rollDiceExpression, rollWithAdvantage, secureRandInt } from "../src/lib/dice";
import { computeDerived } from "../src/lib/rules5e";
import { partsFromDice, partsFromExpression, resolveCheck } from "../src/lib/rollCheck";
import {
  buildExpressionLabel,
  coinFaceLabel,
  type DieSpec,
  interpretRoll,
  rollFaceValues,
  rollPartLabels,
  sanitizeThrow,
} from "../src/lib/dice3d";
import { redactStateFor, type StateView } from "../src/lib/redact";
import { loadCampaignFromDisk } from "./loadCampaign";

type ClientMeta = {
  role: Role | null;
  playerId: string | null;
  displayName: string | null;
  joined: boolean;
};

const ROOM_KEY = "room-key";
const VIEWPORT_THROTTLE_MS = 66;
const VIEWPORT_PERSIST_DEBOUNCE_MS = 2000;
const MAX_CHAT_LENGTH = 2000;
const MEASURE_THROTTLE_MS = 40;
/** DM ruler color (players use their slot color). */
const DM_MEASURE_COLOR = "#e9c176";

export default class GameServer implements Party.Server {
  state: GameState;
  clients = new Map<string, ClientMeta>();
  lastViewportBroadcast = 0;
  pendingViewport: GameState["viewport"] | null = null;
  viewportTimer: ReturnType<typeof setTimeout> | null = null;
  viewportPersistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Per-sender+channel transient coalescing (ruler / template; the viewport hot-path pattern). */
  transientRelay = new Map<
    string,
    { last: number; timer: ReturnType<typeof setTimeout> | null; pending: ServerMessage | null }
  >();

  constructor(readonly room: Party.Room) {
    this.state = createInitialState(room.id);
  }

  async onStart() {
    const stored = await this.room.storage.get<GameState>("state");
    if (stored) {
      this.state = normalizeGameState({
        ...stored,
        dmClientId: null,
        connectedPlayers: [],
      });
    } else {
      const manifest = await loadCampaignFromDisk();
      if (manifest) {
        this.state = normalizeGameState({
          ...createInitialState(this.room.id),
          activeSceneId: manifest.activeSceneId,
          scenes: manifest.scenes,
        });
      }
    }
    this.clearStaleDm();
    await this.persistState();
  }

  /// <summary>
  /// Normalizes and applies a scene update to game state.
  /// </summary>
  applySceneUpdate(scene: Scene) {
    this.state.scenes = this.state.scenes.map((item) =>
      item.id === scene.id ? normalizeScene(scene) : item,
    );
  }

  /// <summary>
  /// Sends a typed message to a single connected client.
  /// </summary>
  sendTo(connection: Party.Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }

  /// <summary>
  /// Clears dmClientId when the stored DM connection is no longer in the room.
  /// </summary>
  clearStaleDm() {
    if (this.state.dmClientId && !this.room.getConnection(this.state.dmClientId)) {
      this.state.dmClientId = null;
    }
  }

  /// <summary>
  /// Drops client metadata whose socket is no longer live — a disconnect whose onClose never
  /// fired (laptop sleep, network drop, server eviction). Without this a player who vanished
  /// keeps their character slot "taken" forever (isSlotTaken reads this.clients), and the DM
  /// can't kick them because there's no live connection to close. Mirrors clearStaleDm across
  /// every role. Returns whether anything changed so the caller can rebroadcast.
  /// </summary>
  pruneStaleClients(): boolean {
    let changed = false;
    for (const [clientId] of this.clients) {
      if (!this.room.getConnection(clientId)) {
        this.clients.delete(clientId);
        changed = true;
      }
    }
    if (this.state.dmClientId && !this.room.getConnection(this.state.dmClientId)) {
      this.state.dmClientId = null;
      changed = true;
    }
    if (changed) {
      this.syncConnectedPlayers();
    }
    return changed;
  }

  /// <summary>
  /// Persists durable game data without ephemeral connection fields.
  /// </summary>
  async persistState() {
    await this.room.storage.put("state", {
      ...this.state,
      dmClientId: null,
      connectedPlayers: [],
      log: (this.state.log ?? []).slice(-MAX_LOG_ENTRIES),
    });
  }

  /// <summary>
  /// Appends an entry to the unified log, enforcing the size cap.
  /// </summary>
  appendLog(entry: LogEntry) {
    this.state.log = [...(this.state.log ?? []), entry].slice(-MAX_LOG_ENTRIES);
  }

  /// <summary>
  /// Records a curated game event (scene change, token placed, join/leave, …).
  /// Kept deliberately sparse — no per-move spam.
  /// </summary>
  logEvent(text: string, dmOnly = false) {
    this.appendLog({
      id: `log-${crypto.randomUUID().slice(0, 8)}`,
      t: Date.now(),
      kind: "event",
      text,
      ...(dmOnly ? { dmOnly: true } : {}),
    });
  }

  /// <summary>
  /// Whether players may see this scene: it's the live one, or the DM flagged it
  /// viewable (multi-scene Phase B). Must mirror redactStateFor's scene filter —
  /// transient relays use this so they never leak beyond what state frames reveal.
  /// </summary>
  isSceneVisibleToPlayers(sceneId: string): boolean {
    if (sceneId === this.state.activeSceneId) {
      return true;
    }
    return this.state.scenes.some((scene) => scene.id === sceneId && scene.playerVisible);
  }

  /// <summary>
  /// Sorts combatants: rolled first by initiative desc, DEX desc tiebreak,
  /// insertion order last (stable sort). Unrolled entries sink to the bottom.
  /// The current turn keeps pointing at the same combatant across re-sorts.
  /// </summary>
  sortCombat() {
    const combat = this.state.combat;
    if (!combat) {
      return;
    }
    const currentId = combat.entries[combat.turnIndex]?.id ?? null;
    combat.entries = [...combat.entries].sort((a, b) => {
      const aRolled = a.initiative !== null;
      const bRolled = b.initiative !== null;
      if (aRolled !== bRolled) {
        return aRolled ? -1 : 1;
      }
      if (aRolled && bRolled && a.initiative !== b.initiative) {
        return (b.initiative as number) - (a.initiative as number);
      }
      return b.dexScore - a.dexScore;
    });
    if (currentId) {
      const index = combat.entries.findIndex((entry) => entry.id === currentId);
      if (index >= 0) {
        combat.turnIndex = index;
      }
    }
  }

  /// <summary>
  /// Initiative bonus for a sheet. PC sheets go through the rules engine (DEX mod +
  /// misc, override-aware) so the tracker matches the sheet's Init badge; NPC sheets
  /// keep the manual DEX-mod + init-field math.
  /// </summary>
  initiativeBonus(sheetId: string | null): { bonus: number; dexScore: number } {
    const record = sheetId ? this.state.sheets[sheetId] : undefined;
    const data = record?.data;
    const dexScore = data?.abilityScores["dex"] ?? DEFAULT_ABILITY_SCORE;
    if (record && record.kind === "pc") {
      return { bonus: computeDerived(record.data, "pc").values["init"] ?? 0, dexScore };
    }
    return { bonus: abilityModifier(dexScore) + (data?.initiative ?? 0), dexScore };
  }

  /// <summary>
  /// Binds a physical d20 throw to combat initiative. Only d20 faces count — any other
  /// dice in the throw are ignored. Resolution by roller:
  /// - `entryIds` present (DM's per-NPC / "Roll NPCs" buttons): zips each rolled d20 onto
  ///   those entries in order.
  /// - DM free-throw (no entryIds): auto-fills the NEXT unrolled NPCs in order, one d20
  ///   each, so the DM can throw a few at a time; dice beyond the unrolled-NPC count are
  ///   ignored.
  /// - player: sets every pending entry they control (from the first d20).
  /// Each entry adds its own initiative bonus. Returns true when at least one entry was
  /// set, so the roll can be logged as "Initiative".
  /// </summary>
  applyInitiativeFromThrow(
    meta: ClientMeta,
    entryIds: string[] | undefined,
    specs: DieSpec[],
    rolls: number[],
  ): boolean {
    const combat = this.state.combat;
    if (!combat) {
      return false;
    }
    // d20 faces in throw order (a standalone d20's face is its value).
    const d20Faces: number[] = [];
    specs.forEach((spec, i) => {
      if (spec.kind === "d20") {
        d20Faces.push(rolls[i]);
      }
    });
    if (d20Faces.length === 0) {
      return false;
    }

    const setEntry = (entry: CombatEntry, face: number) => {
      const { bonus, dexScore } = this.initiativeBonus(entry.sheetId);
      entry.initiative = face + bonus;
      entry.dexScore = dexScore;
      entry.hasRolled = true;
    };

    if (entryIds && entryIds.length > 0) {
      // DM rolling for NPCs: only the DM may target arbitrary entries.
      if (meta.role !== "dm") {
        return false;
      }
      let changed = false;
      entryIds.forEach((id, idx) => {
        const entry = combat.entries.find((item) => item.id === id);
        if (!entry || entry.initiative !== null) {
          return;
        }
        setEntry(entry, d20Faces[idx] ?? d20Faces[d20Faces.length - 1]);
        changed = true;
      });
      if (changed) {
        this.sortCombat();
      }
      return changed;
    }

    // DM free-throw (no explicit targets): auto-fill the next unrolled NPCs in order, one
    // d20 each. Extra dice beyond the unrolled-NPC count are ignored; players' own entries
    // are never touched (they roll for themselves).
    if (meta.role === "dm") {
      const npcs = combat.entries.filter((entry) => {
        if (entry.initiative !== null) {
          return false;
        }
        const token = this.state.tokens.find((item) => item.id === entry.tokenId);
        return !token?.ownerPlayerId;
      });
      if (npcs.length === 0) {
        return false;
      }
      const count = Math.min(d20Faces.length, npcs.length);
      for (let i = 0; i < count; i += 1) {
        setEntry(npcs[i], d20Faces[i]);
      }
      this.sortCombat();
      return true;
    }

    // A player's own d20: set every pending entry they control from the first d20.
    if (meta.role === "player" && meta.playerId) {
      const playerId = meta.playerId;
      const pending = combat.entries.filter((entry) => {
        if (entry.initiative !== null) {
          return false;
        }
        const token = this.state.tokens.find((item) => item.id === entry.tokenId);
        return token?.ownerPlayerId === playerId || entry.sheetId === playerId;
      });
      if (pending.length === 0) {
        return false;
      }
      for (const entry of pending) {
        setEntry(entry, d20Faces[0]);
      }
      this.sortCombat();
      return true;
    }

    return false;
  }

  /// <summary>
  /// Applies an HP delta to a sheet: damage eats temp HP first and never drops below 0;
  /// healing caps at max (temp HP is never healed). Shared by ADJUST_HP, APPLY_DAMAGE,
  /// and rests.
  /// </summary>
  applyHpDelta(record: SheetRecord, delta: number) {
    const hp = record.data.hp;
    let temp = hp.temp ?? 0;
    let current = hp.current;
    if (delta < 0) {
      let dmg = -delta;
      const fromTemp = Math.min(temp, dmg);
      temp -= fromTemp;
      dmg -= fromTemp;
      current = Math.max(0, current - dmg);
    } else {
      current = Math.min(hp.max, current + delta);
    }
    record.data.hp = { ...hp, current, ...(temp > 0 ? { temp } : { temp: undefined }) };
  }

  /// <summary>
  /// Re-syncs tokens linked to a sheet (player tokens via the owning slot, NPC tokens
  /// via their direct sheet link) after a sheet mutation.
  /// </summary>
  syncSheetTokens(record: SheetRecord) {
    this.state.tokens = this.state.tokens.map((token) =>
      (record.ownerSlotId !== null && token.ownerPlayerId === record.ownerSlotId) ||
      token.sheetId === record.id
        ? syncTokenFromState(token, this.state)
        : token,
    );
  }

  /// <summary>
  /// Whether a sheet's HP numbers may appear in player-visible log lines (PCs always;
  /// NPCs once combat is revealed or a linked token shows HP).
  /// </summary>
  hpVisibleFor(record: SheetRecord): boolean {
    return (
      record.kind !== "npc" ||
      record.revealed.combat ||
      this.state.tokens.some((token) => token.sheetId === record.id && token.showHp !== "none")
    );
  }

  /// <summary>
  /// Restores feature uses whose recovery matches the rest kind. Returns how many
  /// features recharged.
  /// </summary>
  restoreFeatureUses(record: SheetRecord, kinds: Array<"sr" | "lr">): number {
    let count = 0;
    record.data.features = record.data.features.map((feature) => {
      if (
        feature.uses &&
        feature.recovery &&
        kinds.includes(feature.recovery) &&
        feature.uses.current < feature.uses.max
      ) {
        count += 1;
        return { ...feature, uses: { ...feature.uses, current: feature.uses.max } };
      }
      return feature;
    });
    return count;
  }

  /// <summary>
  /// Refills spell slots to the effective maximums (rules-engine derived for auto
  /// caster types, stored otherwise). Returns whether anything changed. The stored
  /// entry keeps its max so a fully-spent auto slot level persists (absent = full).
  /// </summary>
  restoreSpellSlots(record: SheetRecord, slotMaxes: Record<string, number>): boolean {
    let changed = false;
    const slots = { ...record.data.spellSlots };
    for (const [level, max] of Object.entries(slotMaxes)) {
      const stored = slots[level];
      const current = stored?.current ?? max;
      if (current < max) {
        slots[level] = { current: max, max: stored && stored.max > 0 ? stored.max : max };
        changed = true;
      }
    }
    if (changed) {
      record.data.spellSlots = slots;
    }
    return changed;
  }

  /// <summary>
  /// Returns the redaction view for a connection based on its join state and role.
  /// </summary>
  viewFor(connectionId: string): StateView {
    const meta = this.clients.get(connectionId);
    if (!meta?.joined || !meta.role) {
      return null;
    }
    if (meta.role === "dm") {
      return { role: "dm" };
    }
    return { role: "player", playerId: meta.playerId ?? "" };
  }

  /// <summary>
  /// Broadcasts game state to every client, redacted per connection role.
  /// Storage keeps the full truth; only outbound frames are filtered.
  /// </summary>
  async broadcastState() {
    this.clearStaleDm();
    this.state = normalizeGameState(this.state);
    await this.persistState();
    for (const connection of this.room.getConnections()) {
      const meta = this.clients.get(connection.id);
      this.sendTo(connection, {
        type: "STATE",
        state: redactStateFor(this.state, this.viewFor(connection.id)),
        yourClientId: connection.id,
        yourRole: meta?.role ?? null,
      });
    }
  }

  /// <summary>
  /// Rebuilds the connected player list from active client metadata.
  /// </summary>
  syncConnectedPlayers() {
    const players: ConnectedPlayer[] = [];
    for (const [clientId, meta] of this.clients) {
      if (meta.role === "player" && meta.playerId && meta.displayName) {
        players.push({
          clientId,
          playerId: meta.playerId,
          displayName: meta.displayName,
        });
      }
    }
    this.state.connectedPlayers = players;
  }

  /// <summary>
  /// Returns whether a player slot is already claimed by another connection.
  /// </summary>
  isSlotTaken(slotId: string, exceptClientId?: string): boolean {
    for (const [clientId, meta] of this.clients) {
      if (clientId === exceptClientId) {
        continue;
      }
      if (meta.role === "player" && meta.playerId === slotId && meta.joined) {
        return true;
      }
    }
    return false;
  }

  /// <summary>
  /// Sends the current room snapshot to a client that has not joined yet.
  /// </summary>
  sendLobbyState(connection: Party.Connection) {
    this.sendTo(connection, {
      type: "STATE",
      state: redactStateFor(this.state, null),
      yourClientId: connection.id,
      yourRole: null,
    });
  }

  /// <summary>
  /// Returns whether the sender is the room DM.
  /// </summary>
  isDm(connectionId: string): boolean {
    return this.state.dmClientId === connectionId;
  }

  /// <summary>
  /// Validates the room password from join messages or URL query params.
  /// </summary>
  validateRoomKey(key: string): boolean {
    const expected = this.room.env[ROOM_KEY] as string | undefined;
    if (!expected) {
      return true;
    }
    return key === expected;
  }

  /// <summary>
  /// Schedules throttled viewport broadcasts while the DM pans or zooms.
  /// </summary>
  scheduleViewportBroadcast(viewport: GameState["viewport"]) {
    this.pendingViewport = viewport;
    const now = Date.now();
    const elapsed = now - this.lastViewportBroadcast;

    if (elapsed >= VIEWPORT_THROTTLE_MS) {
      this.flushViewport();
      return;
    }

    if (!this.viewportTimer) {
      this.viewportTimer = setTimeout(() => {
        this.viewportTimer = null;
        this.flushViewport();
      }, VIEWPORT_THROTTLE_MS - elapsed);
    }
  }

  /// <summary>
  /// Applies the latest pending viewport and relays it as a lightweight VIEWPORT
  /// delta — never a full STATE broadcast (this runs at up to ~15Hz while the DM
  /// pans). Persistence is debounced off the hot path.
  /// </summary>
  flushViewport() {
    if (!this.pendingViewport) {
      return;
    }
    this.state.viewport = this.pendingViewport;
    this.pendingViewport = null;
    this.lastViewportBroadcast = Date.now();
    const frame = JSON.stringify({
      type: "VIEWPORT",
      viewport: this.state.viewport,
    } satisfies ServerMessage);
    for (const connection of this.room.getConnections()) {
      connection.send(frame);
    }
    if (!this.viewportPersistTimer) {
      this.viewportPersistTimer = setTimeout(() => {
        this.viewportPersistTimer = null;
        void this.persistState();
      }, VIEWPORT_PERSIST_DEBOUNCE_MS);
    }
  }

  /// <summary>
  /// Relays one client's live ruler to every other joined client, coalesced per sender
  /// at MEASURE_THROTTLE_MS (the viewport hot-path pattern — never rides GameState).
  /// Ruler clears (points = null) flush immediately.
  /// </summary>
  relayTransient(
    senderId: string,
    channel: string,
    frame: ServerMessage,
    clear: boolean,
    shouldReceive?: (meta: ClientMeta) => boolean,
  ) {
    const key = `${senderId}:${channel}`;
    const send = (message: ServerMessage) => {
      const encoded = JSON.stringify(message);
      for (const connection of this.room.getConnections()) {
        if (connection.id === senderId) {
          continue;
        }
        // Re-evaluated per flush so a coalesced/pending frame re-checks visibility (e.g. a token
        // that flipped `hidden` mid-drag must stop reaching players immediately).
        const meta = this.clients.get(connection.id);
        if (meta?.joined && (!shouldReceive || shouldReceive(meta))) {
          connection.send(encoded);
        }
      }
    };
    let entry = this.transientRelay.get(key);
    if (!entry) {
      entry = { last: 0, timer: null, pending: null };
      this.transientRelay.set(key, entry);
    }
    if (clear) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      entry.pending = null;
      entry.last = Date.now();
      send(frame);
      return;
    }
    const now = Date.now();
    if (!entry.timer && now - entry.last >= MEASURE_THROTTLE_MS) {
      entry.last = now;
      send(frame);
      return;
    }
    entry.pending = frame;
    if (!entry.timer) {
      const wait = Math.max(MEASURE_THROTTLE_MS - (now - entry.last), 1);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        const pending = entry.pending;
        entry.pending = null;
        if (pending) {
          entry.last = Date.now();
          send(pending);
        }
      }, wait);
    }
  }

  onConnect(connection: Party.Connection) {
    this.clients.set(connection.id, {
      role: null,
      playerId: null,
      displayName: null,
      joined: false,
    });
    // Reap ghosts on every (re)connection so a reopened DM/player tab clears stale slots without
    // needing an explicit kick; broadcast so already-joined clients see the freed roster.
    if (this.pruneStaleClients()) {
      void this.broadcastState();
    }
    this.sendLobbyState(connection);
  }

  onClose(connection: Party.Connection) {
    const meta = this.clients.get(connection.id);
    this.clients.delete(connection.id);
    // Clear any pending transient-relay timers for this sender (all channels).
    for (const [key, relay] of this.transientRelay) {
      if (key.startsWith(`${connection.id}:`)) {
        if (relay.timer) {
          clearTimeout(relay.timer);
        }
        this.transientRelay.delete(key);
      }
    }

    if (this.state.dmClientId === connection.id) {
      this.state.dmClientId = null;
    }

    if (meta?.joined && meta.displayName) {
      this.logEvent(
        meta.role === "dm" ? `${meta.displayName} (DM) left.` : `${meta.displayName} left.`,
      );
    }

    this.syncConnectedPlayers();
    void this.broadcastState();
  }

  /// <summary>
  /// Handles inbound client actions, validates role permissions, and mutates room state.
  /// </summary>
  onMessage(message: string, sender: Party.Connection) {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(message) as ClientMessage;
    } catch {
      this.sendTo(sender, { type: "ERROR", message: "Invalid message format." });
      return;
    }

    const meta = this.clients.get(sender.id);
    if (!meta) {
      return;
    }

    if (parsed.type === "JOIN") {
      if (!this.validateRoomKey(parsed.roomKey)) {
        this.sendTo(sender, { type: "ERROR", message: "Invalid room password." });
        return;
      }

      // Reconcile any ghost connections first so a slot abandoned without a clean disconnect
      // (and the DM role) can be reclaimed instead of reading as permanently "taken".
      this.pruneStaleClients();

      if (parsed.role === "dm") {
        this.clearStaleDm();
        if (this.state.dmClientId && this.state.dmClientId !== sender.id) {
          this.sendTo(sender, { type: "ERROR", message: "DM role is already taken." });
          return;
        }
        this.state.dmClientId = sender.id;
        meta.role = "dm";
        meta.playerId = "dm";
        meta.displayName = parsed.displayName.trim() || "DM";
        meta.joined = true;
      } else {
        if (this.state.dmClientId === sender.id) {
          this.sendTo(sender, { type: "ERROR", message: "You are already the DM." });
          return;
        }
        const slot = this.state.playerSlots.find((item) => item.id === parsed.slotId);
        if (!slot) {
          this.sendTo(sender, { type: "ERROR", message: "That character slot does not exist." });
          return;
        }
        if (this.isSlotTaken(parsed.slotId, sender.id)) {
          this.sendTo(sender, { type: "ERROR", message: "That character slot is already taken." });
          return;
        }
        meta.role = "player";
        meta.playerId = parsed.slotId;
        meta.displayName = slot.name;
        meta.joined = true;

        if (!this.state.sheets[parsed.slotId]) {
          this.state.sheets[parsed.slotId] = createPcSheetRecord(parsed.slotId, slot.name);
        }
      }

      this.syncConnectedPlayers();
      this.logEvent(
        meta.role === "dm"
          ? `${meta.displayName} (DM) joined.`
          : `${meta.displayName} joined.`,
      );
      this.sendTo(sender, {
        type: "JOINED",
        role: meta.role,
        playerId: meta.playerId!,
      });
      void this.broadcastState();
      return;
    }

    if (!meta.joined) {
      this.sendTo(sender, { type: "ERROR", message: "Join the room before sending actions." });
      return;
    }

    if (parsed.type === "UPDATE_SHEET") {
      // The DM may edit any sheet (NPCs in place, PCs if needed); players only their own.
      const canEdit =
        this.isDm(sender.id) || (meta.role === "player" && meta.playerId === parsed.sheetId);
      if (!canEdit) {
        this.sendTo(sender, {
          type: "ERROR",
          message: "You can only edit your own character sheet.",
        });
        return;
      }
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      const fallbackName =
        this.state.playerSlots.find((slot) => slot.id === record.ownerSlotId)?.name ??
        (record.data.characterName || "Character");
      const nextData = normalizeCharacterSheet({ ...record.data, ...parsed.sheet }, fallbackName);
      if (JSON.stringify(nextData).length > MAX_SHEET_BYTES) {
        this.sendTo(sender, {
          type: "ERROR",
          message: "Sheet is too large — trim long descriptions or remove rows.",
        });
        return;
      }
      record.data = nextData;
      // Keep linked tokens mirroring this sheet: player tokens via the owning
      // slot, NPC/character tokens via their direct sheet link.
      this.state.tokens = this.state.tokens.map((token) =>
        (record.ownerSlotId && token.ownerPlayerId === record.ownerSlotId) ||
        token.sheetId === parsed.sheetId
          ? syncTokenFromState(token, this.state)
          : token,
      );
      void this.broadcastState();
      return;
    }

    if (parsed.type === "MOVE_TOKEN") {
      if (meta.role === "player" && meta.playerId) {
        if (!this.state.playersCanMove) {
          this.sendTo(sender, { type: "ERROR", message: "The DM has disabled moving characters." });
          return;
        }
        const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
        if (!token || token.ownerPlayerId !== meta.playerId) {
          this.sendTo(sender, { type: "ERROR", message: "You can only move your own token." });
          return;
        }
        // Authoritative wall collision: reject a player move whose path crosses a movement wall.
        // (The DM bypasses — DM moves take the general path below, not this one.)
        const moveScene = this.state.scenes.find((s) => s.id === token.sceneId);
        if (moveScene && moveScene.wallsBlockMovement !== false) {
          const clamped = clampMove(
            { x: token.x, y: token.y },
            { x: parsed.x, y: parsed.y },
            movementSegments(moveScene.walls),
          );
          if (clamped.x !== parsed.x || clamped.y !== parsed.y) {
            this.sendTo(sender, { type: "ERROR", message: "A wall blocks the way." });
            return;
          }
        }
        token.x = parsed.x;
        token.y = parsed.y;
        if (parsed.facing !== undefined) {
          token.facing = normalizeFacing(parsed.facing);
        }
        void this.broadcastState();
        return;
      }
    }

    // Conditions: DM any token; players only their own. Token.conditions is the single
    // source of truth (the sheet's Effects grid is a view over it).
    if (parsed.type === "SET_TOKEN_CONDITIONS") {
      const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
      if (!token) {
        this.sendTo(sender, { type: "ERROR", message: "Token not found." });
        return;
      }
      if (meta.role === "player" && token.ownerPlayerId !== meta.playerId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only change your own token." });
        return;
      }
      const valid = new Set<string>(CONDITIONS.map((condition) => condition.id));
      token.conditions = [...new Set(parsed.conditions)].filter((id) => valid.has(id)).slice(0, 16);
      void this.broadcastState();
      return;
    }

    // Rest with real effects (AUTOMATION_PLAN Tier 3). Short rest: spend hit dice
    // (server-rolled: die + CON mod each) and recharge "sr" features (+ pact slots).
    // Long rest: HP to max (temp HP ends), regain half hit dice (min 1), all slots,
    // "sr"+"lr" features, death saves reset. DM any sheet; players own only.
    if (parsed.type === "REST") {
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      if (meta.role === "player" && meta.playerId !== parsed.sheetId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only rest your own character." });
        return;
      }
      const data = record.data;
      const name = data.characterName?.trim() || "A character";
      const derived = computeDerived(data, record.kind);
      const hitDiceMax = derived.values["hit-dice-max"] ?? data.hitDice.max;
      const summary: string[] = [];
      if (parsed.kind === "long") {
        const healed = Math.max(0, data.hp.max - data.hp.current);
        // Temp HP ends when a long rest finishes (5e).
        data.hp = { current: data.hp.max, max: data.hp.max };
        if (healed > 0) summary.push(`+${healed} HP`);
        const regained = Math.min(
          Math.max(0, hitDiceMax - data.hitDice.current),
          Math.max(1, Math.floor(hitDiceMax / 2)),
        );
        if (regained > 0) {
          data.hitDice = { ...data.hitDice, current: data.hitDice.current + regained };
          summary.push(`${regained} hit ${regained === 1 ? "die" : "dice"}`);
        }
        if (this.restoreSpellSlots(record, derived.slotMaxes)) {
          summary.push("all spell slots");
        }
        const features = this.restoreFeatureUses(record, ["sr", "lr"]);
        if (features > 0) summary.push(`${features} feature${features === 1 ? "" : "s"}`);
        if (data.deathSaves.successes > 0 || data.deathSaves.failures > 0) {
          data.deathSaves = { successes: 0, failures: 0 };
        }
        this.logEvent(`${name} finished a long rest ⛰${summary.length ? ` — ${summary.join(", ")}` : ""}`);
      } else {
        const spend = Math.max(0, Math.min(Math.trunc(parsed.spendHitDice ?? 0), data.hitDice.current, 20));
        if (spend > 0) {
          const dieMatch = data.hitDice.die.match(/(\d+)/);
          const parsedSize = dieMatch ? Number.parseInt(dieMatch[1], 10) : 8;
          const dieSize = parsedSize >= 2 && parsedSize <= 100 ? parsedSize : 8;
          const conMod = abilityModifier(data.abilityScores["con"] ?? DEFAULT_ABILITY_SCORE);
          const rolls: number[] = [];
          let healed = 0;
          for (let i = 0; i < spend; i += 1) {
            const die = secureRandInt(dieSize) + 1;
            rolls.push(die);
            healed += Math.max(0, die + conMod);
          }
          healed = Math.min(healed, Math.max(0, data.hp.max - data.hp.current));
          data.hp = { ...data.hp, current: data.hp.current + healed };
          data.hitDice = { ...data.hitDice, current: data.hitDice.current - spend };
          summary.push(
            `spent ${spend} hit ${spend === 1 ? "die" : "dice"} [${rolls.join(", ")}]${
              conMod !== 0 ? ` ${conMod > 0 ? "+" : ""}${conMod} CON each` : ""
            } → +${healed} HP`,
          );
        }
        const features = this.restoreFeatureUses(record, ["sr"]);
        if (features > 0) summary.push(`${features} feature${features === 1 ? "" : "s"}`);
        // Pact magic (warlock) recharges on a short rest.
        if (record.kind === "pc" && data.spellcasting.casterType === "pact") {
          if (this.restoreSpellSlots(record, derived.slotMaxes)) {
            summary.push("pact slots");
          }
        }
        this.logEvent(`${name} finished a short rest 🍴${summary.length ? ` — ${summary.join(", ")}` : ""}`);
      }
      this.syncSheetTokens(record);
      void this.broadcastState();
      return;
    }

    // Quick HP adjust: damage/heal without opening the sheet. DM any sheet; players own.
    if (parsed.type === "ADJUST_HP") {
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      if (meta.role === "player" && meta.playerId !== parsed.sheetId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only adjust your own HP." });
        return;
      }
      const delta = Math.max(-999, Math.min(999, Math.trunc(parsed.delta || 0)));
      if (delta === 0) {
        return;
      }
      this.applyHpDelta(record, delta);
      this.syncSheetTokens(record);
      // Log during combat. Hide the numbers for players when the NPC's HP is secret
      // (combat section unrevealed AND no linked token shows HP).
      if (this.state.combat) {
        const name = record.data.characterName?.trim() || "A character";
        const text = delta < 0 ? `${name} takes ${-delta} damage` : `${name} heals ${delta}`;
        this.logEvent(text, !this.hpVisibleFor(record));
      }
      void this.broadcastState();
      return;
    }

    // Spend one spell slot (Tier 3). Auto caster types: an absent slot entry means
    // "never spent" = full; the write stores the effective max so a fully-spent level
    // persists. DM any sheet; players own only.
    if (parsed.type === "CAST_SPELL") {
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      if (meta.role === "player" && meta.playerId !== parsed.sheetId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only cast from your own sheet." });
        return;
      }
      const level = Math.max(1, Math.min(9, Math.trunc(parsed.level || 0)));
      const derived = computeDerived(record.data, record.kind);
      const max = derived.slotMaxes[String(level)] ?? 0;
      const stored = record.data.spellSlots[String(level)];
      // Absent entry = never spent = full (auto caster types); capped at the max.
      const current = Math.min(stored?.current ?? max, max);
      if (max <= 0 || current <= 0) {
        this.sendTo(sender, { type: "ERROR", message: `No level-${level} spell slots left.` });
        return;
      }
      record.data.spellSlots = {
        ...record.data.spellSlots,
        [String(level)]: { current: current - 1, max: stored && stored.max > 0 ? stored.max : max },
      };
      const name = record.data.characterName?.trim() || "A character";
      this.logEvent(`${name} casts a level-${level} spell (${current - 1}/${max} slots left)`);
      void this.broadcastState();
      return;
    }

    // Spend a feature use (Tier 3). DM any sheet; players own only.
    if (parsed.type === "USE_FEATURE") {
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      if (meta.role === "player" && meta.playerId !== parsed.sheetId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only use your own features." });
        return;
      }
      const feature = record.data.features.find((f) => f.id === parsed.featureId);
      if (!feature?.uses || feature.uses.max <= 0) {
        this.sendTo(sender, { type: "ERROR", message: "That feature has no uses to spend." });
        return;
      }
      if (feature.uses.current <= 0) {
        this.sendTo(sender, { type: "ERROR", message: `No uses of ${feature.name} left.` });
        return;
      }
      const remaining = feature.uses.current - 1;
      record.data.features = record.data.features.map((f) =>
        f.id === feature.id && f.uses ? { ...f, uses: { ...f.uses, current: remaining } } : f,
      );
      const name = record.data.characterName?.trim() || "A character";
      this.logEvent(`${name} uses ${feature.name} (${remaining}/${feature.uses.max} left)`);
      void this.broadcastState();
      return;
    }

    // Spend an item charge (Tier 3). DM any sheet; players own only.
    if (parsed.type === "USE_ITEM_CHARGE") {
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      if (meta.role === "player" && meta.playerId !== parsed.sheetId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only use your own items." });
        return;
      }
      const row = record.data.inventory.find((r) => r.id === parsed.rowId);
      if (!row?.charges || row.charges.max <= 0) {
        this.sendTo(sender, { type: "ERROR", message: "That item has no charges." });
        return;
      }
      if (row.charges.current <= 0) {
        this.sendTo(sender, { type: "ERROR", message: `${row.name} has no charges left.` });
        return;
      }
      const remaining = row.charges.current - 1;
      record.data.inventory = record.data.inventory.map((r) =>
        r.id === row.id && r.charges ? { ...r, charges: { ...r.charges, current: remaining } } : r,
      );
      const name = record.data.characterName?.trim() || "A character";
      this.logEvent(`${name} uses ${row.name} (${remaining}/${row.charges.max} charges left)`);
      void this.broadcastState();
      return;
    }

    // Server-rolled death saving throw (Tier 3): 10+ = success, 9− = failure,
    // nat 1 = two failures, nat 20 = back up at 1 HP. Three successes stabilize
    // (tracker resets); three failures = death (clearly logged). DM any; players own.
    if (parsed.type === "DEATH_SAVE") {
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      if (meta.role === "player" && meta.playerId !== parsed.sheetId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only roll your own death saves." });
        return;
      }
      const data = record.data;
      const name = data.characterName?.trim() || "A character";
      const d20 = secureRandInt(20) + 1;
      let ds = { ...data.deathSaves };
      let note: string;
      if (d20 === 20) {
        // Regain 1 HP and wake up; the tracker resets.
        data.hp = { ...data.hp, current: Math.max(data.hp.current, 1) };
        ds = { successes: 0, failures: 0 };
        note = "natural 20 — back up with 1 HP!";
      } else if (d20 === 1) {
        ds.failures = Math.min(3, ds.failures + 2);
        note = "natural 1 — two failures";
      } else if (d20 >= 10) {
        ds.successes = Math.min(3, ds.successes + 1);
        note = "success";
      } else {
        ds.failures = Math.min(3, ds.failures + 1);
        note = "failure";
      }
      let event: string | null = null;
      if (ds.successes >= 3) {
        ds = { successes: 0, failures: 0 };
        event = `${name} is stable 💤`;
      } else if (ds.failures >= 3) {
        event = `${name} has died ☠`;
      }
      data.deathSaves = ds;
      const roll: DiceRoll = {
        id: `roll-${crypto.randomUUID().slice(0, 8)}`,
        rollerName: meta.displayName?.trim() || "Unknown",
        rollerId: meta.playerId ?? "unknown",
        expression: "1d20",
        rolls: [d20],
        modifier: 0,
        total: d20,
        timestamp: Date.now(),
        parts: [{ kind: "die", value: d20, label: "d20" }],
      };
      this.appendLog({
        id: `log-${crypto.randomUUID().slice(0, 8)}`,
        t: roll.timestamp,
        kind: "roll",
        roll,
        actor: { name, sheetId: parsed.sheetId },
        label: `Death saving throw (${note})`,
      });
      if (event) {
        this.logEvent(event);
      }
      this.syncSheetTokens(record);
      void this.broadcastState();
      return;
    }

    // DM-only damage apply (Tier 3): matches the damage type against the target's
    // resistance/immunity/vulnerability pills (case-insensitive, fuzzy both ways
    // since pills are free text) — immune = 0, resist = half (rounded down),
    // vulnerable = double. Temp HP is eaten first via the shared HP path.
    if (parsed.type === "APPLY_DAMAGE") {
      if (!this.isDm(sender.id)) {
        this.sendTo(sender, { type: "ERROR", message: "Only the DM can apply damage." });
        return;
      }
      const record = this.state.sheets[parsed.sheetId];
      if (!record) {
        this.sendTo(sender, { type: "ERROR", message: "Sheet not found." });
        return;
      }
      const amount = Math.max(1, Math.min(999, Math.trunc(parsed.amount || 0)));
      const dt = (parsed.damageType ?? "").trim().toLowerCase().slice(0, 40);
      const matches = (pills: string[]) =>
        dt !== "" &&
        pills.some((pill) => {
          const p = pill.trim().toLowerCase();
          return p.length > 0 && (p.includes(dt) || dt.includes(p));
        });
      const notes: string[] = [];
      let final = amount;
      if (matches(record.data.immunities)) {
        final = 0;
        notes.push("immune");
      } else {
        if (matches(record.data.resistances)) {
          final = Math.floor(final / 2);
          notes.push("resistant");
        }
        if (matches(record.data.vulnerabilities)) {
          final *= 2;
          notes.push("vulnerable");
        }
      }
      if (final > 0) {
        this.applyHpDelta(record, -final);
        this.syncSheetTokens(record);
      }
      const name = record.data.characterName?.trim() || "A character";
      const detail = notes.length > 0 ? ` (${notes.join(", ")}: ${amount} → ${final})` : "";
      this.logEvent(
        `${name} takes ${final}${dt ? ` ${dt}` : ""} damage${detail}`,
        !this.hpVisibleFor(record),
      );
      void this.broadcastState();
      return;
    }

    if (parsed.type === "ROLL_DICE") {
      if (parsed.private && !this.isDm(sender.id)) {
        this.sendTo(sender, { type: "ERROR", message: "Only the DM can make secret rolls." });
        return;
      }

      // Sheet-integrated rolls are attributed to the character (DM rolls as any
      // NPC/PC; players only as themselves).
      let actor: { name: string; sheetId?: string } = {
        name: meta.displayName?.trim() || "Unknown",
      };
      const sheetId = parsed.context?.sheetId;
      if (sheetId) {
        const canRollAs =
          this.isDm(sender.id) || (meta.role === "player" && meta.playerId === sheetId);
        const record = this.state.sheets[sheetId];
        if (!canRollAs || !record) {
          this.sendTo(sender, {
            type: "ERROR",
            message: "You can only roll from your own sheet.",
          });
          return;
        }
        actor = { name: record.data.characterName?.trim() || actor.name, sheetId };
      }

      try {
        const advResult = parsed.adv
          ? rollWithAdvantage(parsed.expression, parsed.adv, secureRandInt)
          : null;
        const result = advResult ?? rollDiceExpression(parsed.expression, secureRandInt);
        const roll: DiceRoll = {
          id: `roll-${crypto.randomUUID().slice(0, 8)}`,
          rollerName: meta.displayName?.trim() || "Unknown",
          rollerId: meta.playerId ?? "unknown",
          expression: result.expression,
          rolls: result.rolls,
          modifier: result.modifier,
          total: result.total,
          timestamp: Date.now(),
          parts: partsFromExpression(result.rolls, result.modifier, result.expression),
          ...(parsed.adv && advResult
            ? { adv: parsed.adv, otherTotal: advResult.otherTotal }
            : {}),
        };

        // Secret rolls persist as dmOnly log entries (stripped for players by
        // redactStateFor), so the DM's secret log survives a refresh.
        this.appendLog({
          id: `log-${crypto.randomUUID().slice(0, 8)}`,
          t: roll.timestamp,
          kind: "roll",
          roll,
          actor,
          ...(parsed.context?.label ? { label: parsed.context.label } : {}),
          ...(parsed.private ? { dmOnly: true } : {}),
        });
        void this.broadcastState();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid dice expression.";
        this.sendTo(sender, { type: "ERROR", message });
      }
      return;
    }

    // Structured sheet roll: the server resolves modifiers FROM the sheet and builds the
    // color-coded parts. Same attribution/authz as ROLL_DICE (DM any sheet, player own).
    if (parsed.type === "ROLL_CHECK") {
      if (parsed.private && !this.isDm(sender.id)) {
        this.sendTo(sender, { type: "ERROR", message: "Only the DM can make secret rolls." });
        return;
      }
      const canRollAs =
        this.isDm(sender.id) || (meta.role === "player" && meta.playerId === parsed.sheetId);
      const record = this.state.sheets[parsed.sheetId];
      if (!canRollAs || !record) {
        this.sendTo(sender, { type: "ERROR", message: "You can only roll from your own sheet." });
        return;
      }
      // The acting token's conditions impose adv/dis (Poisoned → disadvantage…). An
      // explicit tokenId wins when it belongs to this sheet; otherwise fall back to
      // the sheet's single linked token when unambiguous (shared stat blocks with
      // several tokens can't be guessed).
      const linkedToSheet = (token: (typeof this.state.tokens)[number]) =>
        token.sheetId === parsed.sheetId ||
        (record.ownerSlotId !== null && token.ownerPlayerId === record.ownerSlotId);
      let conditions: string[] = [];
      if (parsed.tokenId) {
        const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
        if (token && linkedToSheet(token)) {
          conditions = token.conditions;
        }
      } else {
        const linked = this.state.tokens.filter(linkedToSheet);
        if (linked.length === 1) {
          conditions = linked[0].conditions;
        }
      }
      const resolved = resolveCheck(record.data, parsed.check, parsed.adv, secureRandInt, {
        kind: record.kind,
        conditions,
      });
      const roll: DiceRoll = {
        id: `roll-${crypto.randomUUID().slice(0, 8)}`,
        rollerName: meta.displayName?.trim() || "Unknown",
        rollerId: meta.playerId ?? "unknown",
        expression: resolved.expression,
        rolls: resolved.rolls,
        modifier: resolved.modifier,
        total: resolved.total,
        timestamp: Date.now(),
        parts: resolved.parts.slice(0, MAX_ROLL_PARTS),
        ...(resolved.adv ? { adv: resolved.adv } : {}),
        ...(resolved.otherTotal !== undefined ? { otherTotal: resolved.otherTotal } : {}),
        ...(resolved.crit ? { crit: true } : {}),
      };
      this.appendLog({
        id: `log-${crypto.randomUUID().slice(0, 8)}`,
        t: roll.timestamp,
        kind: "roll",
        roll,
        actor: { name: record.data.characterName?.trim() || meta.displayName?.trim() || "Unknown", sheetId: parsed.sheetId },
        label: resolved.label,
        ...(parsed.private ? { dmOnly: true } : {}),
      });
      void this.broadcastState();
      return;
    }

    if (parsed.type === "COMBAT_ROLL_INITIATIVE") {
      const combat = this.state.combat;
      if (!combat) {
        this.sendTo(sender, { type: "ERROR", message: "No active combat." });
        return;
      }
      if (meta.role !== "player" || !meta.playerId) {
        this.sendTo(sender, {
          type: "ERROR",
          message: "The DM sets NPC initiative from the tracker.",
        });
        return;
      }
      const playerId = meta.playerId;
      const pending = combat.entries.filter((entry) => {
        if (entry.initiative !== null) {
          return false;
        }
        const token = this.state.tokens.find((item) => item.id === entry.tokenId);
        return token?.ownerPlayerId === playerId || entry.sheetId === playerId;
      });
      if (pending.length === 0) {
        this.sendTo(sender, { type: "ERROR", message: "You have no pending initiative roll." });
        return;
      }
      const record = this.state.sheets[playerId];
      const { bonus, dexScore } = this.initiativeBonus(playerId);
      for (const entry of pending) {
        const d20 = secureRandInt(20) + 1;
        entry.initiative = d20 + bonus;
        entry.hasRolled = true;
        entry.dexScore = dexScore;
        const roll: DiceRoll = {
          id: `roll-${crypto.randomUUID().slice(0, 8)}`,
          rollerName: meta.displayName?.trim() || "Unknown",
          rollerId: playerId,
          expression: `1d20${bonus >= 0 ? `+${bonus}` : bonus}`,
          rolls: [d20],
          modifier: bonus,
          total: entry.initiative,
          timestamp: Date.now(),
        };
        this.appendLog({
          id: `log-${crypto.randomUUID().slice(0, 8)}`,
          t: roll.timestamp,
          kind: "roll",
          roll,
          actor: {
            name: record?.data.characterName?.trim() || roll.rollerName,
            sheetId: playerId,
          },
          label: "Initiative",
        });
      }
      this.sortCombat();
      void this.broadcastState();
      return;
    }

    if (parsed.type === "DICE_THROW_REQUEST") {
      if (parsed.private && !this.isDm(sender.id)) {
        this.sendTo(sender, { type: "ERROR", message: "Only the DM can make secret rolls." });
        return;
      }
      const sanitized = sanitizeThrow(parsed.specs, parsed.track);
      if (!sanitized) {
        this.sendTo(sender, { type: "ERROR", message: "Invalid dice throw." });
        return;
      }
      const { specs, track } = sanitized;

      // Same attribution rules as ROLL_DICE: DM rolls as any sheet, players as their own.
      let actor: { name: string; sheetId?: string } = {
        name: meta.displayName?.trim() || "Unknown",
      };
      const sheetId = parsed.context?.sheetId;
      if (sheetId) {
        const canRollAs =
          this.isDm(sender.id) || (meta.role === "player" && meta.playerId === sheetId);
        const record = this.state.sheets[sheetId];
        if (!canRollAs || !record) {
          this.sendTo(sender, { type: "ERROR", message: "You can only roll from your own sheet." });
          return;
        }
        actor = { name: record.data.characterName?.trim() || actor.name, sheetId };
      }

      // The server picks every value — physics never decides results.
      const faceValues = rollFaceValues(specs, secureRandInt);
      const modifier =
        typeof parsed.modifier === "number" && Number.isFinite(parsed.modifier)
          ? Math.max(-1000, Math.min(1000, Math.trunc(parsed.modifier)))
          : 0;
      const { rolls, total } = interpretRoll(specs, faceValues);
      const throwExpression = buildExpressionLabel(specs, modifier);
      const isCoin = specs.length > 0 && specs.every((spec) => spec.kind === "coin");
      const roll: DiceRoll = {
        id: `roll-${crypto.randomUUID().slice(0, 8)}`,
        rollerName: meta.displayName?.trim() || "Unknown",
        rollerId: meta.playerId ?? "unknown",
        expression: throwExpression,
        rolls,
        modifier,
        total: total + modifier,
        timestamp: Date.now(),
        // Coins read Heads/Tails; other throws get a die/flat breakdown labeled per die
        // (mixed pools like 2d6 + 1d8 keep each die's own size).
        parts: isCoin
          ? rolls.map((value) => ({ kind: "flat" as const, value, label: coinFaceLabel(value) }))
          : partsFromDice(rolls, rollPartLabels(specs), modifier),
      };
      const secret = Boolean(parsed.private);
      const trayCenter: [number, number] = [
        Number.isFinite(parsed.trayCenter?.[0]) ? parsed.trayCenter[0] : 0,
        Number.isFinite(parsed.trayCenter?.[1]) ? parsed.trayCenter[1] : 0,
      ];
      const worldScale =
        typeof parsed.worldScale === "number" && Number.isFinite(parsed.worldScale)
          ? Math.min(Math.max(parsed.worldScale, 0.1), 5000)
          : undefined;

      // Everyone replays the same track now; values stripped for non-DM on secret throws.
      for (const connection of this.room.getConnections()) {
        const connMeta = this.clients.get(connection.id);
        if (!connMeta?.joined) {
          continue;
        }
        const withValues = !secret || connMeta.role === "dm";
        this.sendTo(connection, {
          type: "DICE_THROW",
          rollId: parsed.rollId,
          actorName: secret && !withValues ? "DM" : actor.name,
          specs,
          track,
          trayCenter,
          ...(worldScale ? { worldScale } : {}),
          ...(withValues ? { faceValues } : {}),
          ...(secret ? { secret: true } : {}),
        });
      }

      // Defer the log entry until the dice would have settled, so the log never
      // spoils the result mid-tumble. (v1 behavior; capped for safety.) Initiative is
      // applied here too, so the tracker number appears exactly when the dice land.
      const settleMs = Math.min((track.frames / track.fps) * 1000 + 400, 8000);
      const baseLabel = parsed.context?.label ?? (isCoin ? "🪙 Coin flip" : undefined);
      setTimeout(() => {
        const setInitiative = this.applyInitiativeFromThrow(
          meta,
          parsed.context?.initiativeEntryIds,
          specs,
          rolls,
        );
        const label = setInitiative ? "Initiative" : baseLabel;
        this.appendLog({
          id: `log-${crypto.randomUUID().slice(0, 8)}`,
          t: Date.now(),
          kind: "roll",
          roll,
          actor,
          ...(label ? { label } : {}),
          ...(secret ? { dmOnly: true } : {}),
        });
        void this.broadcastState();
      }, settleMs);
      return;
    }

    if (parsed.type === "SEND_CHAT") {
      const text = String(parsed.text ?? "")
        .trim()
        .slice(0, MAX_CHAT_LENGTH);
      if (!text) {
        return;
      }
      let whisperTo: string | undefined;
      if (parsed.whisperTo) {
        const valid =
          parsed.whisperTo === "dm" ||
          this.state.playerSlots.some((slot) => slot.id === parsed.whisperTo);
        if (!valid) {
          this.sendTo(sender, { type: "ERROR", message: "Whisper target not found." });
          return;
        }
        whisperTo = parsed.whisperTo;
      }
      this.appendLog({
        id: `log-${crypto.randomUUID().slice(0, 8)}`,
        t: Date.now(),
        kind: "chat",
        from: meta.displayName?.trim() || "Unknown",
        fromId: meta.playerId ?? "unknown",
        text,
        ...(whisperTo ? { whisperTo } : {}),
      });
      void this.broadcastState();
      return;
    }

    if (parsed.type === "MEASURE") {
      if (!this.state.scenes.some((scene) => scene.id === parsed.sceneId)) {
        return;
      }
      let points: number[] | null = null;
      if (Array.isArray(parsed.points)) {
        const valid =
          parsed.points.length >= 4 &&
          parsed.points.length <= MAX_MEASURE_NUMBERS &&
          parsed.points.length % 2 === 0 &&
          parsed.points.every((value) => Number.isFinite(value));
        if (!valid) {
          return;
        }
        points = parsed.points;
      }
      const color =
        meta.role === "dm"
          ? DM_MEASURE_COLOR
          : playerTokenColorForSlot(meta.playerId ?? "", this.state.playerSlots);
      this.relayTransient(
        sender.id,
        "measure",
        {
          type: "MEASURE",
          clientId: sender.id,
          name: meta.displayName?.trim() || "?",
          color,
          sceneId: parsed.sceneId,
          points,
        },
        points === null,
      );
      return;
    }

    if (parsed.type === "TEMPLATE") {
      if (!this.state.scenes.some((scene) => scene.id === parsed.sceneId)) {
        return;
      }
      let shape: TemplateShape | null = null;
      if (parsed.shape) {
        const s = parsed.shape;
        const validKind = TEMPLATE_KINDS.includes(s.kind);
        const validPts =
          Array.isArray(s.points) &&
          s.points.length === 4 &&
          s.points.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_TEMPLATE_EXTENT);
        if (!validKind || !validPts) {
          return;
        }
        shape = { kind: s.kind, points: s.points };
      }
      const color =
        meta.role === "dm"
          ? DM_MEASURE_COLOR
          : playerTokenColorForSlot(meta.playerId ?? "", this.state.playerSlots);
      this.relayTransient(
        sender.id,
        "template",
        {
          type: "TEMPLATE",
          clientId: sender.id,
          name: meta.displayName?.trim() || "?",
          color,
          sceneId: parsed.sceneId,
          shape,
        },
        shape === null,
      );
      return;
    }

    if (parsed.type === "TOKEN_DRAG") {
      const token = this.state.tokens.find((t) => t.id === parsed.tokenId);
      if (!token) {
        return;
      }
      // The sender must be allowed to move this token — mirror the MOVE_TOKEN checks. A player
      // who lacks rights is dropped silently (no ERROR spam at ~25Hz); the authoritative,
      // wall-clamped MOVE_TOKEN on drag-end remains the real guard. These frames are cosmetic.
      if (
        meta.role !== "dm" &&
        (!this.state.playersCanMove || !meta.playerId || token.ownerPlayerId !== meta.playerId)
      ) {
        return;
      }
      let pos: { x: number; y: number } | null = null;
      if (parsed.pos) {
        if (!Number.isFinite(parsed.pos.x) || !Number.isFinite(parsed.pos.y)) {
          return;
        }
        pos = { x: parsed.pos.x, y: parsed.pos.y };
      }
      const tokenId = token.id;
      this.relayTransient(
        sender.id,
        "tokendrag",
        { type: "TOKEN_DRAG", clientId: sender.id, tokenId, pos },
        pos === null,
        (receiver) => {
          if (receiver.role === "dm") {
            return true;
          }
          // Players never learn about hidden or invisible-scene tokens (mirrors redactStateFor —
          // a hidden token isn't even present in their state, so a leaked position would be a bug).
          const t = this.state.tokens.find((x) => x.id === tokenId);
          return !!t && !t.hidden && this.isSceneVisibleToPlayers(t.sceneId);
        },
      );
      return;
    }

    if (parsed.type === "ADD_ANNOTATION") {
      const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
      const sanitized = sanitizeAnnotation(parsed.annotation);
      if (!scene || !sanitized) {
        this.sendTo(sender, { type: "ERROR", message: "Invalid annotation." });
        return;
      }
      if (scene.annotations.some((annotation) => annotation.id === sanitized.id)) {
        return;
      }
      const isArrow = sanitized.kind === "arrow";
      // Two independent player gates: the shift-drag pointer arrow behind playersCanPoint,
      // and the Draw tool (strokes etc.) behind playersCanDraw.
      if (isArrow && !this.isDm(sender.id) && !this.state.playersCanPoint) {
        this.sendTo(sender, {
          type: "ERROR",
          message: "The DM has disabled pointer arrows for players.",
        });
        return;
      }
      if (!isArrow && !this.isDm(sender.id) && !this.state.playersCanDraw) {
        this.sendTo(sender, {
          type: "ERROR",
          message: "The DM hasn't enabled drawing for players.",
        });
        return;
      }
      const annotation = {
        ...sanitized,
        authorId: meta.playerId ?? "unknown",
        createdAt: Date.now(),
        // Arrows always fade; Draw-tool strokes persist only for the DM.
        ephemeral: isArrow ? true : this.isDm(sender.id) ? sanitized.ephemeral : true,
      };
      scene.annotations.push(annotation);
      // Cap live pointer arrows per author — drawing past the limit removes that author's
      // oldest arrow immediately; the client fades the removed arrow out (a client-local
      // ghost fade), so it's smooth without the server tracking fade state.
      if (isArrow) {
        const mine = scene.annotations.filter(
          (item) => item.kind === "arrow" && item.authorId === annotation.authorId,
        );
        if (mine.length > MAX_POINTER_ARROWS_PER_AUTHOR) {
          const drop = new Set(
            [...mine]
              .sort((a, b) => a.createdAt - b.createdAt)
              .slice(0, mine.length - MAX_POINTER_ARROWS_PER_AUTHOR)
              .map((item) => item.id),
          );
          scene.annotations = scene.annotations.filter((item) => !drop.has(item.id));
        }
      }
      // Cap persistent objects per scene by dropping the oldest.
      const persistent = scene.annotations.filter((item) => !item.ephemeral);
      if (persistent.length > MAX_SCENE_ANNOTATIONS) {
        const dropIds = new Set(
          persistent.slice(0, persistent.length - MAX_SCENE_ANNOTATIONS).map((item) => item.id),
        );
        scene.annotations = scene.annotations.filter((item) => !dropIds.has(item.id));
      }
      if (annotation.ephemeral) {
        setTimeout(() => {
          const target = this.state.scenes.find((item) => item.id === parsed.sceneId);
          if (target?.annotations.some((item) => item.id === annotation.id)) {
            target.annotations = target.annotations.filter((item) => item.id !== annotation.id);
            void this.broadcastState();
          }
        }, EPHEMERAL_ANNOTATION_TTL_MS);
      }
      void this.broadcastState();
      return;
    }

    if (parsed.type === "REMOVE_ANNOTATION") {
      const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
      const target = scene?.annotations.find((item) => item.id === parsed.annotationId);
      if (!scene || !target) {
        return;
      }
      if (!this.isDm(sender.id) && target.authorId !== meta.playerId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only erase your own drawings." });
        return;
      }
      scene.annotations = scene.annotations.filter((item) => item.id !== parsed.annotationId);
      void this.broadcastState();
      return;
    }

    if (parsed.type === "UPDATE_ANNOTATION") {
      const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
      const target = scene?.annotations.find((item) => item.id === parsed.annotationId);
      if (!scene || !target) {
        return;
      }
      if (!this.isDm(sender.id) && target.authorId !== meta.playerId) {
        this.sendTo(sender, { type: "ERROR", message: "You can only edit your own annotations." });
        return;
      }
      if (typeof parsed.text === "string") {
        target.text = parsed.text.slice(0, 200);
      }
      if (typeof parsed.x === "number" && Number.isFinite(parsed.x)) {
        target.x = parsed.x;
      }
      if (typeof parsed.y === "number" && Number.isFinite(parsed.y)) {
        target.y = parsed.y;
      }
      void this.broadcastState();
      return;
    }

    // Door toggling is allowed for players (opening doors as they explore) — handled BEFORE the
    // DM-only map gate. Locked doors need a DM; secret doors are DM-only (players don't see them
    // as doors). Wall editing + SET_DOOR_STATE stay DM-only inside the gated switch below.
    if (parsed.type === "TOGGLE_DOOR") {
      const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
      const door = scene?.walls.find((wall) => wall.id === parsed.wallId);
      if (!scene || !door || !door.door || door.door === "none") {
        return;
      }
      if (!this.isDm(sender.id)) {
        if (door.state === "locked") {
          this.sendTo(sender, { type: "ERROR", message: "That door is locked." });
          return;
        }
        if (door.door === "secret") {
          return; // players don't even know it's a door
        }
      }
      door.state = door.state === "open" ? "closed" : "open";
      void this.broadcastState();
      return;
    }

    if (!this.isDm(sender.id)) {
      this.sendTo(sender, { type: "ERROR", message: "Only the DM can control the map." });
      return;
    }

    switch (parsed.type) {
      case "UPDATE_VIEWPORT":
        this.scheduleViewportBroadcast(parsed.viewport);
        break;
      case "SET_SCENE": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (scene) {
          this.state.activeSceneId = parsed.sceneId;
          this.logEvent(`Scene changed to “${scene.name}”.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_SCENE_PLAYER_VISIBLE": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (scene && scene.playerVisible !== parsed.visible) {
          scene.playerVisible = parsed.visible;
          this.logEvent(
            parsed.visible
              ? `Scene “${scene.name}” opened to players.`
              : `Scene “${scene.name}” closed to players.`,
          );
          void this.broadcastState();
        }
        break;
      }
      case "ADD_SCENE":
        this.state.scenes.push(normalizeScene(parsed.scene));
        void this.broadcastState();
        break;
      case "UPDATE_SCENE": {
        const payloadSize = JSON.stringify(parsed.scene).length;
        if (payloadSize > 900_000) {
          this.sendTo(sender, {
            type: "ERROR",
            message:
              "Scene update is too large (image data embedded). On localhost, restart Vite so dev upload works, then add the image again.",
          });
          return;
        }
        this.applySceneUpdate(parsed.scene);
        void this.broadcastState();
        break;
      }
      case "ROTATE_SCENE": {
        // Atomic 90° CW rotation: the scene's geometry AND its tokens move in one
        // broadcast, so no client ever sees them disagree.
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (scene) {
          const oldH = scene.height;
          this.state.scenes = this.state.scenes.map((item) =>
            item.id === parsed.sceneId ? rotateSceneCW(item) : item,
          );
          this.state.tokens = this.state.tokens.map((token) =>
            token.sceneId === parsed.sceneId ? rotateTokenCW(token, oldH) : token,
          );
          void this.broadcastState();
        }
        break;
      }
      case "REMOVE_SCENE": {
        if (this.state.scenes.length <= 1) {
          this.sendTo(sender, { type: "ERROR", message: "Cannot remove the last scene." });
          return;
        }
        this.state.scenes = this.state.scenes.filter((scene) => scene.id !== parsed.sceneId);
        this.state.tokens = this.state.tokens.filter((token) => token.sceneId !== parsed.sceneId);
        if (this.state.activeSceneId === parsed.sceneId) {
          this.state.activeSceneId = this.state.scenes[0].id;
        }
        void this.broadcastState();
        break;
      }
      case "ADD_TOKEN": {
        const token = syncTokenFromState(normalizeToken(parsed.token), this.state);
        this.state.tokens.push(token);
        // Log entries are shared with players — a concealed name must not leak here.
        this.logEvent(`Token “${(token.nameConcealed ? "???" : token.label) || "Token"}” placed.`);
        void this.broadcastState();
        break;
      }
      case "MOVE_TOKEN": {
        const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
        if (token) {
          token.x = parsed.x;
          token.y = parsed.y;
          if (parsed.facing !== undefined) {
            token.facing = normalizeFacing(parsed.facing);
          }
          void this.broadcastState();
        }
        break;
      }
      case "UPDATE_TOKEN":
        this.state.tokens = this.state.tokens.map((token) =>
          token.id === parsed.token.id ? normalizeToken(parsed.token) : token,
        );
        void this.broadcastState();
        break;
      case "REMOVE_TOKEN": {
        const removed = this.state.tokens.find((token) => token.id === parsed.tokenId);
        this.state.tokens = this.state.tokens.filter((token) => token.id !== parsed.tokenId);
        if (removed) {
          this.logEvent(`Token “${(removed.nameConcealed ? "???" : removed.label) || "Token"}” removed.`);
        }
        void this.broadcastState();
        break;
      }
      case "EXPORT_CAMPAIGN": {
        const manifest: CampaignExport = {
          version: 2,
          exportedAt: Date.now(),
          state: {
            ...this.state,
            dmClientId: null,
            connectedPlayers: [],
            log: (this.state.log ?? []).slice(-MAX_LOG_ENTRIES),
          },
        };
        this.sendTo(sender, { type: "CAMPAIGN_EXPORT", manifest });
        break;
      }
      case "IMPORT_CAMPAIGN": {
        const manifest = parsed.manifest;
        // v2: a full-campaign restore (replaces the entire durable state).
        if (manifest.version === 2 && manifest.state) {
          if (JSON.stringify(manifest).length > MAX_CAMPAIGN_BYTES) {
            this.sendTo(sender, { type: "ERROR", message: "Campaign file is too large to import." });
            return;
          }
          const incoming = normalizeGameState({
            ...manifest.state,
            roomId: this.state.roomId,
            dmClientId: null,
            connectedPlayers: [],
          });
          // Kick any connected player whose slot no longer exists after the import.
          const validSlots = new Set(incoming.playerSlots.map((slot) => slot.id));
          for (const [connId, meta] of this.clients) {
            if (meta.role === "player" && meta.playerId && !validSlots.has(meta.playerId)) {
              const conn = this.room.getConnection(connId);
              if (conn) {
                this.sendTo(conn, { type: "KICKED", message: "The campaign was replaced by an import." });
              }
              meta.joined = false;
              meta.playerId = null;
            }
          }
          this.state = { ...incoming, dmClientId: this.state.dmClientId };
          this.syncConnectedPlayers();
          this.logEvent("Campaign imported from a backup file");
          void this.persistState();
          void this.broadcastState();
          break;
        }
        // v1: scenes-only manifest (back-compat).
        if (manifest.version !== 1 || !Array.isArray(manifest.scenes)) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid campaign manifest." });
          return;
        }
        this.state.scenes = manifest.scenes.map((scene) => normalizeScene(scene));
        if (this.state.scenes.some((scene) => scene.id === manifest.activeSceneId)) {
          this.state.activeSceneId = manifest.activeSceneId;
        } else if (this.state.scenes[0]) {
          this.state.activeSceneId = this.state.scenes[0].id;
        }
        void this.broadcastState();
        break;
      }
      case "COMBAT_START": {
        const wanted = new Set(parsed.tokenIds);
        const tokens = this.state.tokens.filter(
          (token) => token.sceneId === this.state.activeSceneId && wanted.has(token.id),
        );
        if (tokens.length === 0) {
          this.sendTo(sender, {
            type: "ERROR",
            message: "No tokens in the active scene to start combat with.",
          });
          return;
        }
        const entries: CombatEntry[] = tokens.map((token) => {
          const { dexScore } = this.initiativeBonus(token.sheetId);
          // Everyone starts unrolled: the DM rolls a d20 for NPCs (typically first),
          // then players roll their own. No more silent NPC auto-roll.
          return {
            id: `centry-${crypto.randomUUID().slice(0, 8)}`,
            tokenId: token.id,
            sheetId: token.sheetId,
            name: token.label || "Combatant",
            initiative: null,
            dexScore,
            hasRolled: false,
            // Hidden tokens keep their slot in the order but players see "???".
            ...(token.hidden ? { hidden: true } : {}),
          };
        });
        this.state.combat = { round: 1, turnIndex: 0, entries };
        this.sortCombat();
        this.state.combat.turnIndex = 0;
        this.logEvent(`⚔ Combat started (${entries.length} combatants). Roll for initiative!`);
        void this.broadcastState();
        break;
      }
      case "COMBAT_SET_INITIATIVE": {
        const entry = this.state.combat?.entries.find((item) => item.id === parsed.entryId);
        if (!entry || typeof parsed.value !== "number" || !Number.isFinite(parsed.value)) {
          this.sendTo(sender, { type: "ERROR", message: "Combatant not found." });
          return;
        }
        entry.initiative = parsed.value;
        entry.hasRolled = true;
        this.sortCombat();
        void this.broadcastState();
        break;
      }
      case "COMBAT_ROLL_INITIATIVE_NPCS": {
        // DM initiative roll for NPCs without the 3D dice (auto-roll fallback). With 3D on
        // the tracker throws a real d20 instead (DICE_THROW_REQUEST → applyInitiativeFromThrow).
        const combat = this.state.combat;
        if (!combat) {
          this.sendTo(sender, { type: "ERROR", message: "No active combat." });
          return;
        }
        const wanted =
          parsed.entryIds && parsed.entryIds.length > 0 ? new Set(parsed.entryIds) : null;
        const targets = combat.entries.filter((entry) => {
          if (entry.initiative !== null) {
            return false;
          }
          if (wanted) {
            return wanted.has(entry.id);
          }
          // Default: every unrolled NPC entry (tokens with no player owner).
          const token = this.state.tokens.find((item) => item.id === entry.tokenId);
          return !token?.ownerPlayerId;
        });
        for (const entry of targets) {
          const d20 = secureRandInt(20) + 1;
          const { bonus, dexScore } = this.initiativeBonus(entry.sheetId);
          entry.initiative = d20 + bonus;
          entry.dexScore = dexScore;
          entry.hasRolled = true;
          const roll: DiceRoll = {
            id: `roll-${crypto.randomUUID().slice(0, 8)}`,
            rollerName: meta.displayName?.trim() || "DM",
            rollerId: meta.playerId ?? "dm",
            expression: `1d20${bonus >= 0 ? `+${bonus}` : bonus}`,
            rolls: [d20],
            modifier: bonus,
            total: entry.initiative,
            timestamp: Date.now(),
          };
          this.appendLog({
            id: `log-${crypto.randomUUID().slice(0, 8)}`,
            t: roll.timestamp,
            kind: "roll",
            roll,
            actor: { name: entry.name, sheetId: entry.sheetId ?? undefined },
            label: "Initiative",
          });
        }
        this.sortCombat();
        void this.broadcastState();
        break;
      }
      case "COMBAT_NEXT": {
        const combat = this.state.combat;
        if (!combat || combat.entries.length === 0) {
          break;
        }
        combat.turnIndex += 1;
        if (combat.turnIndex >= combat.entries.length) {
          combat.turnIndex = 0;
          combat.round += 1;
          this.logEvent(`Round ${combat.round} begins.`);
        }
        void this.broadcastState();
        break;
      }
      case "COMBAT_PREV": {
        const combat = this.state.combat;
        if (!combat || combat.entries.length === 0) {
          break;
        }
        combat.turnIndex -= 1;
        if (combat.turnIndex < 0) {
          if (combat.round > 1) {
            combat.round -= 1;
            combat.turnIndex = combat.entries.length - 1;
          } else {
            combat.turnIndex = 0;
          }
        }
        void this.broadcastState();
        break;
      }
      case "COMBAT_END": {
        if (this.state.combat) {
          this.state.combat = null;
          this.logEvent("Combat ended.");
          void this.broadcastState();
        }
        break;
      }
      case "CREATE_SHEET": {
        const sheetId = parsed.sheetId?.trim();
        if (!sheetId || this.state.sheets[sheetId]) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid or duplicate sheet id." });
          return;
        }
        this.state.sheets[sheetId] = createNpcSheetRecord(sheetId, parsed.name?.trim() || "NPC");
        void this.broadcastState();
        break;
      }
      case "DUPLICATE_SHEET": {
        const source = this.state.sheets[parsed.sheetId];
        const newSheetId = parsed.newSheetId?.trim();
        if (!source || !newSheetId || this.state.sheets[newSheetId]) {
          this.sendTo(sender, { type: "ERROR", message: "Cannot duplicate that sheet." });
          return;
        }
        const copy = createNpcSheetRecord(newSheetId, "NPC");
        // normalizeCharacterSheet rebuilds nested objects, so the copy shares no state.
        copy.data = normalizeCharacterSheet(
          { ...source.data, characterName: `${source.data.characterName || "NPC"} (copy)` },
          "NPC",
        );
        copy.revealed = { ...source.revealed };
        this.state.sheets[newSheetId] = copy;
        void this.broadcastState();
        break;
      }
      case "DELETE_SHEET": {
        const record = this.state.sheets[parsed.sheetId];
        if (!record) {
          break;
        }
        if (record.kind === "pc") {
          this.sendTo(sender, {
            type: "ERROR",
            message: "PC sheets are tied to their player slot — remove the slot instead.",
          });
          return;
        }
        delete this.state.sheets[parsed.sheetId];
        this.state.tokens = this.state.tokens.map((token) =>
          token.sheetId === parsed.sheetId ? { ...token, sheetId: null } : token,
        );
        void this.broadcastState();
        break;
      }
      case "SET_SHEET_REVEAL": {
        const record = this.state.sheets[parsed.sheetId];
        if (!record || !SHEET_SECTIONS.some((section) => section.id === parsed.section)) {
          this.sendTo(sender, { type: "ERROR", message: "Sheet or section not found." });
          return;
        }
        if (record.kind === "pc") {
          this.sendTo(sender, { type: "ERROR", message: "PC sheets are always visible." });
          return;
        }
        record.revealed[parsed.section] = Boolean(parsed.revealed);
        // Don't leak the name via the event text unless identity is revealed.
        const npcName = record.revealed.identity
          ? record.data.characterName?.trim() || "an NPC"
          : "an unidentified creature";
        const sectionLabel =
          SHEET_SECTIONS.find((section) => section.id === parsed.section)?.label ??
          parsed.section;
        this.logEvent(
          `${sectionLabel} ${parsed.revealed ? "revealed" : "hidden"} for ${npcName}.`,
        );
        void this.broadcastState();
        break;
      }
      case "UPDATE_DM_NOTES": {
        this.state.dmNotes = String(parsed.notes ?? "").slice(0, 20_000);
        void this.broadcastState();
        break;
      }
      case "CLEAR_ANNOTATIONS": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (scene && scene.annotations.length > 0) {
          scene.annotations = [];
          void this.broadcastState();
        }
        break;
      }
      case "FOG_SET": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (!scene) {
          break;
        }
        scene.fog.enabled = Boolean(parsed.enabled);
        if (typeof parsed.inverted === "boolean") {
          scene.fog.inverted = parsed.inverted;
        }
        this.logEvent(
          `Fog of war ${scene.fog.enabled ? "enabled" : "disabled"}${
            scene.fog.inverted ? " (inverted)" : ""
          } on “${scene.name}”.`,
          true,
        );
        void this.broadcastState();
        break;
      }
      case "FOG_REVEAL": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const shape = sanitizeFogReveal(parsed.shape);
        if (!scene || !shape) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid fog reveal." });
          return;
        }
        scene.fog.reveals.push(shape);
        if (scene.fog.reveals.length > MAX_FOG_REVEALS) {
          scene.fog.reveals = scene.fog.reveals.slice(-MAX_FOG_REVEALS);
        }
        void this.broadcastState();
        break;
      }
      case "FOG_RESET": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (scene && scene.fog.reveals.length > 0) {
          scene.fog.reveals = [];
          void this.broadcastState();
        }
        break;
      }
      case "SET_PLAYERS_CAN_DRAW": {
        const enabled = Boolean(parsed.enabled);
        if (this.state.playersCanDraw !== enabled) {
          this.state.playersCanDraw = enabled;
          this.logEvent(`Player drawing ${enabled ? "enabled" : "disabled"} by the DM.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_PLAYERS_CAN_MOVE": {
        const enabled = Boolean(parsed.enabled);
        if (this.state.playersCanMove !== enabled) {
          this.state.playersCanMove = enabled;
          this.logEvent(`Player character movement ${enabled ? "enabled" : "disabled"} by the DM.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_PLAYERS_CAN_POINT": {
        const enabled = Boolean(parsed.enabled);
        if (this.state.playersCanPoint !== enabled) {
          this.state.playersCanPoint = enabled;
          this.logEvent(`Player pointer arrows ${enabled ? "enabled" : "disabled"} by the DM.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_OPTIMIZE_UPLOADS": {
        const enabled = Boolean(parsed.enabled);
        if (this.state.optimizeUploads !== enabled) {
          this.state.optimizeUploads = enabled;
          this.logEvent(`Upload optimization ${enabled ? "enabled" : "disabled"} by the DM.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_SHOW_ALL_TOKEN_HP": {
        const enabled = Boolean(parsed.enabled);
        if (this.state.showAllTokenHp !== enabled) {
          this.state.showAllTokenHp = enabled;
          this.logEvent(`Health bars on all tokens ${enabled ? "shown" : "hidden"} by the DM.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_HIDE_TOKEN_TRAY": {
        const enabled = Boolean(parsed.enabled);
        if (this.state.hideTokenTray !== enabled) {
          this.state.hideTokenTray = enabled;
          this.logEvent(`Token tray ${enabled ? "hidden" : "shown"} by the DM.`);
          void this.broadcastState();
        }
        break;
      }
      case "SET_UI_OVERRIDE": {
        // DM-forced theme+accent for every client (null = players choose their own).
        const next = parsed.override === null ? null : normalizeUiOverride(parsed.override);
        const changed = JSON.stringify(this.state.uiOverride) !== JSON.stringify(next);
        if (changed) {
          this.state.uiOverride = next;
          // Each dimension is optional now — describe only the ones actually forced.
          const parts: string[] = [];
          if (next?.theme) parts.push(next.theme);
          if (next?.accent) parts.push(`${next.accent} accent`);
          this.logEvent(
            parts.length
              ? `The DM set the table's look: ${parts.join(", ")}.`
              : "The DM released the table's look — pick your own in Settings.",
          );
          void this.broadcastState();
        }
        break;
      }
      // NOTE: this whole switch is already DM-gated (see the isDm check above). Wall EDITING is
      // DM-only; door TOGGLING (players opening doors) is handled before the gate.
      case "SET_WALLS": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (!scene) {
          break;
        }
        if (!Array.isArray(parsed.walls)) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid walls." });
          return;
        }
        scene.walls = parsed.walls
          .map((wall) => sanitizeWall(wall))
          .filter((wall): wall is NonNullable<typeof wall> => wall !== null)
          .slice(-MAX_WALLS);
        void this.broadcastState();
        break;
      }
      case "ADD_WALL": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const wall = sanitizeWall(parsed.wall);
        if (!scene || !wall) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid wall." });
          return;
        }
        if (scene.walls.length >= MAX_WALLS) {
          this.sendTo(sender, { type: "ERROR", message: `Wall limit reached (${MAX_WALLS}).` });
          return;
        }
        scene.walls.push(wall);
        void this.broadcastState();
        break;
      }
      case "UPDATE_WALL": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const wall = sanitizeWall(parsed.wall);
        if (!scene || !wall) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid wall." });
          return;
        }
        scene.walls = scene.walls.map((item) => (item.id === wall.id ? wall : item));
        void this.broadcastState();
        break;
      }
      case "UPDATE_WALLS": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (!scene) {
          break;
        }
        if (!Array.isArray(parsed.walls)) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid walls." });
          return;
        }
        // Upsert each sanitized wall by id; unknown ids append while under the cap.
        const byId = new Map(scene.walls.map((wall) => [wall.id, wall]));
        for (const raw of parsed.walls) {
          const wall = sanitizeWall(raw);
          if (!wall) continue;
          if (!byId.has(wall.id) && byId.size >= MAX_WALLS) continue;
          byId.set(wall.id, wall);
        }
        scene.walls = Array.from(byId.values());
        void this.broadcastState();
        break;
      }
      case "REMOVE_WALL": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (!scene) {
          break;
        }
        scene.walls = scene.walls.filter((wall) => wall.id !== parsed.wallId);
        void this.broadcastState();
        break;
      }
      case "SET_DOOR_STATE": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const door = scene?.walls.find((wall) => wall.id === parsed.wallId);
        if (!scene || !door || !door.door || door.door === "none") {
          break;
        }
        if (!["closed", "open", "locked"].includes(parsed.state)) {
          break;
        }
        door.state = parsed.state;
        void this.broadcastState();
        break;
      }
      case "ADD_LIGHT": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const light = sanitizeLight(parsed.light);
        if (!scene || !light) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid light." });
          return;
        }
        if (scene.lights.length >= MAX_LIGHTS) {
          this.sendTo(sender, { type: "ERROR", message: `Light limit reached (${MAX_LIGHTS}).` });
          return;
        }
        scene.lights.push(light);
        void this.broadcastState();
        break;
      }
      case "UPDATE_LIGHT": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const light = sanitizeLight(parsed.light);
        if (!scene || !light) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid light." });
          return;
        }
        scene.lights = scene.lights.map((item) => (item.id === light.id ? light : item));
        void this.broadcastState();
        break;
      }
      case "REMOVE_LIGHT": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        if (!scene) {
          break;
        }
        scene.lights = scene.lights.filter((light) => light.id !== parsed.lightId);
        void this.broadcastState();
        break;
      }
      case "SET_SHEET_FOLDER": {
        const record = this.state.sheets[parsed.sheetId];
        // "npc" files into the NPCs-page tree (independent from the Actors sidebar).
        const treeKind = parsed.tree === "npc" ? "npc" : "actor";
        const validFolder =
          parsed.folderId === null ||
          this.state.folders.some(
            (folder) => folder.id === parsed.folderId && folder.kind === treeKind,
          );
        if (!record || !validFolder) {
          this.sendTo(sender, { type: "ERROR", message: "Sheet or folder not found." });
          return;
        }
        const order =
          typeof parsed.sortOrder === "number" && Number.isFinite(parsed.sortOrder)
            ? parsed.sortOrder
            : undefined;
        if (treeKind === "npc") {
          record.npcFolderId = parsed.folderId;
          if (order !== undefined) record.npcSortOrder = order;
        } else {
          record.folderId = parsed.folderId;
          if (order !== undefined) record.sortOrder = order;
        }
        void this.broadcastState();
        break;
      }
      case "CREATE_FOLDER": {
        const folderId = parsed.folderId?.trim();
        const name = parsed.name?.trim().slice(0, 100);
        const kind =
          parsed.kind === "item" ? "item" : parsed.kind === "npc" ? "npc" : "actor";
        if (!folderId || !name || this.state.folders.some((f) => f.id === folderId)) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid or duplicate folder." });
          return;
        }
        this.state.folders.push({ id: folderId, name, kind });
        void this.broadcastState();
        break;
      }
      case "RENAME_FOLDER": {
        const folder = this.state.folders.find((f) => f.id === parsed.folderId);
        const name = parsed.name?.trim().slice(0, 100);
        if (!folder || !name) {
          this.sendTo(sender, { type: "ERROR", message: "Folder not found." });
          return;
        }
        folder.name = name;
        void this.broadcastState();
        break;
      }
      case "MOVE_FOLDER": {
        const folder = this.state.folders.find((f) => f.id === parsed.folderId);
        if (folder && typeof parsed.sortOrder === "number" && Number.isFinite(parsed.sortOrder)) {
          folder.sortOrder = parsed.sortOrder;
          void this.broadcastState();
        }
        break;
      }
      case "DELETE_FOLDER": {
        if (!this.state.folders.some((f) => f.id === parsed.folderId)) {
          break;
        }
        // Members drop back to the root; nothing is deleted with the folder.
        this.state.folders = this.state.folders.filter((f) => f.id !== parsed.folderId);
        for (const record of Object.values(this.state.sheets)) {
          if (record.folderId === parsed.folderId) {
            record.folderId = null;
          }
          if (record.npcFolderId === parsed.folderId) {
            record.npcFolderId = null;
          }
        }
        for (const item of Object.values(this.state.items)) {
          if (item.folderId === parsed.folderId) {
            item.folderId = null;
          }
        }
        void this.broadcastState();
        break;
      }
      case "CREATE_ITEM": {
        const itemId = parsed.itemId?.trim();
        const name = parsed.name?.trim().slice(0, 200);
        if (!itemId || !name || this.state.items[itemId]) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid or duplicate item." });
          return;
        }
        this.state.items[itemId] = {
          id: itemId,
          name,
          description: "",
          iconUrl: null,
          iconCrop: { ...DEFAULT_ICON_CROP },
          folderId: null,
        };
        void this.broadcastState();
        break;
      }
      case "UPDATE_ITEM": {
        const existing = this.state.items[parsed.item?.id];
        if (!existing) {
          this.sendTo(sender, { type: "ERROR", message: "Item not found." });
          return;
        }
        const next = normalizeItem({ ...parsed.item, id: existing.id });
        const validFolder =
          next.folderId === null ||
          this.state.folders.some(
            (folder) => folder.id === next.folderId && folder.kind === "item",
          );
        this.state.items[existing.id] = {
          ...next,
          name: next.name.slice(0, 200),
          description: next.description.slice(0, 5000),
          folderId: validFolder ? next.folderId : null,
        };
        // Tokens mirror their catalog item's icon — keep placed copies live.
        this.state.tokens = this.state.tokens.map((token) =>
          token.itemId === existing.id ? syncTokenFromState(token, this.state) : token,
        );
        void this.broadcastState();
        break;
      }
      case "DUPLICATE_ITEM": {
        const source = this.state.items[parsed.itemId];
        const newItemId = parsed.newItemId?.trim();
        if (!source || !newItemId || this.state.items[newItemId]) {
          this.sendTo(sender, { type: "ERROR", message: "Cannot duplicate that item." });
          return;
        }
        this.state.items[newItemId] = normalizeItem({
          ...source,
          id: newItemId,
          name: `${source.name || "Item"} (copy)`.slice(0, 200),
        });
        void this.broadcastState();
        break;
      }
      case "DELETE_ITEM": {
        // Sheet inventories keep their name copies, so this is always safe.
        delete this.state.items[parsed.itemId];
        void this.broadcastState();
        break;
      }
      case "ADD_HANDOUT": {
        const handout = normalizeHandout(parsed.handout);
        if (!handout) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid handout." });
          return;
        }
        if (this.state.handouts.length >= MAX_HANDOUTS) {
          this.sendTo(sender, {
            type: "ERROR",
            message: `Handout limit reached (${MAX_HANDOUTS}). Remove some first.`,
          });
          return;
        }
        if (this.state.handouts.some((item) => item.id === handout.id)) {
          return;
        }
        this.state.handouts.push(handout);
        // DM-only: adding to the library is prep, not a table event.
        this.logEvent(`Handout “${handout.name}” added.`, true);
        void this.broadcastState();
        break;
      }
      case "UPDATE_HANDOUT": {
        const handout = normalizeHandout(parsed.handout);
        if (!handout) {
          this.sendTo(sender, { type: "ERROR", message: "Invalid handout." });
          return;
        }
        const index = this.state.handouts.findIndex((item) => item.id === handout.id);
        if (index < 0) {
          return;
        }
        this.state.handouts[index] = handout;
        void this.broadcastState();
        break;
      }
      case "REMOVE_HANDOUT": {
        this.state.handouts = this.state.handouts.filter((item) => item.id !== parsed.handoutId);
        void this.broadcastState();
        break;
      }
      case "SHOW_HANDOUT": {
        const handout = this.state.handouts.find((item) => item.id === parsed.handoutId);
        if (!handout) {
          this.sendTo(sender, { type: "ERROR", message: "Handout not found." });
          return;
        }
        // Sanitize targets against real slots. Showing also GRANTS lasting visibility
        // (Roll20 semantics): anyone who missed the pop finds it waiting in their panel.
        const to: "all" | string[] =
          parsed.to === "all"
            ? "all"
            : [
                ...new Set(
                  (Array.isArray(parsed.to) ? parsed.to : []).filter((id) =>
                    this.state.playerSlots.some((slot) => slot.id === id),
                  ),
                ),
              ];
        if (to !== "all" && to.length === 0) {
          this.sendTo(sender, { type: "ERROR", message: "No players selected to show to." });
          return;
        }
        if (to === "all") {
          handout.visibleTo = "all";
        } else if (handout.visibleTo !== "all") {
          handout.visibleTo = [...new Set([...handout.visibleTo, ...to])];
        }
        // Self-contained targeted push (see HANDOUT_SHOW doc: it can beat the STATE frame,
        // so it carries name + URL). Straight sends — no relayTransient (nothing to throttle,
        // and its skip-the-sender rule is irrelevant to a DM-only action).
        const frame = JSON.stringify({
          type: "HANDOUT_SHOW",
          handout: { id: handout.id, name: handout.name, imageUrl: handout.imageUrl },
        } satisfies ServerMessage);
        for (const connection of this.room.getConnections()) {
          const meta = this.clients.get(connection.id);
          if (!meta?.joined || meta.role !== "player" || !meta.playerId) {
            continue;
          }
          if (to === "all" || to.includes(meta.playerId)) {
            connection.send(frame);
          }
        }
        // A subset share stays DM-only in the log — the entry itself would leak the secret.
        this.logEvent(`Handout shared: “${handout.name}”.`, to !== "all");
        void this.broadcastState();
        break;
      }
      case "SET_TOKEN_DEFAULTS": {
        this.state.tokenShapeDefaults = normalizeTokenShapeDefaults(parsed.defaults);
        void this.broadcastState();
        break;
      }
      case "SET_DEFAULT_TOKEN_SIZE": {
        if (typeof parsed.size === "number" && Number.isFinite(parsed.size)) {
          this.state.defaultTokenSize = clampTokenSize(parsed.size);
          void this.broadcastState();
        }
        break;
      }
      case "ADD_PLAYER_SLOT": {
        const slot = createPlayerSlot(parsed.name);
        this.state.playerSlots.push(slot);
        this.state.sheets[slot.id] = createPcSheetRecord(slot.id, slot.name);
        void this.broadcastState();
        break;
      }
      case "UPDATE_PLAYER_SLOT": {
        const index = this.state.playerSlots.findIndex((item) => item.id === parsed.slot.id);
        if (index < 0) {
          this.sendTo(sender, { type: "ERROR", message: "Player slot not found." });
          return;
        }
        this.state.playerSlots[index] = parsed.slot;
        const connected = this.state.connectedPlayers.find(
          (player) => player.playerId === parsed.slot.id,
        );
        if (connected) {
          connected.displayName = parsed.slot.name;
          const clientMeta = this.clients.get(connected.clientId);
          if (clientMeta) {
            clientMeta.displayName = parsed.slot.name;
          }
        }
        void this.broadcastState();
        break;
      }
      case "KICK_PLAYER": {
        const target = this.state.connectedPlayers.find(
          (player) => player.playerId === parsed.playerId,
        );
        if (!target) {
          // Nothing under that slot; the roster may just be stale — reconcile and refresh.
          if (this.pruneStaleClients()) void this.broadcastState();
          break;
        }
        const connection = this.room.getConnection(target.clientId);
        if (connection) {
          this.sendTo(connection, {
            type: "KICKED",
            message: "You were removed from the room by the DM.",
          });
          connection.close();
        }
        // Purge the client meta right away so the slot frees even when the socket was already
        // dead and onClose never fired — otherwise a ghost is unkickable (no live connection).
        this.clients.delete(target.clientId);
        if (this.state.dmClientId === target.clientId) {
          this.state.dmClientId = null;
        }
        this.logEvent(`${target.displayName} was removed by the DM.`);
        this.syncConnectedPlayers();
        void this.broadcastState();
        break;
      }
      case "REMOVE_PLAYER_SLOT": {
        if (this.isSlotTaken(parsed.slotId)) {
          this.sendTo(sender, {
            type: "ERROR",
            message: "Cannot remove a slot while a player is using it.",
          });
          return;
        }
        this.state.playerSlots = this.state.playerSlots.filter(
          (slot) => slot.id !== parsed.slotId,
        );
        delete this.state.sheets[parsed.slotId];
        // The player is gone — their character tokens leave the board with them. NPC
        // tokens they merely CONTROLLED (mind-control) stay, but revert to DM control.
        this.state.tokens = this.state.tokens
          .filter(
            (token) =>
              !(token.kind === "player" && (token.ownerPlayerId === parsed.slotId || token.sheetId === parsed.slotId)),
          )
          .map((token) =>
            token.ownerPlayerId === parsed.slotId ? { ...token, ownerPlayerId: null } : token,
          );
        void this.broadcastState();
        break;
      }
      default:
        break;
    }
  }
}

GameServer satisfies Party.Worker;
