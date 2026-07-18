import type { ReactNode } from "react";
import {
  Backpack,
  Feather,
  HeartHandshake,
  IdCard,
  Map as MapIcon,
  MessageSquare,
  ScrollText,
  Settings,
  Swords,
  Users,
} from "lucide-react";
import { ActorsPanel } from "../components/ActorsPanel";
import { CharacterSheetPanel } from "../components/CharacterSheet";
import { InitiativeTracker } from "../components/InitiativeTracker";
import { ItemsPanel } from "../components/ItemsPanel";
import { ItemSheetPanel } from "../components/ItemSheetPanel";
import { LogPanel } from "../components/LogPanel";
import { NotesPanel } from "../components/NotesPanel";
import { PartyPanel } from "../components/PartyPanel";
import { HandoutsPanel } from "../components/HandoutsPanel";
import { InventoryPanel } from "../components/InventoryPanel";
import { ScenePanel } from "../components/ScenePanel";
import { SettingsPanel } from "../components/SettingsPanel";
import type { WindowPos } from "../components/FloatingWindow";
import type { DiceOverlayController } from "../dice/useDiceOverlay";
import type { GameRoom, RollOptions, useDmActions } from "../hooks/useGameRoom";
import type { History } from "../lib/history";
import type { CharacterSheet, CheckSpec, GameState, Role, UiAccent } from "../lib/types";
import { buildConditionsControl } from "../components/sheet/conditionsControl";

export type PanelId =
  | "sheet"
  | "itemSheet"
  | "log"
  | "initiative"
  | "inventory"
  | "scenes"
  | "actors"
  | "items"
  | "party"
  | "handouts"
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
  /** Which item the Item Sheet window is showing (DM-only). */
  viewItemId: string | null;
  openItemSheet: (itemId: string) => void;
  /** Opens a floating handout viewer window (players re-view, DM previews). */
  openHandout: (handoutId: string) => void;
  /** Sends UPDATE_SHEET — the server authorizes (DM: any sheet, player: own only). */
  updateSheet: (sheetId: string, sheet: Partial<CharacterSheet>) => void;
  /** Rolls dice with the DM's secret toggle already applied. */
  rollDice: (expression: string, options?: Omit<RollOptions, "private">) => void;
  /** Rolls a structured sheet check (server resolves the parts), secret toggle applied. */
  rollCheck: (sheetId: string, check: CheckSpec, adv?: "adv" | "dis") => void;
  /** DM: place a token for a sheet (null → blank) at screen coordinates on the map. */
  dropActorAt: (sheetId: string | null, clientX: number, clientY: number) => void;
  /** DM: place an "item" token at screen coordinates on the map. */
  dropItemAt: (itemId: string, clientX: number, clientY: number) => void;
  /** The 3D dice controller (settings: 3D on/off, mute). */
  dice: DiceOverlayController;
  /** Per-client snap-to-grid (shared by the map toolbar 🧲 and settings). */
  snap: boolean;
  toggleSnap: () => void;
  /** Per-client log-toast notifications. */
  toastsEnabled: boolean;
  setToastsEnabled: (on: boolean) => void;
  /** Per-client: hold SpaceBar as the left mouse button (touchpad aid). */
  spaceClick: boolean;
  setSpaceClick: (on: boolean) => void;
  /** DM per-client: single-clicking a token opens its Token editor panel. */
  tokenPanelOnClick: boolean;
  setTokenPanelOnClick: (on: boolean) => void;
  /** DM per-client: closing a character sheet also closes the linked token's Token editor panel. */
  closeTokenWithSheet: boolean;
  setCloseTokenWithSheet: (on: boolean) => void;
  /** Per-client: clicking outside the open Settings window closes it (off by default). */
  closeSettingsOnClickOff: boolean;
  setCloseSettingsOnClickOff: (on: boolean) => void;
  /** Per-client: shrink + re-encode this device's own image uploads (WebP). */
  optimizeUploads: boolean;
  setOptimizeUploads: (on: boolean) => void;
  /** Per-client: mirror other players' tokens sliding live while they drag (receiver-side). */
  showLiveDrags: boolean;
  setShowLiveDrags: (on: boolean) => void;
  /** Per-client: render the board at ≥2× pixel ratio (crisper text/art, higher GPU cost). */
  hiResRender: boolean;
  setHiResRender: (on: boolean) => void;
  /** Per-client theme: day (parchment) or night (carved stone). */
  nightMode: boolean;
  setNightMode: (on: boolean) => void;
  /** Per-client accent variation (sky/moss/ember/lapis). */
  accent: UiAccent;
  setAccent: (accent: UiAccent) => void;
  /** Per-client: ask "are you sure?" before deleting NPCs/items/players. */
  confirmDeletes: boolean;
  setConfirmDeletes: (on: boolean) => void;
  /** DM client-side undo/redo (board edits + directory create/delete). */
  history?: History;
  /** Clears saved window/tray positions and returns floating UI to defaults. */
  resetUiLayout: () => void;
  /** Which page the Settings window shows: the main list or the Keybinds sub-page. */
  settingsView: SettingsView;
  setSettingsView: (view: SettingsView) => void;
  /** Leaves the campaign (back to the lobby). */
  leave: () => void;
};

/** The Settings window's two pages (a lightweight in-panel sub-view, not a separate window). */
export type SettingsView = "main" | "keybinds";

export type PanelDef = {
  id: PanelId;
  /** Tab tooltip / window title fallback. */
  label: string;
  /** Sidebar tab glyph. */
  icon: ReactNode;
  /** Dockable panels appear as sidebar tabs; others are floating-only. */
  dockable: boolean;
  /** Roles that can see this panel. */
  roles: Role[];
  title: (ctx: PanelContext) => string;
  defaultPos: (viewportWidth: number, viewportHeight: number) => WindowPos;
  width: number;
  /** Initial window height. Omit for auto (content-sized) height. */
  height?: number;
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
    icon: <IdCard size={17} strokeWidth={2.2} />,
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
    // Centered horizontally, opening tall and biased above the vertical center (the sheet
    // has a lot of content).
    defaultPos: (vw, vh) => ({ x: Math.max(16, Math.round((vw - 800) / 2)), y: Math.max(16, Math.round((vh - 860) / 2 - 60)) }),
    // Min width measured so the Main page shows TWO columns (container query flips at a
    // .sheet7 inline-size of 680px ≈ a 690px window) AND every skill name fits on ONE line.
    // The widest skill ("Animal Handling") needs a ~758px window to fit; 760 sat right on
    // that edge and still truncated to "Animal Handl…" on displays whose font renders a
    // hair wider. 790 gives ~15px of track clearance so cross-machine font variance never
    // re-truncates it, while staying just under the default so both columns still breathe.
    width: 800,
    height: 860,
    minWidth: 790,
    minHeight: 480,
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
          onRollCheck={canEdit ? (check, adv) => ctx.rollCheck(sheetId, check, adv) : undefined}
          onRest={canEdit ? (kind, spendHitDice) => ctx.room.send({ type: "REST", sheetId, kind, spendHitDice }) : undefined}
          conditions={buildConditionsControl(ctx.state.tokens, sheetId, canEdit, ctx.room.send)}
          actions={
            canEdit
              ? {
                  castSpell: (level) => ctx.room.send({ type: "CAST_SPELL", sheetId, level }),
                  useFeature: (featureId) => ctx.room.send({ type: "USE_FEATURE", sheetId, featureId }),
                  useItemCharge: (rowId) => ctx.room.send({ type: "USE_ITEM_CHARGE", sheetId, rowId }),
                  deathSave: () => ctx.room.send({ type: "DEATH_SAVE", sheetId }),
                }
              : undefined
          }
        />
      );
    },
  },
  {
    id: "itemSheet",
    label: "Item",
    icon: <Backpack size={17} strokeWidth={2.2} />,
    dockable: false,
    roles: ["dm"],
    title: (ctx) => {
      const item = ctx.viewItemId ? ctx.state.items[ctx.viewItemId] : null;
      return item ? item.name || "Item" : "Item";
    },
    defaultPos: (vw) => ({ x: Math.max(16, vw - 760), y: 96 }),
    width: 320,
    render: (ctx) => {
      const item = ctx.viewItemId ? ctx.state.items[ctx.viewItemId] : null;
      if (!item) {
        return (
          <div className="panel-body">
            <span className="muted">Pick an item from the Items tab, or double-click an item token.</span>
          </div>
        );
      }
      return (
        <ItemSheetPanel item={item} roomId={ctx.state.roomId} onChange={ctx.dm.updateItem} />
      );
    },
  },
  {
    id: "log",
    label: "Log",
    icon: <MessageSquare size={17} strokeWidth={2.2} />,
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
        sheets={ctx.isDm ? ctx.state.sheets : undefined}
        onApplyDamage={
          ctx.isDm
            ? (sheetId, amount, damageType) =>
                ctx.room.send({ type: "APPLY_DAMAGE", sheetId, amount, damageType })
            : undefined
        }
      />
    ),
  },
  {
    id: "initiative",
    label: "Combat",
    icon: <Swords size={17} strokeWidth={2.2} />,
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
    id: "inventory",
    label: "Inventory",
    icon: <Backpack size={17} strokeWidth={2.2} />,
    dockable: true,
    // Player-only: the DM reaches any character's inventory through the sheet window,
    // and the Backpack glyph stays unambiguous per role (the DM's is the Items catalog).
    roles: ["player"],
    title: (ctx) => {
      const record = ctx.room.yourPlayerId ? ctx.state.sheets[ctx.room.yourPlayerId] : null;
      const name = record?.data.characterName;
      return name ? `Inventory — ${name}` : "Inventory";
    },
    defaultPos: (vw) => ({ x: Math.max(16, vw - 560), y: 90 }),
    width: 480,
    height: 620,
    minWidth: 320,
    minHeight: 320,
    render: (ctx) => <InventoryPanel ctx={ctx} />,
  },
  {
    id: "scenes",
    label: "Scenes",
    icon: <MapIcon size={17} strokeWidth={2.2} />,
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
    icon: <Users size={17} strokeWidth={2.2} />,
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
        // Creating an NPC here just adds the row (like player creation) — no
        // auto-popped floating sheet. Click the row to open it when you want it.
        openOnCreate={false}
      />
    ),
  },
  {
    id: "items",
    label: "Items",
    icon: <Backpack size={17} strokeWidth={2.2} />,
    dockable: true,
    roles: ["dm"],
    title: () => "Items",
    defaultPos: (vw) => ({ x: vw - 392, y: 156 }),
    width: 340,
    render: (ctx) => (
      <ItemsPanel
        state={ctx.state}
        dm={ctx.dm}
        openItemSheet={ctx.openItemSheet}
        dropItemAt={ctx.dropItemAt}
      />
    ),
  },
  {
    id: "party",
    label: "Party",
    icon: <HeartHandshake size={17} strokeWidth={2.2} />,
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
    id: "handouts",
    label: "Handouts",
    icon: <ScrollText size={17} strokeWidth={2.2} />,
    dockable: true,
    roles: ["dm", "player"],
    title: () => "Handouts",
    defaultPos: (vw) => ({ x: vw - 392, y: 220 }),
    width: 340,
    render: (ctx) => (
      <HandoutsPanel
        state={ctx.state}
        dm={ctx.dm}
        isDm={ctx.isDm}
        openHandout={ctx.openHandout}
      />
    ),
  },
  {
    id: "notes",
    label: "DM Notes",
    icon: <Feather size={17} strokeWidth={2.2} />,
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
    icon: <Settings size={17} strokeWidth={2.2} />,
    dockable: false,
    roles: ["dm", "player"],
    title: (ctx) => (ctx.settingsView === "keybinds" ? "Keybinds" : "Settings"),
    // Bigger by default and centered horizontally, biased slightly above the vertical
    // center (the panel has a lot of rows, especially for the DM) — the width/height here
    // must match the centering math.
    defaultPos: (vw, vh) => ({ x: Math.max(16, Math.round((vw - 460) / 2)), y: Math.max(16, Math.round((vh - 640) / 2 - 70)) }),
    width: 460,
    height: 640,
    minWidth: 360,
    minHeight: 320,
    render: (ctx) => <SettingsPanel ctx={ctx} />,
  },
];

export function panelsForRole(role: Role): PanelDef[] {
  return PANELS.filter((panel) => panel.roles.includes(role));
}

export function dockPanelsForRole(role: Role): PanelDef[] {
  return PANELS.filter((panel) => panel.dockable && panel.roles.includes(role));
}
