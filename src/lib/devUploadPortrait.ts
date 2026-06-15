import { readImageFromFile } from "./sceneUtils";

type UploadPortraitResponse = {
  ok?: boolean;
  url?: string;
  error?: string;
};

/// <summary>
/// Uploads a character portrait via the Vite dev server so only a short URL is sent over WebSocket.
/// </summary>
export async function uploadPortraitInDev(
  slotId: string,
  file: File,
): Promise<{ url: string }> {
  const { dataUrl } = await readImageFromFile(file);

  const response = await fetch("/__dev/upload-portrait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slotId, dataUrl }),
  });

  const payload = (await response.json()) as UploadPortraitResponse;
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "Could not upload portrait.");
  }

  return { url: payload.url };
}
