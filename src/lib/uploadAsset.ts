import { readImageFromFile } from "./sceneUtils";

// Client mirror of the DM's synced "Optimize uploads" setting (kept in sync by App from game
// state). When on, uploads are downscaled to a per-kind cap and re-encoded as WebP before they
// reach R2 — far smaller files (quicker to decode, and the 10 GB bucket lasts much longer).
// Defaults on so a join-time campaign-icon upload (before any state exists) is still optimized.
let optimizeUploads = true;
export function setOptimizeUploads(enabled: boolean): void {
  optimizeUploads = enabled;
}
// Longest-side caps per asset kind. Maps stay generous so deep zoom keeps detail.
const CAP_PORTRAIT_TOKEN = 1024;
const CAP_MAP = 2560;
const CAP_ICON = 512;
function uploadOpts(maxSide: number): { maxSide: number } | undefined {
  return optimizeUploads ? { maxSide } : undefined;
}

type UploadResponse = {
  ok?: boolean;
  url?: string;
  layerId?: string;
  width?: number;
  height?: number;
  error?: string;
};

/// <summary>
/// Parses a JSON upload response and surfaces clear errors for empty or invalid bodies.
/// </summary>
async function parseUploadResponse(response: Response): Promise<UploadResponse> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "Upload server returned an empty response."
        : `Upload failed (${response.status}). Image uploads may not be configured for this deployment.`,
    );
  }

  try {
    return JSON.parse(text) as UploadResponse;
  } catch {
    throw new Error(`Upload server returned invalid JSON (${response.status}).`);
  }
}

/// <summary>
/// Posts a JSON payload to the dev or production upload endpoint.
/// </summary>
async function postUpload(path: string, body: Record<string, unknown>): Promise<UploadResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseUploadResponse(response);
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "Image upload failed.");
  }
  return payload;
}

/// <summary>
/// Uploads a character portrait and returns its public URL path. Keys are
/// namespaced by room so assets can be listed/cleaned up per campaign.
/// </summary>
export async function uploadPortrait(
  roomId: string,
  slotId: string,
  file: File,
): Promise<{ url: string }> {
  const { dataUrl } = await readImageFromFile(file, uploadOpts(CAP_PORTRAIT_TOKEN));
  const path = import.meta.env.DEV ? "/__dev/upload-portrait" : "/api/upload-portrait";
  const payload = await postUpload(path, { roomId, slotId, dataUrl });
  return { url: payload.url! };
}

/// <summary>
/// Uploads a map token image and returns its public URL path.
/// </summary>
export async function uploadTokenImage(
  roomId: string,
  tokenId: string,
  file: File,
): Promise<{ url: string }> {
  const { dataUrl } = await readImageFromFile(file, uploadOpts(CAP_PORTRAIT_TOKEN));
  const path = import.meta.env.DEV ? "/__dev/upload-token-image" : "/api/upload-token-image";
  const payload = await postUpload(path, { roomId, tokenId, dataUrl });
  return { url: payload.url! };
}

export async function uploadCampaignIcon(roomId: string, file: File): Promise<{ url: string }> {
  const { dataUrl } = await readImageFromFile(file, uploadOpts(CAP_ICON));
  const path = import.meta.env.DEV ? "/__dev/upload-campaign-icon" : "/api/upload-campaign-icon";
  const payload = await postUpload(path, { roomId, dataUrl });
  return { url: payload.url! };
}

/// <summary>
/// Uploads a standalone image for the Assets library (stored under the room's token
/// prefix). Returns its public URL.
/// </summary>
export async function uploadLibraryImage(roomId: string, file: File): Promise<{ url: string }> {
  return uploadTokenImage(roomId, `asset-${crypto.randomUUID().slice(0, 8)}`, file);
}

/// <summary>
/// Uploads a scene backdrop image (stored under the room's token prefix, like the
/// library). Uses the MAP cap (2560), not the token cap: a backdrop fills the whole
/// viewport, so a sharp/low-blur backdrop needs the extra resolution to stay crisp.
/// </summary>
export async function uploadBackdropImage(roomId: string, file: File): Promise<{ url: string }> {
  const { dataUrl } = await readImageFromFile(file, uploadOpts(CAP_MAP));
  const path = import.meta.env.DEV ? "/__dev/upload-token-image" : "/api/upload-token-image";
  const payload = await postUpload(path, {
    roomId,
    tokenId: `asset-${crypto.randomUUID().slice(0, 8)}`,
    dataUrl,
  });
  return { url: payload.url! };
}

export type AssetInfo = { key: string; url: string; kind: string; size: number; uploaded: string };

/// <summary>
/// Lists a room's uploaded R2 assets (Phase 7 Assets page). Resilient in dev where the
/// Pages function + R2 aren't served — returns an empty, unconfigured list instead of throwing.
/// </summary>
export async function listAssets(roomId: string): Promise<{ assets: AssetInfo[]; unconfigured: boolean }> {
  const path = import.meta.env.DEV ? "/__dev/list-assets" : "/api/list-assets";
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    });
    if (!response.ok) {
      return { assets: [], unconfigured: true };
    }
    const payload = (await response.json()) as { assets?: AssetInfo[]; unconfigured?: boolean };
    return { assets: payload.assets ?? [], unconfigured: Boolean(payload.unconfigured) };
  } catch {
    return { assets: [], unconfigured: true };
  }
}

/// <summary>Deletes one uploaded asset by key (server validates the room prefix).</summary>
export async function deleteAsset(roomId: string, key: string): Promise<void> {
  const path = import.meta.env.DEV ? "/__dev/delete-asset" : "/api/delete-asset";
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, key }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Delete failed.");
  }
}

/// <summary>
/// Uploads a map layer image and returns its URL plus layer metadata.
/// </summary>
export async function uploadMapImage(
  roomId: string,
  sceneId: string,
  file: File,
): Promise<{ url: string; layerId: string; width: number; height: number }> {
  const { dataUrl, width, height } = await readImageFromFile(file, uploadOpts(CAP_MAP));
  const layerId = `layer-${crypto.randomUUID().slice(0, 8)}`;
  const path = import.meta.env.DEV ? "/__dev/upload-map-image" : "/api/upload-map-image";
  const payload = await postUpload(path, { roomId, sceneId, layerId, dataUrl, width, height });
  return {
    url: payload.url!,
    layerId: payload.layerId ?? layerId,
    width: payload.width ?? width,
    height: payload.height ?? height,
  };
}
