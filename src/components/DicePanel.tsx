import { useState } from "react";
import { DICE_QUICK_SIDES, formatDiceRoll } from "../lib/dice";
import type { DiceRoll } from "../lib/types";

type DicePanelProps = {
  isDm: boolean;
  yourPlayerId: string | null;
  publicRolls: DiceRoll[];
  privateRolls: DiceRoll[];
  /** Instant roll (no animation) — used for the Instant buttons and DM secret rolls. */
  onRoll: (expression: string, options?: { private?: boolean }) => void;
  /** Arms a physical die set in the 3D arena (d100 becomes a percentile d10 + d10). */
  onArm: (sides: number) => void;
  /** Throws the currently armed dice without a manual drag. */
  onThrowArmed: () => void;
  /** Parses an expression and throws it physically. */
  onThrowExpression: (expression: string) => void;
  /** Parses an expression and resolves it with a quick spin-to-value reveal. */
  onInstantExpression: (expression: string) => void;
  /** Resolves the currently armed dice with a quick spin-to-value reveal. */
  onInstantArmed: () => void;
  hasArmed: boolean;
  trayVisible: boolean;
  onToggleTray: (visible: boolean) => void;
  muted: boolean;
  onToggleMuted: (muted: boolean) => void;
};

/// <summary>
/// Shared dice tray with a public log for everyone and a secret log visible only to the DM.
/// </summary>
export function DicePanel({
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
}: DicePanelProps) {
  const [expression, setExpression] = useState("1d20");
  const [collapsed, setCollapsed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const validExpression = (): string | null => {
    const trimmed = expression.trim();
    if (!trimmed) {
      setLocalError("Enter a dice expression.");
      return null;
    }
    setLocalError(null);
    return trimmed;
  };

  // "Roll" throws physical 3D dice; "Instant" does a quick spin-to-value reveal.
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = validExpression();
    if (trimmed) {
      onThrowExpression(trimmed);
    }
  };

  const handleInstant = () => {
    const trimmed = validExpression();
    if (trimmed) {
      onInstantExpression(trimmed);
    }
  };

  const handleSecretSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = validExpression();
    if (trimmed) {
      onRoll(trimmed, { private: true });
    }
  };

  if (collapsed) {
    return (
      <footer className="dice-tray dice-tray-collapsed">
        <button
          type="button"
          className="dice-tray-toggle"
          aria-expanded={false}
          title="Show dice panel"
          onClick={() => setCollapsed(false)}
        >
          Dice
          {publicRolls.length > 0 ? (
            <span className="dice-tray-badge">{publicRolls[publicRolls.length - 1]?.total}</span>
          ) : null}
        </button>
      </footer>
    );
  }

  return (
    <footer className="dice-tray">
      <div className="dice-tray-header">
        <h2>Dice</h2>
        <div className="dice-tray-header-actions">
          <button
            type="button"
            className="btn-compact dice-icon-btn"
            aria-pressed={!muted}
            title={muted ? "Unmute dice sounds" : "Mute dice sounds"}
            onClick={() => onToggleMuted(!muted)}
          >
            {muted ? "🔇" : "🔊"}
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
          <button
            type="button"
            className="btn-compact"
            aria-expanded={true}
            onClick={() => setCollapsed(true)}
          >
            Hide
          </button>
        </div>
      </div>

      <div className="dice-tray-body">
        <div className="dice-tray-controls">
          <form className="dice-roll-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              placeholder="1d20+5"
              aria-label="Dice expression"
              spellCheck={false}
            />
            <button type="submit">Roll</button>
            <button
              type="button"
              className="btn-compact dice-instant-btn"
              title="Quick roll — dice spin to the result"
              onClick={handleInstant}
            >
              Instant
            </button>
          </form>

          <div className="dice-quick-row">
            {DICE_QUICK_SIDES.map((sides) => (
              <button
                key={sides}
                type="button"
                className="btn-compact dice-quick-btn"
                title={`Grab a d${sides} to throw`}
                onClick={() => onArm(sides)}
              >
                d{sides}
              </button>
            ))}
            <button
              type="button"
              className="btn-compact dice-throw-btn"
              disabled={!hasArmed}
              onClick={() => onThrowArmed()}
            >
              Throw
            </button>
            <button
              type="button"
              className="btn-compact dice-instant-btn"
              disabled={!hasArmed}
              title="Quick roll — dice spin to the result"
              onClick={() => onInstantArmed()}
            >
              Instant
            </button>
          </div>

          {hasArmed ? (
            <p className="dice-hint">
              {trayVisible ? "Drag the dice and release to roll, or press Throw." : "Press Throw to roll."}
            </p>
          ) : null}

          {localError ? <p className="dice-error">{localError}</p> : null}

          {isDm ? (
            <section className="dice-secret-section" aria-label="Secret DM rolls">
              <div className="dice-secret-header">
                <h3>Secret rolls</h3>
                <span className="dice-secret-note">Only you can see these</span>
              </div>
              <form className="dice-roll-form dice-secret-form" onSubmit={handleSecretSubmit}>
                <input
                  type="text"
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                  placeholder="1d20"
                  aria-label="Secret dice expression"
                  spellCheck={false}
                />
                <button type="submit" className="dice-secret-button btn-compact" title="Secret roll">
                  Secret
                </button>
              </form>
            </section>
          ) : null}
        </div>

        <div className="dice-tray-logs">
          <section className="dice-public-section" aria-label="Shared dice log">
            <h3>{isDm ? "Player rolls" : "Table log"}</h3>
            <DiceLog
              rolls={publicRolls}
              yourPlayerId={yourPlayerId}
              emptyMessage="No rolls yet. Everyone in the room can see rolls here."
            />
          </section>

          {isDm ? (
            <section className="dice-secret-log-section" aria-label="Secret roll log">
              <h3>Secret log</h3>
              <DiceLog
                rolls={privateRolls}
                yourPlayerId={yourPlayerId}
                emptyMessage="No secret rolls yet."
                secret
              />
            </section>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

type DiceLogProps = {
  rolls: DiceRoll[];
  yourPlayerId: string | null;
  emptyMessage: string;
  secret?: boolean;
};

/// <summary>
/// Renders a scrollable list of dice roll results, newest first.
/// </summary>
function DiceLog({ rolls, yourPlayerId, emptyMessage, secret = false }: DiceLogProps) {
  if (rolls.length === 0) {
    return <p className="dice-log-empty">{emptyMessage}</p>;
  }

  const visible = [...rolls].reverse().slice(0, 30);

  return (
    <ul className={`dice-log${secret ? " dice-log-secret" : ""}`}>
      {visible.map((roll) => {
        const isOwn = yourPlayerId !== null && roll.rollerId === yourPlayerId;
        return (
          <li key={roll.id} className={isOwn ? "dice-log-own" : undefined}>
            <span className="dice-log-roller">{roll.rollerName}</span>
            <span className="dice-log-detail">{formatDiceRoll(roll)}</span>
          </li>
        );
      })}
    </ul>
  );
}
