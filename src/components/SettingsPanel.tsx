import { useState } from "react";
import type { PanelContext } from "../panels/registry";

/** One labeled on/off row, matching the ScenePanel toggle idiom. */
function ToggleRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <label style={{ margin: 0 }} title={hint}>
        {label}
      </label>
      <button className={on ? "btn-active" : ""} title={hint} onClick={() => onToggle(!on)}>
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

/// <summary>
/// Per-client settings window (⚙ on the dock rail): 3D dice, dice sound,
/// snap-to-grid, log-toast notifications, reset UI layout, and Leave. The DM
/// additionally gets the players-can-draw room toggle (mirrored from the draw
/// tool's options).
/// </summary>
export function SettingsPanel({ ctx }: { ctx: PanelContext }) {
  const { dice, isDm, state, room } = ctx;
  const [layoutReset, setLayoutReset] = useState(false);

  return (
    <div className="panel-body stack">
      <div className="section-title">This device</div>
      <ToggleRow
        label="3D dice"
        hint="Physical dice you grab, shake, and throw. Off = instant text rolls."
        on={dice.enabled}
        onToggle={dice.setEnabled}
      />
      <ToggleRow
        label="Dice sound"
        hint="Rattle and impact sounds for dice rolls (3D and text)."
        on={!dice.muted}
        onToggle={(on) => dice.setMuted(!on)}
      />
      <ToggleRow
        label="Snap to grid"
        hint="Dropped and dragged tokens land on cell centers."
        on={ctx.snap}
        onToggle={() => ctx.toggleSnap()}
      />
      <ToggleRow
        label="Roll & chat toasts"
        hint="Pop-up notifications for new log entries while the Log panel is closed."
        on={ctx.toastsEnabled}
        onToggle={ctx.setToastsEnabled}
      />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }} title="Windows and the dice tray return to their default spots">
          UI layout
        </label>
        <button
          onClick={() => {
            ctx.resetUiLayout();
            setLayoutReset(true);
            setTimeout(() => setLayoutReset(false), 1500);
          }}
        >
          {layoutReset ? "Reset ✓" : "Reset layout"}
        </button>
      </div>

      {isDm ? (
        <>
          <div className="section-title">Room (DM)</div>
          <ToggleRow
            label="Players can draw"
            hint="Allow players to use the Draw tool (their strokes fade after ~10s). Also in the draw tool options."
            on={state.playersCanDraw}
            onToggle={(on) => room.send({ type: "SET_PLAYERS_CAN_DRAW", enabled: on })}
          />
        </>
      ) : null}

      <div className="section-title">Session</div>
      <button className="btn-danger" onClick={ctx.leave}>
        Leave campaign
      </button>
    </div>
  );
}
