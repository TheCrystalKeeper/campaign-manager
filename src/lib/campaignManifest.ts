import type { Scene } from "./types";

export type CampaignManifest = {
  version: 1;
  activeSceneId: string;
  scenes: Scene[];
};

export const CAMPAIGN_MANIFEST_PATH = "/campaign/scenes.json";
