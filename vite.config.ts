import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devCampaignSavePlugin } from "./vite-dev-campaign-save";

/// <summary>
/// Vite config with a dev proxy so the frontend can reach PartyKit on a fixed port.
/// </summary>
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const partykitPort = env.PARTYKIT_DEV_PORT ?? "1999";

  return {
    plugins: [react(), devCampaignSavePlugin()],
    server: {
      proxy: {
        "/parties": {
          target: `http://127.0.0.1:${partykitPort}`,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
