import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { CampaignManifest } from "../src/lib/campaignManifest";
import { normalizeScene } from "../src/lib/sceneUtils";

const MANIFEST_RELATIVE = join("public", "campaign", "scenes.json");

/// <summary>
/// Loads a saved campaign manifest from the public folder when PartyKit storage is empty.
/// </summary>
export async function loadCampaignFromDisk(): Promise<CampaignManifest | null> {
  const manifestPath = join(process.cwd(), MANIFEST_RELATIVE);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as CampaignManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.scenes)) {
      return null;
    }
    return {
      version: 1,
      activeSceneId: parsed.activeSceneId,
      scenes: parsed.scenes.map((scene) => normalizeScene(scene)),
    };
  } catch {
    return null;
  }
}
