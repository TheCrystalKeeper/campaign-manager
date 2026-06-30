import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PartySocket from "partysocket";
import type {
  CharacterSheet,
  ClientMessage,
  DiceRoll,
  GameState,
  JoinMessage,
  PlayerSlot,
  Role,
  Scene,
  ServerMessage,
  SheetTemplate,
  Token,
  Viewport,
} from "../lib/types";
import { normalizeGameState } from "../lib/types";
import type { CampaignManifest } from "../lib/campaignManifest";
import type { CursorPoint, DiceTrack, DieSpec, DieTransform, WorldPoint } from "../dice3d/diceProtocol";

/** Transient dice events (throws + live drag motion) that drive the 3D dice arena. */
export type DiceEvent =
  | Extract<ServerMessage, { type: "DICE_THROW" }>
  | Extract<ServerMessage, { type: "DICE_MOTION" }>;

export type ThrowDicePayload = {
  rollId: string;
  specs: DieSpec[];
  track: DiceTrack;
  modifier: number;
  private?: boolean;
  /** Map/world anchor for this roll's tray. */
  trayCenter?: WorldPoint;
};

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

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "joined";

export type JoinParams =
  | { role: "dm"; displayName: string; roomKey: string }
  | { role: "player"; slotId: string; roomKey: string };

export type GameRoom = {
  status: ConnectionStatus;
  error: string | null;
  state: GameState | null;
  yourClientId: string | null;
  yourRole: Role | null;
  yourPlayerId: string | null;
  privateDiceLog: DiceRoll[];
  send: (message: ClientMessage) => void;
  join: (params: JoinParams) => void;
  rollDice: (expression: string, options?: { private?: boolean }) => void;
  throwDice: (payload: ThrowDicePayload) => void;
  sendDiceMotion: (
    rollId: string,
    specs: DieSpec[],
    transforms: DieTransform[],
    cursor?: CursorPoint,
    trayCenter?: WorldPoint,
  ) => void;
  subscribeDice: (handler: (event: DiceEvent) => void) => () => void;
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
  const [privateDiceLog, setPrivateDiceLog] = useState<DiceRoll[]>([]);
  const socketRef = useRef<PartySocket | null>(null);
  const pendingJoinRef = useRef<JoinMessage | null>(null);
  const diceListenersRef = useRef<Set<(event: DiceEvent) => void>>(new Set());

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }, []);

  const rollDice = useCallback(
    (expression: string, options?: { private?: boolean }) => {
      send({ type: "ROLL_DICE", expression, private: options?.private });
    },
    [send],
  );

  const throwDice = useCallback(
    (payload: ThrowDicePayload) => {
      send({
        type: "DICE_THROW_REQUEST",
        rollId: payload.rollId,
        specs: payload.specs,
        track: payload.track,
        modifier: payload.modifier,
        private: payload.private,
        trayCenter: payload.trayCenter,
      });
    },
    [send],
  );

  const sendDiceMotion = useCallback(
    (
      rollId: string,
      specs: DieSpec[],
      transforms: DieTransform[],
      cursor?: CursorPoint,
      trayCenter?: WorldPoint,
    ) => {
      send({ type: "DICE_MOTION", rollId, specs, transforms, cursor, trayCenter });
    },
    [send],
  );

  const subscribeDice = useCallback((handler: (event: DiceEvent) => void) => {
    diceListenersRef.current.add(handler);
    return () => {
      diceListenersRef.current.delete(handler);
    };
  }, []);

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
    setPrivateDiceLog([]);

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
          setStatus("joined");
        }
      } else if (message.type === "JOINED") {
        setYourRole(message.role);
        setYourPlayerId(message.playerId);
        setStatus("joined");
        setError(null);
      } else if (message.type === "DM_DICE_ROLL") {
        setPrivateDiceLog((current) => [...current, message.roll].slice(-50));
      } else if (message.type === "DICE_THROW" || message.type === "DICE_MOTION") {
        for (const listener of diceListenersRef.current) {
          listener(message);
        }
      } else if (message.type === "ERROR") {
        setError(message.message);
        setStatus("connected");
      }
    });

    socket.addEventListener("close", () => {
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

  return {
    status,
    error,
    state,
    yourClientId,
    yourRole,
    yourPlayerId,
    privateDiceLog,
    send,
    join,
    rollDice,
    throwDice,
    sendDiceMotion,
    subscribeDice,
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
      setPing: (x: number, y: number) => send({ type: "SET_PING", x, y }),
      clearPing: () => send({ type: "CLEAR_PING" }),
      addAnnotation: (sceneId: string, points: number[], color: string) =>
        send({ type: "ADD_ANNOTATION", sceneId, points, color }),
      updateFog: (sceneId: string, fogDataUrl: string) =>
        send({ type: "UPDATE_FOG", sceneId, fogDataUrl }),
      importCampaign: (manifest: CampaignManifest) =>
        send({ type: "IMPORT_CAMPAIGN", manifest }),
      updateSheetTemplate: (template: SheetTemplate) =>
        send({ type: "UPDATE_SHEET_TEMPLATE", template }),
      addPlayerSlot: (name: string) => send({ type: "ADD_PLAYER_SLOT", name }),
      updatePlayerSlot: (slot: PlayerSlot) => send({ type: "UPDATE_PLAYER_SLOT", slot }),
      removePlayerSlot: (slotId: string) => send({ type: "REMOVE_PLAYER_SLOT", slotId }),
    }),
    [send, yourRole],
  );
}

export function usePlayerSheet(room: GameRoom) {
  const { send, yourRole, yourPlayerId, state } = room;

  const sheet =
    yourPlayerId && state ? (state.characterSheets[yourPlayerId] ?? null) : null;

  const updateSheet = useCallback(
    (next: CharacterSheet) => {
      if (yourRole === "player") {
        send({ type: "UPDATE_MY_SHEET", sheet: next });
      }
    },
    [send, yourRole],
  );

  return { sheet, updateSheet, canEdit: yourRole === "player" };
}
