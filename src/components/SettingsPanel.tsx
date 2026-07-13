import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { PanelContext } from "../panels/registry";
import {
  DEFAULT_TOKEN_SHAPES,
  DEFAULT_TOKEN_SIZE,
  TOKEN_SHAPES,
  UI_ACCENTS,
  UI_ACCENT_LABEL,
  tokenSizeLabel,
  type CampaignExport,
  type TokenShape,
  type TokenShapeDefaults,
  type UiAccent,
  type UiThemeOverride,
} from "../lib/types";
import type { CampaignManifest } from "../lib/campaignManifest";
import { useVisualEffectsLite } from "../lib/visualEffects";

const SHAPE_LABEL: Record<TokenShape, string> = {
  circle: "● Circle",
  square: "■ Square",
  diamond: "◆ Diamond",
  triangle: "▲ Triangle",
  hexagon: "⬢ Hexagon",
  octagon: "⯃ Octagon",
};

/** Day swatch colors for the accent picker (the variations' interaction accents). */
const ACCENT_SWATCH: Record<UiAccent, string> = {
  sky: "#4f8cbf",
  moss: "#6f8a48",
  ember: "#b05f33",
  lapis: "#4b69a6",
  amethyst: "#7a52a6",
  rose: "#b04f78",
  teal: "#2f8a80",
  crimson: "#b83232",
};

/**
 * A row of accent "coins"; the active one wears a cream inner ring. When `onClear` is
 * given (the DM's table-accent override), a leading dashed/transparent coin means "don't
 * override the accent" and `value` may be null (each player keeps their own).
 */
function AccentSwatches({
  value,
  onPick,
  onClear,
}: {
  value: UiAccent | null;
  onPick: (accent: UiAccent) => void;
  onClear?: () => void;
}) {
  return (
    <div className="accent-swatches">
      {onClear ? (
        <button
          className={`accent-swatch accent-swatch--clear${value === null ? " accent-swatch--active" : ""}`}
          title="Don't override the accent — each player keeps their own"
          aria-label="Don't override the accent"
          aria-pressed={value === null}
          onClick={onClear}
        />
      ) : null}
      {UI_ACCENTS.map((accent) => (
        <button
          key={accent}
          className={`accent-swatch${accent === value ? " accent-swatch--active" : ""}`}
          style={{ backgroundColor: ACCENT_SWATCH[accent] }}
          title={UI_ACCENT_LABEL[accent]}
          aria-label={UI_ACCENT_LABEL[accent]}
          aria-pressed={accent === value}
          onClick={() => onPick(accent)}
        />
      ))}
    </div>
  );
}

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
  const [fxLite, setFxLite] = useVisualEffectsLite();
  const [layoutReset, setLayoutReset] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Table-look override (DM): the theme/accent the DM has DIALED IN, editable
  // whether or not the override is live. While off, this is a private draft
  // (nothing broadcasts) so the DM can set the look first and flip it on in one
  // atomic step — players never flash a wrong default. While on, edits go live
  // immediately and we mirror the live value back into the draft.
  const [stagedLook, setStagedLook] = useState<UiThemeOverride>(
    () => state.uiOverride ?? { theme: ctx.nightMode ? "night" : "day", accent: ctx.accent },
  );
  const overrideOn = state.uiOverride !== null;
  useEffect(() => {
    if (state.uiOverride) {
      setStagedLook(state.uiOverride);
    }
  }, [state.uiOverride]);
  const editLook = (next: UiThemeOverride) => {
    setStagedLook(next);
    if (overrideOn) {
      room.send({ type: "SET_UI_OVERRIDE", override: next });
    }
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const manifest = JSON.parse(text) as CampaignExport | CampaignManifest;
      if (manifest.version !== 1 && manifest.version !== 2) {
        throw new Error("Unrecognized campaign file.");
      }
      if (!window.confirm("Import this campaign? It REPLACES the current campaign's scenes (v1) or the entire campaign (v2). This can't be undone.")) {
        return;
      }
      room.send({ type: "IMPORT_CAMPAIGN", manifest });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  return (
    <div className="panel-body stack">
      <div className="section-title">This device</div>
      {state.uiOverride ? (
        <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
          The DM has set one look for the whole table — your theme and accent choices below
          will apply again once it's released.
        </p>
      ) : null}
      <ToggleRow
        label="Night mode"
        hint="Trade the daytime parchment for carved stone — chalk ink, moonlit accents."
        on={ctx.nightMode}
        onToggle={ctx.setNightMode}
      />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }} title="The interactive accent: selection, links, active tabs. Gold, terracotta, and sage stay put.">
          Accent color
        </label>
        <AccentSwatches value={ctx.accent} onPick={ctx.setAccent} />
      </div>
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
        label="Confirm deletions"
        hint='Ask "are you sure?" before deleting NPCs, items, or players.'
        on={ctx.confirmDeletes}
        onToggle={ctx.setConfirmDeletes}
      />
      <ToggleRow
        label="Roll & chat toasts"
        hint="Pop-up notifications for new log entries while the Log panel is closed."
        on={ctx.toastsEnabled}
        onToggle={ctx.setToastsEnabled}
      />
      <ToggleRow
        label="SpaceBar = left click"
        hint="Hold SpaceBar to act as the left mouse button at the cursor — click, and press-move-release to drag. Handy on a touchpad. (Space still types in text fields.)"
        on={ctx.spaceClick}
        onToggle={ctx.setSpaceClick}
      />
      <ToggleRow
        label="Hi-res board rendering"
        hint="Renders the board at 2× resolution for crisper text and token art — most visible on standard (non-retina) displays. Higher GPU cost; turn off if the map feels sluggish."
        on={ctx.hiResRender}
        onToggle={ctx.setHiResRender}
      />
      <ToggleRow
        label="Show live token drags"
        hint="See other players' tokens slide in real time while they drag them, with a little lift-and-wobble. Off = tokens simply appear at their destination when the drag ends. This device only."
        on={ctx.showLiveDrags}
        onToggle={ctx.setShowLiveDrags}
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
          <div className="section-title">Table look (DM)</div>
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            Set the theme and accent below, then turn the override on to apply it to every
            player at once. Pick “User” theme or the dashed accent to leave that one up to each
            player — so you can override just the theme, just the accent, or both. Off
            (default) = each player picks their own look entirely.
          </span>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }}>Table theme</label>
            <div className="row" style={{ gap: "0.25rem" }}>
              <button
                className={`btn-dashed${stagedLook.theme === null ? " btn-active" : ""}`}
                title="Don't override the theme — each player keeps their own"
                onClick={() => editLook({ ...stagedLook, theme: null })}
              >
                User
              </button>
              <button
                className={stagedLook.theme === "day" ? "btn-active" : ""}
                onClick={() => editLook({ ...stagedLook, theme: "day" })}
              >
                Day
              </button>
              <button
                className={stagedLook.theme === "night" ? "btn-active" : ""}
                onClick={() => editLook({ ...stagedLook, theme: "night" })}
              >
                Night
              </button>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }}>Table accent</label>
            <AccentSwatches
              value={stagedLook.accent}
              onPick={(accent) => editLook({ ...stagedLook, accent })}
              onClear={() => editLook({ ...stagedLook, accent: null })}
            />
          </div>
          <ToggleRow
            label="Override everyone's look"
            hint="Force the theme + accent above on every player. Off (default) = each player picks their own in Settings."
            on={overrideOn}
            onToggle={(on) =>
              room.send({ type: "SET_UI_OVERRIDE", override: on ? stagedLook : null })
            }
          />

          <div className="section-title">Room (DM)</div>
          <ToggleRow
            label="Players can move characters"
            hint="Allow players to move and rotate their own characters' tokens on the map."
            on={state.playersCanMove !== false}
            onToggle={(on) => room.send({ type: "SET_PLAYERS_CAN_MOVE", enabled: on })}
          />
          <ToggleRow
            label="Players can point"
            hint="Allow players to Shift-drag on the map to draw a temporary dotted pointer arrow."
            on={state.playersCanPoint !== false}
            onToggle={(on) => room.send({ type: "SET_PLAYERS_CAN_POINT", enabled: on })}
          />
          <ToggleRow
            label="Players can draw"
            hint="Allow players to use the Draw tool (their strokes fade after ~10s). Also in the draw tool options."
            on={state.playersCanDraw}
            onToggle={(on) => room.send({ type: "SET_PLAYERS_CAN_DRAW", enabled: on })}
          />
          <ToggleRow
            label="Optimize uploads"
            hint="Shrink new image uploads and save them as WebP (portraits/tokens ≤1024px, maps ≤2560px). Much smaller files — faster to load and far easier on storage. Off = keep originals at full size. Applies to new uploads only."
            on={state.optimizeUploads !== false}
            onToggle={(on) => room.send({ type: "SET_OPTIMIZE_UPLOADS", enabled: on })}
          />
          <ToggleRow
            label="Open Token panel on click"
            hint="When on, single-clicking a token opens its Token editor panel. Off = clicking only selects the token; double-click still opens its sheet. (This device only.)"
            on={ctx.tokenPanelOnClick}
            onToggle={ctx.setTokenPanelOnClick}
          />
          <ToggleRow
            label="Reduce visual effects"
            hint="Turn off the fancy decorative effects (textured panels, notch frames, modal blur, crystal glow) for a lighter, faster render on slower machines. This device only — doesn't affect other players."
            on={fxLite}
            onToggle={setFxLite}
          />

          <div className="section-title">Default token shapes</div>
          {(
            [
              ["player", "PCs"],
              ["enemy", "NPCs"],
              ["item", "Items"],
            ] as Array<[keyof TokenShapeDefaults, string]>
          ).map(([group, label]) => {
            const defaults = state.tokenShapeDefaults ?? DEFAULT_TOKEN_SHAPES;
            return (
              <div className="field" key={group}>
                <label>{label}</label>
                <select
                  value={defaults[group]}
                  onChange={(e) =>
                    ctx.dm.setTokenDefaults({ ...defaults, [group]: e.target.value as TokenShape })
                  }
                >
                  {TOKEN_SHAPES.map((shape) => (
                    <option key={shape} value={shape}>
                      {SHAPE_LABEL[shape]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="field">
            <label>Default token size ({tokenSizeLabel(state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE)})</label>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE}
              onChange={(e) => ctx.dm.setDefaultTokenSize(Number(e.target.value))}
            />
          </div>

          <div className="section-title">Campaign backup</div>
          <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
            Download the full campaign as a JSON file, or restore one. Images are referenced by
            URL, never embedded.
          </p>
          <div className="row">
            <button onClick={() => room.send({ type: "EXPORT_CAMPAIGN" })}><Download size={13} strokeWidth={2.2} /> Export campaign</button>
            <button onClick={() => importRef.current?.click()}><Upload size={13} strokeWidth={2.2} /> Import…</button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
                e.target.value = "";
              }}
            />
          </div>
          {importError ? (
            <span className="muted" style={{ color: "var(--danger)", fontSize: "0.75rem" }}>{importError}</span>
          ) : null}
        </>
      ) : null}

      <div className="section-title">Session</div>
      <button className="btn-danger" onClick={ctx.leave}>
        Leave campaign
      </button>
    </div>
  );
}
