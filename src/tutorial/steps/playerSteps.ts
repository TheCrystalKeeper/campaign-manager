import {
  center,
  dockActionAnchor,
  dockTabAnchor,
  domExists,
  rolledSinceBaseline,
  sel,
  sheetOpened,
  sheetPageAnchor,
  strokesGrew,
  tokenAnchor,
  toolAnchor,
  viewportMoved,
  type TutorialSignals,
  type TutorialStep,
} from "../types";
import { toolTip, toolTitle } from "./registryCopy";

function heroConditions(sig: TutorialSignals): string {
  return sig.state.tokens
    .filter((token) => token.ownerPlayerId === "hero")
    .map((token) => token.conditions.join(","))
    .join("|");
}

export const PLAYER_STEPS: TutorialStep[] = [
  {
    id: "pl-welcome",
    anchor: center,
    title: "Welcome, adventurer",
    body:
      "This is a practice table — you're playing Aria Brightblade, an Eldritch Knight (a fighter who knows a little magic). Click everything; nothing here is saved. Everything stays clickable throughout the tour.",
  },
  {
    id: "pl-board",
    anchor: center,
    title: "The board",
    body:
      "You're in the Sample Tavern. Drag to pan and scroll to zoom — your camera is yours alone; the Dungeon Master can't yank it around. Move the view now.",
    advanceWhen: viewportMoved,
  },
  {
    id: "pl-avatar-strip",
    anchor: sel(".avatar-strip"),
    title: "The table",
    placement: "bottom",
    body:
      "The chips up top are the party and any NPCs the DM lets you see, with live HP bars. Double-click your own chip to open your sheet — try it.",
    advanceWhen: sheetOpened,
  },
  {
    id: "pl-select",
    anchor: tokenAnchor("tut-token-hero"),
    title: toolTitle("select"),
    body: `${toolTip("select")} It's the default tool. Click Aria's token (highlighted here) to select her — you'll see a selection ring appear on the board.`,
    before: (a) => a.closeWindows(),
    advanceWhen: (sig) => sig.selectedTokenIds.includes("tut-token-hero"),
  },
  {
    id: "pl-move",
    anchor: tokenAnchor("tut-token-hero"),
    title: "Move your hero",
    body:
      "Drag Aria to another square. Everyone at the table sees your move live — in a real game this is how you take your turn's movement.",
    advanceWhen: (sig, base) => sig.tokenMoves > base.tokenMoves,
  },
  {
    id: "pl-measure",
    anchor: toolAnchor("measure"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("measure"),
    placement: "bottom",
    body: `${toolTip("measure")} Aria walks 30 feet per turn — click the highlighted button, then drag from her token to check a move before you commit.`,
    advanceWhen: (sig) => sig.activeToolId === "measure",
  },
  {
    id: "pl-template",
    anchor: toolAnchor("template"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("template"),
    placement: "bottom",
    body: `${toolTip("template")} Show the table where your Burning Hands cone lands before you cast it. Click the highlighted button — an options panel will appear with shape choices. Pick a shape and drag on the map.`,
    advanceWhen: (sig) => sig.activeToolId === "template",
  },
  {
    id: "pl-draw",
    anchor: toolAnchor("draw"),
    popoverAnchor: sel(".map-toolbar"),
    title: toolTitle("draw"),
    placement: "bottom",
    body: `${toolTip("draw")} Sketch a plan on the map — player strokes fade after a few seconds. (The DM can switch player drawing off; it's on at this table.) Click the highlighted button and draw something now.`,
    advanceWhen: strokesGrew,
  },
  {
    id: "pl-sheet-open",
    anchor: dockActionAnchor("sheet"),
    title: "Your character sheet",
    placement: "left",
    body: "Click the card button at the top of the right rail to open Aria's sheet.",
    advanceWhen: (sig) => sig.openSheetIds.includes("hero"),
  },
  {
    id: "pl-sheet-rolls",
    anchor: sel('[data-window-id="sheet:hero"]'),
    title: "Roll from the sheet",
    placement: "bottom",
    body:
      "Click any ability modifier, saving throw, or skill to roll it with your bonuses applied. Shift-click rolls with advantage (roll twice, keep the best), Alt-click with disadvantage. Try one now.",
    before: (a) => a.openSheet("hero"),
    advanceWhen: rolledSinceBaseline,
  },
  {
    id: "pl-sheet-hp",
    anchor: sel(".death-saves"),
    popoverAnchor: sel('[data-window-id="sheet:hero"]'),
    title: "HP, rests & death saves",
    placement: "bottom",
    body:
      "Step your hit points up and down at the top of the sheet. Short and Long rest buttons spend hit dice and restore spell slots for you. The highlighted Death Save tracker (the skull with pip slots) is in the left sidebar — use it when you drop to 0 HP.",
    before: (a) => a.openSheet("hero"),
  },
  {
    id: "pl-conditions",
    anchor: sel(".conditions-section"),
    popoverAnchor: sel('[data-window-id="sheet:hero"]'),
    title: "Conditions",
    placement: "bottom",
    body:
      "We've opened the Effects page for you. The highlighted Conditions grid shows status effects like Prone or Poisoned — toggle one now. It badges your token for the whole table, and some auto-apply advantage or disadvantage to your rolls.",
    before: (a) => {
      a.openSheet("hero");
      // Navigate to the Effects page so the conditions grid is visible.
      setTimeout(() => {
        const railBtn = document.querySelector<HTMLButtonElement>('[data-sheet-page="effects"]');
        if (railBtn && !railBtn.classList.contains("sheet-rail-btn--active")) railBtn.click();
      }, 300);
    },
    advanceWhen: (sig, base) => heroConditions(sig) !== heroConditions(base),
  },
  {
    id: "pl-sheet-inventory",
    anchor: sheetPageAnchor("inventory"),
    title: "Inventory page",
    placement: "right",
    body:
      "Click the Inventory button on the sheet rail. This page holds your gear, coin purse, carry weight, and attunement slots.",
    before: (a) => a.openSheet("hero"),
    advanceWhenDom: () => domExists('.sheet-rail-btn--active[data-sheet-page="inventory"]'),
  },
  {
    id: "pl-sheet-potion",
    anchor: sel('[data-row-id="tut-inv-potion"]'),
    popoverAnchor: sel('[data-window-id="sheet:hero"]'),
    title: "Item charges",
    placement: "bottom",
    body:
      "Find the Potion of Healing row (under Consumables) and click the ▾ arrow to expand it. Inside you'll see a Charges counter and a ▶ button — that's how you spend a charge.",
    advanceWhenDom: () => domExists('[data-row-id="tut-inv-potion"] .inv-expand'),
  },
  {
    id: "pl-sheet-features",
    anchor: sheetPageAnchor("features"),
    title: "Features page",
    placement: "right",
    body:
      "Your class and species abilities, with limited uses tracked — Aria's Second Wind and Action Surge recharge on a rest automatically. Open Features.",
    before: (a) => a.openSheet("hero"),
    advanceWhenDom: () => domExists('.sheet-rail-btn--active[data-sheet-page="features"]'),
  },
  {
    id: "pl-sheet-spells",
    anchor: sheetPageAnchor("spells"),
    title: "Spells page",
    placement: "right",
    body:
      "Aria's Eldritch Knight magic: cantrips, known spells, and spell-slot pips. Open Spells and cast Magic Missile — casting ticks a slot down; a long rest refills it.",
    before: (a) => a.openSheet("hero"),
    advanceWhenDom: () => domExists('.sheet-rail-btn--active[data-sheet-page="spells"]'),
  },
  {
    id: "pl-sheet-bio",
    anchor: sheetPageAnchor("biography"),
    title: "Biography & more",
    placement: "right",
    body:
      "Backstory, appearance, and portrait live on Biography; the Effects and Special traits pages hold buffs and feats. It's all yours to edit any time. Open Biography.",
    before: (a) => a.openSheet("hero"),
    advanceWhenDom: () => domExists('.sheet-rail-btn--active[data-sheet-page="biography"]'),
  },
  {
    id: "pl-inventory-panel",
    anchor: dockTabAnchor("inventory"),
    title: "Inventory tab",
    placement: "left",
    body:
      "Click the Inventory tab on the right rail. Same inventory as your sheet's page, docked in the sidebar — the two edit identical data, which is handy mid-combat.",
    before: (a) => a.setDockTab("inventory"),
  },
  {
    id: "pl-dice-ready",
    anchor: sel(".dice-tray .die-btn.btn-crystal"),
    title: "Dice tray",
    placement: "top",
    body:
      "Click dice to ready them — stack a d20 with a d4 if you like — then drag them out of the tray and let go to throw. Right-click a readied die to put it back. Roll something now.",
    before: (a) => {
      a.closeWindows();
      a.setTrayOpen(true);
    },
    advanceWhen: rolledSinceBaseline,
  },
  {
    id: "pl-dice-expr",
    anchor: sel(".dice-tray-expr"),
    title: "Roll expressions",
    placement: "top",
    body:
      "Type an expression like 2d6+3 and press Enter. (Advantage lives on the sheet via Shift/Alt-click; secret rolls are a DM-only power.)",
    advanceWhen: rolledSinceBaseline,
  },
  {
    id: "pl-dice-skins",
    anchor: sel('[aria-label="Dice skins"]'),
    title: "Dice skins",
    placement: "right",
    body:
      "The palette button restyles your dice, coin, and tray — per die or all at once. Your look is saved on this device.",
  },
  {
    id: "pl-log",
    anchor: dockTabAnchor("log"),
    title: "Log & chat",
    placement: "left",
    body:
      "Click the Log tab. Dice rolls and table chat — every roll lands here with its full breakdown, and the text box is the table chat. Say hello if you like.",
    before: (a) => a.setDockTab("log"),
  },
  {
    id: "pl-whisper",
    anchor: sel(".whisper-anchor"),
    title: "Whispers",
    placement: "left",
    body:
      "The To: menu next to the chat box sends privately — only the DM (or the player you pick) sees it. No DM is seated in this sandbox, but the menu works the same at a real table.",
    before: (a) => a.setDockTab("log"),
    informational: true,
  },
  {
    id: "pl-handouts",
    anchor: dockTabAnchor("handouts"),
    title: "Handouts",
    placement: "left",
    body:
      'Click the Handouts tab. In a real game the DM pops images onto your screen; anything shared stays here to re-open. Open the "Tattered dungeon map" now.',
    before: (a) => a.setDockTab("handouts"),
    advanceWhen: (sig) => sig.openHandoutIds.includes("tut-handout-map"),
  },
  {
    id: "pl-combat",
    anchor: dockTabAnchor("initiative"),
    title: "Combat",
    placement: "left",
    body:
      "Click the Combat tab. When the DM starts combat, this tracker pops open, your tray's d20 glows, and any d20 you throw sets your initiative (turn order). Your turn is highlighted for everyone. Only the DM can start it, so this one's a look-ahead.",
    before: (a) => a.setDockTab("initiative"),
    informational: true,
  },
  {
    id: "pl-scenes",
    anchor: sel(".scene-switcher"),
    title: "Other scenes",
    placement: "bottom",
    body:
      "The DM has opened the Dungeon for viewing — this strip lets you peek at it while the table stays in the Tavern. Click Dungeon, look around, and Return brings you back to the live scene.",
    before: (a) => a.closeWindows(),
    advanceWhen: (sig, base) => sig.displayedSceneId !== base.displayedSceneId,
  },
  {
    id: "pl-stats",
    anchor: sel('[data-page-id="stats"]'),
    title: "Stats page",
    placement: "bottom",
    body:
      "In the top-left corner you'll see Board and Stats buttons. Click Stats — it shows the table's roll history: distributions, hot streaks, and luck by player. The DM chooses whether players can see this; it's on at this table.",
    before: (a) => a.setPage("board"),
    advanceWhen: (sig) => sig.page === "stats",
  },
  {
    id: "pl-settings",
    anchor: dockActionAnchor("settings"),
    title: "Settings (S)",
    placement: "left",
    body:
      "Back on the board: the gear at the bottom of the dock holds day/night theme, accent colors, hover tooltips, 3D dice, and a Keybinds page to remap every shortcut. Open it.",
    before: (a) => a.setPage("board"),
    advanceWhen: (sig) => sig.settingsOpen,
  },
  {
    id: "pl-finish",
    anchor: center,
    title: "Go find a table",
    body:
      "That's the full player kit: move, measure, roll, and run your sheet. Finish returns you to the lobby — pick a campaign, claim a character slot, and play for real.",
  },
];
