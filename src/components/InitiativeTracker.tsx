import type { GameRoom, useDmActions } from "../hooks/useGameRoom";
import { Dices, Swords } from "lucide-react";
import { DEFAULT_ICON_CROP, type GameState } from "../lib/types";
import type { DiceOverlayController } from "../dice/useDiceOverlay";
import { CroppableImage } from "./CroppableImage";
import { NumberInput } from "./NumberInput";
import { HpStepper } from "./HpStepper";

type InitiativeTrackerProps = {
  state: GameState;
  isDm: boolean;
  room: GameRoom;
  dm: ReturnType<typeof useDmActions>;
  dice: DiceOverlayController;
  openSheet: (sheetId: string) => void;
};

/// <summary>
/// The initiative order during combat. Out of combat the DM gets the "Roll for
/// initiative!" button (starts combat with every token in the active scene). In combat
/// nobody is auto-rolled: the DM throws a d20 for NPCs (a "Roll NPCs" button plus a
/// per-NPC die on each unrolled NPC), and players throw their own d20 — typically NPCs
/// first, then players. With 3D dice on, these throw a real (highlighted) d20 whose face
/// sets the initiative; with 3D off they fall back to a server auto-roll.
/// </summary>
export function InitiativeTracker({ state, isDm, room, dm, dice, openSheet }: InitiativeTrackerProps) {
  const combat = state.combat;

  if (!combat) {
    if (!isDm) {
      return (
        <div className="panel-body">
          <span className="muted">No active combat.</span>
        </div>
      );
    }
    const sceneTokens = state.tokens.filter(
      (token) => token.sceneId === state.activeSceneId && token.kind !== "item",
    );
    // Tokens the DM flagged "not in initiative" (Token panel) sit combat out entirely.
    const sceneTokenIds = sceneTokens.filter((token) => !token.noInitiative).map((token) => token.id);
    const excludedCount = sceneTokens.length - sceneTokenIds.length;
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
            ? sceneTokens.length === 0
              ? "Place tokens in the scene first."
              : "Every token in this scene is excluded from initiative."
            : `Starts combat with ${
                excludedCount > 0
                  ? `${sceneTokenIds.length} of the ${sceneTokens.length}`
                  : `all ${sceneTokenIds.length}`
              } tokens in the scene. Roll a d20 for the NPCs, then players roll theirs.`}
        </span>
        {excludedCount > 0 ? (
          <span className="muted" style={{ fontSize: "0.78rem" }}>
            {excludedCount} token{excludedCount === 1 ? " is" : "s are"} set to skip initiative.
          </span>
        ) : null}
      </div>
    );
  }

  // An NPC entry is one whose token has no player owner (the DM rolls these; players roll
  // their own). Bare tokens with no owner count as NPCs too.
  const isNpcEntry = (tokenId: string | null, sheetId: string | null) => {
    const token = state.tokens.find((item) => item.id === tokenId);
    if (token) {
      return !token.ownerPlayerId;
    }
    // No token: treat a sheet the DM owns (not a player's own PC slot) as an NPC.
    return sheetId !== null;
  };

  const unrolledNpcIds = combat.entries
    .filter((entry) => entry.initiative === null && isNpcEntry(entry.tokenId, entry.sheetId))
    .map((entry) => entry.id);

  const myPendingRoll =
    !isDm &&
    combat.entries.some((entry) => {
      if (entry.initiative !== null) {
        return false;
      }
      const token = state.tokens.find((item) => item.id === entry.tokenId);
      return token?.ownerPlayerId === room.yourPlayerId || entry.sheetId === room.yourPlayerId;
    });

  // Roll a real d20 when 3D dice are on; otherwise fall back to a server auto-roll.
  const rollNpcInitiative = (entryIds: string[]) => {
    if (entryIds.length === 0) {
      return;
    }
    if (!dice.throwInitiative(entryIds)) {
      dm.rollInitiativeNpcs(entryIds);
    }
  };
  const rollMyInitiative = () => {
    if (!dice.throwInitiative()) {
      room.send({ type: "COMBAT_ROLL_INITIATIVE" });
    }
  };

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

      {isDm && unrolledNpcIds.length > 0 ? (
        <button
          className="btn-primary"
          title="Throw a d20 for every NPC that hasn't rolled yet"
          onClick={() => rollNpcInitiative(unrolledNpcIds)}
        >
          <Dices size={15} strokeWidth={2.2} /> Roll NPCs
          {unrolledNpcIds.length > 1 ? ` (${unrolledNpcIds.length})` : ""}
        </button>
      ) : null}

      {myPendingRoll ? (
        <button className="btn-primary" title="Throw a d20 for your initiative" onClick={rollMyInitiative}>
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
          const canRollThisNpc =
            isDm && entry.initiative === null && isNpcEntry(entry.tokenId, entry.sheetId);
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
                <span className="init-value init-value--dm">
                  {canRollThisNpc ? (
                    <button
                      className="init-roll-btn"
                      title={`Throw a d20 for ${entry.name}`}
                      aria-label={`Roll initiative for ${entry.name}`}
                      onClick={() => rollNpcInitiative([entry.id])}
                    >
                      <Dices size={13} strokeWidth={2.2} />
                    </button>
                  ) : null}
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
