import type { GameRoom, useDmActions } from "../hooks/useGameRoom";
import { Dices, Swords } from "lucide-react";
import { DEFAULT_ICON_CROP, type GameState } from "../lib/types";
import { CroppableImage } from "./CroppableImage";
import { NumberInput } from "./NumberInput";
import { HpStepper } from "./HpStepper";

type InitiativeTrackerProps = {
  state: GameState;
  isDm: boolean;
  room: GameRoom;
  dm: ReturnType<typeof useDmActions>;
  openSheet: (sheetId: string) => void;
};

/// <summary>
/// The initiative order during combat. Out of combat the DM gets the
/// "Roll for initiative!" button (all tokens in the active scene); in combat
/// players with a pending roll get a one-click CTA that uses their sheet.
/// </summary>
export function InitiativeTracker({ state, isDm, room, dm, openSheet }: InitiativeTrackerProps) {
  const combat = state.combat;

  if (!combat) {
    if (!isDm) {
      return (
        <div className="panel-body">
          <span className="muted">No active combat.</span>
        </div>
      );
    }
    const sceneTokenIds = state.tokens
      .filter((token) => token.sceneId === state.activeSceneId && token.kind !== "item")
      .map((token) => token.id);
    return (
      <div className="panel-body stack">
        <button
          className="btn-primary"
          disabled={sceneTokenIds.length === 0}
          onClick={() => dm.startCombat(sceneTokenIds)}
        >
          <Swords size={15} strokeWidth={2.2} /> Roll for initiative!
        </button>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          {sceneTokenIds.length === 0
            ? "Place tokens in the scene first."
            : `Starts combat with all ${sceneTokenIds.length} tokens in the scene. NPCs roll automatically; players get a roll prompt.`}
        </span>
      </div>
    );
  }

  const myPendingRoll =
    !isDm &&
    combat.entries.some((entry) => {
      if (entry.initiative !== null) {
        return false;
      }
      const token = state.tokens.find((item) => item.id === entry.tokenId);
      return token?.ownerPlayerId === room.yourPlayerId || entry.sheetId === room.yourPlayerId;
    });

  return (
    <div className="panel-body stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="init-round">Round {combat.round}</span>
        {isDm ? (
          <div className="row">
            <button title="Previous turn" onClick={() => dm.prevTurn()}>
              ◀
            </button>
            <button className="btn-primary" title="Next turn" onClick={() => dm.nextTurn()}>
              Next ▶
            </button>
            <button className="btn-danger" title="End combat" onClick={() => dm.endCombat()}>
              End
            </button>
          </div>
        ) : null}
      </div>

      {myPendingRoll ? (
        <button
          className="btn-primary"
          onClick={() => room.send({ type: "COMBAT_ROLL_INITIATIVE" })}
        >
          <Dices size={15} strokeWidth={2.2} /> Roll initiative!
        </button>
      ) : null}

      <div className="stack" style={{ gap: "0.15rem" }}>
        {combat.entries.map((entry, index) => {
          const token = state.tokens.find((item) => item.id === entry.tokenId);
          const sheet = entry.sheetId ? state.sheets[entry.sheetId] : undefined;
          const portrait = sheet?.data.iconUrl ?? token?.imageUrl ?? null;
          const portraitCrop = sheet?.data.iconUrl ? sheet.data.iconCrop : DEFAULT_ICON_CROP;
          const current = index === combat.turnIndex;
          // No portrait (or a broken/deleted one) → the name's initial, not a broken-image icon.
          const initDot = (
            <span
              className="init-portrait init-dot"
              style={{ background: token?.color ?? "var(--surface-2)", display: "grid", placeItems: "center" }}
            >
              {entry.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          );
          return (
            <div className={`init-row${current ? " init-row--current" : ""}`} key={entry.id}>
              <span className="init-marker">{current ? "▶" : ""}</span>
              {portrait ? (
                <CroppableImage className="init-portrait" src={portrait} crop={portraitCrop} alt="" fallback={initDot} />
              ) : (
                initDot
              )}
              {entry.sheetId ? (
                <button
                  className="init-name btn-ghost"
                  onClick={() => openSheet(entry.sheetId!)}
                  title="Open sheet"
                >
                  {entry.name}
                </button>
              ) : (
                <span className="init-name">{entry.name}</span>
              )}
              {isDm ? (
                <span className="init-value">
                  <NumberInput
                    value={entry.initiative ?? 0}
                    onCommit={(value) => dm.setCombatInitiative(entry.id, value)}
                    aria-label={`${entry.name} initiative`}
                  />
                </span>
              ) : (
                <span className="init-value">
                  {entry.initiative === null ? (
                    <span className="muted">waiting…</span>
                  ) : (
                    entry.initiative
                  )}
                </span>
              )}
              {sheet && !entry.hidden ? (
                <HpStepper
                  hp={sheet.data.hp}
                  canEdit={isDm || entry.sheetId === room.yourPlayerId}
                  compact
                  onAdjust={(delta) => room.send({ type: "ADJUST_HP", sheetId: entry.sheetId!, delta })}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
