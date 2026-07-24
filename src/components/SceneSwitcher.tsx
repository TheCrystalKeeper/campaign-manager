import type { Scene } from "../lib/types";

/// <summary>
/// Player-side scene strip (multi-scene viewing): rendered only when the DM has opened
/// extra scenes, in the top-left slot the PageSwitcher also occupies. When the player
/// also has the Board/Stats pill (Stats enabled), App renders this inline inside that
/// pill instead of as its own floating one, so the two don't collide. The live scene is
/// marked ●; clicking another opened scene looks at it with a free camera. The DM
/// activating a scene pulls everyone back — App resets the local selection, so the strip
/// snaps to the live pill by itself.
/// </summary>
export function SceneSwitcher({
  scenes,
  activeSceneId,
  displayedSceneId,
  onView,
  inline = false,
}: {
  /** Already redacted: only scenes this player may see reach the client. */
  scenes: Scene[];
  activeSceneId: string;
  displayedSceneId: string;
  /** null = follow the live scene. */
  onView: (sceneId: string | null) => void;
  /** Render just the button group (no floating pill), for sharing the Board/Stats pill. */
  inline?: boolean;
}) {
  const offLive = displayedSceneId !== activeSceneId;
  return (
    <div
      className={inline ? "scene-switcher-group" : "scene-switcher"}
      role="tablist"
      aria-label="Scenes you can view"
    >
      {scenes.map((scene) => {
        const isLive = scene.id === activeSceneId;
        const shown = scene.id === displayedSceneId;
        return (
          <button
            key={scene.id}
            role="tab"
            aria-selected={shown}
            className={shown ? "btn-active" : ""}
            title={
              isLive
                ? "The live scene — where the action is happening"
                : "Look at this scene (your camera roams free until the DM changes the live scene)"
            }
            onClick={() => onView(isLive ? null : scene.id)}
          >
            {isLive ? "● " : ""}
            {scene.name}
          </button>
        );
      })}
      {offLive ? (
        <button
          className="scene-switcher-return"
          title="Snap back to the live scene"
          onClick={() => onView(null)}
        >
          ⤺ Live
        </button>
      ) : null}
    </div>
  );
}
