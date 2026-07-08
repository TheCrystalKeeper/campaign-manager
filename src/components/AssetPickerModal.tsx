import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listAssets, type AssetInfo } from "../lib/uploadAsset";

/// <summary>
/// "Choose from library" modal: a thumbnail grid of the room's already-uploaded
/// images (R2), so a portrait / item icon / token can REUSE an existing asset
/// instead of re-uploading a fresh copy. Click a thumbnail to pick it. Battlemaps
/// are excluded (they aren't portraits). In local dev (no R2 bound) the list comes
/// back unconfigured/empty with a note — same as the Assets page.
/// </summary>
export function AssetPickerModal({
  roomId,
  title = "Choose from library",
  onPick,
  onClose,
}: {
  roomId: string;
  title?: string;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listAssets(roomId).then((res) => {
      if (cancelled) return;
      // Portraits + token art are reusable as images; full battlemaps are not.
      setAssets(res.assets.filter((asset) => asset.kind !== "maps"));
      setUnconfigured(res.unconfigured);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Esc closes — the modal is exclusive, so no topmost/typing guards needed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const empty = !loading && assets.length === 0;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal asset-picker" onClick={(e) => e.stopPropagation()}>
        <div className="asset-picker-head">
          <h2 style={{ color: "var(--accent-bright)", margin: 0 }}>{title}</h2>
          <button className="btn-ghost icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {loading ? <p className="muted">Loading…</p> : null}
        {empty ? (
          <p className="muted">
            {unconfigured
              ? "The image library needs the deployed environment (an R2 bucket bound as UPLOADS). Uploaded images appear here once deployed."
              : "No uploaded images yet — upload one from the Assets page or the upload button."}
          </p>
        ) : null}
        {assets.length > 0 ? (
          <div className="asset-picker-grid">
            {assets.map((asset) => (
              <button
                key={asset.key}
                type="button"
                className="asset-picker-item"
                title="Use this image"
                onClick={() => {
                  onPick(asset.url);
                  onClose();
                }}
              >
                <img src={asset.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
