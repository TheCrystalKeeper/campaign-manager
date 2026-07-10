import { useState } from "react";
import { ItemsPanel } from "../components/ItemsPanel";
import { ItemSheetPanel } from "../components/ItemSheetPanel";
import { PageShell } from "./PageShell";
import { PageSwitcher, type PageId } from "./PageSwitcher";
import type { PanelContext } from "../panels/registry";

/// <summary>
/// DM-only Items page: the item-authoring workspace. The full Items directory
/// (the SAME folders/items as the Items dock tab — they share the "item" tree)
/// opens items into the main area, where several Item Sheets edit side by side.
/// Mirrors the NPCs page.
/// </summary>
export function ItemsPage({
  ctx,
  activePage,
  onNavigate,
}: {
  ctx: PanelContext;
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}) {
  const { state, dm } = ctx;
  const [openIds, setOpenIds] = useState<string[]>([]);

  const open = (id: string) => setOpenIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
  const close = (id: string) => setOpenIds((cur) => cur.filter((x) => x !== id));

  const items = openIds.map((id) => state.items[id]).filter((item) => Boolean(item));

  return (
    <div className="npcs-page">
      <div className="chip-tabs npcs-topbar">
        <PageSwitcher active={activePage} onSelect={onNavigate} className="page-switcher--inline" history={ctx.history} />
      </div>
      <div className="npcs-page-body">
        <PageShell
          roomId={state.roomId}
          roster={
            <ItemsPanel
              state={state}
              dm={dm}
              // On this page, opening an item adds it to the side-by-side main area.
              openItemSheet={open}
              dropItemAt={ctx.dropItemAt}
            />
          }
        >
          {items.length === 0 ? (
            <div className="page-empty muted">
              Pick an item from the directory — or create one — to edit its sheet. Open several to
              compare side by side.
            </div>
          ) : (
            <div className="sheet-cards">
              {items.map((item) => (
                <section className="sheet-col" key={item.id}>
                  <header className="sheet-col-head">
                    <span className="window-title">{item.name || "Item"}</span>
                    <button
                      className="btn-ghost icon-btn"
                      title="Close this item"
                      onClick={() => close(item.id)}
                    >
                      ✕
                    </button>
                  </header>
                  <div className="sheet-col-body">
                    <ItemSheetPanel item={item} roomId={state.roomId} onChange={dm.updateItem} />
                  </div>
                </section>
              ))}
            </div>
          )}
        </PageShell>
      </div>
    </div>
  );
}
