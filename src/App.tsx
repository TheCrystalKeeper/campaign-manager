import { useEffect, useRef, useState } from "react";
import { JoinScreen } from "./components/JoinScreen";
import { MapCanvas } from "./components/MapCanvas";
import { FloatingCluster } from "./components/FloatingCluster";
import { FloatingWindow } from "./components/FloatingWindow";
import { Dock } from "./components/Dock";
import { DiceTray } from "./components/DiceTray";
import { LogToasts } from "./components/LogToasts";
import { TokenEditor } from "./components/TokenEditor";
import { dockPanelsForRole, PANELS, type PanelContext, type PanelId } from "./panels/registry";
import { useDiceOverlay } from "./dice/useDiceOverlay";
import { useDmActions, useGameRoom, type JoinParams } from "./hooks/useGameRoom";
import { fitViewportToScene } from "./lib/sceneUtils";
import { DEFAULT_VIEWPORT, TOKEN_ENEMY_COLOR, type Viewport } from "./lib/types";

type SessionParams = JoinParams & { roomId: string };

/// <summary>
/// Root shell: lobby (join flow) or the in-campaign view — a full-bleed map, a
/// FoundryVTT-style docked sidebar of panel tabs (each pop-out-able into a
/// floating window), and floating character-sheet windows.
/// </summary>
export default function App() {
  const [session, setSession] = useState<SessionParams | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<PanelId>("log");
  const [popped, setPopped] = useState<PanelId[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewSheetId, setViewSheetId] = useState<string | null>(null);
  const [secretRolls, setSecretRolls] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const lastSceneRef = useRef<string | null>(null);

  const room = useGameRoom(session?.roomId ?? null);
  const dm = useDmActions(room);
  const dice = useDiceOverlay(room);
  const { state, yourRole, status, error } = room;
  const isDm = yourRole === "dm";

  // Feed the dice overlay this client's live viewport and the DM secret toggle.
  const setDiceProjection = dice.setProjection;
  useEffect(() => {
    setDiceProjection(viewport);
  }, [viewport, setDiceProjection]);

  // Thrown dice stay inside the visible map: window edges (with breathing room) minus
  // the dock column and the open tray drawer. Measured fresh at each throw, so dock
  // open/close and the tray drawer need no state wiring here.
  const setDiceSafeArea = dice.setSafeAreaProvider;
  useEffect(() => {
    const margin = 24;
    setDiceSafeArea(() => {
      const insets = { top: margin, right: margin, bottom: margin, left: margin };
      const dock = document.querySelector(".dock")?.getBoundingClientRect();
      if (dock) {
        insets.right = Math.max(insets.right, window.innerWidth - dock.left + 8);
      }
      const tray = document.querySelector(".dice-tray--open")?.getBoundingClientRect();
      if (tray) {
        insets.bottom = Math.max(insets.bottom, window.innerHeight - tray.top + 8);
      }
      return insets;
    });
    return () => setDiceSafeArea(null);
  }, [setDiceSafeArea]);
  const setDiceSecret = dice.setSecret;
  useEffect(() => {
    setDiceSecret(isDm && secretRolls);
  }, [isDm, secretRolls, setDiceSecret]);

  useEffect(() => {
    if (!session) {
      return;
    }
    room.join(
      session.role === "dm"
        ? { role: "dm", displayName: session.displayName, roomKey: session.roomKey }
        : { role: "player", slotId: session.slotId, roomKey: session.roomKey },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Combat pulls the tracker forward when it starts (unless it's popped out).
  const combatActive = Boolean(state?.combat);
  useEffect(() => {
    if (status !== "joined") {
      return;
    }
    if (combatActive) {
      setPopped((current) => {
        if (!current.includes("initiative")) {
          setDockTab("initiative");
          setDockOpen(true);
        }
        return current;
      });
    } else {
      setDockTab((current) => (current === "initiative" ? "log" : current));
    }
  }, [combatActive, status]);

  // In-game errors surface as a transient banner, never a screen change.
  const clearError = room.clearError;
  useEffect(() => {
    if (error && status === "joined") {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, status, clearError]);

  // Each client owns its own local viewport; fit the view when the active scene changes.
  useEffect(() => {
    if (!state) {
      return;
    }
    const scene = state.scenes.find((item) => item.id === state.activeSceneId);
    if (!scene || lastSceneRef.current === scene.id) {
      return;
    }
    lastSceneRef.current = scene.id;
    const fitted = fitViewportToScene(scene, window.innerWidth, window.innerHeight);
    setViewport(fitted);
    if (isDm) {
      dm.updateViewport(fitted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.activeSceneId, status]);

  const leave = () => {
    setSession(null);
    setPopped([]);
    setSheetOpen(false);
    setSelectedTokenId(null);
    setSecretRolls(false);
    setViewSheetId(null);
    setDockTab("log");
    setDockOpen(true);
    lastSceneRef.current = null;
  };

  if (!session) {
    return <JoinScreen onJoin={setSession} />;
  }

  if (error && status !== "joined" && status !== "reconnecting") {
    return (
      <div className="join-failed">
        <p>{error}</p>
        <button onClick={leave}>Back to lobby</button>
      </div>
    );
  }

  if (!state || (status !== "joined" && status !== "reconnecting")) {
    return <div className="loading">Connecting to room…</div>;
  }

  const selectedToken = state.tokens.find((token) => token.id === selectedTokenId) ?? null;

  const openSheet = (sheetId: string) => {
    setViewSheetId(sheetId);
    setSheetOpen(true);
  };

  /** Select a token; if it has a linked sheet, open that sheet (redacted for players). */
  const selectToken = (tokenId: string | null) => {
    setSelectedTokenId(tokenId);
    if (!tokenId) {
      return;
    }
    const token = state.tokens.find((item) => item.id === tokenId);
    if (token?.sheetId && state.sheets[token.sheetId]) {
      openSheet(token.sheetId);
    }
  };

  /** DM dropped an actor row (or the blank chip) from the directory onto the map. */
  const dropActorAt = (sheetId: string | null, clientX: number, clientY: number) => {
    if (!isDm) {
      return;
    }
    // The stage fills the window, so screen coords map straight through the viewport.
    const x = (clientX - viewport.x) / viewport.scale;
    const y = (clientY - viewport.y) / viewport.scale;
    const record = sheetId ? state.sheets[sheetId] : null;
    const isPc = record?.kind === "pc";
    dm.addToken({
      id: `token-${crypto.randomUUID().slice(0, 8)}`,
      sceneId: state.activeSceneId,
      x,
      y,
      label: record ? record.data.characterName || "Token" : "Token",
      color: TOKEN_ENEMY_COLOR,
      kind: isPc ? "player" : "enemy",
      imageUrl: record?.data.iconUrl ?? null,
      ownerPlayerId: isPc && record ? record.id : null,
      sheetId: record && !isPc ? record.id : null,
      conditions: [],
      showHp: "none",
    });
  };

  const handleViewportChange = (next: Viewport) => {
    setViewport(next);
    if (isDm) {
      // Relayed server-side as a lightweight VIEWPORT delta, never a full STATE.
      dm.updateViewport(next);
    }
  };

  const panelContext: PanelContext = {
    state,
    room,
    dm,
    isDm,
    viewSheetId,
    openSheet,
    updateSheet: (sheetId, sheet) => room.send({ type: "UPDATE_SHEET", sheetId, sheet }),
    // The DM's persistent Secret toggle applies to every roll, sheet-clicks included.
    rollDice: (expression, options) =>
      room.rollDice(expression, { ...options, private: isDm && secretRolls }),
    dropActorAt,
  };

  const dockPanels = yourRole ? dockPanelsForRole(yourRole) : [];
  const sheetPanel = PANELS.find((panel) => panel.id === "sheet")!;

  // Avatar strip: connected players + NPCs with a token in the active scene.
  const npcChipSheetIds = [
    ...new Set(
      state.tokens
        .filter(
          (token) =>
            token.sceneId === state.activeSceneId &&
            token.kind === "enemy" &&
            token.sheetId &&
            state.sheets[token.sheetId],
        )
        .map((token) => token.sheetId as string),
    ),
  ];

  const popOut = (id: PanelId) =>
    setPopped((current) => (current.includes(id) ? current : [...current, id]));
  const dockBack = (id: PanelId) => {
    setPopped((current) => current.filter((item) => item !== id));
    setDockTab(id);
    setDockOpen(true);
  };

  return (
    <div className="app">
      <MapCanvas
        state={state}
        sceneId={state.activeSceneId}
        isDm={isDm}
        yourPlayerId={room.yourPlayerId}
        viewport={viewport}
        onViewportChange={handleViewportChange}
        onMoveToken={(tokenId, x, y) => room.send({ type: "MOVE_TOKEN", tokenId, x, y })}
        onSelectToken={selectToken}
        selectedTokenId={selectedTokenId}
        send={room.send}
        subscribeMeasure={room.subscribeMeasure}
      />

      {/* 3D dice canvas: above the map, below all UI, never takes pointer events. */}
      <div className="dice-arena" ref={dice.containerRef} />

      <div className="overlay">
        <FloatingCluster
          anchor="top-center"
          plain
          className={`avatar-strip${dockOpen ? " avatar-strip--dock-open" : ""}`}
        >
          {state.connectedPlayers.map((player) => {
            const icon = state.sheets[player.playerId]?.data.iconUrl;
            return (
              <div
                key={player.playerId}
                className="player-chip"
                title={`${player.displayName} — double-click for sheet`}
                onDoubleClick={() => openSheet(player.playerId)}
              >
                {icon ? (
                  <img src={icon} alt={player.displayName} />
                ) : (
                  <span className="player-initial">
                    {player.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {isDm ? (
                  <button
                    className="kick"
                    title={`Kick ${player.displayName}`}
                    onClick={() => dm.kickPlayer(player.playerId)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            );
          })}
          {npcChipSheetIds.map((sheetId) => {
            const record = state.sheets[sheetId]!;
            const name = record.data.characterName || "???";
            return (
              <div
                key={sheetId}
                className="player-chip npc-chip"
                title={`${name} — double-click for sheet`}
                onDoubleClick={() => openSheet(sheetId)}
              >
                {record.data.iconUrl ? (
                  <img src={record.data.iconUrl} alt={name} />
                ) : (
                  <span className="player-initial">{name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
            );
          })}
        </FloatingCluster>

        <FloatingCluster anchor="top-left">
          <button
            className={sheetOpen ? "btn-active" : ""}
            title="Character sheet"
            onClick={() => {
              if (sheetOpen) {
                setSheetOpen(false);
              } else {
                setViewSheetId(isDm ? viewSheetId : room.yourPlayerId);
                setSheetOpen(true);
              }
            }}
          >
            🪪 Sheet
          </button>
          <button
            className={trayOpen ? "btn-active" : ""}
            title="Dice tray"
            onClick={() => setTrayOpen((open) => !open)}
          >
            🎲 Dice
          </button>
          <button onClick={leave}>Leave</button>
        </FloatingCluster>

        <Dock
          panels={dockPanels}
          open={dockOpen}
          activeTab={dockTab}
          popped={popped}
          context={panelContext}
          onSelectTab={(id) => {
            if (popped.includes(id)) {
              dockBack(id);
              return;
            }
            setDockTab(id);
            setDockOpen(true);
          }}
          onPopOut={popOut}
          onToggleOpen={() => setDockOpen((open) => !open)}
        />

        {popped.map((panelId) => {
          const panel = PANELS.find((item) => item.id === panelId);
          if (!panel || (yourRole && !panel.roles.includes(yourRole))) {
            return null;
          }
          return (
            <FloatingWindow
              key={panel.id}
              id={panel.id}
              title={panel.title(panelContext)}
              width={panel.width}
              defaultPos={panel.defaultPos}
              onClose={() => setPopped((current) => current.filter((id) => id !== panel.id))}
              onDock={() => dockBack(panel.id)}
            >
              {panel.render(panelContext)}
            </FloatingWindow>
          );
        })}

        {sheetOpen ? (
          <FloatingWindow
            id="sheet"
            title={sheetPanel.title(panelContext)}
            width={sheetPanel.width}
            defaultPos={sheetPanel.defaultPos}
            onClose={() => setSheetOpen(false)}
          >
            {sheetPanel.render(panelContext)}
          </FloatingWindow>
        ) : null}

        {isDm && selectedToken ? (
          <FloatingCluster anchor="bottom-left">
            <TokenEditor
              token={selectedToken}
              state={state}
              dm={dm}
              openSheet={openSheet}
              onClose={() => setSelectedTokenId(null)}
            />
          </FloatingCluster>
        ) : null}

        {/* Always mounted so the drawer can slide out (and the tray scene persists). */}
        <DiceTray
          open={trayOpen}
          isDm={isDm}
          secret={secretRolls}
          onToggleSecret={setSecretRolls}
          controller={dice}
          onTextRoll={(expression) =>
            room.rollDice(expression, { private: isDm && secretRolls })
          }
          onClose={() => setTrayOpen(false)}
        />

        <LogToasts
          log={state.log}
          yourPlayerId={room.yourPlayerId}
          playerSlots={state.playerSlots}
          suppress={(dockOpen && dockTab === "log") || popped.includes("log")}
          dockExpanded={dockOpen}
        />

        {status === "reconnecting" ? (
          <div className="toast">Reconnecting to the game server…</div>
        ) : null}
        {error && status === "joined" ? <div className="error-banner">{error}</div> : null}
      </div>
    </div>
  );
}
