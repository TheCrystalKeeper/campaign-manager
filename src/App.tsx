import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JoinScreen } from "./components/JoinScreen";
import { MapCanvas } from "./components/MapCanvas";
import { FloatingCluster } from "./components/FloatingCluster";
import { FloatingWindow } from "./components/FloatingWindow";
import { Dock, type DockAction } from "./components/Dock";
import { ConfirmDeleteHost, CONFIRM_DELETES_KEY } from "./components/ConfirmDeleteDialog";
import { DiceTray } from "./components/DiceTray";
import { LogToasts } from "./components/LogToasts";
import { TokenEditor } from "./components/TokenEditor";
import { CroppableImage } from "./components/CroppableImage";
import { dockPanelsForRole, PANELS, type PanelContext, type PanelId } from "./panels/registry";
import { PlayersPage } from "./pages/PlayersPage";
import { NpcsPage } from "./pages/NpcsPage";
import { ItemsPage } from "./pages/ItemsPage";
import { ScenesPage } from "./pages/ScenesPage";
import { AssetsPage } from "./pages/AssetsPage";
import { PageSwitcher, type PageId } from "./pages/PageSwitcher";
import { useDiceOverlay } from "./dice/useDiceOverlay";
import { useDmActions, useGameRoom, type JoinParams } from "./hooks/useGameRoom";
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
import { fitViewportToScene, prefetchImage } from "./lib/sceneUtils";
import { setOptimizeUploads } from "./lib/uploadAsset";
import { LoadingScreen } from "./components/LoadingScreen";
import {
  DEFAULT_ICON_CROP,
  DEFAULT_VIEWPORT,
  TOKEN_ENEMY_COLOR,
  TOKEN_ITEM_COLOR,
  type GameState,
  type HitPoints,
  type IconCrop,
  type Viewport,
} from "./lib/types";

import { applyRenderPixelRatio } from "./lib/renderQuality";

type SessionParams = JoinParams & { roomId: string };

const SNAP_KEY = "cm-map-snap";
const TOASTS_KEY = "cm-log-toasts";
const SPACE_CLICK_KEY = "cm-space-click";
const TOKEN_PANEL_KEY = "cm-token-panel-on-click";
const LIVE_DRAGS_KEY = "cm-live-drags";
const HI_RES_KEY = "cm-hi-res";
const NIGHT_KEY = "cm-night-mode";
const ACCENT_KEY = "cm-ui-accent";

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
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<PanelId>("log");
  const [popped, setPopped] = useState<PanelId[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewSheetId, setViewSheetId] = useState<string | null>(null);
  const [itemSheetOpen, setItemSheetOpen] = useState(false);
  const [viewItemId, setViewItemId] = useState<string | null>(null);
  const [secretRolls, setSecretRolls] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const [page, setPage] = useState<PageId>("board");
  const [snap, setSnap] = useState(() => readLocalFlag(SNAP_KEY, false));
  const [toastsEnabled, setToastsEnabledState] = useState(() => readLocalFlag(TOASTS_KEY, true));
  const [spaceClick, setSpaceClickState] = useState(() => readLocalFlag(SPACE_CLICK_KEY, false));
  const [tokenPanelOnClick, setTokenPanelOnClickState] = useState(() => readLocalFlag(TOKEN_PANEL_KEY, true));
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

  // Players have no pages — the Board (with maximizable sheet windows) covers them.
  const activePage: PageId = isDm ? page : "board";
  const onBoard = activePage === "board";

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

  // Each client owns its own local viewport; fit the view when the active scene changes.
  useEffect(() => {
    if (!state) {
      return;
    }
    const scene = state.scenes.find((item) => item.id === state.activeSceneId);
    if (!scene || lastSceneRef.current === scene.id) {
      return;
    }
    lastSceneRef.current = scene.id;
    // Undo history is scene-scoped — switching the active scene starts fresh.
    history.reset();
    const fitted = fitViewportToScene(scene, window.innerWidth, window.innerHeight);
    setViewport(fitted);
    if (isDm) {
      dm.updateViewport(fitted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.activeSceneId, status]);

  // Players mirror DM pan/zoom when a VIEWPORT delta arrives (server relay).
  // Keyed on viewportRevision so full STATE updates do not yank a player's local pan.
  useEffect(() => {
    if (isDm || !state?.viewport || room.viewportRevision === 0) {
      return;
    }
    setViewport(state.viewport);
  }, [isDm, room.viewportRevision, state?.viewport]);

  // On join, adopt the room's authoritative viewport so late joiners match the DM.
  useEffect(() => {
    if (isDm || status !== "joined" || !state?.viewport) {
      return;
    }
    setViewport(state.viewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDm, status]);

  // DM undo/redo shortcuts (board only; ignored while typing).
  const historyUndo = history.undo;
  const historyRedo = history.redo;
  useEffect(() => {
    if (!isDm || !onBoard) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") {
        // Ctrl+Y is an alternate redo.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
          if (!isTypingTarget(event.target)) {
            event.preventDefault();
            historyRedo();
          }
        }
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        historyRedo();
      } else {
        historyUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDm, onBoard, historyUndo, historyRedo]);

  const leave = () => {
    setSession(null);
    setPopped([]);
    setSheetOpen(false);
    setSettingsOpen(false);
    setSelectedTokenId(null);
    setSecretRolls(false);
    setViewSheetId(null);
    setDockTab("log");
    setDockOpen(true);
    setPage("board");
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
  const effectiveNight = uiOverride ? uiOverride.theme === "night" : nightMode;
  const effectiveAccent = uiOverride ? uiOverride.accent : accent;
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
    setPage(layout.page);
    setSettingsOpen(layout.settingsOpen);
    setSnap(readCampaignFlag(roomId, "snap", false, SNAP_KEY));
    setToastsEnabledState(readCampaignFlag(roomId, "toasts", true, TOASTS_KEY));
    setSpaceClickState(readCampaignFlag(roomId, "space-click", false, SPACE_CLICK_KEY));
    setTokenPanelOnClickState(readCampaignFlag(roomId, "token-panel", true, TOKEN_PANEL_KEY));
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

  // Relay the DM's viewport to players as a lightweight VIEWPORT delta, trailing-throttled to
  // ~30/s. A fast pan/zoom fires far more often, and each echo re-renders every player's board —
  // unthrottled it floods them. The DM's own view tracks the Konva drag directly (no dependence
  // on this relay), so local smoothness is unaffected; the trailing timer guarantees players
  // still land on the final resting viewport. Declared here (before the early returns below) so
  // its hooks always run — see the Rules of Hooks.
  const latestViewportRef = useRef<Viewport | null>(null);
  const viewportBroadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleViewportBroadcast = useCallback(
    (next: Viewport) => {
      latestViewportRef.current = next;
      if (viewportBroadcastTimerRef.current != null) return;
      viewportBroadcastTimerRef.current = setTimeout(() => {
        viewportBroadcastTimerRef.current = null;
        if (latestViewportRef.current) dm.updateViewport(latestViewportRef.current);
      }, 33);
    },
    [dm],
  );
  useEffect(
    () => () => {
      if (viewportBroadcastTimerRef.current != null) clearTimeout(viewportBroadcastTimerRef.current);
    },
    [],
  );

  // Keep the client-side upload optimizer in sync with the DM's synced setting, so every client
  // (DM and players) compresses new uploads the same way. Default on when state is absent.
  useEffect(() => {
    setOptimizeUploads(state?.optimizeUploads !== false);
  }, [state?.optimizeUploads]);

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

  const selectedToken = state.tokens.find((token) => token.id === selectedTokenId) ?? null;

  const openSheet = (sheetId: string) => {
    setViewSheetId(sheetId);
    setSheetOpen(true);
  };

  /** Open the Item Sheet window for a catalog item (DM-only). */
  const openItemSheet = (itemId: string) => {
    setViewItemId(itemId);
    setItemSheetOpen(true);
  };

  /** Single-click a token: just select it (the DM's Token panel shows). No sheet. */
  const selectToken = (tokenId: string | null) => {
    setSelectedTokenId(tokenId);
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
    if (!isDm) {
      return;
    }
    // The stage fills the window, so screen coords map straight through the viewport.
    const x = (clientX - viewport.x) / viewport.scale;
    const y = (clientY - viewport.y) / viewport.scale;
    const record = sheetId ? state.sheets[sheetId] : null;
    const isPc = record?.kind === "pc";
    dm.addToken({
      id: `token-${crypto.randomUUID().slice(0, 8)}`,
      sceneId: state.activeSceneId,
      x,
      y,
      label: record ? record.data.characterName || "Token" : "Token",
      color: TOKEN_ENEMY_COLOR,
      kind: isPc ? "player" : "enemy",
      imageUrl: record?.data.iconUrl ?? null,
      ownerPlayerId: isPc && record ? record.id : null,
      sheetId: record && !isPc ? record.id : null,
      conditions: [],
      showHp: "none",
    });
  };

  /** DM dropped a catalog item from the Items directory onto the map → an "item" token. */
  const dropItemAt = (itemId: string, clientX: number, clientY: number) => {
    if (!isDm) {
      return;
    }
    const item = state.items[itemId];
    if (!item) {
      return;
    }
    const x = (clientX - viewport.x) / viewport.scale;
    const y = (clientY - viewport.y) / viewport.scale;
    dm.addToken({
      id: `token-${crypto.randomUUID().slice(0, 8)}`,
      sceneId: state.activeSceneId,
      x,
      y,
      label: item.name || "Item",
      color: TOKEN_ITEM_COLOR,
      kind: "item",
      imageUrl: item.iconUrl ?? null,
      ownerPlayerId: null,
      sheetId: null,
      itemId,
      conditions: [],
      showHp: "none",
    });
  };

  const handleViewportChange = (next: Viewport) => {
    setViewport(next);
    if (isDm) {
      scheduleViewportBroadcast(next);
    }
  };

  const panelContext: PanelContext = {
    state,
    room,
    dm,
    isDm,
    viewSheetId,
    openSheet,
    viewItemId,
    openItemSheet,
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
    leave,
  };

  const dockPanels = yourRole ? dockPanelsForRole(yourRole) : [];
  const sheetPanel = PANELS.find((panel) => panel.id === "sheet")!;
  const settingsPanel = PANELS.find((panel) => panel.id === "settings")!;
  const itemSheetPanel = PANELS.find((panel) => panel.id === "itemSheet")!;

  const toggleSheet = () => {
    if (sheetOpen) {
      setSheetOpen(false);
    } else {
      setViewSheetId(isDm ? viewSheetId : room.yourPlayerId);
      setSheetOpen(true);
    }
  };

  // Rail action buttons: sheet on top, dice after the tabs, settings at the bottom.
  const dockActions: DockAction[] = [
    {
      id: "sheet",
      icon: <IdCard size={17} strokeWidth={2.2} />,
      title: "Character sheet",
      active: sheetOpen,
      slot: "top",
      onClick: toggleSheet,
    },
    {
      id: "dice",
      icon: <Dices size={17} strokeWidth={2.2} />,
      title: "Dice tray",
      active: trayOpen,
      slot: "after-tabs",
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

  // Avatar strip: connected players + NPCs with a token in the active scene.
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
    <div className="app">
      <ConfirmDeleteHost onDisableConfirms={() => setConfirmDeletesState(false)} />
      <MapCanvas
        state={state}
        sceneId={state.activeSceneId}
        isDm={isDm}
        yourPlayerId={room.yourPlayerId}
        viewport={viewport}
        onViewportChange={handleViewportChange}
        onMoveToken={(tokenId, x, y, facing) =>
          (isDm ? historySend : room.send)({ type: "MOVE_TOKEN", tokenId, x, y, ...(facing !== undefined ? { facing } : {}) })
        }
        onSelectToken={selectToken}
        onOpenTokenSheet={openTokenSheet}
        selectedTokenId={selectedTokenId}
        send={isDm ? historySend : room.send}
        subscribeMeasure={room.subscribeMeasure}
        subscribeTemplate={room.subscribeTemplate}
        subscribeTokenDrag={room.subscribeTokenDrag}
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
        <FloatingCluster
          anchor="top-center"
          plain
          className={`avatar-strip${dockOpen ? " avatar-strip--dock-open" : ""}`}
        >
          {state.connectedPlayers.map((player) => {
            const sheetData = state.sheets[player.playerId]?.data;
            const hp = chipHp(player.playerId);
            return (
              <div
                key={player.playerId}
                className="player-chip"
                title={`${player.displayName} — double-click for sheet`}
                onDoubleClick={() => openSheet(player.playerId)}
              >
                <div className="chip-portrait">
                  <ChipAvatar src={sheetData?.iconUrl} crop={sheetData?.iconCrop} name={player.displayName} />

                  {isDm ? (
                    <button
                      className="kick"
                      title={`Kick ${player.displayName}`}
                      onClick={() => dm.kickPlayer(player.playerId)}
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

        {isDm && onBoard ? (
          <div className="page-switcher">
            <PageSwitcher active={activePage} onSelect={setPage} />
          </div>
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

        {onBoard && sheetOpen ? (
          <FloatingWindow
            key={`sheet:${layoutEpoch}`}
            id="sheet"
            roomId={session.roomId}
            title={sheetPanel.title(panelContext)}
            width={sheetPanel.width}
            height={sheetPanel.height}
            minWidth={sheetPanel.minWidth}
            minHeight={sheetPanel.minHeight}
            defaultPos={sheetPanel.defaultPos}
            onClose={() => setSheetOpen(false)}
          >
            {sheetPanel.render(panelContext)}
          </FloatingWindow>
        ) : null}

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
            onClose={() => setSettingsOpen(false)}
          >
            {settingsPanel.render(panelContext)}
          </FloatingWindow>
        ) : null}

        {onBoard && isDm && itemSheetOpen ? (
          <FloatingWindow
            key={`itemSheet:${layoutEpoch}`}
            id="itemSheet"
            roomId={session.roomId}
            title={itemSheetPanel.title(panelContext)}
            width={itemSheetPanel.width}
            minWidth={itemSheetPanel.minWidth}
            minHeight={itemSheetPanel.minHeight}
            defaultPos={itemSheetPanel.defaultPos}
            onClose={() => setItemSheetOpen(false)}
          >
            {itemSheetPanel.render(panelContext)}
          </FloatingWindow>
        ) : null}

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
            onClose={() => setSelectedTokenId(null)}
          >
            <TokenEditor
              token={selectedToken}
              state={state}
              dm={dm}
              openSheet={openSheet}
              openItemSheet={openItemSheet}
              onClose={() => setSelectedTokenId(null)}
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
  );
}
