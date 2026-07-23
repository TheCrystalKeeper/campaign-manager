import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JoinScreen } from "./components/JoinScreen";
import { MapCanvas } from "./components/MapCanvas";
import { FloatingCluster } from "./components/FloatingCluster";
import { FloatingWindow } from "./components/FloatingWindow";
import { Dock, type DockAction } from "./components/Dock";
import { ConfirmDeleteHost, CONFIRM_DELETES_KEY } from "./components/ConfirmDeleteDialog";
import { ConfirmActionHost } from "./components/ConfirmActionDialog";
import { DiceTray } from "./components/DiceTray";
import { HandoutViewer } from "./components/HandoutsPanel";
import { LogToasts } from "./components/LogToasts";
import { SceneSwitcher } from "./components/SceneSwitcher";
import { TokenEditor } from "./components/TokenEditor";
import { MultiTokenEditor } from "./components/MultiTokenEditor";
import { CroppableImage } from "./components/CroppableImage";
import { dockPanelsForRole, PANELS, type PanelContext, type PanelId, type SettingsView } from "./panels/registry";
import { PlayersPage } from "./pages/PlayersPage";
import { NpcsPage } from "./pages/NpcsPage";
import { ItemsPage } from "./pages/ItemsPage";
import { ScenesPage } from "./pages/ScenesPage";
import { AssetsPage } from "./pages/AssetsPage";
import { DM_PAGES, PLAYER_PAGES, PageSwitcher, type PageId } from "./pages/PageSwitcher";
import { StatsPage } from "./pages/StatsPage";
import { useDiceOverlay } from "./dice/useDiceOverlay";
import { useDmActions, useGameRoom, type JoinParams } from "./hooks/useGameRoom";
import { buildHomebrewContext, HomebrewProvider } from "./hooks/useHomebrew";
import { buildInverse, useHistory } from "./lib/history";
import { readLocalFlag, writeLocalFlag } from "./lib/localFlags";
import { Dices, IdCard, Settings, X } from "lucide-react";
import { UI_ACCENTS, type UiAccent } from "./lib/types";
import {
  clearCampaignLayout,
  readCampaignFlag,
  readCampaignJson,
  writeCampaignFlag,
  writeCampaignJson,
} from "./lib/campaignStore";
import { useSpaceClick } from "./lib/useSpaceClick";
import { useKeybinds } from "./lib/useKeybinds";
import { matchesBinding } from "./lib/keybinds";
import { fitViewportToScene, prefetchImage } from "./lib/sceneUtils";
import { setOptimizeUploads as applyOptimizeUploads } from "./lib/uploadAsset";
import { LoadingScreen } from "./components/LoadingScreen";
import {
  DEFAULT_ICON_CROP,
  DEFAULT_VIEWPORT,
  type GameState,
  type HitPoints,
  type IconCrop,
  type Viewport,
} from "./lib/types";
import { actorToken, itemToken } from "./lib/tokenFactory";

import { applyRenderPixelRatio } from "./lib/renderQuality";

type SessionParams = JoinParams & { roomId: string };

const SNAP_KEY = "cm-map-snap";
const TOASTS_KEY = "cm-log-toasts";
const SPACE_CLICK_KEY = "cm-space-click";
const TOKEN_PANEL_KEY = "cm-token-panel-on-click";
const CLOSE_TOKEN_WITH_SHEET_KEY = "cm-close-token-with-sheet";
const CLOSE_SETTINGS_ON_CLICK_OFF_KEY = "cm-close-settings-on-click-off";
const OPTIMIZE_UPLOADS_KEY = "cm-optimize-uploads";
const LIVE_DRAGS_KEY = "cm-live-drags";
const HI_RES_KEY = "cm-hi-res";
const NIGHT_KEY = "cm-night-mode";
const ACCENT_KEY = "cm-ui-accent";

/** Sentinel entry in the open-sheets list: the DM's "pick a character" placeholder window
 *  (opened from the dock button before a specific sheet has been chosen). */
const SHEET_PICKER = "__sheet_picker__";

function readStoredAccent(): UiAccent {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    return UI_ACCENTS.includes(raw as UiAccent) ? (raw as UiAccent) : "sky";
  } catch {
    return "sky";
  }
}

/** The per-campaign UI layout blob (localStorage `cm:{roomId}:layout`). Entity-bound windows
 *  (open sheet/item) and transient state (selection, viewport) are deliberately excluded. */
type StoredLayout = {
  dockOpen: boolean;
  dockTab: PanelId;
  popped: PanelId[];
  trayOpen: boolean;
  page: PageId;
  settingsOpen: boolean;
};
const DEFAULT_LAYOUT: StoredLayout = {
  dockOpen: true,
  dockTab: "log",
  popped: [],
  trayOpen: true,
  page: "board",
  settingsOpen: false,
};

/** True when a keyboard event targets an editable field (so shortcuts stand down). */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** A player/NPC chip avatar: the portrait — cropped to the same focal point/zoom the user set
 *  on the sheet — falling back to the name's capitalized initial when it's missing or fails to
 *  load (e.g. the image was deleted). */
function ChipAvatar({
  src,
  crop,
  name,
}: {
  src: string | null | undefined;
  crop?: IconCrop;
  name: string;
}) {
  const initial = <span className="player-initial">{name.slice(0, 1).toUpperCase() || "?"}</span>;
  return src ? (
    <CroppableImage className="chip-avatar" src={src} crop={crop ?? DEFAULT_ICON_CROP} alt={name} fallback={initial} />
  ) : (
    initial
  );
}

/** The tiny HP bar under an avatar chip: fill green → gold → terracotta as health drops. */
function ChipHpBar({ hp }: { hp: HitPoints }) {
  const ratio = hp.max > 0 ? Math.max(0, Math.min(1, hp.current / hp.max)) : 0;
  const tone = ratio > 0.5 ? "high" : ratio > 0.25 ? "mid" : "low";
  return (
    <div className={`chip-hp chip-hp--${tone}`}>
      <div className="chip-hp-fill" style={{ width: `${ratio * 100}%` }} />
      <span className="chip-hp-text">
        {hp.current}/{hp.max}
      </span>
    </div>
  );
}

/// <summary>
/// Root shell: lobby (join flow) or the in-campaign view — a full-bleed map, a
/// FoundryVTT-style docked sidebar of panel tabs (each pop-out-able into a
/// floating window), floating character-sheet windows, and (DM only) the
/// top-left page switcher to the Players/NPCs/Scenes prep pages.
/// </summary>
export default function App() {
  const [session, setSession] = useState<SessionParams | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  // Board token selection (DM multi-select capable): [] = none, [id] = the single-token
  // editor, 2+ = the bulk MultiTokenEditor. Ids only — tokens are re-derived from state
  // every render so deletions/undo prune the selection automatically.
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<PanelId>("log");
  const [popped, setPopped] = useState<PanelId[]>([]);
  // Character-sheet windows currently open (one FloatingWindow each). Ordered by open time;
  // may include the SHEET_PICKER sentinel (the DM's "pick a character" placeholder).
  const [openSheetIds, setOpenSheetIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Settings window's current page: the main list vs the Keybinds sub-page. Reset to "main"
  // whenever the window closes so reopening always lands on the main settings.
  const [settingsView, setSettingsView] = useState<SettingsView>("main");
  // Live keyboard-shortcut map (undo/redo, S = Settings, …). Identity changes on rebind, so the
  // keydown effects below re-attach with the new chords.
  const keybinds = useKeybinds();
  // Item-sheet windows currently open (DM-only), one FloatingWindow each, ordered by open time.
  const [openItemIds, setOpenItemIds] = useState<string[]>([]);
  // Handout viewer windows currently open, one FloatingWindow each, ordered by open time.
  const [openHandoutIds, setOpenHandoutIds] = useState<string[]>([]);
  /**
   * Last HANDOUT_SHOW payload per handout id. The push carries name+URL because it can
   * arrive BEFORE the STATE frame that grants visibility (broadcastState persists first) —
   * the viewer falls back to this until state.handouts catches up.
   */
  const handoutPushRef = useRef<Map<string, { name: string; imageUrl: string | null }>>(new Map());
  const [secretRolls, setSecretRolls] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const [page, setPage] = useState<PageId>("board");
  const [snap, setSnap] = useState(() => readLocalFlag(SNAP_KEY, false));
  const [toastsEnabled, setToastsEnabledState] = useState(() => readLocalFlag(TOASTS_KEY, true));
  const [spaceClick, setSpaceClickState] = useState(() => readLocalFlag(SPACE_CLICK_KEY, false));
  const [tokenPanelOnClick, setTokenPanelOnClickState] = useState(() => readLocalFlag(TOKEN_PANEL_KEY, true));
  const [closeTokenWithSheet, setCloseTokenWithSheetState] = useState(() => readLocalFlag(CLOSE_TOKEN_WITH_SHEET_KEY, true));
  const [closeSettingsOnClickOff, setCloseSettingsOnClickOffState] = useState(() => readLocalFlag(CLOSE_SETTINGS_ON_CLICK_OFF_KEY, false));
  const [optimizeUploads, setOptimizeUploadsState] = useState(() => readLocalFlag(OPTIMIZE_UPLOADS_KEY, true));
  const [showLiveDrags, setShowLiveDragsState] = useState(() => readLocalFlag(LIVE_DRAGS_KEY, true));
  const [hiResRender, setHiResRenderState] = useState(() => readLocalFlag(HI_RES_KEY, true));
  const [nightMode, setNightModeState] = useState(() => readLocalFlag(NIGHT_KEY, false));
  const [accent, setAccentState] = useState<UiAccent>(() => readStoredAccent());
  const [confirmDeletes, setConfirmDeletesState] = useState(() =>
    readLocalFlag(CONFIRM_DELETES_KEY, true),
  );
  /** Bumped by "Reset UI layout" — remounts windows / repositions the tray. */
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const lastSceneRef = useRef<string | null>(null);
  /** roomId whose saved layout has been restored (once per join) — nulled on leave. */
  const restoredRoomRef = useRef<string | null>(null);

  const roomId = session?.roomId ?? null;
  const room = useGameRoom(roomId);
  const dice = useDiceOverlay(room, roomId);
  const { state, yourRole, status, error } = room;
  const isDm = yourRole === "dm";

  // Player multi-scene viewing (Phase B): which scene THIS client displays. null = follow
  // the live scene. Client-local by design — never part of GameState, so each player can
  // look at a different opened scene. Self-heals: if the viewed scene stops being visible
  // (removed, or the DM closes it), redacted state no longer carries it and the guard
  // below falls back to the live scene.
  const [viewingSceneId, setViewingSceneId] = useState<string | null>(null);
  const displayedSceneId =
    viewingSceneId && state?.scenes.some((scene) => scene.id === viewingSceneId)
      ? viewingSceneId
      : (state?.activeSceneId ?? null);

  // The DM activating a scene pulls everyone to it (Foundry semantics): drop any local
  // side-viewing so the scene-fit effect lands this client on the new live scene.
  const activeSceneId = state?.activeSceneId ?? null;
  useEffect(() => {
    setViewingSceneId(null);
  }, [activeSceneId]);

  // Scene switch: clear a MULTI-selection (a surviving one would make "Delete N tokens" a
  // cross-scene foot-gun). A single selection survives, matching today's behavior of the
  // token editor staying open across scene changes.
  const prevSceneRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSceneRef.current !== null && prevSceneRef.current !== displayedSceneId) {
      setSelectedTokenIds((current) => (current.length >= 2 ? [] : current));
    }
    prevSceneRef.current = displayedSceneId;
  }, [displayedSceneId]);

  // Players get at most two pages: the Board and — only when the DM has enabled it —
  // the Stats page. Everything else (the DM prep pages, or Stats while it's disabled
  // for players) clamps back to the board, so flipping the switch off mid-view pushes
  // any player who was on Stats straight back to the board.
  const activePage: PageId =
    isDm ? page : page === "stats" && state?.playersCanSeeStats ? "stats" : "board";
  const onBoard = activePage === "board";

  // Highlight the tray's d20 while this client still owes initiative rolls: a player for
  // their own entry, the DM while any NPC is unrolled (a free d20 fills the next NPC).
  // Any d20 they throw counts for initiative; other dice don't.
  const initiativePending =
    !!state?.combat &&
    state.combat.entries.some((entry) => {
      if (entry.initiative !== null) {
        return false;
      }
      const token = state?.tokens.find((item) => item.id === entry.tokenId);
      if (isDm) {
        return !token?.ownerPlayerId;
      }
      return token?.ownerPlayerId === room.yourPlayerId || entry.sheetId === room.yourPlayerId;
    });

  // DM undo/redo for map edits + tokens. `historySend` wraps room.send: it records the
  // inverse of each tracked mutation, then forwards. All DM mutations that should be
  // undoable (dm actions, board map edits, token moves) go through it.
  const history = useHistory();
  const stateRef = useRef<typeof state>(state);
  stateRef.current = state;
  const roomSend = room.send;
  const recordEdit = history.record;
  const historySend = useCallback(
    (message: Parameters<typeof roomSend>[0]) => {
      if (stateRef.current) {
        const inverse = buildInverse(stateRef.current, message);
        if (inverse) {
          recordEdit({ send: roomSend, undo: inverse.undo, redo: inverse.redo });
        }
      }
      roomSend(message);
    },
    [roomSend, recordEdit],
  );
  const dmRoom = useMemo(() => ({ ...room, send: historySend }), [room, historySend]);
  const dm = useDmActions(dmRoom);

  // Feed the dice overlay this client's live viewport and the DM secret toggle.
  const setDiceProjection = dice.setProjection;
  useEffect(() => {
    setDiceProjection(viewport);
  }, [viewport, setDiceProjection]);

  // Thrown dice stay inside the visible map: window edges (with breathing room) minus
  // the dock column and the open tray drawer. Measured fresh at each throw, so dock
  // open/close and the tray drawer need no state wiring here.
  const setDiceSafeArea = dice.setSafeAreaProvider;
  useEffect(() => {
    const margin = 24;
    setDiceSafeArea(() => {
      const insets = { top: margin, right: margin, bottom: margin, left: margin };
      const dock = document.querySelector(".dock")?.getBoundingClientRect();
      if (dock) {
        insets.right = Math.max(insets.right, window.innerWidth - dock.left + 8);
      }
      const tray = document.querySelector(".dice-tray--open")?.getBoundingClientRect();
      if (tray) {
        insets.bottom = Math.max(insets.bottom, window.innerHeight - tray.top + 8);
      }
      return insets;
    });
    return () => setDiceSafeArea(null);
  }, [setDiceSafeArea]);
  const setDiceSecret = dice.setSecret;
  useEffect(() => {
    setDiceSecret(isDm && secretRolls);
  }, [isDm, secretRolls, setDiceSecret]);

  // Close viewers whose handout this client may no longer see. The push payload only
  // bridges the gap until the granting STATE frame lands (SHOW always grants first, and
  // frames are FIFO, so the next STATE after a push carries the handout) — once state
  // confirms it, drop the payload so state is authoritative: the DM un-ticking a player
  // (or deleting the handout) then closes that player's open popup on the very next
  // frame. Bail out unchanged so ordinary STATE frames don't churn renders.
  const roomState = room.state;
  useEffect(() => {
    if (!roomState) {
      return;
    }
    for (const id of [...handoutPushRef.current.keys()]) {
      if (roomState.handouts.some((handout) => handout.id === id)) {
        handoutPushRef.current.delete(id);
      }
    }
    setOpenHandoutIds((current) => {
      const next = current.filter(
        (id) =>
          roomState.handouts.some((handout) => handout.id === id) ||
          handoutPushRef.current.has(id),
      );
      return next.length === current.length ? current : next;
    });
  }, [roomState]);

  // DM "show handout" pushes: pop the floating viewer immediately (players only receive
  // pushes aimed at them — the server targets connections). Re-showing an open handout
  // is a no-op; the window is already up.
  const subscribeHandout = room.subscribeHandout;
  useEffect(() => {
    return subscribeHandout((event) => {
      handoutPushRef.current.set(event.handout.id, {
        name: event.handout.name,
        imageUrl: event.handout.imageUrl,
      });
      setOpenHandoutIds((current) =>
        current.includes(event.handout.id) ? current : [...current, event.handout.id],
      );
    });
  }, [subscribeHandout]);

  useEffect(() => {
    if (!session) {
      return;
    }
    room.join(
      session.role === "dm"
        ? { role: "dm", displayName: session.displayName, roomKey: session.roomKey }
        : { role: "player", slotId: session.slotId, roomKey: session.roomKey },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Combat pulls the tracker forward when it starts (unless it's popped out) —
  // and pulls the DM back to the Board from any prep page.
  const combatActive = Boolean(state?.combat);
  useEffect(() => {
    if (status !== "joined") {
      return;
    }
    if (combatActive) {
      setPage("board");
      setPopped((current) => {
        if (!current.includes("initiative")) {
          setDockTab("initiative");
          setDockOpen(true);
        }
        return current;
      });
    } else {
      setDockTab((current) => (current === "initiative" ? "log" : current));
    }
  }, [combatActive, status]);

  // In-game errors surface as a transient banner, never a screen change.
  const clearError = room.clearError;
  useEffect(() => {
    if (error && status === "joined") {
      const timer = setTimeout(clearError, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, status, clearError]);

  // Each client owns its own local viewport; fit the view when the DISPLAYED scene
  // changes — the live scene going live, or this player switching to an opened scene.
  useEffect(() => {
    if (!state) {
      return;
    }
    const scene = state.scenes.find((item) => item.id === displayedSceneId);
    if (!scene || lastSceneRef.current === scene.id) {
      return;
    }
    lastSceneRef.current = scene.id;
    // Undo history is scene-scoped — switching the displayed scene starts fresh.
    history.reset();
    const fitted = fitViewportToScene(scene, window.innerWidth, window.innerHeight);
    setViewport(fitted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedSceneId, status]);

  // Each client owns its own camera: players never adopt the DM's (or any other client's)
  // viewport. This is what keeps a token move — or the DM panning — from yanking a player's
  // pan/zoom. Initial framing on join and on scene switch is handled by the scene-fit effect
  // above, which fits the map to *this* client's own window.

  // DM undo/redo shortcuts (board only; ignored while typing).
  const historyUndo = history.undo;
  const historyRedo = history.redo;
  useEffect(() => {
    if (!isDm || !onBoard) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      // Ctrl/Cmd+Y stays a fixed alternate redo alongside the rebindable Redo chord.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        historyRedo();
        return;
      }
      if (matchesBinding(event, keybinds.redo)) {
        event.preventDefault();
        historyRedo();
      } else if (matchesBinding(event, keybinds.undo)) {
        event.preventDefault();
        historyUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDm, onBoard, historyUndo, historyRedo, keybinds]);

  // 'S' toggles the Settings window (board only; ignored while typing or with a modifier held).
  useEffect(() => {
    if (!onBoard) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || !matchesBinding(event, keybinds.toggleSettings)) {
        return;
      }
      event.preventDefault();
      setSettingsOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBoard, keybinds]);

  // Opt-in: a pointer-down anywhere outside the open Settings window (except its dock toggle)
  // closes it — click-off-to-dismiss. Off by default; the ⚙ toggle stays available.
  useEffect(() => {
    if (!onBoard || !settingsOpen || !closeSettingsOnClickOff) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        target.closest('[data-window-id="settings"]') ||
        target.closest('[data-dock-action="settings"]')
      ) {
        return;
      }
      setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onBoard, settingsOpen, closeSettingsOnClickOff]);

  const leave = () => {
    setSession(null);
    setPopped([]);
    setOpenSheetIds([]);
    setOpenItemIds([]);
    setOpenHandoutIds([]);
    handoutPushRef.current.clear();
    setSettingsOpen(false);
    setSelectedTokenIds([]);
    setSecretRolls(false);
    setDockTab("log");
    setDockOpen(true);
    setPage("board");
    setViewingSceneId(null);
    history.reset();
    lastSceneRef.current = null;
    // Re-arm restore so re-joining any campaign reloads its saved layout.
    restoredRoomRef.current = null;
  };

  const toggleSnap = useCallback(() => {
    setSnap((current) => {
      if (roomId) writeCampaignFlag(roomId, "snap", !current);
      return !current;
    });
  }, [roomId]);

  const setToastsEnabled = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "toasts", on);
      setToastsEnabledState(on);
    },
    [roomId],
  );

  const setSpaceClick = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "space-click", on);
      setSpaceClickState(on);
    },
    [roomId],
  );

  const setTokenPanelOnClick = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "token-panel", on);
      setTokenPanelOnClickState(on);
    },
    [roomId],
  );

  const setCloseTokenWithSheet = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "close-token-with-sheet", on);
      setCloseTokenWithSheetState(on);
    },
    [roomId],
  );

  const setCloseSettingsOnClickOff = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "close-settings-on-click-off", on);
      setCloseSettingsOnClickOffState(on);
    },
    [roomId],
  );

  const setOptimizeUploads = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "optimize-uploads", on);
      setOptimizeUploadsState(on);
    },
    [roomId],
  );

  const setShowLiveDrags = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "live-drags", on);
      setShowLiveDragsState(on);
    },
    [roomId],
  );

  const setHiResRender = useCallback(
    (on: boolean) => {
      if (roomId) writeCampaignFlag(roomId, "hi-res", on);
      setHiResRenderState(on);
    },
    [roomId],
  );
  // Applies the hi-res setting to every mounted Konva stage (board + embedded scene editor)
  // and to canvases created later; components re-read the ratio via the renderQuality store.
  useEffect(() => {
    applyRenderPixelRatio(hiResRender);
  }, [hiResRender]);

  const setNightMode = useCallback((on: boolean) => {
    writeLocalFlag(NIGHT_KEY, on);
    setNightModeState(on);
  }, []);
  const setAccent = useCallback((next: UiAccent) => {
    try {
      localStorage.setItem(ACCENT_KEY, next);
    } catch {
      // preference just won't persist
    }
    setAccentState(next);
  }, []);
  const setConfirmDeletes = useCallback((on: boolean) => {
    writeLocalFlag(CONFIRM_DELETES_KEY, on);
    setConfirmDeletesState(on);
  }, []);
  // The theme lives on <html> so every token (day parchment / night stone,
  // accent family) flips everywhere at once — lobby, portaled modals, and
  // toasts included. A DM room override (state.uiOverride) beats device prefs
  // while joined; device prefs are untouched underneath.
  const uiOverride = status === "joined" ? state?.uiOverride ?? null : null;
  // Per-dimension: a null theme/accent in the override falls back to this device's own pref.
  const effectiveNight = uiOverride?.theme ? uiOverride.theme === "night" : nightMode;
  const effectiveAccent = uiOverride?.accent ?? accent;
  useEffect(() => {
    const root = document.documentElement;
    if (effectiveNight) {
      root.setAttribute("data-theme", "night");
    } else {
      root.removeAttribute("data-theme");
    }
    if (effectiveAccent !== "sky") {
      root.setAttribute("data-accent", effectiveAccent);
    } else {
      root.removeAttribute("data-accent");
    }
  }, [effectiveNight, effectiveAccent]);
  // Holding SpaceBar acts as the left mouse button when this device opts in.
  useSpaceClick(spaceClick);

  /// <summary>Resets this campaign's UI layout: returns popped panels to the dock, clears saved
  /// window/tray positions, and re-centers the tray. Device toggles are left intact.</summary>
  const resetUiLayout = useCallback(() => {
    if (roomId) clearCampaignLayout(roomId);
    setPopped([]);
    // Open windows remount (key includes the epoch) → default geometry; the
    // tray watches the same signal and re-centers without remounting.
    setLayoutEpoch((current) => current + 1);
  }, [roomId]);

  // Restore this campaign's saved layout + device toggles once, when it's joined. Runs before
  // the combat effect (which keys on status === "joined"), so an active encounter still forces
  // the Board/Initiative view over a restored page/tab.
  useEffect(() => {
    if (!roomId || restoredRoomRef.current === roomId) {
      return;
    }
    restoredRoomRef.current = roomId;
    const layout = readCampaignJson<StoredLayout>(roomId, "layout", DEFAULT_LAYOUT);
    setDockOpen(layout.dockOpen);
    setDockTab(layout.dockTab);
    setPopped(Array.isArray(layout.popped) ? layout.popped : []);
    setTrayOpen(layout.trayOpen);
    // Unknown/legacy stored pages fall back to the board (role clamping happens in activePage).
    setPage(DM_PAGES.some((entry) => entry.id === layout.page) ? layout.page : "board");
    setSettingsOpen(layout.settingsOpen);
    setSnap(readCampaignFlag(roomId, "snap", false, SNAP_KEY));
    setToastsEnabledState(readCampaignFlag(roomId, "toasts", true, TOASTS_KEY));
    setSpaceClickState(readCampaignFlag(roomId, "space-click", false, SPACE_CLICK_KEY));
    setTokenPanelOnClickState(readCampaignFlag(roomId, "token-panel", true, TOKEN_PANEL_KEY));
    setCloseTokenWithSheetState(readCampaignFlag(roomId, "close-token-with-sheet", true, CLOSE_TOKEN_WITH_SHEET_KEY));
    setCloseSettingsOnClickOffState(readCampaignFlag(roomId, "close-settings-on-click-off", false, CLOSE_SETTINGS_ON_CLICK_OFF_KEY));
    setOptimizeUploadsState(readCampaignFlag(roomId, "optimize-uploads", true, OPTIMIZE_UPLOADS_KEY));
    setShowLiveDragsState(readCampaignFlag(roomId, "live-drags", true, LIVE_DRAGS_KEY));
    setHiResRenderState(readCampaignFlag(roomId, "hi-res", true, HI_RES_KEY));
  }, [roomId]);

  // Persist the layout blob whenever it changes (only after this campaign has been restored, so
  // the initial defaults never clobber saved values before the restore effect runs).
  useEffect(() => {
    if (!roomId || restoredRoomRef.current !== roomId) {
      return;
    }
    writeCampaignJson<StoredLayout>(roomId, "layout", {
      dockOpen,
      dockTab,
      popped,
      trayOpen,
      page,
      settingsOpen,
    });
  }, [roomId, dockOpen, dockTab, popped, trayOpen, page, settingsOpen]);


  // Keep the client-side upload optimizer in sync with this device's own setting (per-device,
  // not a DM override) so each user compresses their own uploads to taste.
  useEffect(() => {
    applyOptimizeUploads(optimizeUploads);
  }, [optimizeUploads]);

  // Asset warming (Phase 2): the decode-once shared cache lets us proactively warm likely-next
  // assets so scene switches and portraits never decode cold. Active-scene assets + party
  // portraits go first; everything else (other scenes' maps, remaining sheets/items) is deferred
  // to idle so it never competes with the visible board. All calls are de-duped by the cache.
  useEffect(() => {
    if (!state) return;
    const activeSceneId = state.activeSceneId;
    const activeScene = state.scenes.find((s) => s.id === activeSceneId);
    prefetchImage(activeScene?.mapUrl);
    for (const t of state.tokens) if (t.sceneId === activeSceneId) prefetchImage(t.imageUrl);
    for (const p of state.connectedPlayers) prefetchImage(state.sheets[p.playerId]?.data.iconUrl);

    const warmRest = () => {
      for (const s of state.scenes) if (s.id !== activeSceneId) prefetchImage(s.mapUrl);
      for (const id of Object.keys(state.sheets)) prefetchImage(state.sheets[id]?.data.iconUrl);
      for (const id of Object.keys(state.items)) prefetchImage(state.items[id]?.iconUrl);
    };
    const useIdle = typeof window.requestIdleCallback === "function";
    const handle = useIdle
      ? window.requestIdleCallback(warmRest, { timeout: 3000 })
      : window.setTimeout(warmRest, 500);
    return () => {
      if (useIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [state]);

  // Homebrew read-context for the compendium pickers (however deep they mount). Must
  // stay ABOVE the early returns — hooks after a conditional return break hook order
  // on the lobby → joined transition.
  const homebrewCtx = useMemo(() => (state ? buildHomebrewContext(state) : null), [state]);

  if (!session) {
    return <JoinScreen onJoin={setSession} nightMode={nightMode} onToggleNight={setNightMode} />;
  }

  if (error && status !== "joined" && status !== "reconnecting") {
    return (
      <div className="join-failed">
        <p>{error}</p>
        <button onClick={leave}>Back to lobby</button>
      </div>
    );
  }

  // Skeleton / progressive load: once the room state is here, render the board immediately and
  // let assets fill in over their placeholders (portrait/map shimmers + token colored shapes).
  // Only the connect phase (no state yet) shows a full screen — there's nothing to render then.
  if (!state || (status !== "joined" && status !== "reconnecting")) {
    return <LoadingScreen label="Connecting to room…" />;
  }

  // Selection derivations. Filtering against live state prunes deleted tokens automatically
  // (undo, another client, scene import) — a 3-selection that shrinks to 1 degrades to the
  // single-token editor with no bookkeeping.
  const selectedTokens = state.tokens.filter((token) => selectedTokenIds.includes(token.id));
  const selectedToken = selectedTokens.length === 1 ? selectedTokens[0] : null;
  // MapCanvas gets only ids that exist in live state (never ids still in flight — e.g. a
  // just-pasted trio whose STATE echo hasn't landed), so its batch delete/copy hotkeys
  // always operate on real tokens and their history inverses can snapshot them.
  const liveSelectedTokenIds = selectedTokens.map((token) => token.id);

  const openSheet = (sheetId: string) => {
    // Open a window for this sheet if one isn't already up (each stays open independently).
    // Opening a real sheet also clears the DM's placeholder picker.
    setOpenSheetIds((current) => {
      const withoutPicker = current.filter((id) => id !== SHEET_PICKER);
      return withoutPicker.includes(sheetId) ? withoutPicker : [...withoutPicker, sheetId];
    });
  };

  const closeSheet = (id: string) => {
    setOpenSheetIds((current) => current.filter((sheetId) => sheetId !== id));
    // QoL (opt-out in Settings): closing a character sheet also dismisses the left-hand Token
    // editor popup — but only when it's showing the very token that sheet belongs to, so an
    // unrelated token panel is left alone.
    if (closeTokenWithSheet && isDm && selectedToken) {
      const linkedSheetId = selectedToken.sheetId ?? selectedToken.ownerPlayerId ?? null;
      if (linkedSheetId === id) {
        setSelectedTokenIds([]);
      }
    }
  };

  /** Open the Item Sheet window for a catalog item (DM-only). Each item gets its own window,
   *  so several can be open at once; a second open of the same item is a no-op. */
  const openItemSheet = (itemId: string) => {
    setOpenItemIds((current) => (current.includes(itemId) ? current : [...current, itemId]));
  };

  const closeItemSheet = (itemId: string) => {
    setOpenItemIds((current) => current.filter((id) => id !== itemId));
  };

  /** Open a floating handout viewer (player re-view from the panel, DM preview). */
  const openHandout = (handoutId: string) => {
    setOpenHandoutIds((current) =>
      current.includes(handoutId) ? current : [...current, handoutId],
    );
  };

  const closeHandout = (handoutId: string) => {
    setOpenHandoutIds((current) => current.filter((id) => id !== handoutId));
  };

  /** Single-click a token: select it (the DM's Token panel shows). `toggle` (Alt+click)
   *  adds/removes it from the multi-selection instead of replacing. No sheet. */
  const selectToken = (tokenId: string | null, mods?: { toggle?: boolean }) => {
    if (tokenId === null) {
      setSelectedTokenIds([]);
    } else if (mods?.toggle) {
      setSelectedTokenIds((current) =>
        current.includes(tokenId) ? current.filter((id) => id !== tokenId) : [...current, tokenId],
      );
    } else {
      setSelectedTokenIds([tokenId]);
    }
  };

  /** Marquee select (Alt+drag): replace the whole selection. */
  const selectTokens = (tokenIds: string[]) => {
    setSelectedTokenIds(tokenIds);
  };

  /** Double-click a token: open its linked sheet — item sheet for item tokens, else character. */
  const openTokenSheet = (token: GameState["tokens"][number]) => {
    if (token.itemId && state.items[token.itemId]) {
      if (isDm) openItemSheet(token.itemId);
      return;
    }
    const sheetId = token.sheetId ?? (token.ownerPlayerId ? token.ownerPlayerId : null);
    if (sheetId && state.sheets[sheetId]) {
      openSheet(sheetId);
    }
  };

  /** DM dropped an actor row (or the blank chip) from the directory onto the map. */
  const dropActorAt = (sheetId: string | null, clientX: number, clientY: number) => {
    if (!isDm) return;
    const x = (clientX - viewport.x) / viewport.scale;
    const y = (clientY - viewport.y) / viewport.scale;
    dm.addToken(actorToken(state, sheetId, state.activeSceneId, x, y));
  };

  /** DM dropped a catalog item from the Items directory onto the map. */
  const dropItemAt = (itemId: string, clientX: number, clientY: number) => {
    if (!isDm) return;
    const x = (clientX - viewport.x) / viewport.scale;
    const y = (clientY - viewport.y) / viewport.scale;
    const token = itemToken(state, itemId, state.activeSceneId, x, y);
    if (token) dm.addToken(token);
  };

  const handleViewportChange = (next: Viewport) => {
    setViewport(next);
  };

  const panelContext: PanelContext = {
    state,
    room,
    dm,
    isDm,
    // Per-sheet windows override this with their own id; the base context has no single "current"
    // sheet. Other panels don't read it.
    viewSheetId: null,
    openSheet,
    // Per-item windows override this with their own id; the base context has no single "current".
    viewItemId: null,
    openItemSheet,
    openHandout,
    updateSheet: (sheetId, sheet) => room.send({ type: "UPDATE_SHEET", sheetId, sheet }),
    // The DM's persistent Secret toggle applies to every roll, sheet-clicks included.
    rollDice: (expression, options) =>
      room.rollDice(expression, { ...options, private: isDm && secretRolls }),
    rollCheck: (sheetId, check, adv) =>
      room.send({ type: "ROLL_CHECK", sheetId, check, adv, private: isDm && secretRolls }),
    dropActorAt,
    dropItemAt,
    dice,
    snap,
    toggleSnap,
    toastsEnabled,
    setToastsEnabled,
    spaceClick,
    setSpaceClick,
    tokenPanelOnClick,
    setTokenPanelOnClick,
    closeTokenWithSheet,
    setCloseTokenWithSheet,
    closeSettingsOnClickOff,
    setCloseSettingsOnClickOff,
    optimizeUploads,
    setOptimizeUploads,
    showLiveDrags,
    setShowLiveDrags,
    hiResRender,
    setHiResRender,
    nightMode,
    setNightMode,
    accent,
    setAccent,
    confirmDeletes,
    setConfirmDeletes,
    history: isDm ? history : undefined,
    resetUiLayout,
    settingsView,
    setSettingsView,
    leave,
  };

  const dockPanels = yourRole ? dockPanelsForRole(yourRole) : [];
  const sheetPanel = PANELS.find((panel) => panel.id === "sheet")!;
  const settingsPanel = PANELS.find((panel) => panel.id === "settings")!;
  const itemSheetPanel = PANELS.find((panel) => panel.id === "itemSheet")!;

  const toggleSheet = () => {
    // The dock button is a toggle: close every open sheet window if any are up, otherwise open
    // this viewer's entry point — the player's own sheet, or the DM's "pick a character" picker.
    setOpenSheetIds((current) => {
      if (current.length > 0) {
        return [];
      }
      if (isDm) {
        return [SHEET_PICKER];
      }
      return room.yourPlayerId ? [room.yourPlayerId] : [];
    });
  };

  // Rail action buttons: sheet and dice on top, settings at the bottom.
  const dockActions: DockAction[] = [
    {
      id: "sheet",
      icon: <IdCard size={17} strokeWidth={2.2} />,
      title: "Character sheet",
      active: openSheetIds.length > 0,
      slot: "top",
      onClick: toggleSheet,
    },
    {
      id: "dice",
      icon: <Dices size={17} strokeWidth={2.2} />,
      title: "Dice tray",
      active: trayOpen,
      slot: "top",
      onClick: () => setTrayOpen((open) => !open),
    },
    {
      id: "settings",
      icon: <Settings size={17} strokeWidth={2.2} />,
      title: "Settings",
      active: settingsOpen,
      slot: "bottom",
      onClick: () => setSettingsOpen((open) => !open),
    },
  ];

  /** HP to show under an avatar chip, or null when this viewer may not see it. The DM sees
   *  everything; players always see PC HP (party transparency). NPC HP shows only when the
   *  sheet's combat block is revealed or the DM turned on a token's HP display — the same
   *  rule the server's redaction applies, so whenever we show numbers they're real. */
  const chipHp = (sheetId: string): HitPoints | null => {
    const record = state.sheets[sheetId];
    if (!record || record.data.hp.max <= 0) return null;
    if (!isDm && record.kind === "npc" && record.redacted && !record.revealed.combat) {
      const shown = state.tokens.some(
        (token) =>
          token.sceneId === state.activeSceneId &&
          token.sheetId === sheetId &&
          token.showHp !== "none",
      );
      if (!shown) return null;
    }
    return record.data.hp;
  };

  // Avatar strip: PCs with a token in the active scene (or currently connected), plus
  // NPCs with a token in the active scene — the tray mirrors who's on the current board.
  const onlinePlayerById = new Map(
    state.connectedPlayers.map((player) => [player.playerId, player] as const),
  );
  const pcChipSlotIds = state.playerSlots
    .map((slot) => slot.id)
    .filter(
      (slotId) =>
        onlinePlayerById.has(slotId) ||
        state.tokens.some(
          (token) =>
            token.sceneId === state.activeSceneId &&
            token.kind === "player" &&
            token.ownerPlayerId === slotId,
        ),
    );
  const npcChipSheetIds = [
    ...new Set(
      state.tokens
        .filter(
          (token) =>
            token.sceneId === state.activeSceneId &&
            token.kind === "enemy" &&
            token.sheetId &&
            state.sheets[token.sheetId],
        )
        .map((token) => token.sheetId as string),
    ),
  ];

  const popOut = (id: PanelId) =>
    setPopped((current) => (current.includes(id) ? current : [...current, id]));
  const dockBack = (id: PanelId) => {
    setPopped((current) => current.filter((item) => item !== id));
    setDockTab(id);
    setDockOpen(true);
  };

  return (
    // homebrewCtx is only null before `state` exists, and the LoadingScreen return
    // above has already handled that case.
    <HomebrewProvider value={homebrewCtx!}>
    <div className="app">
      <ConfirmDeleteHost onDisableConfirms={() => setConfirmDeletesState(false)} />
      <ConfirmActionHost />
      <MapCanvas
        state={state}
        sceneId={displayedSceneId ?? state.activeSceneId}
        isDm={isDm}
        yourPlayerId={room.yourPlayerId}
        viewport={viewport}
        onViewportChange={handleViewportChange}
        onMoveToken={(tokenId, x, y, facing) =>
          (isDm ? historySend : room.send)({ type: "MOVE_TOKEN", tokenId, x, y, ...(facing !== undefined ? { facing } : {}) })
        }
        onSelectToken={selectToken}
        onSelectTokens={selectTokens}
        onOpenTokenSheet={openTokenSheet}
        selectedTokenIds={liveSelectedTokenIds}
        send={isDm ? historySend : room.send}
        subscribeMeasure={room.subscribeMeasure}
        subscribeTemplate={room.subscribeTemplate}
        subscribeTokenDrag={room.subscribeTokenDrag}
        subscribeTokenSfx={room.subscribeTokenSfx}
        showLiveDrags={showLiveDrags}
        snap={snap}
        onToggleSnap={toggleSnap}
        hotkeysEnabled={onBoard}
        history={isDm ? history : undefined}
        dockOpen={dockOpen}
      />

      {/* 3D dice canvas: above the map, below all UI, never takes pointer events. */}
      <div className="dice-arena" ref={dice.containerRef} />

      <div className="overlay">
        {!state.hideTokenTray ? (
        <FloatingCluster
          anchor="top-center"
          plain
          className="avatar-strip"
        >
          {pcChipSlotIds.map((slotId) => {
            const record = state.sheets[slotId];
            const online = onlinePlayerById.get(slotId);
            const name =
              online?.displayName ||
              record?.data.characterName?.trim() ||
              state.playerSlots.find((slot) => slot.id === slotId)?.name ||
              "Character";
            const hp = chipHp(slotId);
            return (
              <div
                key={slotId}
                // Offline PCs (only their token is on the board) read dimmed vs. players at the table.
                className={`player-chip${online ? "" : " player-chip--offline"}`}
                title={`${name}${online ? "" : " (offline)"} — double-click for sheet`}
                onDoubleClick={() => openSheet(slotId)}
              >
                <div className="chip-portrait">
                  <ChipAvatar src={record?.data.iconUrl} crop={record?.data.iconCrop} name={name} />

                  {isDm && online ? (
                    <button
                      className="kick"
                      title={`Kick ${name}`}
                      onClick={() => dm.kickPlayer(slotId)}
                    >
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  ) : null}
                </div>
                {hp ? <ChipHpBar hp={hp} /> : null}
              </div>
            );
          })}
          {npcChipSheetIds.map((sheetId) => {
            const record = state.sheets[sheetId]!;
            const name = record.data.characterName || "???";
            const hp = chipHp(sheetId);
            return (
              <div
                key={sheetId}
                className="player-chip npc-chip"
                title={`${name} — double-click for sheet`}
                onDoubleClick={() => openSheet(sheetId)}
              >
                <div className="chip-portrait">
                  <ChipAvatar src={record.data.iconUrl} crop={record.data.iconCrop} name={name} />
                </div>
                {hp ? <ChipHpBar hp={hp} /> : null}
              </div>
            );
          })}
        </FloatingCluster>
        ) : null}

        {/* The DM always gets the page switcher; players get it only when the DM has
            enabled the Stats page (otherwise the two-button Board/Stats pill vanishes
            for them — with only the board left there is nothing to switch between). */}
        {onBoard && (isDm || state.playersCanSeeStats) ? (
          <div className="page-switcher">
            <PageSwitcher
              pages={isDm ? DM_PAGES : PLAYER_PAGES}
              active={activePage}
              onSelect={setPage}
            />
          </div>
        ) : null}

        {/* Players: scene strip when the DM has opened extra scenes (redacted state only
            ever carries scenes this player may see, so length > 1 IS the signal). */}
        {!isDm && state.scenes.length > 1 ? (
          <SceneSwitcher
            scenes={state.scenes}
            activeSceneId={state.activeSceneId}
            displayedSceneId={displayedSceneId ?? state.activeSceneId}
            onView={setViewingSceneId}
          />
        ) : null}

        <Dock
          panels={dockPanels}
          open={dockOpen}
          activeTab={dockTab}
          popped={popped}
          context={panelContext}
          actions={dockActions}
          onSelectTab={(id) => {
            if (popped.includes(id)) {
              dockBack(id);
              return;
            }
            setDockTab(id);
            setDockOpen(true);
          }}
          onPopOut={popOut}
          onToggleOpen={() => setDockOpen((open) => !open)}
        />

        {/* DM prep pages: an opaque surface over the board chrome. Kept mounted
            so each page preserves its own state (selection, drafts) across
            switches; the board underneath keeps viewport/selection/windows. */}
        {isDm ? (
          <>
            <div className={`page${activePage === "players" ? " page--active" : ""}`}>
              <PlayersPage ctx={panelContext} activePage={activePage} onNavigate={setPage} />
            </div>
            <div className={`page${activePage === "npcs" ? " page--active" : ""}`}>
              <NpcsPage ctx={panelContext} activePage={activePage} onNavigate={setPage} />
            </div>
            <div className={`page${activePage === "items" ? " page--active" : ""}`}>
              <ItemsPage ctx={panelContext} activePage={activePage} onNavigate={setPage} />
            </div>
            <div className={`page${activePage === "scenes" ? " page--active" : ""}`}>
              <ScenesPage
                ctx={panelContext}
                active={activePage === "scenes"}
                activePage={activePage}
                onNavigate={setPage}
              />
            </div>
            <div className={`page${activePage === "assets" ? " page--active" : ""}`}>
              <AssetsPage
                ctx={panelContext}
                active={activePage === "assets"}
                activePage={activePage}
                onNavigate={setPage}
              />
            </div>
          </>
        ) : null}

        {/* Roll Statistics: the one full page players can open too. */}
        <div className={`page${activePage === "stats" ? " page--active" : ""}`}>
          <StatsPage
            room={room}
            active={activePage === "stats"}
            activePage={activePage}
            onNavigate={setPage}
          />
        </div>

        {/* Floating windows are board furniture — hidden while a prep page is up. */}
        {onBoard
          ? popped.map((panelId) => {
              const panel = PANELS.find((item) => item.id === panelId);
              if (!panel || (yourRole && !panel.roles.includes(yourRole))) {
                return null;
              }
              return (
                <FloatingWindow
                  key={`${panel.id}:${layoutEpoch}`}
                  id={panel.id}
                  roomId={session.roomId}
                  title={panel.title(panelContext)}
                  width={panel.width}
                  height={panel.height}
                  minWidth={panel.minWidth}
                  minHeight={panel.minHeight}
                  defaultPos={panel.defaultPos}
                  onClose={() => setPopped((current) => current.filter((id) => id !== panel.id))}
                  onDock={() => dockBack(panel.id)}
                >
                  {panel.render(panelContext)}
                </FloatingWindow>
              );
            })
          : null}

        {/* One floating window per open sheet — players and the DM can have several up at
            once. Each has its own id (independent geometry + z-order); freshly-opened ones
            cascade off the default position so they don't land exactly atop one another. */}
        {onBoard || activePage === "scenes"
          ? openSheetIds.map((entryId, index) => {
              const sheetId = entryId === SHEET_PICKER ? null : entryId;
              const sheetCtx: PanelContext = { ...panelContext, viewSheetId: sheetId };
              const cascade = index * 32;
              return (
                <FloatingWindow
                  key={`sheet:${entryId}:${layoutEpoch}`}
                  id={sheetId ? `sheet:${sheetId}` : "sheet"}
                  roomId={session.roomId}
                  title={sheetPanel.title(sheetCtx)}
                  width={sheetPanel.width}
                  height={sheetPanel.height}
                  minWidth={sheetPanel.minWidth}
                  minHeight={sheetPanel.minHeight}
                  defaultPos={(vw, vh) => {
                    const base = sheetPanel.defaultPos(vw, vh);
                    return { x: base.x + cascade, y: base.y + cascade };
                  }}
                  onClose={() => closeSheet(entryId)}
                >
                  {sheetPanel.render(sheetCtx)}
                </FloatingWindow>
              );
            })
          : null}

        {onBoard && settingsOpen ? (
          <FloatingWindow
            key={`settings:${layoutEpoch}`}
            id="settings"
            roomId={session.roomId}
            title={settingsPanel.title(panelContext)}
            width={settingsPanel.width}
            minWidth={settingsPanel.minWidth}
            minHeight={settingsPanel.minHeight}
            defaultPos={settingsPanel.defaultPos}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsView("main");
            }}
            onBack={settingsView === "keybinds" ? () => setSettingsView("main") : undefined}
          >
            {settingsPanel.render(panelContext)}
          </FloatingWindow>
        ) : null}

        {/* One floating window per open item sheet — the DM can inspect several at once.
            Each has its own id (independent geometry + z-order) and cascades off the default. */}
        {(onBoard || activePage === "scenes") && isDm
          ? openItemIds.map((itemId, index) => {
              const itemCtx: PanelContext = { ...panelContext, viewItemId: itemId };
              const cascade = index * 32;
              return (
                <FloatingWindow
                  key={`itemSheet:${itemId}:${layoutEpoch}`}
                  id={`itemSheet:${itemId}`}
                  roomId={session.roomId}
                  title={itemSheetPanel.title(itemCtx)}
                  width={itemSheetPanel.width}
                  minWidth={itemSheetPanel.minWidth}
                  minHeight={itemSheetPanel.minHeight}
                  defaultPos={(vw, vh) => {
                    const base = itemSheetPanel.defaultPos(vw, vh);
                    return { x: base.x + cascade, y: base.y + cascade };
                  }}
                  onClose={() => closeItemSheet(itemId)}
                >
                  {itemSheetPanel.render(itemCtx)}
                </FloatingWindow>
              );
            })
          : null}

        {/* One floating viewer per open handout — DM previews and player pops share the
            wiring. Content resolves from state, falling back to the transient push payload
            (a HANDOUT_SHOW frame can arrive before the STATE frame that grants visibility). */}
        {onBoard
          ? openHandoutIds.map((handoutId, index) => {
              const record = state.handouts.find((handout) => handout.id === handoutId);
              const pushed = handoutPushRef.current.get(handoutId);
              if (!record && !pushed) {
                return null;
              }
              const name = record?.name ?? pushed?.name ?? "Handout";
              const imageUrl = record?.imageUrl ?? pushed?.imageUrl ?? null;
              // Opens near-fullscreen (the image is the point), centered, cascading like
              // sheets so several don't land exactly atop one another.
              const winWidth = Math.min(Math.max(window.innerWidth - 160, 320), 900);
              const winHeight = Math.min(Math.max(window.innerHeight - 160, 280), 760);
              const cascade = index * 32;
              return (
                <FloatingWindow
                  key={`handout:${handoutId}:${layoutEpoch}`}
                  id={`handout:${handoutId}`}
                  roomId={session.roomId}
                  title={name}
                  width={winWidth}
                  height={winHeight}
                  minWidth={280}
                  minHeight={220}
                  defaultPos={(vw, vh) => ({
                    x: Math.max(16, Math.round((vw - winWidth) / 2) + cascade),
                    y: Math.max(16, Math.round((vh - winHeight) / 2) + cascade),
                  })}
                  onClose={() => closeHandout(handoutId)}
                >
                  <HandoutViewer name={name} imageUrl={imageUrl} />
                </FloatingWindow>
              );
            })
          : null}

        {onBoard && isDm && selectedToken && tokenPanelOnClick ? (
          <FloatingWindow
            key={`token-editor:${layoutEpoch}`}
            id="token-editor"
            roomId={session.roomId}
            title={selectedToken.kind === "item" ? "Item token" : "Token"}
            width={300}
            height={640}
            minWidth={264}
            minHeight={280}
            // Clear of the left map toolbar (fixed to the left edge, vertically centered);
            // draggable like every window, and its position is remembered per campaign.
            defaultPos={(_vw, vh) => ({ x: 72, y: Math.max(12, Math.round(vh / 2) - 320) })}
            onClose={() => setSelectedTokenIds([])}
          >
            <TokenEditor
              token={selectedToken}
              state={state}
              dm={dm}
              openSheet={openSheet}
              openItemSheet={openItemSheet}
              onClose={() => setSelectedTokenIds([])}
            />
          </FloatingWindow>
        ) : null}

        {/* Multi-selection (Alt+click / Alt+drag marquee): bulk editor in the same window
            slot. Mutually exclusive with the single-token block above (length 1 vs 2+), and
            the shared id keeps the remembered position. Deliberately NOT gated on
            tokenPanelOnClick — that setting suppresses the auto-popup on every single click,
            but a multi-selection is a deliberate act whose only UI is this panel. */}
        {onBoard && isDm && selectedTokens.length >= 2 ? (
          <FloatingWindow
            key={`token-editor:${layoutEpoch}`}
            id="token-editor"
            roomId={session.roomId}
            title={`${selectedTokens.length} tokens`}
            width={300}
            height={640}
            minWidth={264}
            minHeight={280}
            defaultPos={(_vw, vh) => ({ x: 72, y: Math.max(12, Math.round(vh / 2) - 320) })}
            onClose={() => setSelectedTokenIds([])}
          >
            <MultiTokenEditor
              tokens={selectedTokens}
              state={state}
              dm={dm}
              onClose={() => setSelectedTokenIds([])}
            />
          </FloatingWindow>
        ) : null}

        {/* Always mounted so the drawer can slide out (and the tray scene persists). */}
        <DiceTray
          open={trayOpen}
          roomId={session.roomId}
          isDm={isDm}
          secret={secretRolls}
          onToggleSecret={setSecretRolls}
          highlightD20={initiativePending}
          controller={dice}
          onTextRoll={(expression) =>
            room.rollDice(expression, { private: isDm && secretRolls })
          }
          onClose={() => setTrayOpen(false)}
          resetSignal={layoutEpoch}
        />

        <LogToasts
          log={state.log}
          yourPlayerId={room.yourPlayerId}
          playerSlots={state.playerSlots}
          // Toasts are global (they follow you onto prep pages); hidden only when
          // the Log panel itself is visible on the board, or turned off in settings.
          suppress={
            !toastsEnabled ||
            (onBoard && ((dockOpen && dockTab === "log") || popped.includes("log")))
          }
          dockExpanded={dockOpen}
        />

        {status === "reconnecting" ? (
          <div className="toast">Reconnecting to the game server…</div>
        ) : null}
        {error && status === "joined" ? <div className="error-banner">{error}</div> : null}
      </div>
    </div>
    </HomebrewProvider>
  );
}
