import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";
import type {
  CharacterSheet,
  ClientMessage,
  Folder,
  GameState,
  ItemRecord,
  JoinMessage,
  PlayerSlot,
  Role,
  Scene,
  ServerMessage,
  SheetSectionId,
  Token,
  Viewport,
} from "../lib/types";
import { normalizeGameState } from "../lib/types";
import type { CampaignManifest } from "../lib/campaignManifest";

/// <summary>
/// Resolves the PartyKit host for dev (Vite proxy) or production (env var).
/// </summary>
function getPartyKitHost(): string {
  if (import.meta.env.VITE_PARTYKIT_HOST) {
    return import.meta.env.VITE_PARTYKIT_HOST;
  }
  if (import.meta.env.DEV) {
    return window.location.host;
  }
  throw new Error("VITE_PARTYKIT_HOST is required in production builds.");
}

const PARTYKIT_PARTY = "main";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "joined"
  /** Connection dropped after a successful join; PartySocket is auto-rejoining. */
  | "reconnecting";

export type JoinParams =
  | { role: "dm"; displayName: string; roomKey: string }
  | { role: "player"; slotId: string; roomKey: string };

export type RollOptions = {
  private?: boolean;
  context?: { sheetId?: string; label?: string };
  adv?: "adv" | "dis";
};

/** The transient 3D-throw broadcast, dispatched to dice-overlay subscribers. */
export type DiceThrowEvent = Extract<ServerMessage, { type: "DICE_THROW" }>;

/** Another client's live ruler (transient relay), dispatched to map subscribers. */
export type MeasureEvent = Extract<ServerMessage, { type: "MEASURE" }>;

export type GameRoom = {
  status: ConnectionStatus;
  error: string | null;
  state: GameState | null;
  yourClientId: string | null;
  yourRole: Role | null;
  yourPlayerId: string | null;
  send: (message: ClientMessage) => void;
  join: (params: JoinParams) => void;
  rollDice: (expression: string, options?: RollOptions) => void;
  /** Listen for 3D dice throws; returns an unsubscribe function. */
  subscribeDice: (listener: (event: DiceThrowEvent) => void) => () => void;
  /** Listen for other clients' live rulers; returns an unsubscribe function. */
  subscribeMeasure: (listener: (event: MeasureEvent) => void) => () => void;
  clearError: () => void;
};

export type RoomLobby = {
  status: "idle" | "connecting" | "ready" | "error";
  error: string | null;
  state: GameState | null;
  availableSlots: PlayerSlot[];
};

/// <summary>
/// Connects to a room without joining so players can pick an open character slot.
/// </summary>
export function useRoomLobby(roomId: string, enabled: boolean): RoomLobby {
  const [status, setStatus] = useState<RoomLobby["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);

  useEffect(() => {
    if (!enabled || !roomId.trim()) {
      setStatus("idle");
      setError(null);
      setState(null);
      return;
    }

    setStatus("connecting");
    setError(null);

    const socket = new PartySocket({
      host: getPartyKitHost(),
      room: roomId.trim(),
      party: PARTYKIT_PARTY,
    });

    socket.addEventListener("open", () => {
      setStatus("ready");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "STATE") {
        setState(normalizeGameState(message.state));
        setStatus("ready");
      } else if (message.type === "ERROR") {
        setError(message.message);
        setStatus("error");
      }
    });

    socket.addEventListener("close", () => {
      setError("Could not reach the room. Is PartyKit running?");
      setStatus("error");
    });

    socket.addEventListener("error", () => {
      setError("Could not connect to the game server.");
      setStatus("error");
    });

    return () => {
      socket.close();
    };
  }, [enabled, roomId]);

  const takenSlotIds = new Set(
    state?.connectedPlayers.map((player) => player.playerId) ?? [],
  );
  const availableSlots =
    state?.playerSlots.filter((slot) => !takenSlotIds.has(slot.id)) ?? [];

  return { status, error, state, availableSlots };
}

export type CampaignPlayerCount = {
  count: number | null;
  loading: boolean;
};

/// <summary>
/// Counts connected player slots in a room lobby, excluding the dungeon master.
/// </summary>
function lobbyPlayerCount(state: GameState): number {
  return state.connectedPlayers.filter((player) => player.playerId !== "dm").length;
}

/// <summary>
/// Opens lightweight lobby sockets for each room and tracks live player counts.
/// </summary>
export function useCampaignPlayerCounts(roomIds: string[]): Record<string, CampaignPlayerCount> {
  const stableRoomIds = useMemo(() => {
    const ids = roomIds.map((id) => id.trim()).filter(Boolean);
    return [...new Set(ids)].sort();
  }, [roomIds]);

  const roomKey = stableRoomIds.join("|");
  const [counts, setCounts] = useState<Record<string, CampaignPlayerCount>>({});

  useEffect(() => {
    if (stableRoomIds.length === 0) {
      setCounts({});
      return;
    }

    setCounts(
      Object.fromEntries(
        stableRoomIds.map((id) => [id, { count: null, loading: true }]),
      ),
    );

    const sockets = stableRoomIds.map((roomId) => {
      const socket = new PartySocket({
        host: getPartyKitHost(),
        room: roomId,
        party: PARTYKIT_PARTY,
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        if (message.type === "STATE") {
          setCounts((prev) => ({
            ...prev,
            [roomId]: { count: lobbyPlayerCount(message.state), loading: false },
          }));
        }
      });

      socket.addEventListener("close", () => {
        setCounts((prev) => ({
          ...prev,
          [roomId]: {
            count: prev[roomId]?.count ?? null,
            loading: false,
          },
        }));
      });

      socket.addEventListener("error", () => {
        setCounts((prev) => ({
          ...prev,
          [roomId]: {
            count: prev[roomId]?.count ?? null,
            loading: false,
          },
        }));
      });

      return socket;
    });

    return () => {
      for (const socket of sockets) {
        socket.close();
      }
    };
  }, [roomKey, stableRoomIds]);

  return counts;
}

/// <summary>
/// Manages the PartyKit WebSocket connection and authoritative game state for a room.
/// </summary>
export function useGameRoom(roomId: string | null): GameRoom {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [yourClientId, setYourClientId] = useState<string | null>(null);
  const [yourRole, setYourRole] = useState<Role | null>(null);
  const [yourPlayerId, setYourPlayerId] = useState<string | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const pendingJoinRef = useRef<JoinMessage | null>(null);
  const everJoinedRef = useRef(false);
  const diceListenersRef = useRef<Set<(event: DiceThrowEvent) => void>>(new Set());
  const measureListenersRef = useRef<Set<(event: MeasureEvent) => void>>(new Set());

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const rollDice = useCallback(
    (expression: string, options?: RollOptions) => {
      send({
        type: "ROLL_DICE",
        expression,
        private: options?.private,
        context: options?.context,
        adv: options?.adv,
      });
    },
    [send],
  );

  const join = useCallback(
    (params: JoinParams) => {
      const message: JoinMessage =
        params.role === "dm"
          ? {
              type: "JOIN",
              role: "dm",
              displayName: params.displayName,
              roomKey: params.roomKey,
            }
          : {
              type: "JOIN",
              role: "player",
              slotId: params.slotId,
              roomKey: params.roomKey,
            };
      pendingJoinRef.current = message;
      if (params.role === "player") {
        setYourPlayerId(params.slotId);
      } else {
        setYourPlayerId("dm");
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        send(message);
      }
    },
    [send],
  );

  useEffect(() => {
    if (!roomId) {
      return;
    }

    setStatus("connecting");
    setError(null);
    everJoinedRef.current = false;

    const socket = new PartySocket({
      host: getPartyKitHost(),
      room: roomId,
      party: PARTYKIT_PARTY,
    });

    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setStatus("connected");
      const pending = pendingJoinRef.current;
      if (pending) {
        socket.send(JSON.stringify(pending));
      }
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "STATE") {
        setState(normalizeGameState(message.state));
        setYourClientId(message.yourClientId);
        setYourRole(message.yourRole);
        if (message.yourRole) {
          everJoinedRef.current = true;
          setStatus("joined");
        }
      } else if (message.type === "VIEWPORT") {
        // Hot-path delta: patch the shared viewport without reprocessing full state.
        setState((current) =>
          current ? { ...current, viewport: message.viewport } : current,
        );
      } else if (message.type === "DICE_THROW") {
        for (const listener of diceListenersRef.current) {
          listener(message);
        }
      } else if (message.type === "MEASURE") {
        for (const listener of measureListenersRef.current) {
          listener(message);
        }
      } else if (message.type === "JOINED") {
        setYourRole(message.role);
        setYourPlayerId(message.playerId);
        everJoinedRef.current = true;
        setStatus("joined");
        setError(null);
      } else if (message.type === "KICKED") {
        // Prevent PartySocket's auto-reconnect from silently rejoining after a kick.
        pendingJoinRef.current = null;
        setError(message.message);
        setStatus("disconnected");
      } else if (message.type === "ERROR") {
        // Never downgrade the connection status: an in-game rules error
        // ("cannot remove that slot", …) must not eject a joined client.
        setError(message.message);
      }
    });

    socket.addEventListener("close", () => {
      // A drop after a successful join is a blip: PartySocket auto-reconnects and
      // the pending join is re-sent on open. Only unjoined failures are terminal.
      if (everJoinedRef.current && pendingJoinRef.current) {
        setStatus("reconnecting");
        return;
      }
      setStatus("disconnected");
      setError((prev) =>
        prev ?? "Lost connection to the game server. Is PartyKit running on port 1999?",
      );
    });

    socket.addEventListener("error", () => {
      setError(
        "Could not connect to the game server. Start PartyKit with: npm run partykit:dev",
      );
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [roomId]);

  const clearError = useCallback(() => setError(null), []);

  const subscribeDice = useCallback((listener: (event: DiceThrowEvent) => void) => {
    diceListenersRef.current.add(listener);
    return () => {
      diceListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeMeasure = useCallback((listener: (event: MeasureEvent) => void) => {
    measureListenersRef.current.add(listener);
    return () => {
      measureListenersRef.current.delete(listener);
    };
  }, []);

  return {
    status,
    error,
    state,
    yourClientId,
    yourRole,
    yourPlayerId,
    send,
    join,
    rollDice,
    subscribeDice,
    subscribeMeasure,
    clearError,
  };
}

export function useDmActions(room: GameRoom) {
  const { send, yourRole } = room;

  return useMemo(
    () => ({
      isDm: yourRole === "dm",
      updateViewport: (viewport: Viewport) => send({ type: "UPDATE_VIEWPORT", viewport }),
      setScene: (sceneId: string) => send({ type: "SET_SCENE", sceneId }),
      addScene: (scene: Scene) => send({ type: "ADD_SCENE", scene }),
      updateScene: (scene: Scene) => send({ type: "UPDATE_SCENE", scene }),
      removeScene: (sceneId: string) => send({ type: "REMOVE_SCENE", sceneId }),
      addToken: (token: Token) => send({ type: "ADD_TOKEN", token }),
      moveToken: (tokenId: string, x: number, y: number) =>
        send({ type: "MOVE_TOKEN", tokenId, x, y }),
      updateToken: (token: Token) => send({ type: "UPDATE_TOKEN", token }),
      removeToken: (tokenId: string) => send({ type: "REMOVE_TOKEN", tokenId }),
      importCampaign: (manifest: CampaignManifest) =>
        send({ type: "IMPORT_CAMPAIGN", manifest }),
      addPlayerSlot: (name: string) => send({ type: "ADD_PLAYER_SLOT", name }),
      updatePlayerSlot: (slot: PlayerSlot) => send({ type: "UPDATE_PLAYER_SLOT", slot }),
      removePlayerSlot: (slotId: string) => send({ type: "REMOVE_PLAYER_SLOT", slotId }),
      kickPlayer: (playerId: string) => send({ type: "KICK_PLAYER", playerId }),
      updateSheet: (sheetId: string, sheet: CharacterSheet) =>
        send({ type: "UPDATE_SHEET", sheetId, sheet }),
      createSheet: (sheetId: string, name: string) =>
        send({ type: "CREATE_SHEET", sheetId, name }),
      duplicateSheet: (sheetId: string, newSheetId: string) =>
        send({ type: "DUPLICATE_SHEET", sheetId, newSheetId }),
      deleteSheet: (sheetId: string) => send({ type: "DELETE_SHEET", sheetId }),
      setSheetReveal: (sheetId: string, section: SheetSectionId, revealed: boolean) =>
        send({ type: "SET_SHEET_REVEAL", sheetId, section, revealed }),
      updateDmNotes: (notes: string) => send({ type: "UPDATE_DM_NOTES", notes }),
      startCombat: (tokenIds: string[]) => send({ type: "COMBAT_START", tokenIds }),
      setCombatInitiative: (entryId: string, value: number) =>
        send({ type: "COMBAT_SET_INITIATIVE", entryId, value }),
      nextTurn: () => send({ type: "COMBAT_NEXT" }),
      prevTurn: () => send({ type: "COMBAT_PREV" }),
      endCombat: () => send({ type: "COMBAT_END" }),
      setSheetFolder: (sheetId: string, folderId: string | null, sortOrder?: number) =>
        send({ type: "SET_SHEET_FOLDER", sheetId, folderId, sortOrder }),
      createFolder: (folderId: string, kind: Folder["kind"], name: string) =>
        send({ type: "CREATE_FOLDER", folderId, kind, name }),
      renameFolder: (folderId: string, name: string) =>
        send({ type: "RENAME_FOLDER", folderId, name }),
      deleteFolder: (folderId: string) => send({ type: "DELETE_FOLDER", folderId }),
      createItem: (itemId: string, name: string) => send({ type: "CREATE_ITEM", itemId, name }),
      updateItem: (item: ItemRecord) => send({ type: "UPDATE_ITEM", item }),
      deleteItem: (itemId: string) => send({ type: "DELETE_ITEM", itemId }),
      clearAnnotations: (sceneId: string) => send({ type: "CLEAR_ANNOTATIONS", sceneId }),
      setFogEnabled: (sceneId: string, enabled: boolean) =>
        send({ type: "FOG_SET", sceneId, enabled }),
      resetFog: (sceneId: string) => send({ type: "FOG_RESET", sceneId }),
    }),
    [send, yourRole],
  );
}

export function usePlayerSheet(room: GameRoom) {
  const { send, yourRole, yourPlayerId, state } = room;

  const sheet =
    yourPlayerId && state ? (state.sheets[yourPlayerId]?.data ?? null) : null;

  const updateSheet = useCallback(
    (next: CharacterSheet) => {
      if (yourRole === "player" && yourPlayerId) {
        send({ type: "UPDATE_SHEET", sheetId: yourPlayerId, sheet: next });
      }
    },
    [send, yourRole, yourPlayerId],
  );

  return { sheet, updateSheet, canEdit: yourRole === "player" };
}
