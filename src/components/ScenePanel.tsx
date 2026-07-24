import { Eye, EyeOff, Telescope } from "lucide-react";
import type { GameState, Scene } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { createEmptyScene } from "../lib/sceneUtils";
import { SceneSettings } from "./SceneSettings";

type ScenePanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  /** The scene this DM's board is currently showing — the live scene, or a peeked one. */
  displayedSceneId: string;
  /** Peek a scene on this board only (null → snap back to the live scene). */
  onPeek: (sceneId: string | null) => void;
};

/// <summary>
/// DM dock tab for in-play scene control: switch/add/remove scenes and edit the
/// ACTIVE scene's settings live. The Scenes page is the full prep editor (edits
/// any selected scene, with staging); this stays the quick at-the-table panel.
///
/// Two ways to look at a scene: clicking a scene's NAME cuts it live for everyone
/// (SET_SCENE); the telescope PEEKS it on this DM's board only (a local viewingSceneId
/// override — players stay on the live scene). The telescope works on every row, and the
/// one for the scene you're currently viewing is lit — peek the live scene (▶) to snap
/// back to the live view. Peeking also auto-clears when the live scene changes.
/// </summary>
export function ScenePanel({ state, dm, displayedSceneId, onPeek }: ScenePanelProps) {
  const active = state.scenes.find((scene) => scene.id === state.activeSceneId) ?? state.scenes[0];

  const patchActive = (patch: Partial<Scene>) => {
    if (!active) return;
    dm.updateScene({ ...active, ...patch });
  };

  return (
    <div className="panel-body stack">
      <div className="stack">
        {state.scenes.map((scene) => {
          const isLive = scene.id === state.activeSceneId;
          const isViewing = scene.id === displayedSceneId;
          return (
            <div className="row" key={scene.id}>
              <button
                className={isLive ? "btn-active" : ""}
                style={{ flex: 1, textAlign: "left" }}
                title={isLive ? `${scene.name} — live on every board` : `Cut to “${scene.name}” live for everyone`}
                onClick={() => dm.setScene(scene.id)}
              >
                {isLive ? "▶ " : ""}
                {scene.name}
              </button>
              <button
                className={`icon-btn${isViewing ? " btn-active" : ""}`}
                title={
                  isLive
                    ? isViewing
                      ? "You're viewing the live scene"
                      : "Back to the live scene"
                    : isViewing
                      ? "You're peeking this scene — players still see the live one"
                      : "Peek: view this scene on your board without pulling players here"
                }
                onClick={() => onPeek(isLive ? null : scene.id)}
              >
                <Telescope size={14} />
              </button>
              <button
                className="icon-btn"
                disabled={isLive}
                title={
                  isLive
                    ? "Players always see the live scene"
                    : scene.playerVisible
                      ? "Players can view this scene alongside the live one — click to close it"
                      : "Hidden from players — click to let them view it alongside the live scene"
                }
                onClick={() => dm.setScenePlayerVisible(scene.id, !scene.playerVisible)}
              >
                {scene.playerVisible || isLive ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                className="btn-danger"
                disabled={state.scenes.length <= 1}
                onClick={() => dm.removeScene(scene.id)}
                title="Remove scene"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button onClick={() => dm.addScene(createEmptyScene(`Scene ${state.scenes.length + 1}`))}>
          + Add scene
        </button>
      </div>

      {active ? (
        <>
          <div className="section-title">Active: {active.name}</div>
          <SceneSettings
            scene={active}
            roomId={state.roomId}
            onPatch={patchActive}
            onSetFog={(patch) =>
              dm.setFogEnabled(active.id, patch.enabled ?? active.fog.enabled, patch.inverted)
            }
            onResetFog={() => dm.resetFog(active.id)}
          />
        </>
      ) : null}
    </div>
  );
}
