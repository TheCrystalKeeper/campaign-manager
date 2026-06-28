import type { Viewport } from "./types";

export type SessionViewportMode = "play" | "edit";

const sessionViewports = new Map<string, Viewport>();

/// <summary>
/// Builds a stable in-tab cache key for a viewer's viewport on a room scene.
/// </summary>
function viewportKey(
  roomId: string,
  viewerId: string,
  sceneId: string,
  mode: SessionViewportMode,
): string {
  return `${roomId}:${viewerId}:${sceneId}:${mode}`;
}

/// <summary>
/// Returns a saved pan/zoom for this viewer and scene in the current tab session, if any.
/// </summary>
export function getSessionViewport(
  roomId: string,
  viewerId: string,
  sceneId: string,
  mode: SessionViewportMode,
): Viewport | null {
  const saved = sessionViewports.get(viewportKey(roomId, viewerId, sceneId, mode));
  return saved ? { ...saved } : null;
}

/// <summary>
/// Persists pan/zoom until the page is reloaded.
/// </summary>
export function saveSessionViewport(
  roomId: string,
  viewerId: string,
  sceneId: string,
  mode: SessionViewportMode,
  viewport: Viewport,
): void {
  sessionViewports.set(viewportKey(roomId, viewerId, sceneId, mode), { ...viewport });
}

/// <summary>
/// Clears saved viewports for a room so rejoining starts from the default centered view.
/// </summary>
export function clearSessionViewportsForRoom(roomId: string): void {
  const prefix = `${roomId}:`;
  for (const key of sessionViewports.keys()) {
    if (key.startsWith(prefix)) {
      sessionViewports.delete(key);
    }
  }
}
