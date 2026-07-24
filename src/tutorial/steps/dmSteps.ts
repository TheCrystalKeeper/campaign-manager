import {
  center,
  displayedScene,
  dockActionAnchor,
  dockTabAnchor,
  gridCalibrationChanged,
  pinsGrew,
  rolledSinceBaseline,
  sel,
  selAll,
  sheetOpened,
  strokesGrew,
  tokenAnchor,
  toolAnchor,
  unionDockAnchor,
  viewportMoved,
  type TutorialStep,
} from "../types";
import { toolTip, toolTitle } from "./registryCopy";

export const DM_STEPS: TutorialStep[] = [
  {
    id: "dm-welcome",
    anchor: center,
    title: "Welcome, Dungeon Master",
    body:
      "This is a throwaway practice table on the two sample maps — click, drag, and break things freely. Nothing you do here is saved, and the real campaigns can't see it. Everything stays clickable throughout the tour.",
  },
  {
    id: "dm-board",
    anchor: center,
    title: "The board",
    body:
      "You're looking at the Sample Tavern. Drag anywhere to pan and scroll to zoom — your camera is your own; players aim theirs independently. Try moving the view now.",
    advanceWhen: viewportMoved,
  },
  {
    id: "dm-avatar-strip",
    anchor: sel(".avatar-strip"),
    title: "Who's at the table",
    placement: "bottom",
    body:
      "These chips are the party and the scene's NPCs, with live HP bars. Double-click a chip to open its sheet — try it. The ✕ on a player chip disconnects them.",
    advanceWhen: sheetOpened,
  },
  {
    id: "dm-token-drag",
    anchor: tokenAnchor("tut-token-hero"),
    title: "Tokens",
    body:
      "This is Aria, the sample hero. Drag her to another square — every move is shown to the whole table live.",
    before: (a) => a.closeWindows(),
    advanceWhen: (sig, base) => sig.tokenMoves > base.tokenMoves,
  },
  {
    id: "dm-snap",
    anchor: sel('[data-map-action="snap"]'),
    title: "Snap to grid",
    placement: "right",
    body:
      "The 🧲 magnet lands dragged tokens on cell centers. Flip it, then drag Aria again to feel the difference.",
    advanceWhen: (sig, base) => sig.snap !== base.snap && sig.tokenMoves > base.tokenMoves,
  },
  {
    id: "dm-token-select",
    anchor: tokenAnchor("tut-token-barkeep"),
    title: "The Token editor",
    body: "Click Old Toby the Barkeep — his Token window opens with everything about that mini.",
    advanceWhen: (sig) => sig.selectedTokenIds.includes("tut-token-barkeep"),
  },
  {
    id: "dm-token-editor",
    anchor: sel('[data-window-id="token-editor"]'),
    title: "Token controls",
    placement: "right",
    body:
      "Size (Tiny to Gargantuan), how players see its HP, conditions, facing in degrees, skip-initiative, and name display all live here. Double-clicking a token opens its full sheet instead.",
  },
  {
    id: "dm-token-visibility",
    anchor: selAll("[data-token-section]"),
    title: "Hidden & vision",
    placement: "right",
    body:
      "Hidden strips the token from player screens entirely — you see it ghosted. Auto lets each player's vision and the scene's lights decide. Always forces it visible for everyone. The Vision toggle below gives a token darkvision. Try flipping one now.",
    advanceWhen: (sig, base) => {
      const cur = sig.state.tokens.find((t) => t.id === "tut-token-barkeep");
      const was = base.state.tokens.find((t) => t.id === "tut-token-barkeep");
      if (!cur || !was) return false;
      return (
        cur.hidden !== was.hidden ||
        cur.dmVisibility !== was.dmVisibility ||
        cur.vision?.enabled !== was.vision?.enabled
      );
    },
  },
  {
    id: "dm-toolbar",
    anchor: selAll(".map-toolbar-rail [data-tool-id]"),
    title: "Map tools",
    placement: "right",
    body:
      "Everyone gets Select, Measure, Template, and Draw. The rest are yours alone: Calibrate, Fog, Pin, Walls, and Lights. Each has a hotkey — hover any button to see it.",
  },
  {
    id: "dm-measure",
    anchor: toolAnchor("measure"),
    title: toolTitle("measure"),
    placement: "right",
    body: `${toolTip("measure")} Activate it, drag on the map to measure, then hit Next.`,
    advanceWhen: (sig) => sig.activeToolId === "measure",
  },
  {
    id: "dm-template",
    anchor: toolAnchor("template"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("template"),
    placement: "bottom",
    body: `${toolTip("template")} Click the highlighted button, then pick a shape in the options that appear and drag from the spell's origin. Pin keeps it on the map until cleared.`,
    advanceWhen: (sig) => sig.activeToolId === "template",
  },
  {
    id: "dm-draw",
    anchor: toolAnchor("draw"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("draw"),
    placement: "bottom",
    body: `${toolTip("draw")} Click the highlighted button and draw on the map. Right-click erases. The "Players" toggle in its options decides whether players may draw too. Draw a squiggle now.`,
    advanceWhen: strokesGrew,
  },
  {
    id: "dm-pin",
    anchor: toolAnchor("pin"),
    title: toolTitle("pin"),
    placement: "right",
    body: `${toolTip("pin")} Numbered markers with notes — players never see them. Drop one now.`,
    advanceWhen: pinsGrew,
  },
  {
    id: "dm-calibrate",
    anchor: toolAnchor("calibrate"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("calibrate"),
    placement: "bottom",
    body: `${toolTip("calibrate")} For imported map art: click the highlighted button, then drag the grid to move and resize it, or box exactly one map square to set it from scratch. Nudge the grid now — Undo puts it back.`,
    advanceWhen: gridCalibrationChanged,
  },
  {
    id: "dm-fog",
    anchor: toolAnchor("fog"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("fog"),
    placement: "bottom",
    body: `${toolTip("fog")} Click the highlighted button to open its options, flip the Fog switch on, then paint: Reveal clears fog, Cover paints it back — brush, rectangle, or lasso. Turn fog on now.`,
    advanceWhen: (sig) => displayedScene(sig)?.fog.enabled === true,
  },
  {
    id: "dm-walls",
    anchor: toolAnchor("walls"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("walls"),
    placement: "bottom",
    body: `${toolTip("walls")} Click the highlighted button, then click empty space on the map to start a wall run; the Door brush in the options makes segments players can open. Right-click (or press Esc) to end the run. Draw one wall segment now.`,
    advanceWhen: (sig, base) =>
      (displayedScene(sig)?.walls.length ?? 0) > (displayedScene(base)?.walls.length ?? 0),
  },
  {
    id: "dm-lights",
    anchor: toolAnchor("lights"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("lights"),
    placement: "bottom",
    body: `${toolTip("lights")} Click the highlighted button, then pick Candle, Torch, or Lantern in the options and click the map to place one. Drag its rings to resize; double-click to edit color and flicker.`,
    advanceWhen: (sig, base) =>
      (displayedScene(sig)?.lights.length ?? 0) > (displayedScene(base)?.lights.length ?? 0),
  },
  {
    id: "dm-darkness",
    anchor: sel(".map-toolbar-options"),
    title: "Dynamic lighting",
    placement: "right",
    body:
      'Walls and lights come alive when the scene isn\'t "Fully lit". In the options panel to the left, click the "Fully lit" button to switch to Dynamic — Aria has darkvision, and the 👁 Preview shows exactly what her player would see.',
    advanceWhen: (sig) => displayedScene(sig)?.globalIllumination === false,
  },
  {
    id: "dm-undo",
    anchor: selAll('[data-map-action="undo"], [data-map-action="redo"]'),
    title: "Undo / Redo",
    placement: "right",
    body:
      "Made a mess with all that fog and wall practice? The ↶ and ↷ buttons on the rail (or Ctrl+Z / Ctrl+Y) walk your map edits and token moves back and forward.",
  },
  {
    id: "dm-dock",
    anchor: sel(".dock-rail"),
    title: "The dock",
    placement: "left",
    body:
      "The right rail holds every panel. Click a tab to open it docked; the ↗ button pops a panel out into a floating window you can drag anywhere; the chevron collapses the whole thing.",
  },
  {
    id: "dm-log",
    anchor: dockTabAnchor("log"),
    title: "Log (chat)",
    placement: "left",
    body:
      "Dice rolls and table chat. Click the Log tab to open it. The To: menu whispers privately, and on roll entries you can apply damage straight to a character's sheet — resistances handled.",
    before: (a) => a.setDockTab("log"),
  },
  {
    id: "dm-actors",
    anchor: dockTabAnchor("actors"),
    title: "Actors",
    placement: "left",
    body:
      "NPCs and monsters — drag onto the map. Click the Actors tab, then drag the Goblin Skirmisher out onto the board — one stat block can drive any number of tokens.",
    before: (a) => a.setDockTab("actors"),
    advanceWhen: (sig, base) => sig.state.tokens.length > base.state.tokens.length,
  },
  {
    id: "dm-npc-sheet",
    anchor: sel('[data-window-id="sheet:tut-npc-barkeep"]'),
    title: "NPC vs PC sheets",
    placement: "bottom",
    body:
      "This is Old Toby's sheet. NPC sheets start fully hidden from players — the eye toggles reveal them section by section as the party learns things. PC sheets are always fully visible.",
    before: (a) => a.openSheet("tut-npc-barkeep"),
  },
  {
    id: "dm-items",
    anchor: dockTabAnchor("items"),
    title: "Items",
    placement: "left",
    body:
      "Item library — click the Items tab. Drag items onto the map to drop loot the party can find; double-click to open its Item Sheet and edit it.",
    before: (a) => {
      a.closeWindows();
      a.setDockTab("items");
    },
  },
  {
    id: "dm-party",
    anchor: dockTabAnchor("party"),
    title: "Party",
    placement: "left",
    body:
      "Click the Party tab. The player characters at a glance — HP, AC, and passive stats for the whole party. Your mid-session dashboard.",
    before: (a) => a.setDockTab("party"),
  },
  {
    id: "dm-handouts",
    anchor: dockTabAnchor("handouts"),
    title: "Handouts",
    placement: "left",
    body:
      'Click the Handouts tab. Share images with the table — there\'s a "Barkeep\'s ledger" waiting here. Show it to All and it pops onto every player\'s screen. Granted handouts stay reopenable for them.',
    before: (a) => a.setDockTab("handouts"),
  },
  {
    id: "dm-homebrew",
    anchor: dockTabAnchor("homebrew"),
    title: "Homebrew",
    placement: "left",
    body:
      "Click the Homebrew tab. Custom monsters, spells, and items — anything you create here joins the compendium pickers everywhere, and NPC sheets can be published as reusable statblocks.",
    before: (a) => a.setDockTab("homebrew"),
  },
  {
    id: "dm-notes",
    anchor: dockTabAnchor("notes"),
    title: "DM Notes",
    placement: "left",
    body:
      "Click the Notes tab. Private notes only you can see — synced with the room, not this device, so your prep follows the campaign wherever you log in.",
    before: (a) => a.setDockTab("notes"),
  },
  {
    id: "dm-dice",
    anchor: sel(".dice-tray"),
    title: "Dice tray",
    placement: "top",
    body:
      "Click the d20 to ready it, then drag it out of the tray and let go to throw — or type an expression like 2d6+3. The 🔒 makes your rolls secret: players see the throw but not the result. Roll something now.",
    before: (a) => {
      a.closeWindows();
      a.setTrayOpen(true);
    },
    advanceWhen: rolledSinceBaseline,
  },
  {
    id: "dm-scene-switch",
    anchor: dockTabAnchor("scenes"),
    title: "Scenes panel",
    placement: "left",
    body:
      "Click the Scenes tab. Build and switch battle maps. Activate the Dungeon now — activating a scene pulls the whole table to it. The 👁 toggle instead lets players peek at a scene without moving anyone.",
    before: (a) => a.setDockTab("scenes"),
    advanceWhen: (sig) => sig.state.activeSceneId === "scene-1",
  },
  {
    id: "dm-combat-start",
    anchor: dockTabAnchor("initiative"),
    title: "Start combat",
    placement: "left",
    body:
      "Click the Combat tab. Initiative order and turn tracking. Two goblins are lurking in this dungeon. Hit Start combat — everyone joins the order unrolled, and d20 throws fill in initiative.",
    before: (a) => a.setDockTab("initiative"),
    advanceWhen: (sig) => sig.state.combat !== null,
  },
  {
    id: "dm-combat-turn",
    anchor: unionDockAnchor("initiative"),
    title: "Run the round",
    placement: "left",
    body:
      "Roll initiative for the NPCs — any d20 you throw fills the next unrolled NPC — then advance the fight with Next turn. The active combatant is highlighted for everyone.",
    before: (a) => a.setDockTab("initiative"),
    advanceWhen: (sig, base) =>
      sig.state.combat !== null &&
      base.state.combat !== null &&
      (sig.state.combat.round !== base.state.combat.round ||
        sig.state.combat.turnIndex !== base.state.combat.turnIndex),
  },
  {
    id: "dm-combat-end",
    anchor: unionDockAnchor("initiative"),
    title: "End combat",
    placement: "left",
    body: "When the last goblin drops, End combat clears the tracker for everyone.",
    before: (a) => a.setDockTab("initiative"),
    advanceWhen: (sig, base) => base.state.combat !== null && sig.state.combat === null,
  },
  {
    id: "dm-pages-players",
    anchor: sel('.page-switcher [data-page-id="players"]'),
    title: "Prep pages: Players",
    placement: "bottom",
    body:
      'The top-left switcher opens your between-session workspaces. Click Players: that\'s where character slots live — the "Aria Brightblade" seat you\'ve been touring with was made there, and + Add player creates a new seat with a fresh sheet.',
    advanceWhen: (sig) => sig.page === "players",
  },
  {
    id: "dm-pages-npcs",
    anchor: sel('.page-switcher--inline [data-page-id="npcs"]'),
    title: "NPCs page",
    placement: "bottom",
    body:
      "A full-screen NPC workshop — the same sheets as the Actors tab, with folders and room to edit several side by side. Click NPCs to peek.",
    advanceWhen: (sig) => sig.page === "npcs",
  },
  {
    id: "dm-pages-items",
    anchor: sel('[data-page-id="items"]'),
    title: "Items page",
    placement: "bottom",
    body:
      "Item authoring at full size — same catalog as the Items tab, several item sheets open at once. Click Items.",
    advanceWhen: (sig) => sig.page === "items",
  },
  {
    id: "dm-pages-scenes",
    anchor: sel('[data-page-id="scenes"]'),
    title: "Scenes page",
    placement: "bottom",
    body:
      "Scenes is where maps are built: upload art, calibrate the grid, set fog defaults, player visibility, and activate scenes. Click Scenes to look around.",
    advanceWhen: (sig) => sig.page === "scenes",
  },
  {
    id: "dm-pages-assets",
    anchor: sel('[data-page-id="assets"]'),
    title: "Assets page",
    placement: "bottom",
    body:
      "Every image this campaign has uploaded — map art, portraits, handouts. A central library you can browse, rename, or clean up. Click Assets.",
    advanceWhen: (sig) => sig.page === "assets",
  },
  {
    id: "dm-settings",
    anchor: dockActionAnchor("settings"),
    title: "Settings (S)",
    placement: "left",
    body:
      "Back on the board: the gear at the bottom of the dock opens Settings — theme, hover tooltips, a Keybinds page to remap every shortcut, and a table-look override that restyles the app for every player at once. Open it.",
    before: (a) => a.setPage("board"),
    advanceWhen: (sig) => sig.settingsOpen,
  },
  {
    id: "dm-finish",
    anchor: center,
    title: "Ready to run a game",
    body:
      "That's the whole DM kit: board, tools, panels, prep pages. Finish returns you to the lobby — create a real campaign with + New, add player slots on the Players page, and take your seat at the table.",
  },
];
