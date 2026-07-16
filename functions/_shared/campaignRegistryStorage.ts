import {
  DEFAULT_CAMPAIGN_REGISTRY,
  parseRegistryFile,
  serializeRegistryFile,
  upsertRegistryEntry,
  type CampaignRegistryEntry,
} from "../../src/lib/campaignRegistry";

const REGISTRY_KEY = "registry/rooms.json";

/// <summary>
/// Reads the shared campaign registry from R2, falling back to defaults when empty.
/// </summary>
export async function readRegistryFromR2(bucket: R2Bucket): Promise<CampaignRegistryEntry[]> {
  const object = await bucket.get(REGISTRY_KEY);
  if (!object) {
    return [...DEFAULT_CAMPAIGN_REGISTRY];
  }
  return parseRegistryFile(await object.text());
}

/// <summary>
/// Persists a new or updated campaign room entry to the shared registry.
/// </summary>
export async function upsertRegistryRoomInR2(
  bucket: R2Bucket,
  entry: Pick<CampaignRegistryEntry, "roomId" | "name"> & {
    iconUrl?: string | null;
    description?: string | null;
  },
): Promise<CampaignRegistryEntry[]> {
  const rooms = await readRegistryFromR2(bucket);
  const next = upsertRegistryEntry(rooms, {
    roomId: entry.roomId.trim(),
    name: entry.name.trim(),
    iconUrl: entry.iconUrl ?? null,
    description: entry.description ?? null,
    createdAt: Date.now(),
  });
  await bucket.put(REGISTRY_KEY, serializeRegistryFile(next), {
    httpMetadata: { contentType: "application/json" },
  });
  return next;
}
