import { useEffect, useState } from "react";
import { useDiceArena } from "./dice3d/useDiceArena";
import { JoinScreen } from "./components/JoinScreen";
import { MapCanvas } from "./components/MapCanvas";
import { DMToolbar } from "./components/DMToolbar";
import { SceneSettingsPanel } from "./components/SceneSettingsModal";
import { SceneAccessPanel } from "./components/SceneAccessPanel";
import { PlayerSceneToolbar } from "./components/PlayerSceneToolbar";
import { DicePanel } from "./components/DicePanel";
import { CharacterSheetPanel } from "./components/CharacterSheet";
import { TokenLibraryPanel } from "./components/TokenLibraryPanel";
import { ResizableSplit } from "./components/ResizableSplit";
import { useDmActions, useGameRoom, usePlayerSheet, type JoinParams } from "./hooks/useGameRoom";
import type { FogBrushMode } from "./lib/fogCanvas";
import { DEFAULT_VIEWPORT, playerTokenColorForSlot, resolvePlayerViewingSceneId, type Viewport } from "./lib/types";
import { clearSessionViewportsForRoom } from "./lib/sessionViewportMemory";

type SessionParams = JoinParams & {
  roomId: string;
};

export type DmView = "main" | "players" | "scenes" | "tokens";

/// <summary>
/// Root application shell: join flow, game room layout, and role-specific panels.
/// </summary>
export default function App() {
  const [session, setSession] = useState<SessionParams | null>(null);
  const [dmView, setDmView] = useState<DmView>("main");
  const [fogMode, setFogMode] = useState(false);
  const [fogPreview, setFogPreview] = useState(true);
  const [fogBrushMode, setFogBrushMode] = useState<FogBrushMode>("reveal");
  const [settingsViewport, setSettingsViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [viewCommand, setViewCommand] = useState<{ type: "fit" | "reset"; id: number } | null>(
    null,
  );
  const [viewCommandId, setViewCommandId] = useState(0);
  const [playerViewingSceneId, setPlayerViewingSceneId] = useState<string | null>(null);
  const room = useGameRoom(session?.roomId ?? null);
  const dm = useDmActions(room);
  const { sheet, updateSheet, canEdit } = usePlayerSheet(room);
  const diceArena = useDiceArena(room);

  useEffect(() => {
    if (!session) {
      return;
    }
    clearSessionViewportsForRoom(session.roomId);
    room.join(
      session.role === "dm"
        ? {
            role: "dm",
            displayName: session.displayName,
            roomKey: session.roomKey,
          }
        : {
            role: "player",
            slotId: session.slotId,
            roomKey: session.roomKey,
          },
    );
  }, [session, room.join]);

  useEffect(() => {
    if (dmView === "scenes") {
      setFogMode(false);
    }
  }, [dmView]);

  const { state, yourRole, status, error } = room;
  const isDm = yourRole === "dm";

  useEffect(() => {
    if (isDm || !state || !room.yourPlayerId) {
      return;
    }
    setPlayerViewingSceneId((current) =>
      resolvePlayerViewingSceneId(state, room.yourPlayerId!, current),
    );
  }, [isDm, state, room.yourPlayerId]);

  const mapSceneId = isDm
    ? (state?.activeSceneId ?? "")
    : (playerViewingSceneId ?? state?.activeSceneId ?? "");

  const handleViewCommand = (type: "fit" | "reset") => {
    const id = viewCommandId + 1;
    setViewCommandId(id);
    setViewCommand({ type, id });
  };

  if (!session) {
    return <JoinScreen onJoin={setSession} />;
  }

  const sceneEditMode = isDm && dmView === "scenes";
  const toolbarMode = dmView === "main" ? "play" : "main";
  const playControls = isDm && dmView === "main";
  const showMap = !isDm || (dmView !== "players" && dmView !== "tokens");

  const displayName =
    session.role === "dm"
      ? session.displayName
      : (state?.playerSlots.find((slot) => slot.id === session.slotId)?.name ?? "Player");

  const gameContent =
    state && status === "joined" ? (
      (() => {
        const mapSection = (
          <section className="map-section">
            <MapCanvas
              state={state}
              sceneId={mapSceneId}
              isDm={isDm}
              dm={dm}
              playerSlotId={room.yourPlayerId}
              onMoveToken={(tokenId, x, y) =>
                room.send({ type: "MOVE_TOKEN", tokenId, x, y })
              }
              onAddAnnotation={(sceneId, points, color) =>
                dm.addAnnotation(sceneId, points, color)
              }
              annotationColor={
                isDm
                  ? "#fcd34d"
                  : playerTokenColorForSlot(room.yourPlayerId!, state.playerSlots)
              }
              fogMode={fogMode && playControls}
              fogPreview={fogPreview && isDm}
              fogBrushMode={fogBrushMode}
              sceneEditMode={sceneEditMode}
              viewCommand={viewCommand}
              onSettingsViewportChange={setSettingsViewport}
              onContainerEl={diceArena.mapAreaRef}
              onViewportChange={diceArena.setProjection}
            />
            {isDm ? (
              <DMToolbar
                state={state}
                dm={dm}
                mode={toolbarMode}
                fogMode={fogMode}
                onFogModeChange={setFogMode}
                fogPreview={fogPreview}
                onFogPreviewChange={setFogPreview}
                fogBrushMode={fogBrushMode}
                onFogBrushModeChange={setFogBrushMode}
              />
            ) : null}
          </section>
        );

        const sidebarPanel = isDm ? (
          dmView === "main" ? (
            <div className="dm-main-sidebar">
              <SceneAccessPanel state={state} dm={dm} />
              <CharacterSheetPanel
                sheet={null}
                canEdit={false}
                onChange={() => {}}
                template={state.sheetTemplate}
                playerSlots={state.playerSlots}
                connectedPlayers={state.connectedPlayers}
                allSheets={state.characterSheets}
                isDm={isDm}
                dm={dm}
                showSlotManagement={false}
              />
            </div>
          ) : dmView === "players" ? (
            <CharacterSheetPanel
              sheet={sheet}
              canEdit={canEdit}
              onChange={updateSheet}
              template={state.sheetTemplate}
              playerSlots={state.playerSlots}
              connectedPlayers={state.connectedPlayers}
              allSheets={state.characterSheets}
              isDm={isDm}
              dm={dm}
            />
          ) : dmView === "tokens" ? (
            <TokenLibraryPanel state={state} dm={dm} />
          ) : (
            <SceneSettingsPanel
              state={state}
              dm={dm}
              viewport={settingsViewport}
              onFitView={() => handleViewCommand("fit")}
              onResetView={() => handleViewCommand("reset")}
            />
          )
        ) : (
          <CharacterSheetPanel
            sheet={sheet}
            canEdit={canEdit}
            onChange={updateSheet}
            template={state.sheetTemplate}
            slotId={room.yourPlayerId}
            playerSlots={state.playerSlots}
            connectedPlayers={state.connectedPlayers}
            allSheets={state.characterSheets}
            isDm={isDm}
            dm={dm}
          />
        );

        const dicePanel = (
          <DicePanel
            isDm={isDm}
            yourPlayerId={room.yourPlayerId}
            publicRolls={state.publicDiceLog}
            privateRolls={room.privateDiceLog}
            onRoll={room.rollDice}
            onArm={diceArena.arm}
            onThrowArmed={diceArena.throwArmed}
            onThrowExpression={diceArena.throwExpression}
            onInstantExpression={diceArena.instantExpression}
            onInstantArmed={diceArena.instantArmed}
            hasArmed={diceArena.hasArmed}
            trayVisible={diceArena.trayVisible}
            onToggleTray={diceArena.setTrayVisible}
            muted={diceArena.muted}
            onToggleMuted={diceArena.setMuted}
          />
        );

        return (
          <main
            className={`game-layout${
              isDm && (dmView === "players" || dmView === "tokens")
                ? ` ${dmView === "players" ? "players" : "tokens"}-layout`
                : ""
            }`}
          >
            {showMap ? (
              <ResizableSplit main={mapSection} middle={dicePanel} sidebar={sidebarPanel} />
            ) : (
              <div className="layout-with-dice-rail">
                <aside className="dice-rail">{dicePanel}</aside>
                {sidebarPanel}
              </div>
            )}
          </main>
        );
      })()
    ) : null;

  return (
    <div className="app">
      <header className="app-header">
        {isDm ? (
          <nav className="view-tabs" aria-label="DM views">
            <button
              type="button"
              className={dmView === "main" ? "active" : ""}
              onClick={() => setDmView("main")}
            >
              Main view
            </button>
            <button
              type="button"
              className={dmView === "players" ? "active" : ""}
              onClick={() => setDmView("players")}
            >
              Players
            </button>
            <button
              type="button"
              className={dmView === "scenes" ? "active" : ""}
              onClick={() => setDmView("scenes")}
            >
              Scenes
            </button>
            <button
              type="button"
              className={dmView === "tokens" ? "active" : ""}
              onClick={() => setDmView("tokens")}
            >
              Tokens
            </button>
          </nav>
        ) : state && status === "joined" && room.yourPlayerId ? (
          <PlayerSceneToolbar
            state={state}
            playerSlotId={room.yourPlayerId}
            viewingSceneId={playerViewingSceneId}
            onViewingSceneChange={setPlayerViewingSceneId}
          />
        ) : null}

        <div className="header-right">
          <div className="header-meta">
            <span className="meta-chip">
              <span className="meta-label">Room</span> {session.roomId}
            </span>
            <span className="meta-chip">
              <span className="meta-label">You</span> {displayName}
            </span>
            <span className="meta-chip">
              <span className="meta-label">Online</span> {state?.connectedPlayers.length ?? 0}
            </span>
            <span className={`meta-chip meta-chip-status status-${status}`}>
              <span className="meta-label">Status</span> {status}
            </span>
          </div>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {error && status !== "joined" ? (
        <div className="join-failed">
          <p>{error}</p>
          <button type="button" onClick={() => setSession(null)}>
            Back to join screen
          </button>
        </div>
      ) : gameContent ? (
        gameContent
      ) : (
        <div className="loading">Connecting to room...</div>
      )}

      <div
        ref={diceArena.containerRef}
        className={`dice-arena${diceArena.trayVisible ? " dice-arena--tray" : ""}${
          diceArena.hasArmed ? " dice-arena--armed" : ""
        }`}
        aria-hidden
      >
        {diceArena.remoteCursor ? (
          <div
            className="dice-remote-cursor"
            style={{
              left: diceArena.remoteCursor.x,
              top: diceArena.remoteCursor.y,
              ["--cursor-color" as string]: diceArena.remoteCursor.color,
            }}
          >
            <span className="dice-remote-cursor-dot" />
            <span className="dice-remote-cursor-label">{diceArena.remoteCursor.name}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
