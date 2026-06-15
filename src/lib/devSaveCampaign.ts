import type { CampaignManifest } from "./campaignManifest";
import type { GameState } from "./types";

/// <summary>
/// Persists the current campaign to public/ via the Vite dev server (localhost only).
/// </summary>
export async function saveCampaignToDisk(state: GameState): Promise<CampaignManifest> {
  const response = await fetch("/__dev/save-campaign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      activeSceneId: state.activeSceneId,
      scenes: state.scenes,
    }),
  });

  const payload = (await response.json()) as {
    ok?: boolean;
    manifest?: CampaignManifest;
    error?: string;
  };

  if (!response.ok || !payload.manifest) {
    throw new Error(payload.error ?? "Could not save campaign to disk.");
  }

  return payload.manifest;
}
