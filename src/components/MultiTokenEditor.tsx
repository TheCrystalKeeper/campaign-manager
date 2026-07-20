import { EyeOff } from "lucide-react";
import {
  CONDITIONS,
  DEFAULT_TOKEN_SIZE,
  TOKEN_SHAPES,
  tokenSizeLabel,
  type GameState,
  type Token,
  type TokenHpDisplay,
  type TokenShape,
} from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type MultiTokenEditorProps = {
  tokens: Token[];
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  /** Clear the selection (closes the hosting window) — used after Delete. */
  onClose: () => void;
};

const SHAPE_LABEL: Record<TokenShape, string> = {
  circle: "● Circle",
  square: "■ Square",
  diamond: "◆ Diamond",
  triangle: "▲ Triangle",
  hexagon: "⬢ Hexagon",
  octagon: "⯃ Octagon",
};

/** Sentinel for "the selection disagrees on this value". */
const MIXED = Symbol("mixed");

/// <summary>
/// Bulk editor for a multi-selection of tokens (Alt+click / Alt+drag marquee, DM only).
/// Every edit maps a patch over ALL selected tokens and sends ONE UPDATE_TOKENS — one
/// broadcast, one undo step. Deliberately excluded fields: label + image (linked tokens
/// re-derive them from their sheet/item every server pass — syncTokenFromState — so a bulk
/// write would be stomped), HP (lives on the linked SHEET, not the token), owner/sheet/item
/// links and facing (per-token identity/positional concerns — use the single-token editor).
/// Controls render straight from props (they refresh with each server echo): no defaultValue
/// caching, or stale text would overwrite fresher state on blur.
/// </summary>
export function MultiTokenEditor({ tokens, state, dm, onClose }: MultiTokenEditorProps) {
  /** One message for the whole selection — the server upserts each patched token by id. */
  const apply = (patch: (t: Token) => Token) => dm.updateTokens(tokens.map(patch));

  /** The value every selected token agrees on, or MIXED. */
  function common<T>(get: (t: Token) => T): T | typeof MIXED {
    const first = get(tokens[0]);
    return tokens.every((t) => get(t) === first) ? first : MIXED;
  }

  const shape = common((t) => t.shape ?? "");
  const size = common((t) => t.size);
  const color = common((t) => t.color);
  const showHp = common((t) => t.showHp);
  const nameHidden = common((t) => Boolean(t.nameHidden));
  const nameConcealed = common((t) => Boolean(t.nameConcealed));
  const portraitConcealed = common((t) => Boolean(t.portraitConcealed));
  const visionOn = common((t) => Boolean(t.vision?.enabled));
  const visionRange = common((t) => t.vision?.rangeFt ?? 0);
  // Visibility tri-state: "hidden" / "auto" / "always" per token, unanimous or MIXED.
  const visibility = common((t) =>
    t.hidden ? "hidden" : t.dmVisibility === "always" ? "always" : "auto",
  );

  const playerCount = tokens.filter((t) => t.kind === "player").length;
  const anySheet = tokens.some((t) => t.sheetId);
  const labels = tokens
    .map((t) => t.label || "Token")
    .join(", ");

  /** A toggle-toward-uniform click: all-on → clear everywhere; else → set everywhere. */
  const toggleAll = (allOn: boolean, set: (t: Token, on: boolean) => Token) =>
    apply((t) => set(t, !allOn));

  return (
    // Hosted in the same FloatingWindow slot as the single-token editor (App.tsx).
    <div className="panel">
      <div className="panel-body stack">
        <div className="muted" style={{ fontSize: "0.8rem" }} title={labels}>
          Editing {tokens.length} tokens:{" "}
          {labels.length > 90 ? `${labels.slice(0, 90)}…` : labels}
        </div>

        <div className="row">
          <div style={{ flex: 1 }}>
            <label title={playerCount > 0 ? "Player tokens keep their player color" : undefined}>
              Color
            </label>
            <input
              type="color"
              value={color === MIXED ? "#888888" : color}
              onChange={(e) =>
                // Player tokens' color is derived from their slot (syncTokenFromState) —
                // writing it would silently revert on the next broadcast, so skip them.
                apply((t) => (t.kind === "player" ? t : { ...t, color: e.target.value }))
              }
            />
            {color === MIXED ? <div className="muted" style={{ fontSize: "0.72rem" }}>Mixed</div> : null}
          </div>
          <div style={{ flex: 2 }}>
            <label>Shape</label>
            <select
              value={shape === MIXED ? "__mixed" : shape}
              onChange={(e) => {
                if (e.target.value === "__mixed") return;
                const next = (e.target.value || undefined) as TokenShape | undefined;
                apply((t) => ({ ...t, shape: next }));
              }}
            >
              {shape === MIXED ? (
                <option value="__mixed" disabled>
                  Mixed
                </option>
              ) : null}
              <option value="">Group default</option>
              {TOKEN_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {SHAPE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {playerCount > 0 ? (
          <div className="muted" style={{ fontSize: "0.72rem", marginTop: "-0.35rem" }}>
            {playerCount} player token{playerCount === 1 ? "" : "s"} keep their player color.
          </div>
        ) : null}

        <div className="field">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }}>
              Size (
              {size === MIXED
                ? "Mixed"
                : size === undefined
                  ? "default"
                  : tokenSizeLabel(size)}
              )
            </label>
            <button
              className={size !== MIXED && size === undefined ? "btn-active" : ""}
              title="Use the campaign default token size for all selected"
              onClick={() => apply((t) => ({ ...t, size: undefined }))}
            >
              Default
            </button>
          </div>
          <input
            type="range"
            min={0.5}
            max={8}
            step={0.25}
            value={
              size === MIXED || size === undefined
                ? (state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE)
                : size
            }
            onChange={(e) => {
              const next = Number(e.target.value);
              apply((t) => ({ ...t, size: next }));
            }}
          />
        </div>

        <div className="field">
          <label>Player visibility</label>
          <div className="row">
            <button
              className={visibility === "hidden" ? "btn-active" : ""}
              title="Never sent to player clients — you see them ghosted"
              onClick={() => apply((t) => ({ ...t, hidden: true, dmVisibility: undefined }))}
            >
              <EyeOff size={13} strokeWidth={2.2} /> Hidden
            </button>
            <button
              className={visibility === "auto" ? "btn-active" : ""}
              title="With dynamic lighting, each player's own vision decides"
              onClick={() => apply((t) => ({ ...t, hidden: undefined, dmVisibility: undefined }))}
            >
              Auto
            </button>
            <button
              className={visibility === "always" ? "btn-active" : ""}
              title="Everyone sees these tokens even in darkness"
              onClick={() => apply((t) => ({ ...t, hidden: undefined, dmVisibility: "always" }))}
            >
              Always
            </button>
          </div>
          {visibility === MIXED ? (
            <div className="muted" style={{ fontSize: "0.72rem" }}>Mixed</div>
          ) : null}
        </div>

        {state.playerSlots.length > 0 ? (
          <div className="field">
            <label>Reveal to specific players (even in darkness)</label>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {state.playerSlots.map((slot) => {
                const withSlot = tokens.filter((t) => t.revealTo?.includes(slot.id)).length;
                const all = withSlot === tokens.length;
                const some = withSlot > 0 && !all;
                return (
                  <button
                    key={slot.id}
                    className={all ? "btn-active" : some ? "cond-chip--partial" : ""}
                    title={
                      all
                        ? `${slot.name || "Player"} always sees all selected — click to revert to their vision`
                        : `Show all selected to ${slot.name || "Player"} even when their vision fails`
                    }
                    onClick={() =>
                      toggleAll(all, (t, on) => {
                        const next = on
                          ? Array.from(new Set([...(t.revealTo ?? []), slot.id]))
                          : (t.revealTo ?? []).filter((id) => id !== slot.id);
                        return { ...t, revealTo: next.length > 0 ? next : undefined };
                      })
                    }
                  >
                    {slot.name || "Player"}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }} title='Players see "???" as these tokens&apos; names everywhere'>
            Conceal name
          </label>
          <button
            className={nameConcealed === true ? "btn-active" : ""}
            onClick={() => toggleAll(nameConcealed === true, (t, on) => ({ ...t, nameConcealed: on || undefined }))}
          >
            {nameConcealed === MIXED ? "Mixed" : nameConcealed ? "??? ✓" : "Off"}
          </button>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }} title='Players see a "?" instead of these tokens&apos; art'>
            Conceal portrait
          </label>
          <button
            className={portraitConcealed === true ? "btn-active" : ""}
            onClick={() =>
              toggleAll(portraitConcealed === true, (t, on) => ({ ...t, portraitConcealed: on || undefined }))
            }
          >
            {portraitConcealed === MIXED ? "Mixed" : portraitConcealed ? "? ✓" : "Off"}
          </button>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label
            style={{ margin: 0 }}
            title="Show or hide these tokens' name captions on the board (affects everyone)"
          >
            Name on board
          </label>
          <button
            className={nameHidden === true ? "btn-active" : ""}
            onClick={() => toggleAll(nameHidden === true, (t, on) => ({ ...t, nameHidden: on || undefined }))}
          >
            {nameHidden === MIXED ? "Mixed" : nameHidden ? "Hidden" : "Shown"}
          </button>
        </div>

        <div className="field">
          <label title={anySheet ? undefined : "Only affects tokens linked to a sheet"}>
            Show HP to players
          </label>
          <select
            value={showHp === MIXED ? "__mixed" : showHp}
            onChange={(e) => {
              if (e.target.value === "__mixed") return;
              const next = e.target.value as TokenHpDisplay;
              apply((t) => ({ ...t, showHp: next }));
            }}
          >
            {showHp === MIXED ? (
              <option value="__mixed" disabled>
                Mixed
              </option>
            ) : null}
            <option value="none">Hidden</option>
            <option value="bar">Bar only</option>
            <option value="values">Bar + numbers</option>
          </select>
          {!anySheet ? (
            <div className="muted" style={{ fontSize: "0.72rem" }}>
              None of the selected tokens has a linked sheet — no bars will show.
            </div>
          ) : null}
        </div>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Vision (sees in the dark)</label>
          <button
            className={visionOn === true ? "btn-active" : ""}
            title="Each token keeps its own darkvision range when toggled on"
            onClick={() =>
              toggleAll(visionOn === true, (t, on) => ({
                ...t,
                vision: { enabled: on, rangeFt: t.vision?.rangeFt ?? 0 },
              }))
            }
          >
            {visionOn === MIXED ? "Mixed" : visionOn ? "On" : "Off"}
          </button>
        </div>
        {visionOn === true ? (
          <div className="field">
            <label>Darkvision range (ft, 0 = only lit areas)</label>
            <input
              type="number"
              min={0}
              step={5}
              placeholder={visionRange === MIXED ? "Mixed" : undefined}
              value={visionRange === MIXED ? "" : visionRange}
              onChange={(e) => {
                const next = Math.max(0, Number(e.target.value) || 0);
                apply((t) => ({ ...t, vision: { enabled: true, rangeFt: next } }));
              }}
            />
          </div>
        ) : null}

        <div className="field">
          <label>Conditions</label>
          <div className="cond-grid">
            {CONDITIONS.map((condition) => {
              const withIt = tokens.filter((t) => t.conditions.includes(condition.id)).length;
              const all = withIt === tokens.length;
              const some = withIt > 0 && !all;
              return (
                <button
                  key={condition.id}
                  className={`cond-chip ${all ? "btn-active" : some ? "cond-chip--partial" : ""}`}
                  title={`${condition.label}${some ? ` (${withIt}/${tokens.length})` : ""}`}
                  onClick={() =>
                    // Toggle-toward-uniform: all have it → clear everywhere; else add to
                    // every token missing it.
                    toggleAll(all, (t, on) => ({
                      ...t,
                      conditions: on
                        ? Array.from(new Set([...t.conditions, condition.id]))
                        : t.conditions.filter((id) => id !== condition.id),
                    }))
                  }
                >
                  {condition.emoji}
                </button>
              );
            })}
          </div>
        </div>

        <button
          className="btn-danger"
          onClick={() => {
            dm.removeTokens(tokens.map((t) => t.id));
            onClose();
          }}
        >
          Delete {tokens.length} tokens
        </button>
      </div>
    </div>
  );
}
