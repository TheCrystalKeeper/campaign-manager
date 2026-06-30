import type * as Party from "partykit/server";
import {
  createDefaultSheet,
  createInitialState,
  createPlayerSlot,
  normalizeCharacterSheet,
  normalizeGameState,
  normalizeSheetTemplate,
  normalizeToken,
  syncPlayerTokenFromState,
  type ClientMessage,
  type ConnectedPlayer,
  type DiceRoll,
  type GameState,
  type Role,
  type Scene,
  type ServerMessage,
} from "../src/lib/types";
import { normalizeScene } from "../src/lib/sceneUtils";
import { normalizeTokenTemplate } from "../src/lib/tokenTemplate";
import {
  ANNOTATION_DURATION_MS,
  annotationPathLength,
  annotationRemainingMs,
  isAnnotationExpired,
  isValidAnnotationPoints,
  MAX_ACTIVE_ANNOTATIONS_PER_PLAYER,
  normalizeMapAnnotation,
  trimAnnotationPoints,
} from "../src/lib/mapAnnotation";
import { rollDiceExpression, secureRandInt } from "../src/lib/dice";
import {
  buildExpressionLabel,
  interpretRoll,
  rollFaceValues,
} from "../src/dice3d/diceProtocol";
import { loadCampaignFromDisk } from "./loadCampaign";

type ClientMeta = {
  role: Role | null;
  playerId: string | null;
  displayName: string | null;
  joined: boolean;
};

const ROOM_KEY = "room-key";
const VIEWPORT_THROTTLE_MS = 66;
const MAX_PUBLIC_DICE_LOG = 50;
const MAX_DICE_PER_THROW = 20;

export default class GameServer implements Party.Server {
  state: GameState;
  clients = new Map<string, ClientMeta>();
  annotationRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  lastViewportBroadcast = 0;
  pendingViewport: GameState["viewport"] | null = null;
  viewportTimer: ReturnType<typeof setTimeout> | null = null;

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
        scenes: stored.scenes.map((scene) => normalizeScene(scene)),
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
    this.pruneAndRescheduleAnnotations();
    await this.persistState();
  }

  /// <summary>
  /// Drops expired annotations and rebuilds removal timers after durable storage reload.
  /// </summary>
  pruneAndRescheduleAnnotations() {
    const now = Date.now();
    const annotations = (this.state.annotations ?? [])
      .map((annotation) => normalizeMapAnnotation(annotation))
      .filter((annotation) => !isAnnotationExpired(annotation.createdAt, now));

    this.state.annotations = annotations;

    for (const timer of this.annotationRemovalTimers.values()) {
      clearTimeout(timer);
    }
    this.annotationRemovalTimers.clear();

    for (const annotation of annotations) {
      this.scheduleAnnotationRemoval(annotation.id, annotationRemainingMs(annotation.createdAt, now));
    }
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
  /// Broadcasts a typed message to all clients, optionally excluding one connection.
  /// </summary>
  broadcast(message: ServerMessage, exceptId?: string) {
    this.room.broadcast(JSON.stringify(message), exceptId ? [exceptId] : []);
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
      publicDiceLog: (this.state.publicDiceLog ?? []).slice(-MAX_PUBLIC_DICE_LOG),
    });
  }

  /// <summary>
  /// Broadcasts full game state to every client with per-connection role metadata.
  /// </summary>
  async broadcastState() {
    this.clearStaleDm();
    this.state = normalizeGameState(this.state);
    await this.persistState();
    for (const connection of this.room.getConnections()) {
      const meta = this.clients.get(connection.id);
      this.sendTo(connection, {
        type: "STATE",
        state: this.state,
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
      state: this.state,
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
  /// Applies the latest pending viewport and broadcasts state.
  /// </summary>
  flushViewport() {
    if (!this.pendingViewport) {
      return;
    }
    this.state.viewport = this.pendingViewport;
    this.pendingViewport = null;
    this.lastViewportBroadcast = Date.now();
    void this.broadcastState();
  }

  /// <summary>
  /// Removes one annotation by id and only broadcasts when state actually changed.
  /// </summary>
  removeAnnotationById(annotationId: string) {
    const before = this.state.annotations?.length ?? 0;
    this.state.annotations = (this.state.annotations ?? []).filter(
      (item) => item.id !== annotationId,
    );
    this.annotationRemovalTimers.delete(annotationId);
    if ((this.state.annotations?.length ?? 0) !== before) {
      void this.broadcastState();
    }
  }

  /// <summary>
  /// Schedules annotation expiry, replacing any existing timer for that annotation id.
  /// </summary>
  scheduleAnnotationRemoval(annotationId: string, delayMs: number) {
    const existingTimer = this.annotationRemovalTimers.get(annotationId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      this.removeAnnotationById(annotationId);
    }, delayMs);
    this.annotationRemovalTimers.set(annotationId, timer);
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
    this.clients.delete(connection.id);

    if (this.state.dmClientId === connection.id) {
      this.state.dmClientId = null;
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

        if (!this.state.characterSheets[parsed.slotId]) {
          this.state.characterSheets[parsed.slotId] = createDefaultSheet(slot.name);
        }
      }

      this.syncConnectedPlayers();
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

    if (parsed.type === "UPDATE_MY_SHEET") {
      if (meta.role !== "player" || !meta.playerId) {
        this.sendTo(sender, { type: "ERROR", message: "Only players can update character sheets." });
        return;
      }
      const slotName =
        this.state.playerSlots.find((slot) => slot.id === meta.playerId)?.name ?? "Player";
      const existing = this.state.characterSheets[meta.playerId];
      this.state.characterSheets[meta.playerId] = normalizeCharacterSheet(
        existing ? { ...existing, ...parsed.sheet } : parsed.sheet,
        slotName,
      );
      this.state.tokens = this.state.tokens.map((token) =>
        token.ownerPlayerId === meta.playerId
          ? syncPlayerTokenFromState(token, this.state)
          : token,
      );
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

    if (parsed.type === "ADD_ANNOTATION") {
      if (!meta.playerId) {
        return;
      }
      const points = parsed.points;
      if (!isValidAnnotationPoints(points)) {
        return;
      }
      const trimmedPoints = trimAnnotationPoints(points);
      if (annotationPathLength(trimmedPoints) < 8) {
        return;
      }
      if (!this.state.scenes.some((scene) => scene.id === parsed.sceneId)) {
        return;
      }
      const activePlayerAnnotations = (this.state.annotations ?? []).filter(
        (item) => item.playerId === meta.playerId && !isAnnotationExpired(item.createdAt),
      );
      if (activePlayerAnnotations.length >= MAX_ACTIVE_ANNOTATIONS_PER_PLAYER) {
        return;
      }
      const now = Date.now();
      const annotation = {
        id: `ann-${crypto.randomUUID().slice(0, 8)}`,
        sceneId: parsed.sceneId,
        playerId: meta.playerId,
        playerName: meta.displayName?.trim() || "Player",
        color: parsed.color || "#fcd34d",
        points: trimmedPoints,
        createdAt: now,
      };
      const existing = this.state.annotations ?? [];
      this.state.annotations = [...existing, annotation].slice(-24);
      void this.broadcastState();
      this.scheduleAnnotationRemoval(annotation.id, ANNOTATION_DURATION_MS);
      return;
    }

    if (parsed.type === "ROLL_DICE") {
      try {
        const result = rollDiceExpression(parsed.expression, secureRandInt);
        const roll: DiceRoll = {
          id: `roll-${crypto.randomUUID().slice(0, 8)}`,
          rollerName: meta.displayName?.trim() || "Unknown",
          rollerId: meta.playerId ?? "unknown",
          expression: result.expression,
          rolls: result.rolls,
          modifier: result.modifier,
          total: result.total,
          timestamp: Date.now(),
        };

        if (parsed.private) {
          if (!this.isDm(sender.id)) {
            this.sendTo(sender, { type: "ERROR", message: "Only the DM can make secret rolls." });
            return;
          }
          this.sendTo(sender, { type: "DM_DICE_ROLL", roll });
          return;
        }

        const log = this.state.publicDiceLog ?? [];
        this.state.publicDiceLog = [...log, roll].slice(-MAX_PUBLIC_DICE_LOG);
        void this.broadcastState();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid dice expression.";
        this.sendTo(sender, { type: "ERROR", message });
      }
      return;
    }

    if (parsed.type === "DICE_MOTION") {
      // Pure relay of another player's live drag/shake so everyone sees it move.
      if (!Array.isArray(parsed.transforms) || parsed.transforms.length > MAX_DICE_PER_THROW) {
        return;
      }
      const specs =
        Array.isArray(parsed.specs) && parsed.specs.length > 0 && parsed.specs.length <= MAX_DICE_PER_THROW
          ? parsed.specs
          : undefined;
      this.broadcast(
        {
          type: "DICE_MOTION",
          rollId: parsed.rollId,
          rollerId: meta.playerId ?? "unknown",
          rollerName: meta.displayName?.trim() || "Unknown",
          specs,
          transforms: parsed.transforms,
          cursor: parsed.cursor,
          trayCenter: parsed.trayCenter,
          secret: parsed.secret && this.isDm(sender.id) ? true : undefined,
        },
        sender.id,
      );
      return;
    }

    if (parsed.type === "DICE_THROW_REQUEST") {
      const specs = parsed.specs;
      if (!Array.isArray(specs) || specs.length < 1 || specs.length > MAX_DICE_PER_THROW) {
        this.sendTo(sender, { type: "ERROR", message: "Invalid dice throw." });
        return;
      }
      const isPrivate = Boolean(parsed.private);
      if (isPrivate && !this.isDm(sender.id)) {
        this.sendTo(sender, { type: "ERROR", message: "Only the DM can make secret rolls." });
        return;
      }

      // Server is authoritative: pick each face value with the CSPRNG.
      const faceValues = rollFaceValues(specs, secureRandInt);
      const modifier = Number.isFinite(parsed.modifier) ? Math.trunc(parsed.modifier) : 0;
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

      const throwMessage: ServerMessage = {
        type: "DICE_THROW",
        rollId: parsed.rollId,
        rollerId: roll.rollerId,
        rollerName: roll.rollerName,
        specs,
        track: parsed.track,
        faceValues,
        roll,
        private: isPrivate,
        trayCenter: parsed.trayCenter,
      };

      // The animation plays immediately, but the log entry only appears once the dice
      // would have finished rolling — defer by the recorded track's duration.
      const track = parsed.track;
      const settleMs =
        track && track.fps > 0 ? Math.min((track.frames / track.fps) * 1000, 12000) : 0;
      const delayMs = settleMs + 300;

      if (isPrivate) {
        // Secret roll: the DM (sender) gets the full result; everyone else sees the dice
        // tumble but with faceValues + roll stripped, so they render blank and can't read it.
        this.sendTo(sender, throwMessage);
        const blankMessage: ServerMessage = {
          type: "DICE_THROW",
          rollId: parsed.rollId,
          rollerId: roll.rollerId,
          rollerName: roll.rollerName,
          specs,
          track: parsed.track,
          private: true,
          trayCenter: parsed.trayCenter,
        };
        this.broadcast(blankMessage, sender.id);
        setTimeout(() => this.sendTo(sender, { type: "DM_DICE_ROLL", roll }), delayMs);
        return;
      }

      this.broadcast(throwMessage);
      setTimeout(() => {
        const log = this.state.publicDiceLog ?? [];
        this.state.publicDiceLog = [...log, roll].slice(-MAX_PUBLIC_DICE_LOG);
        void this.broadcastState();
      }, delayMs);
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
      case "SET_SCENE":
        if (this.state.scenes.some((scene) => scene.id === parsed.sceneId)) {
          this.state.activeSceneId = parsed.sceneId;
          this.state.ping = null;
          void this.broadcastState();
        }
        break;
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
        this.state.playerSlots = this.state.playerSlots.map((slot) => ({
          ...slot,
          visibleSceneIds: slot.visibleSceneIds.filter((id) => id !== parsed.sceneId),
        }));
        if (this.state.activeSceneId === parsed.sceneId) {
          this.state.activeSceneId = this.state.scenes[0].id;
        }
        void this.broadcastState();
        break;
      }
      case "ADD_TOKEN":
        this.state.tokens.push(
          syncPlayerTokenFromState(normalizeToken(parsed.token), this.state),
        );
        void this.broadcastState();
        break;
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
      case "REMOVE_TOKEN":
        this.state.tokens = this.state.tokens.filter((token) => token.id !== parsed.tokenId);
        void this.broadcastState();
        break;
      case "ADD_TOKEN_TEMPLATE": {
        const template = normalizeTokenTemplate(parsed.template);
        this.state.tokenTemplates = [...(this.state.tokenTemplates ?? []), template];
        void this.broadcastState();
        break;
      }
      case "UPDATE_TOKEN_TEMPLATE": {
        const template = normalizeTokenTemplate(parsed.template);
        this.state.tokenTemplates = (this.state.tokenTemplates ?? []).map((item) =>
          item.id === template.id ? template : item,
        );
        void this.broadcastState();
        break;
      }
      case "REMOVE_TOKEN_TEMPLATE":
        this.state.tokenTemplates = (this.state.tokenTemplates ?? []).filter(
          (item) => item.id !== parsed.templateId,
        );
        void this.broadcastState();
        break;
      case "SET_PING":
        this.state.ping = {
          x: parsed.x,
          y: parsed.y,
          sceneId: this.state.activeSceneId,
        };
        void this.broadcastState();
        setTimeout(() => {
          if (
            this.state.ping?.x === parsed.x &&
            this.state.ping?.y === parsed.y &&
            this.state.ping?.sceneId === this.state.activeSceneId
          ) {
            this.state.ping = null;
            void this.broadcastState();
          }
        }, 3000);
        break;
      case "CLEAR_PING":
        this.state.ping = null;
        void this.broadcastState();
        break;
      case "UPDATE_FOG":
        this.state.scenes = this.state.scenes.map((scene) =>
          scene.id === parsed.sceneId ? { ...scene, fogDataUrl: parsed.fogDataUrl } : scene,
        );
        void this.broadcastState();
        break;
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
        this.state.ping = null;
        void this.broadcastState();
        break;
      }
      case "ADD_PLAYER_SLOT": {
        const slot = createPlayerSlot(
          parsed.name,
          this.state.scenes.map((scene) => scene.id),
        );
        this.state.playerSlots.push(slot);
        this.state.characterSheets[slot.id] = createDefaultSheet(slot.name);
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
      case "UPDATE_SHEET_TEMPLATE":
        this.state.sheetTemplate = normalizeSheetTemplate(parsed.template);
        void this.broadcastState();
        break;
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
        delete this.state.characterSheets[parsed.slotId];
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
