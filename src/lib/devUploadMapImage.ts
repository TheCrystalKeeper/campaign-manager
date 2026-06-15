import { readImageFromFile } from "./sceneUtils";

type UploadMapImageResponse = {
  ok?: boolean;
  url?: string;
  layerId?: string;
  width?: number;
  height?: number;
  error?: string;
};

/// <summary>
/// Uploads a map image via the Vite dev server so only a short URL is sent over WebSocket.
/// </summary>
export async function uploadMapImageInDev(
  sceneId: string,
  file: File,
): Promise<{ url: string; layerId: string; width: number; height: number }> {
  const { dataUrl, width, height } = await readImageFromFile(file);
  const layerId = `layer-${crypto.randomUUID().slice(0, 8)}`;

  const response = await fetch("/__dev/upload-map-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneId, layerId, dataUrl, width, height }),
  });

  const payload = (await response.json()) as UploadMapImageResponse;
  if (!response.ok || !payload.url || !payload.layerId) {
    throw new Error(payload.error ?? "Could not upload image.");
  }

  return {
    url: payload.url,
    layerId: payload.layerId,
    width: payload.width ?? width,
    height: payload.height ?? height,
  };
}
