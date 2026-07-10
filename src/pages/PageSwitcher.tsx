import { Redo2, Undo2 } from "lucide-react";
import type { History } from "../lib/history";

export type PageId = "board" | "players" | "npcs" | "items" | "scenes" | "assets";

export const DM_PAGES: Array<{ id: PageId; label: string }> = [
  { id: "board", label: "Board" },
  { id: "players", label: "Players" },
  { id: "npcs", label: "NPCs" },
  { id: "items", label: "Items" },
  { id: "scenes", label: "Scenes" },
  { id: "assets", label: "Assets" },
];

/// <summary>
/// The Board / Players / NPCs / Scenes navigation buttons. Rendered in two
/// places: as the floating corner pill on the board (wrapped in .page-switcher),
/// and inline as the leftmost element of each prep page's top tab row
/// (className "page-switcher--inline"). Pages that mutate directory entities
/// (Players/NPCs/Items) pass `history` to get undo/redo buttons appended —
/// the same DM history the board toolbar drives.
/// </summary>
export function PageSwitcher({
  active,
  onSelect,
  className,
  history,
}: {
  active: PageId;
  onSelect: (id: PageId) => void;
  className?: string;
  history?: History;
}) {
  return (
    <div className={`page-switcher-group${className ? ` ${className}` : ""}`}>
      {DM_PAGES.map((entry) => (
        <button
          key={entry.id}
          className={active === entry.id ? "btn-active" : ""}
          onClick={() => onSelect(entry.id)}
        >
          {entry.label}
        </button>
      ))}
      {history ? (
        <>
          <span className="page-topbar-sep" />
          <button
            className="icon-btn btn-ghost"
            title="Undo"
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Undo2 size={15} strokeWidth={2.2} />
          </button>
          <button
            className="icon-btn btn-ghost"
            title="Redo"
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Redo2 size={15} strokeWidth={2.2} />
          </button>
        </>
      ) : null}
    </div>
  );
}
