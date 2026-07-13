import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { PageSwitcher, type PageId } from "./PageSwitcher";
import {
  deleteAsset,
  listAssets,
  uploadLibraryImage,
  type AssetInfo,
} from "../lib/uploadAsset";
import { assetSection, findAssetUsage, type AssetUsage } from "../lib/assetUsage";
import type { Scene } from "../lib/types";
import type { PanelContext } from "../panels/registry";

// Section order shown on the page. "unused" collects every unreferenced image; "maps"
// includes scene backdrops (which physically live in the token folder). See assetSection.
const SECTIONS = ["maps", "tokens", "portraits", "unused"] as const;
const KIND_LABEL: Record<string, string> = {
  tokens: "Tokens",
  portraits: "Portraits",
  maps: "Maps",
  unused: "Unused",
};
// How each usage reads in the delete warning (findAssetUsage kinds → a human word).
const USAGE_LABEL: Record<string, string> = {
  token: "Token",
  sheet: "Portrait",
  scene: "Map",
  backdrop: "Backdrop",
  item: "Item",
};

/// <summary>
/// DM-only Assets page (Phase 7): a thumbnail grid of the room's uploaded R2 images,
/// grouped by kind. Upload new images, copy a URL to paste onto a token/portrait, and
/// delete — with an "in use by N places" warning scanned from live state so an image that
/// a token/sheet/scene/item still references isn't dropped by accident. (R2 lives in the
/// deployed environment; in local dev the list is empty + a note.)
/// </summary>
export function AssetsPage({
  ctx,
  active,
  activePage,
  onNavigate,
}: {
  ctx: PanelContext;
  active: boolean;
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}) {
  const { state, dm } = ctx;
  const roomId = state.roomId;
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [unconfigured, setUnconfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { assets: list, unconfigured: unconf } = await listAssets(roomId);
      setAssets(list);
      setUnconfigured(unconf);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // Load once when the page becomes visible.
  useEffect(() => {
    if (active) {
      void refresh();
    }
  }, [active, refresh]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await uploadLibraryImage(roomId, file);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (asset: AssetInfo) => {
    const usage = findAssetUsage(state, asset.url);
    if (usage.length > 0) {
      const where = usage.map((u) => `${USAGE_LABEL[u.kind] ?? u.kind}: ${u.label}`).join(", ");
      if (!window.confirm(`This image is used in ${usage.length} place(s):\n${where}\n\nDelete it everywhere? It will be removed from those and this can't be undone.`)) {
        return;
      }
    }
    // Cascade: clear every reference to this URL so it disappears everywhere it's shown.
    // Clear the SOURCE entities (sheets/items) BEFORE tokens — a token linked to a sheet/item
    // re-derives its image from that entity, so the source must be blank first or the token
    // sync would just re-fill it. Then clear any token/scene that references the URL directly.
    for (const record of Object.values(state.sheets)) {
      if (record.data.iconUrl === asset.url) {
        dm.updateSheet(record.id, { ...record.data, iconUrl: null });
      }
    }
    for (const item of Object.values(state.items)) {
      if (item.iconUrl === asset.url) {
        dm.updateItem({ ...item, iconUrl: null });
      }
    }
    for (const token of state.tokens) {
      if (token.imageUrl === asset.url) {
        dm.updateToken({ ...token, imageUrl: null });
      }
    }
    for (const scene of state.scenes) {
      const patch: Partial<Scene> = {};
      if (scene.mapUrl === asset.url) patch.mapUrl = null;
      if (scene.boardBgImageUrl === asset.url) patch.boardBgImageUrl = null;
      if (Object.keys(patch).length > 0) {
        dm.updateScene({ ...scene, ...patch });
      }
    }
    try {
      await deleteAsset(roomId, asset.key);
      setAssets((cur) => cur.filter((a) => a.key !== asset.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  // Usage per asset, computed once — reused for both the section grouping and the
  // per-card "in use ×N / unused" badge.
  const usageByUrl = useMemo(() => {
    const map = new Map<string, AssetUsage[]>();
    for (const asset of assets) {
      if (!map.has(asset.url)) map.set(asset.url, findAssetUsage(state, asset.url));
    }
    return map;
  }, [assets, state]);
  const inSection = (kind: string) =>
    assets.filter((a) => assetSection(a.kind, usageByUrl.get(a.url) ?? []) === kind);

  return (
    <div className="npcs-page">
      <div className="chip-tabs npcs-topbar">
        <PageSwitcher active={activePage} onSelect={onNavigate} className="page-switcher--inline" />
        <button className="btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "Uploading…" : "＋ Upload image"}
        </button>
        <button className="btn-ghost" disabled={loading} onClick={() => void refresh()}>
          {loading ? "Refreshing…" : <><RefreshCw size={13} strokeWidth={2.2} /> Refresh</>}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="assets-page-body">
        {error ? <div className="assets-error">{error}</div> : null}
        {unconfigured ? (
          <p className="muted assets-hint">
            Asset listing needs the deployed environment (an R2 bucket bound as UPLOADS). Uploads
            still work; the grid populates once deployed.
          </p>
        ) : null}
        {!unconfigured && assets.length === 0 && !loading ? (
          <p className="muted assets-hint">No uploaded images yet. Use ＋ Upload image.</p>
        ) : null}

        {SECTIONS.map((kind) => {
          const list = inSection(kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} className="assets-group">
              <h3 className="assets-group-title">{KIND_LABEL[kind] ?? kind}</h3>
              <div className="assets-grid">
                {list.map((asset) => {
                  const usage = usageByUrl.get(asset.url) ?? [];
                  return (
                    <div className="asset-card" key={asset.key}>
                      <div className="asset-thumb">
                        <img src={asset.url} alt="" loading="lazy" />
                      </div>
                      <div className="asset-meta">
                        <span className="asset-size">{Math.round(asset.size / 1024)} KB</span>
                        <span className={`asset-usage${usage.length ? " asset-usage--used" : ""}`}>
                          {usage.length ? `in use ×${usage.length}` : "unused"}
                        </span>
                      </div>
                      <div className="asset-actions">
                        <button
                          className="btn-ghost"
                          title="Copy the image URL to paste onto a token or portrait"
                          onClick={() => void navigator.clipboard?.writeText(asset.url)}
                        >
                          Copy URL
                        </button>
                        <button className="btn-ghost asset-del" title="Delete this image" onClick={() => void handleDelete(asset)}>
                          <Trash2 size={14} strokeWidth={2.2} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
