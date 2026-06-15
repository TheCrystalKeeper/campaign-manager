import type { Plugin, ViteDevServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CampaignManifest } from "./src/lib/campaignManifest";
import type { Scene } from "./src/lib/types";

type SaveRequestBody = {
  activeSceneId: string;
  scenes: Scene[];
};

type UploadMapImageBody = {
  sceneId: string;
  layerId: string;
  dataUrl: string;
  width: number;
  height: number;
};

type UploadPortraitBody = {
  slotId: string;
  dataUrl: string;
};

/// <summary>
/// Decodes a data URL into a binary buffer and file extension.
/// </summary>
export function dataUrlToFile(dataUrl: string): { buffer: Buffer; ext: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image data URL.");
  }
  const mime = match[1];
  const ext =
    mime === "image/jpeg"
      ? "jpg"
      : mime === "image/webp"
        ? "webp"
        : mime === "image/gif"
          ? "gif"
          : mime === "image/svg+xml"
            ? "svg"
            : "png";
  return { buffer: Buffer.from(match[2], "base64"), ext };
}

/// <summary>
/// Reads the full request body from a Node HTTP incoming message.
/// </summary>
function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/// <summary>
/// Writes a map image data URL to public/maps and returns its served URL path.
/// </summary>
export async function writeMapImageToDisk(
  rootDir: string,
  sceneId: string,
  layerId: string,
  dataUrl: string,
): Promise<string> {
  const mapsDir = join(rootDir, "public", "maps");
  await mkdir(mapsDir, { recursive: true });
  const { buffer, ext } = dataUrlToFile(dataUrl);
  const filename = `${sceneId}-${layerId}.${ext}`;
  await writeFile(join(mapsDir, filename), buffer);
  return `/maps/${filename}`;
}

/// <summary>
/// Writes a character portrait data URL to public/portraits and returns its served URL path.
/// </summary>
export async function writePortraitToDisk(
  rootDir: string,
  slotId: string,
  dataUrl: string,
): Promise<string> {
  const portraitsDir = join(rootDir, "public", "portraits");
  await mkdir(portraitsDir, { recursive: true });
  const { buffer, ext } = dataUrlToFile(dataUrl);
  const filename = `${slotId}.${ext}`;
  await writeFile(join(portraitsDir, filename), buffer);
  return `/portraits/${filename}`;
}

/// <summary>
/// Writes scene layers and fog masks to public/ and returns a path-based manifest.
/// </summary>
async function buildManifest(
  rootDir: string,
  body: SaveRequestBody,
): Promise<CampaignManifest> {
  const fogDir = join(rootDir, "public", "campaign", "fog");
  const campaignDir = join(rootDir, "public", "campaign");
  await mkdir(fogDir, { recursive: true });
  await mkdir(campaignDir, { recursive: true });

  const scenes: Scene[] = [];

  for (const scene of body.scenes) {
    const layers = [];
    for (const layer of scene.layers) {
      if (layer.url.startsWith("data:")) {
        const url = await writeMapImageToDisk(rootDir, scene.id, layer.id, layer.url);
        layers.push({ ...layer, url });
      } else {
        layers.push(layer);
      }
    }

    let fogDataUrl = scene.fogDataUrl;
    if (fogDataUrl?.startsWith("data:")) {
      const { buffer } = dataUrlToFile(fogDataUrl);
      const fogFilename = `${scene.id}.png`;
      await writeFile(join(fogDir, fogFilename), buffer);
      fogDataUrl = `/campaign/fog/${fogFilename}`;
    }

    scenes.push({ ...scene, layers, fogDataUrl });
  }

  const manifest: CampaignManifest = {
    version: 1,
    activeSceneId: body.activeSceneId,
    scenes,
  };

  await writeFile(
    join(campaignDir, "scenes.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

/// <summary>
/// Vite dev-only middleware that persists campaign scenes and map images under public/.
/// </summary>
export function devCampaignSavePlugin(): Plugin {
  return {
    name: "dev-campaign-save",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__dev/upload-map-image", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          try {
            const raw = await readRequestBody(req);
            const body = JSON.parse(raw) as UploadMapImageBody;
            if (!body?.sceneId || !body?.layerId || !body?.dataUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid upload payload." }));
              return;
            }

            const url = await writeMapImageToDisk(
              server.config.root,
              body.sceneId,
              body.layerId,
              body.dataUrl,
            );
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: true,
                url,
                layerId: body.layerId,
                width: body.width,
                height: body.height,
              }),
            );
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Upload failed.",
              }),
            );
          }
        })();
      });

      server.middlewares.use("/__dev/upload-portrait", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          try {
            const raw = await readRequestBody(req);
            const body = JSON.parse(raw) as UploadPortraitBody;
            if (!body?.slotId || !body?.dataUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid upload payload." }));
              return;
            }

            const url = await writePortraitToDisk(server.config.root, body.slotId, body.dataUrl);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, url }));
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Upload failed.",
              }),
            );
          }
        })();
      });

      server.middlewares.use("/__dev/save-campaign", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }

        void (async () => {
          try {
            const raw = await readRequestBody(req);
            const body = JSON.parse(raw) as SaveRequestBody;
            if (!body?.activeSceneId || !Array.isArray(body.scenes)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid campaign payload." }));
              return;
            }

            const manifest = await buildManifest(server.config.root, body);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, manifest }));
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Save failed.",
              }),
            );
          }
        })();
      });
    },
  };
}
