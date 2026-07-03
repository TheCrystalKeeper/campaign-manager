import type { PanelContext, PanelDef, PanelId } from "../panels/registry";

/** A non-tab rail button (sheet / dice tray / settings toggles). */
export type DockAction = {
  id: string;
  icon: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  /** Rail placement: above the tabs, right after them, or at the bottom (above the chevron). */
  slot: "top" | "after-tabs" | "bottom";
};

type DockProps = {
  /** Dockable panels available to this role, in tab order. */
  panels: PanelDef[];
  /** Whether the panel column is expanded (the tab rail is always visible). */
  open: boolean;
  activeTab: PanelId;
  /** Tabs currently popped out into floating windows (shown dimmed in the rail). */
  popped: PanelId[];
  context: PanelContext;
  /** Action buttons interleaved with the tabs (sheet on top, dice after, settings bottom). */
  actions?: DockAction[];
  onSelectTab: (id: PanelId) => void;
  onPopOut: (id: PanelId) => void;
  onToggleOpen: () => void;
};

function ActionButtons({ actions }: { actions: DockAction[] }) {
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          className={`dock-tab${action.active ? " dock-tab--active" : ""}`}
          title={action.title}
          onClick={action.onClick}
        >
          {action.icon}
        </button>
      ))}
    </>
  );
}

/// <summary>
/// FoundryVTT-style docked sidebar: a vertical icon rail hugging the right
/// window edge, with the active panel expanding to its left. The rail (and its
/// collapse chevron) stays visible even when the panel is collapsed, so the
/// sidebar can never be lost off-screen. Besides the panel tabs, the rail holds
/// action buttons: sheet at the very top, dice tray after the tabs, and
/// settings at the bottom just above the chevron.
/// </summary>
export function Dock({
  panels,
  open,
  activeTab,
  popped,
  context,
  actions = [],
  onSelectTab,
  onPopOut,
  onToggleOpen,
}: DockProps) {
  const active =
    panels.find((panel) => panel.id === activeTab && !popped.includes(panel.id)) ??
    panels.find((panel) => !popped.includes(panel.id)) ??
    null;

  const topActions = actions.filter((action) => action.slot === "top");
  const afterTabActions = actions.filter((action) => action.slot === "after-tabs");
  const bottomActions = actions.filter((action) => action.slot === "bottom");

  return (
    <div className="dock">
      <div className="dock-rail">
        {topActions.length > 0 ? (
          <>
            <ActionButtons actions={topActions} />
            <span className="dock-sep" />
          </>
        ) : null}
        {panels.map((panel) => {
          const isPopped = popped.includes(panel.id);
          return (
            <button
              key={panel.id}
              className={`dock-tab${open && active?.id === panel.id ? " dock-tab--active" : ""}${
                isPopped ? " dock-tab--popped" : ""
              }`}
              title={isPopped ? `${panel.label} (popped out)` : panel.label}
              onClick={() => onSelectTab(panel.id)}
            >
              {panel.icon}
            </button>
          );
        })}
        <ActionButtons actions={afterTabActions} />
        <span className="dock-rail-spacer" />
        <ActionButtons actions={bottomActions} />
        <button
          className="dock-tab"
          title={open ? "Collapse" : "Expand"}
          onClick={onToggleOpen}
        >
          {open ? "▶" : "◀"}
        </button>
      </div>

      <div className={`dock-panel${open ? "" : " dock-panel--closed"}`} aria-hidden={!open}>
        <div className="dock-panel-inner">
          {active ? (
            <>
              <div className="dock-panel-head">
                <span className="window-title">{active.title(context)}</span>
                <button
                  className="btn-ghost icon-btn"
                  title="Pop out into a window"
                  onClick={() => onPopOut(active.id)}
                >
                  ⇱
                </button>
              </div>
              <div className="dock-panel-body">{active.render(context)}</div>
            </>
          ) : (
            <div className="dock-panel-body">
              <span className="muted" style={{ padding: "0.5rem" }}>
                All tabs are popped out.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
