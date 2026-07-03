import type { GameState, Scene } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { createEmptyScene } from "../lib/sceneUtils";
import { SceneSettings } from "./SceneSettings";

type ScenePanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
};

/// <summary>
/// DM dock tab for in-play scene control: switch/add/remove scenes and edit the
/// ACTIVE scene's settings live. The Scenes page is the full prep editor (edits
/// any selected scene, with staging); this stays the quick at-the-table panel.
/// </summary>
export function ScenePanel({ state, dm }: ScenePanelProps) {
  const active = state.scenes.find((scene) => scene.id === state.activeSceneId) ?? state.scenes[0];

  const patchActive = (patch: Partial<Scene>) => {
    if (!active) return;
    dm.updateScene({ ...active, ...patch });
  };

  return (
    <div className="panel-body stack">
      <div className="stack">
        {state.scenes.map((scene) => (
          <div className="row" key={scene.id}>
            <button
              className={scene.id === state.activeSceneId ? "btn-active" : ""}
              style={{ flex: 1, textAlign: "left" }}
              onClick={() => dm.setScene(scene.id)}
            >
              {scene.id === state.activeSceneId ? "▶ " : ""}
              {scene.name}
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
        ))}
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
