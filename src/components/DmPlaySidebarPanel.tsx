import { useCallback, useState } from "react";
import type { GameState } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { DicePanel } from "./DicePanel";
import { SceneAccessPanel } from "./SceneAccessPanel";
import type { DicePanelProps } from "./DicePanel";

type TabId = "scene" | "dice";

const TAB_STORAGE_KEY = "cm-dm-play-sidebar-tab";

function readStoredTab(): TabId {
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return stored === "dice" ? "dice" : "scene";
  } catch {
    return "scene";
  }
}

type DmPlaySidebarPanelProps = DicePanelProps & {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
};

/// <summary>
/// DM main-view sidebar: scene access and dice in one tabbed panel.
/// </summary>
export function DmPlaySidebarPanel({
  state,
  dm,
  isDm,
  yourPlayerId,
  publicRolls,
  privateRolls,
  onRoll,
  onArm,
  onThrowArmed,
  onThrowExpression,
  onInstantExpression,
  onInstantArmed,
  hasArmed,
  trayVisible,
  onToggleTray,
  muted,
  onToggleMuted,
}: DmPlaySidebarPanelProps) {
  const [tab, setTabState] = useState<TabId>(readStoredTab);

  const setTab = useCallback((next: TabId) => {
    setTabState(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // ignore storage failures
    }
  }, []);

  const lastRollTotal = publicRolls.length > 0 ? publicRolls[publicRolls.length - 1]?.total : null;

  return (
    <div className="side-panel sheet-dice-panel dm-play-sidebar">
      <header className="side-panel-header sheet-dice-header">
        <nav className="panel-tabs" aria-label="Scene access and dice">
          <button
            type="button"
            className={tab === "scene" ? "active" : ""}
            aria-selected={tab === "scene"}
            onClick={() => setTab("scene")}
          >
            Scene
          </button>
          <button
            type="button"
            className={tab === "dice" ? "active" : ""}
            aria-selected={tab === "dice"}
            onClick={() => setTab("dice")}
          >
            Dice
            {lastRollTotal != null ? (
              <span className="panel-tab-badge">{lastRollTotal}</span>
            ) : null}
          </button>
        </nav>
        {tab === "dice" ? (
          <div className="sheet-dice-header-actions">
            <button
              type="button"
              className="btn-compact dice-icon-btn"
              aria-pressed={!muted}
              aria-label={muted ? "Unmute dice sounds" : "Mute dice sounds"}
              title={muted ? "Unmute dice sounds" : "Mute dice sounds"}
              onClick={() => onToggleMuted(!muted)}
            >
              <span className="dice-icon-btn-glyph" aria-hidden>
                {muted ? "🔇" : "🔊"}
              </span>
            </button>
            <button
              type="button"
              className="btn-compact"
              aria-pressed={trayVisible}
              title={trayVisible ? "Hide the 3D dice tray" : "Show the 3D dice tray"}
              onClick={() => onToggleTray(!trayVisible)}
            >
              {trayVisible ? "Tray ✓" : "Tray"}
            </button>
          </div>
        ) : null}
      </header>

      <div
        className={`side-panel-body sheet-dice-body${
          tab === "dice" ? " sheet-dice-body--dice" : ""
        }`}
      >
        {tab === "scene" ? (
          <SceneAccessPanel embedded state={state} dm={dm} />
        ) : (
          <DicePanel
            embedded
            isDm={isDm}
            yourPlayerId={yourPlayerId}
            publicRolls={publicRolls}
            privateRolls={privateRolls}
            onRoll={onRoll}
            onArm={onArm}
            onThrowArmed={onThrowArmed}
            onThrowExpression={onThrowExpression}
            onInstantExpression={onInstantExpression}
            onInstantArmed={onInstantArmed}
            hasArmed={hasArmed}
            trayVisible={trayVisible}
            onToggleTray={onToggleTray}
            muted={muted}
            onToggleMuted={onToggleMuted}
          />
        )}
      </div>
    </div>
  );
}
