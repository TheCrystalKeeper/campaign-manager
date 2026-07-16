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
import {
  CAMPAIGN_DESCRIPTION_CAP,
  fetchCampaignRegistry,
  registerCampaignRoom,
} from "../lib/campaignRegistry";
import {
  formatCampaignName,
  loadSavedCampaigns,
  upsertSavedCampaign,
} from "../lib/savedCampaigns";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { uploadLibraryImage } from "../lib/uploadAsset";

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

/** Device-remembered height (px) the DM last dragged the campaign-description editor to. */
const CAMPAIGN_DESC_HEIGHT_KEY = "cm-campaign-desc-height";

/// <summary>
/// DM-only editor for the campaign's join-screen icon + blurb. Both live on the
/// shared campaign registry (not the live room), so we seed name + icon + the
/// current description from there — falling back to this browser's saved copy —
/// and save edits back (description debounced, icon on pick/clear), always
/// re-sending name + the other field so neither is wiped.
/// </summary>
function CampaignSection({ roomId }: { roomId: string }) {
  const [description, setDescription] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">(
    "loading",
  );
  // The registry POST requires `name` and would drop any field we omit, so all three are
  // mirrored into refs — a save (from any field) always re-sends the latest of each without
  // re-rendering on every keystroke.
  const nameRef = useRef("");
  const descRef = useRef("");
  const iconRef = useRef<string | null>(null);
  const loadedRef = useRef(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const descBoxRef = useRef<HTMLTextAreaElement>(null);

  // Restore the height the DM last dragged the description box to, and persist future drags
  // (a device preference; the box keeps whatever size it was left at across settings opens).
  useEffect(() => {
    const el = descBoxRef.current;
    if (!el) return;
    const saved = localStorage.getItem(CAMPAIGN_DESC_HEIGHT_KEY);
    if (saved) el.style.height = saved;
    const observer = new ResizeObserver(() => {
      if (el.style.height) {
        try {
          localStorage.setItem(CAMPAIGN_DESC_HEIGHT_KEY, el.style.height);
        } catch {
          /* storage full / unavailable — height memory is best-effort */
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const seed = (name: string, icon: string | null, desc: string) => {
      nameRef.current = name;
      iconRef.current = icon;
      descRef.current = desc;
      setIconUrl(icon);
      setDescription(desc);
    };
    const seedFromLocal = () => {
      const saved = loadSavedCampaigns().find((c) => c.roomId === roomId);
      seed(saved?.name || formatCampaignName(roomId), saved?.iconUrl ?? null, saved?.description ?? "");
    };
    void (async () => {
      try {
        const registry = await fetchCampaignRegistry();
        if (cancelled) return;
        const entry = registry.find((r) => r.roomId === roomId);
        if (entry) {
          seed(entry.name, entry.iconUrl ?? null, entry.description ?? "");
        } else {
          seedFromLocal();
        }
      } catch {
        if (cancelled) return;
        seedFromLocal();
      } finally {
        if (!cancelled) {
          loadedRef.current = true;
          setStatus("idle");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Reads the current name/icon/description from refs so any field's save re-sends them all.
  const save = async () => {
    const name = nameRef.current.trim() || formatCampaignName(roomId);
    const desc = descRef.current.trim() || null;
    setStatus("saving");
    try {
      await registerCampaignRoom({ roomId, name, iconUrl: iconRef.current, description: desc });
      upsertSavedCampaign(roomId, { name, iconUrl: iconRef.current, description: desc });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };
  const { debounced } = useDebouncedCallback(() => void save(), 600);

  const pickIcon = async (file: File) => {
    setStatus("saving");
    try {
      // Stored as a normal room asset (tokens/{roomId}--asset-…) so it shows on the Assets
      // page and can be truly deleted there. "Remove" below only unlinks it from the campaign.
      const { url } = await uploadLibraryImage(roomId, file);
      iconRef.current = url;
      setIconUrl(url);
      await save();
    } catch {
      setStatus("error");
    }
  };
  const clearIcon = () => {
    iconRef.current = null;
    setIconUrl(null);
    void save();
  };

  const busy = status === "loading" || status === "saving";
  const statusLabel =
    status === "loading"
      ? "Loading…"
      : status === "saving"
        ? "Saving…"
        : status === "saved"
          ? "Saved ✓"
          : status === "error"
            ? "Couldn't save — check your connection."
            : "";

  return (
    <>
      <div className="section-title">Campaign</div>

      <div className="field">
        <label>Icon</label>
        <div className="row" style={{ alignItems: "center", gap: "0.6rem" }}>
          {iconUrl ? (
            <img className="campaign-icon-preview" src={iconUrl} alt="" />
          ) : (
            <span className="campaign-icon-preview campaign-icon-preview--empty" aria-hidden="true" />
          )}
          <button disabled={busy} onClick={() => iconInputRef.current?.click()}>
            {iconUrl ? "Change…" : "Upload…"}
          </button>
          {iconUrl ? (
            <button disabled={busy} onClick={clearIcon}>
              Remove
            </button>
          ) : null}
          <input
            ref={iconInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pickIcon(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="field">
        <label>Description</label>
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          A short blurb shown on the join screen when someone picks this campaign. Everyone at the
          table can read it.
        </span>
        <textarea
          ref={descBoxRef}
          value={description}
          rows={4}
          maxLength={CAMPAIGN_DESCRIPTION_CAP}
          disabled={status === "loading"}
          placeholder="What's this campaign about? Tone, premise, the party's current quest…"
          onChange={(e) => {
            setDescription(e.target.value);
            descRef.current = e.target.value;
            if (loadedRef.current) debounced();
          }}
        />
      </div>
      {statusLabel ? (
        <span
          className="muted"
          style={{
            fontSize: "0.7rem",
            color: status === "error" ? "var(--danger)" : undefined,
          }}
        >
          {statusLabel}
        </span>
      ) : null}
    </>
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
        label="Click-off closes Settings"
        hint="When Settings is open, clicking anywhere outside it (like the board) closes it. Off (default) = it stays open until you close it. Tip: press S to open/close Settings."
        on={ctx.closeSettingsOnClickOff}
        onToggle={ctx.setCloseSettingsOnClickOff}
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
            label="Show all health bars"
            hint="Show every token's health bar to all players — not just tokens you've individually set to show HP in the Token panel. Off (default) = you control HP visibility per token. Numeric HP values stay per-token either way."
            on={state.showAllTokenHp}
            onToggle={(on) => room.send({ type: "SET_SHOW_ALL_TOKEN_HP", enabled: on })}
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
            label="Close Token panel with sheet"
            hint="When on, closing a character sheet also closes the left-hand Token editor panel for that same token. Off = the Token panel stays open. (This device only.)"
            on={ctx.closeTokenWithSheet}
            onToggle={ctx.setCloseTokenWithSheet}
          />
          <ToggleRow
            label="Reduce visual effects"
            hint="Turn off the fancy decorative effects (textured panels, notch frames, modal blur, crystal glow) for a lighter, faster render on slower machines. This device only — doesn't affect other players."
            on={fxLite}
            onToggle={setFxLite}
          />

          <CampaignSection roomId={state.roomId} />

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
