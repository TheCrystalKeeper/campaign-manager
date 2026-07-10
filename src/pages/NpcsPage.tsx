import { useState } from "react";
import { ActorsPanel } from "../components/ActorsPanel";
import { SheetCards } from "./SheetCards";
import { PageShell } from "./PageShell";
import { PageSwitcher, type PageId } from "./PageSwitcher";
import type { PanelContext } from "../panels/registry";

/// <summary>
/// DM-only NPCs page: the stat-block authoring workspace. The full Actors
/// directory (folders/search/create/duplicate/delete — the same ActorsPanel as
/// the dock tab) opens sheets into the main area, where several edit full-size
/// and in place side by side (section-reveal eyes included). Kept separate from
/// the Players page: administration and authoring are different workloads.
/// </summary>
export function NpcsPage({
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

  const records = openIds
    .map((id) => state.sheets[id])
    .filter((record): record is NonNullable<typeof record> => Boolean(record));

  return (
    <div className="npcs-page">
      <div className="chip-tabs npcs-topbar">
        <PageSwitcher active={activePage} onSelect={onNavigate} className="page-switcher--inline" history={ctx.history} />
      </div>
      <div className="npcs-page-body">
        <PageShell
          roomId={state.roomId}
          roster={
            <ActorsPanel
              state={state}
              dm={dm}
              // On this page, "open" adds the sheet to the side-by-side main area.
              openSheet={open}
              dropActorAt={ctx.dropActorAt}
              filterKind="npc"
              // The NPCs page has its OWN folder tree, independent of the Actors sidebar.
              folderKind="npc"
            />
          }
        >
          <SheetCards
            ctx={ctx}
            records={records}
            onClose={close}
            allowReveal
            emptyHint="Pick an actor from the directory — or create an NPC — to edit its sheet. Open several to compare side by side."
          />
        </PageShell>
      </div>
    </div>
  );
}
