import type * as Party from "partykit/server";
import {
  abilityModifier,
  createInitialState,
  createNpcSheetRecord,
  createPcSheetRecord,
  createPlayerSlot,
  DEFAULT_ABILITY_SCORE,
  EPHEMERAL_ANNOTATION_TTL_MS,
  MAX_FOG_REVEALS,
  MAX_LIGHTS,
  MAX_LOG_ENTRIES,
  MAX_MEASURE_NUMBERS,
  MAX_POINTER_ARROWS_PER_AUTHOR,
  MAX_SCENE_ANNOTATIONS,
  MAX_WALLS,
  normalizeCharacterSheet,
  normalizeGameState,
  normalizeItem,
  normalizeScene,
  normalizeToken,
  playerTokenColorForSlot,
  sanitizeAnnotation,
  sanitizeFogReveal,
  sanitizeLight,
  sanitizeWall,
  SHEET_SECTIONS,
  syncPlayerTokenFromState,
  type ClientMessage,
  type CombatEntry,
  type ConnectedPlayer,
  type DiceRoll,
  type GameState,
  type LogEntry,
  type Role,
  type Scene,
  type ServerMessage,
} from "../src/lib/types";
import { rollDiceExpression, rollWithAdvantage, secureRandInt } from "../src/lib/dice";
import {
  buildExpressionLabel,
  interpretRoll,
  rollFaceValues,
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
  /** Per-sender ruler coalescing (same pattern as the viewport hot path). */
  measureRelay = new Map<
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
  /// Initiative bonus for a sheet: DEX modifier plus the sheet's manual init field.
  /// </summary>
  initiativeBonus(sheetId: string | null): { bonus: number; dexScore: number } {
    const data = sheetId ? this.state.sheets[sheetId]?.data : undefined;
    const dexScore = data?.abilityScores["dex"] ?? DEFAULT_ABILITY_SCORE;
    return { bonus: abilityModifier(dexScore) + (data?.initiative ?? 0), dexScore };
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
  relayMeasure(senderId: string, frame: Extract<ServerMessage, { type: "MEASURE" }>) {
    const send = (message: ServerMessage) => {
      const encoded = JSON.stringify(message);
      for (const connection of this.room.getConnections()) {
        if (connection.id === senderId) {
          continue;
        }
        if (this.clients.get(connection.id)?.joined) {
          connection.send(encoded);
        }
      }
    };
    let entry = this.measureRelay.get(senderId);
    if (!entry) {
      entry = { last: 0, timer: null, pending: null };
      this.measureRelay.set(senderId, entry);
    }
    if (frame.points === null) {
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
    this.clearStaleDm();
    this.sendLobbyState(connection);
  }

  onClose(connection: Party.Connection) {
    const meta = this.clients.get(connection.id);
    this.clients.delete(connection.id);
    const relay = this.measureRelay.get(connection.id);
    if (relay?.timer) {
      clearTimeout(relay.timer);
    }
    this.measureRelay.delete(connection.id);

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
      record.data = normalizeCharacterSheet({ ...record.data, ...parsed.sheet }, fallbackName);
      if (record.ownerSlotId) {
        this.state.tokens = this.state.tokens.map((token) =>
          token.ownerPlayerId === record.ownerSlotId
            ? syncPlayerTokenFromState(token, this.state)
            : token,
        );
      }
      void this.broadcastState();
      return;
    }

    if (parsed.type === "MOVE_TOKEN") {
      if (meta.role === "player" && meta.playerId) {
        const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
        if (!token || token.ownerPlayerId !== meta.playerId) {
          this.sendTo(sender, { type: "ERROR", message: "You can only move your own token." });
          return;
        }
        token.x = parsed.x;
        token.y = parsed.y;
        void this.broadcastState();
        return;
      }
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
      const roll: DiceRoll = {
        id: `roll-${crypto.randomUUID().slice(0, 8)}`,
        rollerName: meta.displayName?.trim() || "Unknown",
        rollerId: meta.playerId ?? "unknown",
        expression: buildExpressionLabel(specs, modifier),
        rolls,
        modifier,
        total: total + modifier,
        timestamp: Date.now(),
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
      // spoils the result mid-tumble. (v1 behavior; capped for safety.)
      const settleMs = Math.min((track.frames / track.fps) * 1000 + 400, 8000);
      const label = parsed.context?.label;
      setTimeout(() => {
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
      this.relayMeasure(sender.id, {
        type: "MEASURE",
        clientId: sender.id,
        name: meta.displayName?.trim() || "?",
        color,
        sceneId: parsed.sceneId,
        points,
      });
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
      // The shift-drag pointer arrow is always allowed; the Draw tool (strokes etc.) is
      // gated for players behind the DM's playersCanDraw switch.
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
        const token = syncPlayerTokenFromState(normalizeToken(parsed.token), this.state);
        this.state.tokens.push(token);
        this.logEvent(`Token “${token.label || "Token"}” placed.`);
        void this.broadcastState();
        break;
      }
      case "MOVE_TOKEN": {
        const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
        if (token) {
          token.x = parsed.x;
          token.y = parsed.y;
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
          this.logEvent(`Token “${removed.label || "Token"}” removed.`);
        }
        void this.broadcastState();
        break;
      }
      case "IMPORT_CAMPAIGN": {
        const manifest = parsed.manifest;
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
          const isPc = Boolean(token.ownerPlayerId);
          const { bonus, dexScore } = this.initiativeBonus(token.sheetId);
          // NPCs auto-roll; PCs wait for their player's click.
          const initiative = isPc ? null : secureRandInt(20) + 1 + bonus;
          return {
            id: `centry-${crypto.randomUUID().slice(0, 8)}`,
            tokenId: token.id,
            sheetId: token.sheetId,
            name: token.label || "Combatant",
            initiative,
            dexScore,
            hasRolled: initiative !== null,
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
      case "TOGGLE_DOOR": {
        const scene = this.state.scenes.find((item) => item.id === parsed.sceneId);
        const door = scene?.walls.find((wall) => wall.id === parsed.wallId);
        if (!scene || !door || door.kind !== "door") {
          break;
        }
        door.open = !door.open;
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
        const validFolder =
          parsed.folderId === null ||
          this.state.folders.some(
            (folder) => folder.id === parsed.folderId && folder.kind === "actor",
          );
        if (!record || !validFolder) {
          this.sendTo(sender, { type: "ERROR", message: "Sheet or folder not found." });
          return;
        }
        record.folderId = parsed.folderId;
        if (typeof parsed.sortOrder === "number" && Number.isFinite(parsed.sortOrder)) {
          record.sortOrder = parsed.sortOrder;
        }
        void this.broadcastState();
        break;
      }
      case "CREATE_FOLDER": {
        const folderId = parsed.folderId?.trim();
        const name = parsed.name?.trim().slice(0, 100);
        const kind = parsed.kind === "item" ? "item" : "actor";
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
        void this.broadcastState();
        break;
      }
      case "DELETE_ITEM": {
        // Sheet inventories keep their name copies, so this is always safe.
        delete this.state.items[parsed.itemId];
        void this.broadcastState();
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
        const connection = target ? this.room.getConnection(target.clientId) : null;
        if (connection) {
          this.sendTo(connection, {
            type: "KICKED",
            message: "You were removed from the room by the DM.",
          });
          if (target) {
            this.logEvent(`${target.displayName} was removed by the DM.`);
          }
          connection.close();
        }
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
        this.state.tokens = this.state.tokens.map((token) =>
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
