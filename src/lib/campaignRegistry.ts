import type { SavedCampaign } from "./savedCampaigns";
import { loadSavedCampaigns, saveSavedCampaigns } from "./savedCampaigns";

export type CampaignRegistryEntry = {
  roomId: string;
  name: string;
  iconUrl?: string | null;
  /** Short blurb shown on the join screen; DM-editable. Null when unset. */
  description?: string | null;
  createdAt: number;
};

export type CampaignRegistryFile = {
  rooms: CampaignRegistryEntry[];
};

/** Max stored description length — long enough for a paragraph, capped so the registry stays small. */
export const CAMPAIGN_DESCRIPTION_CAP = 1000;

export const DEFAULT_CAMPAIGN_REGISTRY: CampaignRegistryEntry[] = [
  {
    roomId: "campaign1",
    name: "Campaign 1",
    createdAt: 0,
    iconUrl: null,
  },
];

/// <summary>
/// Parses persisted registry JSON into a normalized room list.
/// </summary>
export function parseRegistryFile(raw: string): CampaignRegistryEntry[] {
  try {
    const parsed = JSON.parse(raw) as CampaignRegistryFile | CampaignRegistryEntry[];
    const rooms = Array.isArray(parsed) ? parsed : parsed.rooms;
    if (!Array.isArray(rooms)) {
      return [...DEFAULT_CAMPAIGN_REGISTRY];
    }
    return rooms
      .map(normalizeRegistryEntry)
      .filter((entry): entry is CampaignRegistryEntry => entry !== null);
  } catch {
    return [...DEFAULT_CAMPAIGN_REGISTRY];
  }
}

/// <summary>
/// Serializes the registry for disk or R2 storage.
/// </summary>
export function serializeRegistryFile(rooms: CampaignRegistryEntry[]): string {
  const normalized = rooms
    .map(normalizeRegistryEntry)
    .filter((entry): entry is CampaignRegistryEntry => entry !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
  return `${JSON.stringify({ rooms: normalized } satisfies CampaignRegistryFile, null, 2)}\n`;
}

/// <summary>
/// Inserts or updates a room in the registry list.
/// </summary>
export function upsertRegistryEntry(
  rooms: CampaignRegistryEntry[],
  entry: CampaignRegistryEntry,
): CampaignRegistryEntry[] {
  const normalized = normalizeRegistryEntry(entry);
  if (!normalized) {
    return rooms;
  }
  // Keep the original creation time on edits so updating a room's name/description/icon
  // doesn't bump it to the top of the registry ordering.
  const existing = rooms.find((room) => room.roomId === normalized.roomId);
  if (existing) {
    normalized.createdAt = existing.createdAt;
  }
  const rest = rooms.filter((room) => room.roomId !== normalized.roomId);
  return [normalized, ...rest].sort((a, b) => b.createdAt - a.createdAt);
}

/// <summary>
/// Merges the shared registry with per-browser join history for display order.
/// </summary>
export function mergeRegistryWithLocal(
  registry: CampaignRegistryEntry[],
  local: SavedCampaign[],
): SavedCampaign[] {
  const localById = new Map(local.map((campaign) => [campaign.roomId, campaign]));
  return registry
    .map((entry) => {
      const saved = localById.get(entry.roomId);
      return {
        roomId: entry.roomId,
        name: entry.name,
        iconUrl: entry.iconUrl ?? saved?.iconUrl ?? null,
        description: entry.description ?? saved?.description ?? null,
        lastJoinedAt: saved?.lastJoinedAt ?? entry.createdAt,
      } satisfies SavedCampaign;
    })
    .sort((a, b) => b.lastJoinedAt - a.lastJoinedAt);
}

/// <summary>
/// Resolves the dev or production registry API path.
/// </summary>
function registryApiPath(): string {
  return import.meta.env.DEV ? "/__dev/campaign-rooms" : "/api/campaign-rooms";
}

/// <summary>
/// Loads the shared campaign room list from the server.
/// </summary>
export async function fetchCampaignRegistry(): Promise<CampaignRegistryEntry[]> {
  const response = await fetch(registryApiPath());
  if (!response.ok) {
    throw new Error(`Could not load campaign rooms (${response.status}).`);
  }
  const payload = (await response.json()) as CampaignRegistryFile;
  if (!Array.isArray(payload.rooms)) {
    return [...DEFAULT_CAMPAIGN_REGISTRY];
  }
  return payload.rooms;
}

/// <summary>
/// Registers a campaign room so every player sees it on the join screen.
/// </summary>
export async function registerCampaignRoom(
  entry: Pick<CampaignRegistryEntry, "roomId" | "name"> & {
    iconUrl?: string | null;
    description?: string | null;
  },
): Promise<CampaignRegistryEntry[]> {
  const response = await fetch(registryApiPath(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  const payload = (await response.json()) as CampaignRegistryFile & { error?: string };
  if (!response.ok || !Array.isArray(payload.rooms)) {
    throw new Error(payload.error ?? "Could not register the campaign room.");
  }
  return payload.rooms;
}

/// <summary>
/// Loads shared rooms and merges them with this browser's saved join order.
/// </summary>
export async function loadMergedCampaigns(): Promise<SavedCampaign[]> {
  const registry = await fetchCampaignRegistry();
  const merged = mergeRegistryWithLocal(registry, loadSavedCampaigns());
  saveSavedCampaigns(merged);
  return merged;
}

/// <summary>
/// Coerces unknown registry rows into valid entries.
/// </summary>
function normalizeRegistryEntry(value: unknown): CampaignRegistryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Partial<CampaignRegistryEntry>;
  const roomId = entry.roomId?.trim();
  const name = entry.name?.trim();
  if (!roomId || !name) {
    return null;
  }
  const description =
    typeof entry.description === "string" && entry.description.trim()
      ? entry.description.trim().slice(0, CAMPAIGN_DESCRIPTION_CAP)
      : null;
  return {
    roomId,
    name,
    iconUrl: entry.iconUrl ?? null,
    description,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
  };
}
