import { useEffect, useState } from "react";
import { JoinScreen } from "./components/JoinScreen";
import { MapCanvas } from "./components/MapCanvas";
import { DMToolbar } from "./components/DMToolbar";
import { SceneSettingsPanel } from "./components/SceneSettingsModal";
import { SceneAccessPanel } from "./components/SceneAccessPanel";
import { CharacterSheetPanel } from "./components/CharacterSheet";
import { ResizableSplit } from "./components/ResizableSplit";
import { useDmActions, useGameRoom, usePlayerSheet, type JoinParams } from "./hooks/useGameRoom";
import type { FogBrushMode } from "./lib/fogCanvas";
import { DEFAULT_VIEWPORT, type Viewport } from "./lib/types";

type SessionParams = JoinParams & {
  roomId: string;
};

export type DmView = "main" | "players" | "scenes";

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
  const room = useGameRoom(session?.roomId ?? null);
  const dm = useDmActions(room);
  const { sheet, updateSheet, canEdit } = usePlayerSheet(room);

  useEffect(() => {
    if (!session) {
      return;
    }
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

  const handleViewCommand = (type: "fit" | "reset") => {
    const id = viewCommandId + 1;
    setViewCommandId(id);
    setViewCommand({ type, id });
  };

  if (!session) {
    return <JoinScreen onJoin={setSession} />;
  }

  const { state, yourRole, status, error } = room;
  const isDm = yourRole === "dm";
  const sceneEditMode = isDm && dmView === "scenes";
  const toolbarMode = dmView === "main" ? "play" : "main";
  const playControls = isDm && dmView === "main";
  const showMap = !isDm || dmView !== "players";

  const displayName =
    session.role === "dm"
      ? session.displayName
      : (state?.playerSlots.find((slot) => slot.id === session.slotId)?.name ?? "Player");

  const mapSection = (
    <section className="map-section">
      <MapCanvas
        state={state!}
        isDm={isDm}
        dm={dm}
        playerSlotId={room.yourPlayerId}
        fogMode={fogMode && playControls}
        fogPreview={fogPreview && isDm}
        fogBrushMode={fogBrushMode}
        sceneEditMode={sceneEditMode}
        viewCommand={viewCommand}
        onSettingsViewportChange={setSettingsViewport}
      />
      {isDm ? (
        <DMToolbar
          state={state!}
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

  const sidebar = isDm ? (
    dmView === "main" ? (
      <SceneAccessPanel state={state!} dm={dm} />
    ) : dmView === "players" ? (
      <CharacterSheetPanel
        sheet={sheet}
        canEdit={canEdit}
        onChange={updateSheet}
        playerSlots={state?.playerSlots}
        connectedPlayers={state?.connectedPlayers}
        allSheets={state?.characterSheets}
        isDm={isDm}
        dm={dm}
      />
    ) : (
      <SceneSettingsPanel
        state={state!}
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
      playerSlots={state?.playerSlots}
      connectedPlayers={state?.connectedPlayers}
      allSheets={state?.characterSheets}
      isDm={isDm}
      dm={dm}
    />
  );

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
          </nav>
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
      ) : state && status === "joined" ? (
        <main className={`game-layout${dmView === "players" && isDm ? " players-layout" : ""}`}>
          {showMap ? (
            <ResizableSplit main={mapSection} sidebar={sidebar} />
          ) : (
            sidebar
          )}
        </main>
      ) : (
        <div className="loading">Connecting to room...</div>
      )}
    </div>
  );
}
