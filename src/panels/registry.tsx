import type { ReactNode } from "react";
import { ActorsPanel } from "../components/ActorsPanel";
import { CharacterSheetPanel } from "../components/CharacterSheet";
import { InitiativeTracker } from "../components/InitiativeTracker";
import { ItemsPanel } from "../components/ItemsPanel";
import { LogPanel } from "../components/LogPanel";
import { NotesPanel } from "../components/NotesPanel";
import { PartyPanel } from "../components/PartyPanel";
import { ScenePanel } from "../components/ScenePanel";
import { SettingsPanel } from "../components/SettingsPanel";
import type { WindowPos } from "../components/FloatingWindow";
import type { DiceOverlayController } from "../dice/useDiceOverlay";
import type { GameRoom, RollOptions, useDmActions } from "../hooks/useGameRoom";
import type { CharacterSheet, GameState, Role } from "../lib/types";

export type PanelId =
  | "sheet"
  | "log"
  | "initiative"
  | "scenes"
  | "actors"
  | "items"
  | "party"
  | "notes"
  | "settings";

/** Everything a panel might need, assembled once in App and passed to render(). */
export type PanelContext = {
  state: GameState;
  room: GameRoom;
  dm: ReturnType<typeof useDmActions>;
  isDm: boolean;
  /** Which sheet the sheet window is showing (null → own sheet for players). */
  viewSheetId: string | null;
  openSheet: (sheetId: string) => void;
  /** Sends UPDATE_SHEET — the server authorizes (DM: any sheet, player: own only). */
  updateSheet: (sheetId: string, sheet: CharacterSheet) => void;
  /** Rolls dice with the DM's secret toggle already applied. */
  rollDice: (expression: string, options?: Omit<RollOptions, "private">) => void;
  /** DM: place a token for a sheet (null → blank) at screen coordinates on the map. */
  dropActorAt: (sheetId: string | null, clientX: number, clientY: number) => void;
  /** The 3D dice controller (settings: 3D on/off, mute). */
  dice: DiceOverlayController;
  /** Per-client snap-to-grid (shared by the map toolbar 🧲 and settings). */
  snap: boolean;
  toggleSnap: () => void;
  /** Per-client log-toast notifications. */
  toastsEnabled: boolean;
  setToastsEnabled: (on: boolean) => void;
  /** Clears saved window/tray positions and returns floating UI to defaults. */
  resetUiLayout: () => void;
  /** Leaves the campaign (back to the lobby). */
  leave: () => void;
};

export type PanelDef = {
  id: PanelId;
  /** Tab tooltip / window title fallback. */
  label: string;
  /** Sidebar tab glyph. */
  icon: string;
  /** Dockable panels appear as sidebar tabs; others are floating-only. */
  dockable: boolean;
  /** Roles that can see this panel. */
  roles: Role[];
  title: (ctx: PanelContext) => string;
  defaultPos: (viewportWidth: number, viewportHeight: number) => WindowPos;
  width: number;
  /** Content-driven minimum window size (resizing floor). */
  minWidth?: number;
  minHeight?: number;
  render: (ctx: PanelContext) => ReactNode;
};

/** The sheet the sheet window should show: explicit choice, or own sheet for players. */
function resolveSheetId(ctx: PanelContext): string | null {
  return ctx.viewSheetId ?? (ctx.isDm ? null : ctx.room.yourPlayerId);
}

/// <summary>
/// The panel registry. The dock renders tabs and App renders pop-out windows
/// from this list generically — adding a panel is one entry here plus its
/// component, with no shell surgery.
/// </summary>
export const PANELS: PanelDef[] = [
  {
    id: "sheet",
    label: "Sheet",
    icon: "🪪",
    dockable: false,
    roles: ["dm", "player"],
    title: (ctx) => {
      const sheetId = resolveSheetId(ctx);
      const record = sheetId ? ctx.state.sheets[sheetId] : null;
      if (!record) {
        return "Character";
      }
      return record.data.characterName || (record.redacted ? "???" : "Character");
    },
    defaultPos: (vw) => ({ x: Math.max(16, vw - 760), y: 60 }),
    width: 360,
    render: (ctx) => {
      const sheetId = resolveSheetId(ctx);
      if (!sheetId) {
        return (
          <div className="panel-body">
            <span className="muted">
              Pick a character from the Actors tab, or click a token or avatar.
            </span>
          </div>
        );
      }
      const record = ctx.state.sheets[sheetId] ?? null;
      const canEdit = ctx.isDm || sheetId === ctx.room.yourPlayerId;
      return (
        <CharacterSheetPanel
          record={record}
          canEdit={canEdit}
          isDm={ctx.isDm}
          roomId={ctx.state.roomId}
          onChange={(sheet) => ctx.updateSheet(sheetId, sheet)}
          onToggleReveal={
            ctx.isDm
              ? (section, revealed) => ctx.dm.setSheetReveal(sheetId, section, revealed)
              : undefined
          }
          onRoll={
            canEdit
              ? (label, modifier, adv) =>
                  ctx.rollDice(`1d20${modifier >= 0 ? `+${modifier}` : modifier}`, {
                    context: { sheetId, label },
                    adv,
                  })
              : undefined
          }
        />
      );
    },
  },
  {
    id: "log",
    label: "Log",
    icon: "💬",
    dockable: true,
    roles: ["dm", "player"],
    title: () => "Log",
    defaultPos: (vw, vh) => ({ x: Math.max(16, vw - 720), y: Math.max(60, vh - 560) }),
    width: 340,
    render: (ctx) => (
      <LogPanel
        log={ctx.state.log}
        isDm={ctx.isDm}
        yourPlayerId={ctx.room.yourPlayerId}
        playerSlots={ctx.state.playerSlots}
        onSendChat={(text, whisperTo) => ctx.room.send({ type: "SEND_CHAT", text, whisperTo })}
      />
    ),
  },
  {
    id: "initiative",
    label: "Combat",
    icon: "⚔",
    dockable: true,
    roles: ["dm", "player"],
    title: (ctx) => (ctx.state.combat ? `Combat — Round ${ctx.state.combat.round}` : "Combat"),
    defaultPos: () => ({ x: 16, y: 60 }),
    width: 300,
    render: (ctx) => (
      <InitiativeTracker
        state={ctx.state}
        isDm={ctx.isDm}
        room={ctx.room}
        dm={ctx.dm}
        openSheet={ctx.openSheet}
      />
    ),
  },
  {
    id: "scenes",
    label: "Scenes",
    icon: "🗺",
    dockable: true,
    roles: ["dm"],
    title: () => "Scenes",
    defaultPos: (vw) => ({ x: vw - 392, y: 92 }),
    width: 340,
    render: (ctx) => <ScenePanel state={ctx.state} dm={ctx.dm} />,
  },
  {
    id: "actors",
    label: "Actors",
    icon: "👥",
    dockable: true,
    roles: ["dm"],
    title: () => "Actors",
    defaultPos: (vw) => ({ x: vw - 392, y: 124 }),
    width: 340,
    render: (ctx) => (
      <ActorsPanel
        state={ctx.state}
        dm={ctx.dm}
        openSheet={ctx.openSheet}
        dropActorAt={ctx.dropActorAt}
      />
    ),
  },
  {
    id: "items",
    label: "Items",
    icon: "🎒",
    dockable: true,
    roles: ["dm"],
    title: () => "Items",
    defaultPos: (vw) => ({ x: vw - 392, y: 156 }),
    width: 340,
    render: (ctx) => <ItemsPanel state={ctx.state} dm={ctx.dm} />,
  },
  {
    id: "party",
    label: "Party",
    icon: "🧑‍🤝‍🧑",
    dockable: true,
    roles: ["dm"],
    title: () => "Party",
    defaultPos: (vw) => ({ x: vw - 392, y: 188 }),
    width: 340,
    render: (ctx) => (
      // PC sheet ids equal slot ids, so viewing a slot's sheet is openSheet(slotId).
      <PartyPanel state={ctx.state} dm={ctx.dm} onViewSheet={ctx.openSheet} />
    ),
  },
  {
    id: "notes",
    label: "DM Notes",
    icon: "📝",
    dockable: true,
    roles: ["dm"],
    title: () => "DM Notes",
    defaultPos: (vw, vh) => ({ x: Math.max(16, vw - 760), y: Math.max(60, vh - 420) }),
    width: 360,
    render: (ctx) => (
      <NotesPanel notes={ctx.state.dmNotes} onChange={(notes) => ctx.dm.updateDmNotes(notes)} />
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: "⚙",
    dockable: false,
    roles: ["dm", "player"],
    title: () => "Settings",
    defaultPos: (vw, vh) => ({ x: Math.max(16, vw - 400), y: Math.max(60, vh - 480) }),
    width: 320,
    render: (ctx) => <SettingsPanel ctx={ctx} />,
  },
];

export function panelsForRole(role: Role): PanelDef[] {
  return PANELS.filter((panel) => panel.roles.includes(role));
}

export function dockPanelsForRole(role: Role): PanelDef[] {
  return PANELS.filter((panel) => panel.dockable && panel.roles.includes(role));
}
