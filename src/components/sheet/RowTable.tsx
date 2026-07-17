import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";

export type RowGroup<T> = {
  id: string;
  title: string;
  rows: T[];
  /** DM/owner: add a row to this group. */
  onAdd?: () => void;
};

type RowTableProps<T extends { id: string }> = {
  groups: RowGroup<T>[];
  /** Column labels shown in each group's header (right side). */
  headerCells?: ReactNode;
  /** Left cell: icon + name + subtitle. */
  renderName: (row: T) => ReactNode;
  /** Right cells: numbers/toggles/roll buttons. */
  renderCells: (row: T) => ReactNode;
  /** Expanded body (description editor etc.); enables the expand chevron. */
  renderExpand?: (row: T) => ReactNode;
  /** Owner/DM: remove a row. */
  onRemove?: (row: T) => void;
  /** Show a search box filtering rows by this text. */
  getSearchText?: (row: T) => string;
  canEdit: boolean;
  emptyHint?: string;
};

/**
 * The grouped-table workhorse (Phase 7): category groups with per-group +add, a
 * search box, per-row expand (description), and a remove action. Shared by the
 * Inventory / Features / Spells / Effects pages and the NPC Actions table.
 * Group headers are collapsible (click the header; search temporarily expands).
 */
export function RowTable<T extends { id: string }>({
  groups,
  headerCells,
  renderName,
  renderCells,
  renderExpand,
  onRemove,
  getSearchText,
  canEdit,
  emptyHint,
}: RowTableProps<T>) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const q = query.trim().toLowerCase();
  const filterRows = (rows: T[]) =>
    !q || !getSearchText ? rows : rows.filter((r) => getSearchText(r).toLowerCase().includes(q));

  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div className="row-table">
      {getSearchText ? (
        <div className="rt-search">
          <span className="rt-search-icon"><Search size={12} strokeWidth={2.2} /></span>
          <input
            value={query}
            placeholder="Search"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button type="button" className="btn-ghost icon-btn" onClick={() => setQuery("")}>
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      {totalRows === 0 && emptyHint ? <div className="muted rt-empty">{emptyHint}</div> : null}

      {groups.map((group) => {
        const rows = filterRows(group.rows);
        if (rows.length === 0 && !group.onAdd) return null;
        // Search forces groups open so matches aren't hidden behind a fold.
        const isCollapsed = collapsedGroups.has(group.id) && !q;
        return (
          <div
            className={`rt-group sheet-section sheet-section--flush${isCollapsed ? " rt-group--collapsed" : ""}`}
            key={group.id}
          >
            <div
              className="rt-group-head"
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              title={isCollapsed ? "Expand" : "Collapse"}
              onClick={() => toggleGroup(group.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleGroup(group.id);
                }
              }}
            >
              <span className="rt-group-chevron" aria-hidden>
                {isCollapsed ? "▸" : "▾"}
              </span>
              <span className="rt-group-title">{group.title}</span>
              {isCollapsed && group.rows.length > 0 ? (
                <span className="rt-group-count">{group.rows.length}</span>
              ) : null}
              <span className="rt-group-cols">{headerCells}</span>
              {canEdit && group.onAdd ? (
                <button
                  type="button"
                  className="btn-ghost rt-add"
                  title="Add row"
                  onClick={(e) => {
                    e.stopPropagation();
                    group.onAdd?.();
                  }}
                >
                  ＋
                </button>
              ) : null}
            </div>
            {!isCollapsed
              ? rows.map((row) => {
                  const isOpen = expanded.has(row.id);
                  return (
                    <div className={`rt-row-wrap ${isOpen ? "rt-row-wrap--open" : ""}`} key={row.id}>
                      <div className="rt-row">
                        <div className="rt-name">{renderName(row)}</div>
                        <div className="rt-cells">{renderCells(row)}</div>
                        <div className="rt-actions">
                          {renderExpand ? (
                            <button
                              type="button"
                              className="btn-ghost icon-btn"
                              title={isOpen ? "Collapse" : "Details"}
                              onClick={() => toggle(row.id)}
                            >
                              {isOpen ? "▴" : "▾"}
                            </button>
                          ) : null}
                          {canEdit && onRemove ? (
                            <button
                              type="button"
                              className="btn-ghost icon-btn"
                              title="Remove"
                              onClick={() => onRemove(row)}
                            >
                              ✕
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {isOpen && renderExpand ? <div className="rt-expand">{renderExpand(row)}</div> : null}
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}
    </div>
  );
}
