import type * as Party from "partykit/server";
import {
  createDefaultSheet,
  createInitialState,
  createPlayerSlot,
  normalizeCharacterSheet,
  normalizeGameState,
  type ClientMessage,
  type ConnectedPlayer,
  type GameState,
  type Role,
  type Scene,
  type ServerMessage,
} from "../src/lib/types";
import { normalizeScene } from "../src/lib/sceneUtils";
import { loadCampaignFromDisk } from "./loadCampaign";

type ClientMeta = {
  role: Role | null;
  playerId: string | null;
  displayName: string | null;
  joined: boolean;
};

const ROOM_KEY = "room-key";
const VIEWPORT_THROTTLE_MS = 66;

export default class GameServer implements Party.Server {
  state: GameState;
  clients = new Map<string, ClientMeta>();
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
  persistState() {
    void this.room.storage.put("state", {
      ...this.state,
      dmClientId: null,
      connectedPlayers: [],
    });
  }

  /// <summary>
  /// Broadcasts full game state to every client with per-connection role metadata.
  /// </summary>
  broadcastState() {
    this.clearStaleDm();
    this.state = normalizeGameState(this.state);
    this.persistState();
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
    this.broadcastState();
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
    this.broadcastState();
  }

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
      this.broadcastState();
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
      this.state.characterSheets[meta.playerId] = normalizeCharacterSheet(
        parsed.sheet,
        this.state.playerSlots.find((slot) => slot.id === meta.playerId)?.name ?? "Player",
      );
      this.broadcastState();
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
          this.broadcastState();
        }
        break;
      case "ADD_SCENE":
        this.state.scenes.push(normalizeScene(parsed.scene));
        this.state.playerSlots = this.state.playerSlots.map((slot) => ({
          ...slot,
          visibleSceneIds: [...new Set([...slot.visibleSceneIds, parsed.scene.id])],
        }));
        this.broadcastState();
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
        this.broadcastState();
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
        this.broadcastState();
        break;
      }
      case "ADD_TOKEN":
        this.state.tokens.push(parsed.token);
        this.broadcastState();
        break;
      case "MOVE_TOKEN": {
        const token = this.state.tokens.find((item) => item.id === parsed.tokenId);
        if (token) {
          token.x = parsed.x;
          token.y = parsed.y;
          this.broadcastState();
        }
        break;
      }
      case "UPDATE_TOKEN":
        this.state.tokens = this.state.tokens.map((token) =>
          token.id === parsed.token.id ? parsed.token : token,
        );
        this.broadcastState();
        break;
      case "REMOVE_TOKEN":
        this.state.tokens = this.state.tokens.filter((token) => token.id !== parsed.tokenId);
        this.broadcastState();
        break;
      case "SET_PING":
        this.state.ping = {
          x: parsed.x,
          y: parsed.y,
          sceneId: this.state.activeSceneId,
        };
        this.broadcastState();
        setTimeout(() => {
          if (
            this.state.ping?.x === parsed.x &&
            this.state.ping?.y === parsed.y &&
            this.state.ping?.sceneId === this.state.activeSceneId
          ) {
            this.state.ping = null;
            this.broadcastState();
          }
        }, 3000);
        break;
      case "CLEAR_PING":
        this.state.ping = null;
        this.broadcastState();
        break;
      case "UPDATE_FOG":
        this.state.scenes = this.state.scenes.map((scene) =>
          scene.id === parsed.sceneId ? { ...scene, fogDataUrl: parsed.fogDataUrl } : scene,
        );
        this.broadcastState();
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
        this.broadcastState();
        break;
      }
      case "ADD_PLAYER_SLOT": {
        const slot = createPlayerSlot(
          parsed.name,
          this.state.scenes.map((scene) => scene.id),
        );
        this.state.playerSlots.push(slot);
        this.state.characterSheets[slot.id] = createDefaultSheet(slot.name);
        this.broadcastState();
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
        this.broadcastState();
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
        delete this.state.characterSheets[parsed.slotId];
        this.state.tokens = this.state.tokens.map((token) =>
          token.ownerPlayerId === parsed.slotId ? { ...token, ownerPlayerId: null } : token,
        );
        this.broadcastState();
        break;
      }
      default:
        break;
    }
  }
}

GameServer satisfies Party.Worker;
