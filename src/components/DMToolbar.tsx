import type { GameState, Token } from "../lib/types";
import { TOKEN_COLORS } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import type { FogBrushMode } from "../lib/fogCanvas";

type DmToolbarProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  mode: "main" | "play";
  fogMode: boolean;
  onFogModeChange: (enabled: boolean) => void;
  fogPreview: boolean;
  onFogPreviewChange: (enabled: boolean) => void;
  fogBrushMode: FogBrushMode;
  onFogBrushModeChange: (mode: FogBrushMode) => void;
};

/// <summary>
/// DM toolbar with scene switching; token and fog controls in main (play) mode.
/// </summary>
export function DMToolbar({
  state,
  dm,
  mode,
  fogMode,
  onFogModeChange,
  fogPreview,
  onFogPreviewChange,
  fogBrushMode,
  onFogBrushModeChange,
}: DmToolbarProps) {
  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);
  const sceneTokens = state.tokens.filter((token) => token.sceneId === state.activeSceneId);
  const fogAvailable = activeScene?.fogEnabled ?? false;

  const handleAddToken = () => {
    if (!activeScene) {
      return;
    }
    const token: Token = {
      id: `token-${crypto.randomUUID().slice(0, 8)}`,
      sceneId: activeScene.id,
      x: 200,
      y: 200,
      label: "Token",
      color: TOKEN_COLORS[state.tokens.length % TOKEN_COLORS.length],
      ownerPlayerId: null,
    };
    dm.addToken(token);
  };

  return (
    <footer className="dm-toolbar">
      <div className="toolbar-group">
        <span className="toolbar-label">Scenes</span>
        {state.scenes.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className={scene.id === state.activeSceneId ? "active" : ""}
            onClick={() => dm.setScene(scene.id)}
          >
            {scene.name}
          </button>
        ))}
      </div>

      {mode === "play" ? (
        <>
          <div className="toolbar-group">
            <span className="toolbar-label">Play</span>
            <button type="button" onClick={handleAddToken}>
              + Token
            </button>
            {fogAvailable ? (
              <>
                <button
                  type="button"
                  className={fogMode ? "active" : ""}
                  onClick={() => onFogModeChange(!fogMode)}
                >
                  Fog brush
                </button>
                {fogMode ? (
                  <>
                    <button
                      type="button"
                      className={fogBrushMode === "reveal" ? "active" : ""}
                      onClick={() => onFogBrushModeChange("reveal")}
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      className={fogBrushMode === "hide" ? "active" : ""}
                      onClick={() => onFogBrushModeChange("hide")}
                    >
                      Hide
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={fogPreview ? "active" : ""}
                  onClick={() => onFogPreviewChange(!fogPreview)}
                  title="Off = x-ray vision (see through fog)"
                >
                  Preview fog
                </button>
              </>
            ) : null}
          </div>

          {sceneTokens.length > 0 ? (
            <div className="toolbar-group">
              <span className="toolbar-label">Tokens</span>
              {sceneTokens.map((token) => (
                <button
                  key={token.id}
                  type="button"
                  className="btn-compact danger"
                  onClick={() => dm.removeToken(token.id)}
                >
                  × {token.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </footer>
  );
}
