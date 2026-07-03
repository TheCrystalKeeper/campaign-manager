import { useState } from "react";
import { ActorsPanel } from "../components/ActorsPanel";
import { SheetCards } from "./SheetCards";
import { PageShell } from "./PageShell";
import type { PanelContext } from "../panels/registry";

/// <summary>
/// DM-only NPCs page: the stat-block authoring workspace. The full Actors
/// directory (folders/search/create/duplicate/delete — the same ActorsPanel as
/// the dock tab) opens sheets into the main area, where several edit full-size
/// and in place side by side (section-reveal eyes included). Kept separate from
/// the Players page: administration and authoring are different workloads.
/// </summary>
export function NpcsPage({ ctx }: { ctx: PanelContext }) {
  const { state, dm } = ctx;
  const [openIds, setOpenIds] = useState<string[]>([]);

  const open = (id: string) => setOpenIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
  const close = (id: string) => setOpenIds((cur) => cur.filter((x) => x !== id));

  const records = openIds
    .map((id) => state.sheets[id])
    .filter((record): record is NonNullable<typeof record> => Boolean(record));

  return (
    <PageShell
      roster={
        <ActorsPanel
          state={state}
          dm={dm}
          // On this page, "open" adds the sheet to the side-by-side main area.
          openSheet={open}
          dropActorAt={ctx.dropActorAt}
          filterKind="npc"
        />
      }
    >
      <SheetCards
        records={records}
        isDm
        roomId={state.roomId}
        onClose={close}
        onChange={(id, sheet) => ctx.updateSheet(id, sheet)}
        onToggleReveal={(id, section, revealed) => dm.setSheetReveal(id, section, revealed)}
        onRoll={(id, label, modifier, adv) =>
          ctx.rollDice(`1d20${modifier >= 0 ? `+${modifier}` : modifier}`, {
            context: { sheetId: id, label },
            adv,
          })
        }
        emptyHint="Pick an actor from the directory — or create an NPC — to edit its sheet. Open several to compare side by side."
      />
    </PageShell>
  );
}
