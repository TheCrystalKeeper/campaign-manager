// Assets page logic: findAssetUsage now counts scene backdrops, and assetSection
// groups usage-first (unused → "unused", maps + backdrops → "maps"). Real src/lib code.
import { createInitialState, normalizeGameState, type GameState } from "@lib/types";
import { assetSection, findAssetUsage } from "@lib/assetUsage";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const MAP = "/maps/room--scene.webp";
const BACKDROP = "/tokens/room--asset-bd.webp";
const TOKENART = "/tokens/room--asset-tok.webp";
const ORPHAN = "/tokens/room--asset-orphan.webp";

const base = createInitialState("room-assets");
const sceneId = base.scenes[0]!.id;
const state = normalizeGameState({
  ...base,
  scenes: [{ ...base.scenes[0]!, mapUrl: MAP, boardBgImageUrl: BACKDROP }],
  tokens: [
    { id: "t1", sceneId, x: 0, y: 0, label: "Goblin", color: "#c45c5c", kind: "enemy", imageUrl: TOKENART },
  ],
} as unknown as GameState);

// --- findAssetUsage ---------------------------------------------------------
const bd = findAssetUsage(state, BACKDROP);
check(
  "backdrop image is detected as used (kind 'backdrop')",
  bd.length === 1 && bd[0]!.kind === "backdrop" && bd[0]!.id === sceneId,
  JSON.stringify(bd),
);
const map = findAssetUsage(state, MAP);
check("scene map still detected as 'scene'", map.length === 1 && map[0]!.kind === "scene");
const tok = findAssetUsage(state, TOKENART);
check("standalone token art detected as 'token'", tok.length === 1 && tok[0]!.kind === "token");
check("an unreferenced URL has no usage", findAssetUsage(state, ORPHAN).length === 0);

// --- assetSection (usage-first grouping) ------------------------------------
check("unused image → 'unused' section", assetSection("tokens", []) === "unused");
check(
  "backdrop (stored under tokens) → 'maps' section",
  assetSection("tokens", findAssetUsage(state, BACKDROP)) === "maps",
);
check(
  "used map file → 'maps' section",
  assetSection("maps", findAssetUsage(state, MAP)) === "maps",
);
check(
  "used token art → 'tokens' section",
  assetSection("tokens", findAssetUsage(state, TOKENART)) === "tokens",
);
check(
  "an unused map file → 'unused' (usage wins over folder)",
  assetSection("maps", []) === "unused",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
