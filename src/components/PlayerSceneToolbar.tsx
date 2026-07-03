import { canPlayerSeeScene, type GameState } from "../lib/types";

type PlayerSceneToolbarProps = {
  state: GameState;
  playerSlotId: string;
  viewingSceneId: string | null;
  onViewingSceneChange: (sceneId: string) => void;
};

/// <summary>
/// Lets players switch between scenes they have been granted access to.
/// </summary>
export function PlayerSceneToolbar({
  state,
  playerSlotId,
  viewingSceneId,
  onViewingSceneChange,
}: PlayerSceneToolbarProps) {
  const slot = state.playerSlots.find((item) => item.id === playerSlotId);
  if (!slot) {
    return null;
  }

  const visibleScenes = state.scenes.filter((scene) => canPlayerSeeScene(slot, scene.id));
  if (visibleScenes.length === 0) {
    return (
      <nav className="player-scene-toolbar player-scene-tabs" aria-label="Your scenes">
        <p className="toolbar-hint">No scenes have been shared with you yet.</p>
      </nav>
    );
  }

  return (
    <nav className="player-scene-toolbar player-scene-tabs" aria-label="Your scenes">
      <span className="toolbar-label">Your scenes</span>
      <div className="view-tabs">
        {visibleScenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className={scene.id === viewingSceneId ? "active" : ""}
            onClick={() => onViewingSceneChange(scene.id)}
          >
            {scene.name}
          </button>
        ))}
      </div>
    </nav>
  );
}
