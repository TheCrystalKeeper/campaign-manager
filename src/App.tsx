import { useCallback, useEffect, useRef, useState } from "react";
import { JoinScreen } from "./components/JoinScreen";
import { MapCanvas } from "./components/MapCanvas";
import { FloatingCluster } from "./components/FloatingCluster";
import { FloatingWindow } from "./components/FloatingWindow";
import { Dock, type DockAction } from "./components/Dock";
import { DiceTray } from "./components/DiceTray";
import { LogToasts } from "./components/LogToasts";
import { TokenEditor } from "./components/TokenEditor";
import { dockPanelsForRole, PANELS, type PanelContext, type PanelId } from "./panels/registry";
import { PlayersPage } from "./pages/PlayersPage";
import { NpcsPage } from "./pages/NpcsPage";
import { ScenesPage } from "./pages/ScenesPage";
import { useDiceOverlay } from "./dice/useDiceOverlay";
import { useDmActions, useGameRoom, type JoinParams } from "./hooks/useGameRoom";
import { fitViewportToScene } from "./lib/sceneUtils";
import { DEFAULT_VIEWPORT, TOKEN_ENEMY_COLOR, type Viewport } from "./lib/types";

type SessionParams = JoinParams & { roomId: string };

/** DM-only prep pages; the Board stays the play surface (players are board-only). */
type PageId = "board" | "players" | "npcs" | "scenes";

const DM_PAGES: Array<{ id: PageId; label: string }> = [
  { id: "board", label: "Board" },
  { id: "players", label: "Players" },
  { id: "npcs", label: "NPCs" },
  { id: "scenes", label: "Scenes" },
];

const SNAP_KEY = "cm-map-snap";
const TOASTS_KEY = "cm-log-toasts";

function readLocalFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function writeLocalFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // preference just won't persist
  }
}

/// <summary>
/// Root shell: lobby (join flow) or the in-campaign view — a full-bleed map, a
/// FoundryVTT-style docked sidebar of panel tabs (each pop-out-able into a
/// floating window), floating character-sheet windows, and (DM only) the
/// top-left page switcher to the Players/NPCs/Scenes prep pages.
/// </summary>
export default function App() {
  const [session, setSession] = useState<SessionParams | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<PanelId>("log");
  const [popped, setPopped] = useState<PanelId[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewSheetId, setViewSheetId] = useState<string | null>(null);
  const [secretRolls, setSecretRolls] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const [page, setPage] = useState<PageId>("board");
  const [snap, setSnap] = useState(() => readLocalFlag(SNAP_KEY, false));
  const [toastsEnabled, setToastsEnabledState] = useState(() => readLocalFlag(TOASTS_KEY, true));
  /** Bumped by "Reset UI layout" — remounts windows / repositions the tray. */
  const [layoutEpoch, setLayoutEpoch] = useState(0);
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

  // Combat pulls the tracker forward when it starts (unless it's popped out) —
  // and pulls the DM back to the Board from any prep page.
  const combatActive = Boolean(state?.combat);
  useEffect(() => {
    if (status !== "joined") {
      return;
    }
    if (combatActive) {
      setPage("board");
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
    setSettingsOpen(false);
    setSelectedTokenId(null);
    setSecretRolls(false);
    setViewSheetId(null);
    setDockTab("log");
    setDockOpen(true);
    setPage("board");
    lastSceneRef.current = null;
  };

  const toggleSnap = useCallback(() => {
    setSnap((current) => {
      writeLocalFlag(SNAP_KEY, !current);
      return !current;
    });
  }, []);

  const setToastsEnabled = useCallback((on: boolean) => {
    writeLocalFlag(TOASTS_KEY, on);
    setToastsEnabledState(on);
  }, []);

  /// <summary>Clears every saved floating-UI position/size and re-lays-out live elements.</summary>
  const resetUiLayout = useCallback(() => {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("cm-window-pos:") || key === "cm-dice-tray-pos")) {
          doomed.push(key);
        }
      }
      for (const key of doomed) {
        localStorage.removeItem(key);
      }
    } catch {
      // storage unavailable — live elements still reset below
    }
    // Open windows remount (key includes the epoch) → default geometry; the
    // tray watches the same signal and re-centers without remounting.
    setLayoutEpoch((current) => current + 1);
  }, []);

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
    dice,
    snap,
    toggleSnap,
    toastsEnabled,
    setToastsEnabled,
    resetUiLayout,
    leave,
  };

  const dockPanels = yourRole ? dockPanelsForRole(yourRole) : [];
  const sheetPanel = PANELS.find((panel) => panel.id === "sheet")!;
  const settingsPanel = PANELS.find((panel) => panel.id === "settings")!;

  // Players have no pages — the Board (with maximizable sheet windows) covers them.
  const activePage: PageId = isDm ? page : "board";
  const onBoard = activePage === "board";

  const toggleSheet = () => {
    if (sheetOpen) {
      setSheetOpen(false);
    } else {
      setViewSheetId(isDm ? viewSheetId : room.yourPlayerId);
      setSheetOpen(true);
    }
  };

  // Rail action buttons: sheet on top, dice after the tabs, settings at the bottom.
  const dockActions: DockAction[] = [
    { id: "sheet", icon: "🪪", title: "Character sheet", active: sheetOpen, slot: "top", onClick: toggleSheet },
    {
      id: "dice",
      icon: "🎲",
      title: "Dice tray",
      active: trayOpen,
      slot: "after-tabs",
      onClick: () => setTrayOpen((open) => !open),
    },
    {
      id: "settings",
      icon: "⚙",
      title: "Settings",
      active: settingsOpen,
      slot: "bottom",
      onClick: () => setSettingsOpen((open) => !open),
    },
  ];

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
        snap={snap}
        onToggleSnap={toggleSnap}
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

        {isDm ? (
          <div className="page-switcher">
            {DM_PAGES.map((entry) => (
              <button
                key={entry.id}
                className={activePage === entry.id ? "btn-active" : ""}
                onClick={() => setPage(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : null}

        <Dock
          panels={dockPanels}
          open={dockOpen}
          activeTab={dockTab}
          popped={popped}
          context={panelContext}
          actions={dockActions}
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

        {/* DM prep pages: an opaque surface over the board chrome. Kept mounted
            so each page preserves its own state (selection, drafts) across
            switches; the board underneath keeps viewport/selection/windows. */}
        {isDm ? (
          <>
            <div className={`page${activePage === "players" ? " page--active" : ""}`}>
              <PlayersPage ctx={panelContext} />
            </div>
            <div className={`page${activePage === "npcs" ? " page--active" : ""}`}>
              <NpcsPage ctx={panelContext} />
            </div>
            <div className={`page${activePage === "scenes" ? " page--active" : ""}`}>
              <ScenesPage ctx={panelContext} />
            </div>
          </>
        ) : null}

        {/* Floating windows are board furniture — hidden while a prep page is up. */}
        {onBoard
          ? popped.map((panelId) => {
              const panel = PANELS.find((item) => item.id === panelId);
              if (!panel || (yourRole && !panel.roles.includes(yourRole))) {
                return null;
              }
              return (
                <FloatingWindow
                  key={`${panel.id}:${layoutEpoch}`}
                  id={panel.id}
                  title={panel.title(panelContext)}
                  width={panel.width}
                  minWidth={panel.minWidth}
                  minHeight={panel.minHeight}
                  defaultPos={panel.defaultPos}
                  onClose={() => setPopped((current) => current.filter((id) => id !== panel.id))}
                  onDock={() => dockBack(panel.id)}
                >
                  {panel.render(panelContext)}
                </FloatingWindow>
              );
            })
          : null}

        {onBoard && sheetOpen ? (
          <FloatingWindow
            key={`sheet:${layoutEpoch}`}
            id="sheet"
            title={sheetPanel.title(panelContext)}
            width={sheetPanel.width}
            minWidth={sheetPanel.minWidth}
            minHeight={sheetPanel.minHeight}
            defaultPos={sheetPanel.defaultPos}
            onClose={() => setSheetOpen(false)}
          >
            {sheetPanel.render(panelContext)}
          </FloatingWindow>
        ) : null}

        {onBoard && settingsOpen ? (
          <FloatingWindow
            key={`settings:${layoutEpoch}`}
            id="settings"
            title={settingsPanel.title(panelContext)}
            width={settingsPanel.width}
            minWidth={settingsPanel.minWidth}
            minHeight={settingsPanel.minHeight}
            defaultPos={settingsPanel.defaultPos}
            onClose={() => setSettingsOpen(false)}
          >
            {settingsPanel.render(panelContext)}
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
          resetSignal={layoutEpoch}
        />

        <LogToasts
          log={state.log}
          yourPlayerId={room.yourPlayerId}
          playerSlots={state.playerSlots}
          // Toasts are global (they follow you onto prep pages); hidden only when
          // the Log panel itself is visible on the board, or turned off in settings.
          suppress={
            !toastsEnabled ||
            (onBoard && ((dockOpen && dockTab === "log") || popped.includes("log")))
          }
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
