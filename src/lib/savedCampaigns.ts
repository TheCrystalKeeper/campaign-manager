import { clearCampaignAll } from "./campaignStore";

export type SavedCampaign = {
  roomId: string;
  name: string;
  lastJoinedAt: number;
  iconUrl?: string | null;
};

export type UpsertCampaignOptions = {
  name?: string;
  iconUrl?: string | null;
};

const CAMPAIGNS_KEY = "cm-saved-campaigns";
const ROOM_KEYS_KEY = "cm-room-keys";

/// <summary>
/// Loads the user's saved campaign rooms from local storage.
/// </summary>
export function loadSavedCampaigns(): SavedCampaign[] {
  try {
    const raw = localStorage.getItem(CAMPAIGNS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SavedCampaign[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/// <summary>
/// Persists the campaign list to local storage.
/// </summary>
export function saveSavedCampaigns(campaigns: SavedCampaign[]): void {
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));
}

/// <summary>
/// Builds a readable default label from a room id slug.
/// </summary>
export function formatCampaignName(roomId: string): string {
  const trimmed = roomId.trim();
  if (!trimmed) {
    return "New campaign";
  }
  return trimmed
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/// <summary>
/// Creates a unique room id for a newly added campaign.
/// </summary>
export function generateRoomId(): string {
  return `campaign-${crypto.randomUUID().slice(0, 8)}`;
}

/// <summary>
/// Turns a user-facing campaign name into a filename-safe slug: apostrophes are
/// dropped so contractions stay tight ("Dragon's" → "Dragons"), every other run of
/// spaces/punctuation/Windows-illegal characters collapses to a single hyphen, and
/// the result is capped at `maxLen`. Returns "" when nothing usable survives (e.g. an
/// emoji- or non-Latin-only name), letting callers fall back to the room id alone.
/// </summary>
export function slugifyCampaignName(name: string, maxLen = 40): string {
  return name
    .trim()
    .replace(/['’"]/g, "")            // drop apostrophes/quotes so contractions stay tight
    .replace(/[^a-zA-Z0-9]+/g, "-")   // spaces + illegal chars → a single hyphen
    .replace(/^-+|-+$/g, "")           // no leading/trailing hyphens
    .slice(0, maxLen)                  // cap length so the full path stays well under Windows' limit
    .replace(/-+$/g, "");              // tidy a hyphen the length cap may have left dangling
}

/// <summary>
/// Builds the download filename for a full-campaign export:
/// `campaign-{roomId}-{slug(name)}-{YYYY-MM-DD}.json`. The name segment is omitted when
/// it slugifies to nothing, matching the older room-id-only filename.
/// </summary>
export function campaignExportFilename(
  roomId: string,
  name: string | undefined | null,
  date: Date = new Date(),
): string {
  const datePart = date.toISOString().slice(0, 10);
  const slug = name ? slugifyCampaignName(name) : "";
  return slug
    ? `campaign-${roomId}-${slug}-${datePart}.json`
    : `campaign-${roomId}-${datePart}.json`;
}

/// <summary>
/// Adds or updates a campaign entry and moves it to the top of the list.
/// </summary>
export function upsertSavedCampaign(
  roomId: string,
  nameOrOptions?: string | UpsertCampaignOptions,
): SavedCampaign[] {
  const trimmedId = roomId.trim();
  if (!trimmedId) {
    return loadSavedCampaigns();
  }

  const options: UpsertCampaignOptions =
    typeof nameOrOptions === "string" ? { name: nameOrOptions } : (nameOrOptions ?? {});

  const all = loadSavedCampaigns();
  const existing = all.find((item) => item.roomId === trimmedId);
  const campaigns = all.filter((item) => item.roomId !== trimmedId);
  const next: SavedCampaign = {
    roomId: trimmedId,
    name: options.name?.trim() || existing?.name || formatCampaignName(trimmedId),
    lastJoinedAt: Date.now(),
    iconUrl:
      options.iconUrl !== undefined ? options.iconUrl : (existing?.iconUrl ?? null),
  };
  const merged = [next, ...campaigns].sort((a, b) => b.lastJoinedAt - a.lastJoinedAt);
  saveSavedCampaigns(merged);
  return merged;
}

/// <summary>
/// Removes a campaign from the saved list without deleting its room on the server.
/// </summary>
export function removeSavedCampaign(roomId: string): SavedCampaign[] {
  const merged = loadSavedCampaigns().filter((item) => item.roomId !== roomId);
  saveSavedCampaigns(merged);
  // Forget this campaign's per-campaign UI prefs (layout + toggles) so they don't linger.
  clearCampaignAll(roomId);
  return merged;
}

/// <summary>
/// Reads the remembered password for a campaign room, if any.
/// </summary>
export function loadRoomKey(roomId: string): string {
  try {
    const keys = JSON.parse(localStorage.getItem(ROOM_KEYS_KEY) ?? "{}") as Record<string, string>;
    return keys[roomId] ?? "";
  } catch {
    return "";
  }
}

/// <summary>
/// Stores or clears the password for a campaign room in local storage.
/// </summary>
export function saveRoomKey(roomId: string, key: string): void {
  const keys = JSON.parse(localStorage.getItem(ROOM_KEYS_KEY) ?? "{}") as Record<string, string>;
  const trimmed = key.trim();
  if (trimmed) {
    keys[roomId] = trimmed;
  } else {
    delete keys[roomId];
  }
  localStorage.setItem(ROOM_KEYS_KEY, JSON.stringify(keys));
}

/// <summary>
/// Ensures at least one campaign exists for first-time visitors.
/// </summary>
export function ensureDefaultCampaigns(initialRoomId: string): SavedCampaign[] {
  const campaigns = loadSavedCampaigns();
  if (campaigns.length > 0) {
    return campaigns;
  }
  return upsertSavedCampaign(initialRoomId || "campaign1");
}
