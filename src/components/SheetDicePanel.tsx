import { useCallback, useState } from "react";
import { CharacterSheetPanel, type CharacterSheetProps } from "./CharacterSheet";
import { DicePanel, type DicePanelProps } from "./DicePanel";

export type SheetDicePanelProps = CharacterSheetProps & DicePanelProps;

type TabId = "sheet" | "dice";

const TAB_STORAGE_KEY = "cm-sheet-dice-tab";

function readStoredTab(): TabId {
  try {
    return window.localStorage.getItem(TAB_STORAGE_KEY) === "dice" ? "dice" : "sheet";
  } catch {
    return "sheet";
  }
}

/// <summary>
/// Side panel with Character sheet and Dice as tabs in one resizable column.
/// </summary>
export function SheetDicePanel(props: SheetDicePanelProps) {
  const {
    isDm,
    showSlotManagement = true,
    publicRolls,
    trayVisible,
    onToggleTray,
    muted,
    onToggleMuted,
    yourPlayerId,
    privateRolls,
    onRoll,
    onArm,
    onThrowArmed,
    onThrowExpression,
    onInstantExpression,
    onInstantArmed,
    hasArmed,
    ...sheetProps
  } = props;

  const [tab, setTabState] = useState<TabId>(readStoredTab);

  const setTab = useCallback((next: TabId) => {
    setTabState(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // ignore storage failures
    }
  }, []);

  const sheetTabLabel =
    isDm && showSlotManagement ? "Players" : isDm ? "Sheets" : "Character";
  const lastRollTotal = publicRolls.length > 0 ? publicRolls[publicRolls.length - 1]?.total : null;

  return (
    <div className="side-panel sheet-dice-panel">
      <header className="side-panel-header sheet-dice-header">
        <nav className="panel-tabs" aria-label="Character sheet and dice">
          <button
            type="button"
            className={tab === "sheet" ? "active" : ""}
            aria-selected={tab === "sheet"}
            onClick={() => setTab("sheet")}
          >
            {sheetTabLabel}
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

      <div className={`side-panel-body sheet-dice-body${tab === "dice" ? " sheet-dice-body--dice" : ""}`}>
        {tab === "sheet" ? (
          <CharacterSheetPanel embedded {...sheetProps} isDm={isDm} showSlotManagement={showSlotManagement} />
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
