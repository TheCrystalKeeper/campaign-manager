import type { GameState } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type SceneAccessPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
};

/// <summary>
/// Sidebar controls for whether each player can see the DM's currently active scene.
/// </summary>
export function SceneAccessPanel({ state, dm }: SceneAccessPanelProps) {
  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);

  const toggleAccess = (slotId: string, enabled: boolean) => {
    const slot = state.playerSlots.find((item) => item.id === slotId);
    if (!slot || !activeScene) {
      return;
    }
    const nextVisible = enabled
      ? [...new Set([...slot.visibleSceneIds, activeScene.id])]
      : slot.visibleSceneIds.filter((id) => id !== activeScene.id);
    dm.updatePlayerSlot({ ...slot, visibleSceneIds: nextVisible });
  };

  return (
    <div className="side-panel scene-access-panel">
      <header className="side-panel-header">
        <h2>Scene access</h2>
      </header>
      <div className="side-panel-body">
        {activeScene ? (
          <p className="settings-hint">
            Active scene: <strong>{activeScene.name}</strong>. Toggle which players can see it.
          </p>
        ) : null}
        {state.playerSlots.length === 0 ? (
          <p className="muted">Add players in the Players tab to control scene access.</p>
        ) : (
          <ul className="scene-access-list">
            {state.playerSlots.map((slot) => {
              const canSee = activeScene
                ? slot.visibleSceneIds.includes(activeScene.id)
                : false;
              return (
                <li key={slot.id}>
                  <label className="scene-access-row">
                    <input
                      type="checkbox"
                      checked={canSee}
                      disabled={!activeScene}
                      aria-label={`${slot.name} can see ${activeScene?.name ?? "scene"}`}
                      onChange={(event) => toggleAccess(slot.id, event.target.checked)}
                    />
                    <span className="scene-access-name">{slot.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
