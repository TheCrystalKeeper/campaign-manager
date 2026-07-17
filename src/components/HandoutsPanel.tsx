import { useEffect, useRef, useState } from "react";
import { Eye, ImagePlus, Images, Trash2 } from "lucide-react";
import type { GameState, Handout } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { uploadHandoutImage } from "../lib/uploadAsset";
import { AssetPickerModal } from "./AssetPickerModal";
import { confirmDelete } from "./ConfirmDeleteDialog";

type HandoutsPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  isDm: boolean;
  /** Opens the floating handout viewer window (App owns the window list). */
  openHandout: (handoutId: string) => void;
};

/// <summary>
/// The Handouts dock tab. DM: manage the library (upload / pick from library /
/// rename / delete), edit each handout's per-player visibility grants, and Show —
/// pop it onto the targeted players' screens. Players: a gallery of everything
/// granted to them (the server already filtered it); click to re-open the viewer.
/// </summary>
export function HandoutsPanel({ state, dm, isDm, openHandout }: HandoutsPanelProps) {
  if (!isDm) {
    return <PlayerGallery handouts={state.handouts} openHandout={openHandout} />;
  }
  return <DmHandouts state={state} dm={dm} openHandout={openHandout} />;
}

function PlayerGallery({
  handouts,
  openHandout,
}: {
  handouts: Handout[];
  openHandout: (id: string) => void;
}) {
  if (handouts.length === 0) {
    return (
      <div className="panel-body">
        <span className="muted">
          The DM hasn’t shared any handouts with you yet. When they do, the images collect
          here so you can look back at them any time.
        </span>
      </div>
    );
  }
  return (
    <div className="panel-body stack">
      <div className="handout-grid">
        {handouts.map((handout) => (
          <button
            key={handout.id}
            type="button"
            className="handout-card"
            title="Open"
            onClick={() => openHandout(handout.id)}
          >
            <span className="handout-card-img">
              {handout.imageUrl ? <img src={handout.imageUrl} alt="" loading="lazy" /> : <Images size={22} />}
            </span>
            <span className="handout-card-name">{handout.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DmHandouts({
  state,
  dm,
  openHandout,
}: {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  openHandout: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Handout id whose Show just fired — 2s "✓" button feedback. */
  const [justShownId, setJustShownId] = useState<string | null>(null);
  useEffect(() => {
    if (!justShownId) {
      return;
    }
    const timer = setTimeout(() => setJustShownId(null), 2000);
    return () => clearTimeout(timer);
  }, [justShownId]);

  const addFromUrl = (imageUrl: string, size?: { width: number; height: number }) => {
    dm.addHandout({
      id: `handout-${crypto.randomUUID().slice(0, 8)}`,
      name: `Handout ${state.handouts.length + 1}`,
      imageUrl,
      ...(size ?? {}),
      visibleTo: [],
      createdAt: Date.now(),
    });
  };

  const onUpload = async (file: File | null) => {
    if (!file) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { url, width, height } = await uploadHandoutImage(state.roomId, file);
      addFromUrl(url, { width, height });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const show = (handout: Handout, to: "all" | string[]) => {
    dm.showHandout(handout.id, to);
    setJustShownId(handout.id);
  };

  return (
    <div className="panel-body stack">
      <div className="row">
        <button disabled={busy} onClick={() => fileRef.current?.click()} title="Upload an image">
          <ImagePlus size={14} /> {busy ? "Uploading…" : "Upload"}
        </button>
        <button disabled={busy} onClick={() => setPickerOpen(true)} title="Reuse an uploaded image">
          <Images size={14} /> From library
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(event) => void onUpload(event.target.files?.[0] ?? null)}
        />
      </div>
      {error ? <span className="handout-error">{error}</span> : null}
      {state.handouts.length === 0 ? (
        <span className="muted">
          No handouts yet. Upload a letter, portrait, or vista — then Show it to pop it up on
          your players’ screens. Players keep access to everything you’ve shown them.
        </span>
      ) : null}
      {state.handouts.map((handout) => (
        <DmHandoutRow
          key={handout.id}
          handout={handout}
          slots={state.playerSlots}
          justShown={justShownId === handout.id}
          onOpen={() => openHandout(handout.id)}
          onRename={(name) => dm.updateHandout({ ...handout, name })}
          onSetVisibleTo={(visibleTo) => dm.updateHandout({ ...handout, visibleTo })}
          onShow={(to) => show(handout, to)}
          onRemove={() => {
            void confirmDelete({ kind: "handout", name: handout.name }).then((ok) => {
              if (ok) {
                dm.removeHandout(handout.id);
              }
            });
          }}
        />
      ))}
      {pickerOpen ? (
        <AssetPickerModal
          roomId={state.roomId}
          title="Choose a handout image"
          includeMaps
          onPick={(url) => addFromUrl(url)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

function DmHandoutRow({
  handout,
  slots,
  justShown,
  onOpen,
  onRename,
  onSetVisibleTo,
  onShow,
  onRemove,
}: {
  handout: Handout;
  slots: GameState["playerSlots"];
  justShown: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onSetVisibleTo: (visibleTo: Handout["visibleTo"]) => void;
  onShow: (to: "all" | string[]) => void;
  onRemove: () => void;
}) {
  const all = handout.visibleTo === "all";
  const grantedIds = all ? slots.map((slot) => slot.id) : handout.visibleTo;
  const summary = all
    ? "All players"
    : grantedIds.length === 0
      ? "No one yet"
      : slots
          .filter((slot) => grantedIds.includes(slot.id))
          .map((slot) => slot.name)
          .join(", ");

  const toggleSlot = (slotId: string, granted: boolean) => {
    // Ticking a box while "all" is on switches to an explicit list first.
    const base = all ? slots.map((slot) => slot.id) : [...handout.visibleTo];
    const next = granted ? [...new Set([...base, slotId])] : base.filter((id) => id !== slotId);
    onSetVisibleTo(next);
  };

  return (
    <div className="handout-row-block stack">
      <div className="row handout-row">
        <button type="button" className="handout-thumb" title="Preview" onClick={onOpen}>
          {handout.imageUrl ? <img src={handout.imageUrl} alt="" loading="lazy" /> : <Images size={18} />}
        </button>
        <input
          key={`${handout.id}:${handout.name}`}
          defaultValue={handout.name}
          style={{ flex: 1, minWidth: 0 }}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== handout.name) {
              onRename(name);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
        <button className="btn-danger icon-btn" title="Delete handout" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="handout-vis">
        <label className="handout-vis-opt" title="Every current and future player slot">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => onSetVisibleTo(event.target.checked ? "all" : [])}
          />
          All players
        </label>
        {slots.map((slot) => (
          <label className="handout-vis-opt" key={slot.id}>
            <input
              type="checkbox"
              checked={grantedIds.includes(slot.id)}
              onChange={(event) => toggleSlot(slot.id, event.target.checked)}
            />
            {slot.name}
          </label>
        ))}
      </div>
      <div className="row">
        <span className="muted handout-vis-summary" title={summary}>
          {summary}
        </span>
        <button
          disabled={!all && grantedIds.length === 0}
          title={
            !all && grantedIds.length === 0
              ? "Tick who may see it first (or use Show to all)"
              : "Pop it up for everyone ticked above"
          }
          onClick={() => onShow(all ? "all" : grantedIds)}
        >
          <Eye size={14} /> {justShown ? "Shown ✓" : "Show"}
        </button>
        <button title="Pop it up for every player (also grants them access)" onClick={() => onShow("all")}>
          Show to all
        </button>
      </div>
    </div>
  );
}

/// <summary>
/// Floating-window content: the image fit to the window, click to toggle natural-size
/// (scrollable) zoom. The name/url may come from state OR from the transient push
/// payload (a HANDOUT_SHOW frame can beat the STATE frame that grants visibility).
/// </summary>
export function HandoutViewer({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  const [zoomed, setZoomed] = useState(false);
  if (!imageUrl) {
    return (
      <div className="panel-body">
        <span className="muted">This handout has no image.</span>
      </div>
    );
  }
  return (
    <div
      className={`handout-viewer${zoomed ? " handout-viewer--zoomed" : ""}`}
      title={zoomed ? "Click to fit the window" : "Click to zoom"}
      onClick={() => setZoomed((current) => !current)}
    >
      <img src={imageUrl} alt={name} draggable={false} />
    </div>
  );
}
