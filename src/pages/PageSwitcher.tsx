export type PageId = "board" | "players" | "npcs" | "scenes";

export const DM_PAGES: Array<{ id: PageId; label: string }> = [
  { id: "board", label: "Board" },
  { id: "players", label: "Players" },
  { id: "npcs", label: "NPCs" },
  { id: "scenes", label: "Scenes" },
];

/// <summary>
/// The Board / Players / NPCs / Scenes navigation buttons. Rendered in two
/// places: as the floating corner pill on the board (wrapped in .page-switcher),
/// and inline as the leftmost element of each prep page's top tab row
/// (className "page-switcher--inline"). Purely presentational.
/// </summary>
export function PageSwitcher({
  active,
  onSelect,
  className,
}: {
  active: PageId;
  onSelect: (id: PageId) => void;
  className?: string;
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
    </div>
  );
}
