import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRoom } from "../hooks/useGameRoom";
import type { Viewport } from "../lib/types";
import {
  decomposeDie,
  parseDiceExpression,
  MAX_DICE_PER_THROW,
  type DieSpec,
  type WorldPoint,
} from "../lib/dice3d";
import { campaignKey, readCampaignJson, writeCampaignFlag, writeCampaignJson } from "../lib/campaignStore";
import {
  applySkinsToSpecs,
  DEFAULT_SKIN_PREFS,
  mergeSkinPref,
  type DiceSkinPrefs,
} from "./skinDefs";
import type { DiceAudio } from "./audio";
import type { DiceEngine, SafeInsets } from "./engine";
import type { DiceTrayScene } from "./trayScene";

// Global fallback keys (device-wide default, read pre-join and by the audio singletons); the
// authoritative per-campaign values live under `cm:{roomId}:dice-3d` / `:dice-muted`.
const ENABLED_KEY = "dice-3d-enabled";
/** Shared with dice/audio.ts and lib/rollSound.ts — one mute for all dice sound. */
const MUTED_KEY = "dice-muted";
/** Cosmetic skin prefs (JSON DiceSkinPrefs) — global default + `cm:{roomId}:dice-skins`. */
const SKINS_KEY = "dice-skins";

/** Physical dice cap per throw (bigger pools resolve as text rolls). */
const MAX_PHYSICAL_DICE = 12;

function readEnabled(roomId: string | null): boolean {
  try {
    const perCampaign = roomId ? window.localStorage.getItem(campaignKey(roomId, "dice-3d")) : null;
    const stored = perCampaign ?? window.localStorage.getItem(ENABLED_KEY);
    if (stored !== null) {
      return stored !== "0";
    }
  } catch {
    // fall through to the media query default
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readMuted(roomId: string | null): boolean {
  try {
    const perCampaign = roomId ? window.localStorage.getItem(campaignKey(roomId, "dice-muted")) : null;
    return (perCampaign ?? window.localStorage.getItem(MUTED_KEY)) === "1";
  } catch {
    return false;
  }
}

function readSkinPrefs(roomId: string | null): DiceSkinPrefs {
  if (roomId) {
    return readCampaignJson(roomId, "dice-skins", DEFAULT_SKIN_PREFS, SKINS_KEY);
  }
  try {
    const raw = window.localStorage.getItem(SKINS_KEY);
    if (raw !== null) {
      return { ...DEFAULT_SKIN_PREFS, ...(JSON.parse(raw) as Partial<DiceSkinPrefs>) };
    }
  } catch {
    // corrupt/unavailable — use the default
  }
  return DEFAULT_SKIN_PREFS;
}

/** How many physical dice one selection unit costs (a d100 is a pair of d10s). */
function physicalCount(sides: number): number {
  return sides === 100 ? 2 : 1;
}

export interface DiceOverlayController {
  /** Callback ref for the full-window arena element. */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Callback ref for the dice tray's felt well (hosts the tray's own 3D scene). */
  trayMountRef: (node: HTMLDivElement | null) => void;
  /** Feed this client's live viewport so dice stay world-anchored and screen-sized. */
  setProjection: (viewport: Viewport) => void;
  /**
   * Provides the screen area dice must stay inside (window minus UI overlays), sampled
   * fresh at each throw. Without one, a uniform window margin is used.
   */
  setSafeAreaProvider: (provider: (() => SafeInsets) | null) => void;
  /** DM secret mode, read live at throw time. */
  setSecret: (on: boolean) => void;
  /** 3D animation preference (persisted). When off, callers fall back to text rolls. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Cosmetic skin prefs (dice skins, coin finish, tray surface), persisted like 3D/mute. */
  skinPrefs: DiceSkinPrefs;
  /**
   * Commits one skin choice: "all" = the every-die default, a number = that die size's
   * override (null clears it back to inherit), "coin"/"tray" = those looks.
   */
  setSkinPref: (target: "all" | "coin" | "tray" | number, value: string | null) => void;
  /**
   * Live-previews prefs on the idle tray dice without persisting (hover) — build them
   * with mergeSkinPref over `skinPrefs`. Pass null to revert to the committed prefs.
   * Throws always read committed prefs, so an active preview can never leak into a roll.
   */
  previewSkinPref: (prefs: DiceSkinPrefs | null) => void;
  /** Warms every skin texture so picker hover previews don't pop (called on picker open). */
  preloadAllSkins: () => void;
  /** Current d#-button selection: sides → count. Selected tray dice glow. */
  selection: Record<number, number>;
  /** Adds/removes dice from the selection (delta ±1); capped at 12 physical dice. */
  adjustSelection: (sides: number, delta: number) => void;
  clearSelection: () => void;
  /**
   * While on, the tray's d20 die glows (like a readied die) to cue a pending initiative
   * roll — independent of the button selection. No-op until the 3D tray scene exists.
   */
  setInitiativeDieHighlight: (on: boolean) => void;
  /**
   * Starts a grab from a pointerdown on the tray well. Picks up the die under the
   * cursor — plus every other highlighted die (far ones gather next to the cursor).
   * Returns false when nothing grabbable is under the pointer or 3D isn't ready.
   */
  grabFromTray: (event: { clientX: number; clientY: number }) => boolean;
  /** Parse an expression and throw it physically. False → caller falls back to text. */
  throwExpression: (expression: string) => boolean;
  /**
   * Throws the current d#-button selection physically (mixed pools welcome) and clears
   * it. False → 3D off/not ready or nothing selected; caller falls back to text.
   */
  throwSelection: () => boolean;
  /**
   * Throws d20(s) for combat initiative. With `entryIds` (the DM rolling for NPCs) it
   * throws one d20 per entry, tagged so the server zips each rolled face onto an entry;
   * with none, a single d20 the server binds to the roller's own pending entry. The value
   * is server-decided like any throw. False → 3D off/not ready (caller falls back).
   */
  throwInitiative: (entryIds?: string[]) => boolean;
}

const uid = () => crypto.randomUUID().slice(0, 8);

/** Optional "why" for a throw — attribution and combat-initiative binding. */
interface ThrowContext {
  sheetId?: string;
  label?: string;
  initiativeEntryIds?: string[];
}

interface ArmedRoll {
  specs: DieSpec[];
  modifier: number;
  context?: ThrowContext;
}

/// <summary>
/// Owns the 3D dice overlay lifecycle: lazily loads the Three+Rapier engine, wires it
/// to the room (recorded-track throws in, authoritative DICE_THROW playback out), and
/// exposes the tray-selection + grab controls. The arena canvas never takes pointer
/// events — grabs start from the tray well and ride window listeners.
/// </summary>
export function useDiceOverlay(room: GameRoom, roomId: string | null): DiceOverlayController {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), []);
  const [trayMount, setTrayMount] = useState<HTMLDivElement | null>(null);
  // A plain ref mirror of the tray well element, readable from the (deps-free)
  // drag listeners so a release over the tray can cancel the throw.
  const trayElRef = useRef<HTMLDivElement | null>(null);
  const trayMountRef = useCallback((node: HTMLDivElement | null) => {
    trayElRef.current = node;
    setTrayMount(node);
  }, []);
  /** The tray selection captured at grab time, restored if the grab is cancelled. */
  const grabbedSelectionRef = useRef<Record<number, number>>({});
  /** Whether the tray's d20 should glow for a pending initiative roll (survives remounts). */
  const initHighlightRef = useRef(false);

  const roomRef = useRef(room);
  roomRef.current = room;

  const engineRef = useRef<DiceEngine | null>(null);
  const enginePromiseRef = useRef<Promise<DiceEngine | null> | null>(null);
  const trayRef = useRef<DiceTrayScene | null>(null);
  const audioRef = useRef<DiceAudio | null>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const armedRef = useRef<Map<string, ArmedRoll>>(new Map());
  const ourRollIdsRef = useRef<Set<string>>(new Set());
  const secretRef = useRef(false);
  const safeAreaRef = useRef<(() => SafeInsets) | null>(null);

  const [enabled, setEnabledState] = useState(() => readEnabled(roomId));
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [muted, setMutedState] = useState(() => readMuted(roomId));
  const [skinPrefs, setSkinPrefsState] = useState<DiceSkinPrefs>(() => readSkinPrefs(roomId));
  // Committed prefs, readable from deps-free callbacks. Throws read ONLY this ref, so a
  // hover preview (which never touches it) can't leak into a roll.
  const skinPrefsRef = useRef(skinPrefs);
  skinPrefsRef.current = skinPrefs;
  const restoredDiceRoomRef = useRef<string | null>(null);
  const [selection, setSelection] = useState<Record<number, number>>({});
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /// <summary>Loads three/rapier + boots the engine exactly once (on demand).</summary>
  const ensureEngine = useCallback((): Promise<DiceEngine | null> => {
    if (engineRef.current) {
      return Promise.resolve(engineRef.current);
    }
    if (!container) {
      return Promise.resolve(null);
    }
    if (!enginePromiseRef.current) {
      enginePromiseRef.current = (async () => {
        try {
          const [{ DiceEngine }, { DiceAudio }] = await Promise.all([
            import("./engine"),
            import("./audio"),
          ]);
          const audio = new DiceAudio();
          audioRef.current = audio;
          setMutedState(audio.isMuted());
          const engine = await DiceEngine.create(container, {
            onRelease: (rollId, track, trayCenter, worldScale) => {
              const armed = armedRef.current.get(rollId);
              if (armed) {
                roomRef.current.send({
                  type: "DICE_THROW_REQUEST",
                  rollId,
                  specs: armed.specs,
                  track,
                  modifier: armed.modifier,
                  trayCenter,
                  worldScale,
                  ...(armed.context ? { context: armed.context } : {}),
                  private: secretRef.current || undefined,
                });
              }
            },
            onImpact: (strength, coin) => audioRef.current?.impact(strength, coin),
            onShake: (intensity) => audioRef.current?.shake(intensity),
            getSafeInsets: () => safeAreaRef.current?.() ?? { top: 24, right: 24, bottom: 24, left: 24 },
          });
          engine.setMapProjection(viewportRef.current);
          engineRef.current = engine;
          return engine;
        } catch (error) {
          console.error("[dice] engine init failed:", error);
          enginePromiseRef.current = null;
          return null;
        }
      })();
    }
    return enginePromiseRef.current;
  }, [container]);

  // Wire authoritative throws from the room; loads the engine on first sight of one.
  useEffect(() => {
    const unsubscribe = roomRef.current.subscribeDice((event) => {
      if (!enabledRef.current) {
        return; // 3D off: results arrive via the log
      }
      void ensureEngine().then((engine) => {
        if (!engine) {
          return;
        }
        const local = ourRollIdsRef.current.has(event.rollId);
        ourRollIdsRef.current.delete(event.rollId);
        armedRef.current.delete(event.rollId);
        const blank = !event.faceValues || event.faceValues.length === 0;
        // Throw-release sounds fire as playback begins, on every client — the whoosh for
        // dice, the airborne flip for coins (its landing "drop" comes via onImpact).
        audioRef.current?.throwStart(
          event.specs.some((spec) => spec.kind !== "coin"),
          event.specs.some((spec) => spec.kind === "coin"),
        );
        engine.playTrack(
          event.rollId,
          event.specs,
          event.track,
          event.faceValues ?? [],
          local,
          blank,
          event.trayCenter,
          event.worldScale,
        );
      });
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispose the engine with its container.
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      enginePromiseRef.current = null;
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, [container]);

  // The tray's own little 3D scene lives exactly as long as the felt well is mounted.
  useEffect(() => {
    if (!trayMount) {
      return;
    }
    let cancelled = false;
    void import("./trayScene").then(({ DiceTrayScene }) => {
      if (cancelled) {
        return;
      }
      const tray = new DiceTrayScene(trayMount, skinPrefsRef.current);
      tray.setSelection(selectionRef.current);
      tray.setInitiativeHighlight(initHighlightRef.current);
      trayRef.current = tray;
    });
    return () => {
      cancelled = true;
      trayRef.current?.dispose();
      trayRef.current = null;
    };
  }, [trayMount]);

  useEffect(() => {
    trayRef.current?.setSelection(selection);
  }, [selection]);

  const setProjection = useCallback((viewport: Viewport) => {
    viewportRef.current = viewport;
    engineRef.current?.setMapProjection(viewport);
  }, []);

  const setSecret = useCallback((on: boolean) => {
    secretRef.current = on;
  }, []);

  const setSafeAreaProvider = useCallback((provider: (() => SafeInsets) | null) => {
    safeAreaRef.current = provider;
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      try {
        // Global = device default; per-campaign = authoritative for this campaign.
        window.localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
        if (roomId) writeCampaignFlag(roomId, "dice-3d", on);
      } catch {
        // preference just won't persist
      }
      if (on) {
        void ensureEngine();
      } else {
        setSelection({});
      }
    },
    [ensureEngine, roomId],
  );

  const setMuted = useCallback(
    (next: boolean) => {
      audioRef.current?.setMuted(next);
      setMutedState(next);
      // Persist even before the engine/audio loads (settings can toggle with 3D off).
      try {
        window.localStorage.setItem(MUTED_KEY, next ? "1" : "0");
        if (roomId) writeCampaignFlag(roomId, "dice-muted", next);
      } catch {
        // preference just won't persist
      }
    },
    [roomId],
  );

  const setSkinPref = useCallback(
    (target: "all" | "coin" | "tray" | number, value: string | null) => {
      const next = mergeSkinPref(skinPrefsRef.current, target, value);
      skinPrefsRef.current = next;
      setSkinPrefsState(next);
      try {
        // Global = device default; per-campaign = authoritative for this campaign.
        window.localStorage.setItem(SKINS_KEY, JSON.stringify(next));
        if (roomId) writeCampaignJson(roomId, "dice-skins", next);
      } catch {
        // preference just won't persist
      }
      trayRef.current?.setSkinPrefs(next);
    },
    [roomId],
  );

  const previewSkinPref = useCallback((prefs: DiceSkinPrefs | null) => {
    // The tray surface previews via CSS alone (DiceTray), so it never reaches here.
    trayRef.current?.setSkinPrefs(prefs ?? skinPrefsRef.current);
  }, []);

  const preloadAllSkins = useCallback(() => {
    void import("./skins").then((m) => m.preloadAllSkinTextures());
  }, []);

  // Restore this campaign's dice prefs once when it's joined — applies to the engine/audio and
  // migrates the pre-join global default into the per-campaign key.
  useEffect(() => {
    if (!roomId || restoredDiceRoomRef.current === roomId) {
      return;
    }
    restoredDiceRoomRef.current = roomId;
    setEnabled(readEnabled(roomId));
    setMuted(readMuted(roomId));
    const prefs = readSkinPrefs(roomId);
    skinPrefsRef.current = prefs;
    setSkinPrefsState(prefs);
    trayRef.current?.setSkinPrefs(prefs);
  }, [roomId, setEnabled, setMuted]);

  const adjustSelection = useCallback((sides: number, delta: number) => {
    setSelection((current) => {
      const cur = current[sides] ?? 0;
      const next = Math.max(0, cur + delta);
      if (delta > 0) {
        const total = Object.entries(current).reduce(
          (sum, [s, n]) => sum + physicalCount(Number(s)) * n,
          0,
        );
        if (total + physicalCount(sides) * delta > MAX_PHYSICAL_DICE) {
          return current;
        }
      }
      const updated = { ...current };
      if (next === 0) {
        delete updated[sides];
      } else {
        updated[sides] = next;
      }
      return updated;
    });
  }, []);

  const clearSelection = useCallback(() => setSelection({}), []);

  const setInitiativeDieHighlight = useCallback((on: boolean) => {
    initHighlightRef.current = on;
    trayRef.current?.setInitiativeHighlight(on);
  }, []);

  /** This client's window center in map/world coordinates — the text-roll throw anchor. */
  const viewCenter = useCallback((): WorldPoint => {
    const viewport = viewportRef.current;
    const scale = viewport.scale > 0 ? viewport.scale : 1;
    return [
      (window.innerWidth / 2 - viewport.x) / scale,
      (window.innerHeight / 2 - viewport.y) / scale,
    ];
  }, []);

  /** Is a screen point inside the tray well's rect (the drop-to-cancel zone)? */
  const isOverTray = useCallback((clientX: number, clientY: number): boolean => {
    const el = trayElRef.current;
    if (!el) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }, []);

  /// <summary>
  /// Registers a roll and its window drag listeners through to release. If the die is
  /// dragged out of the tray and then dropped back onto it, the throw is cancelled and
  /// the readied dice return to the tray (rather than being flung).
  /// </summary>
  const rideDrag = useCallback(
    (
      engine: DiceEngine,
      rollId: string,
      picks: Array<[number, number]>,
      specs: DieSpec[],
      onUpExtra?: () => void,
    ) => {
      // Only allow drop-to-cancel once the die has actually left the tray, so a plain
      // click-in-place still lobs the dice gently instead of instantly cancelling.
      let leftTray = false;
      // While dragging BACK over the tray, the dice pop back onto it (a live preview of
      // the cancel) instead of hiding under the tray UI; drag out again and they re-grab.
      let inTray = false;

      const returnToTray = () => {
        engine.cancelActiveDrag();
        trayRef.current?.restoreLifted();
        setSelection(grabbedSelectionRef.current); // show them readied again
        inTray = true;
      };
      const regrab = (x: number, y: number) => {
        const tray = trayRef.current;
        if (!tray) return;
        const poses = tray.liftForGrab(picks);
        setSelection({});
        engine.beginTrayGrab(rollId, specs, poses, x, y);
        inTray = false;
      };

      const onMove = (e: PointerEvent) => {
        const over = isOverTray(e.clientX, e.clientY);
        if (!over) {
          leftTray = true;
        }
        if (over && leftTray && !inTray) {
          returnToTray();
        } else if (!over && inTray) {
          regrab(e.clientX, e.clientY);
          engine.moveDrag(e.clientX, e.clientY);
        } else if (!inTray) {
          engine.moveDrag(e.clientX, e.clientY);
        }
        e.preventDefault();
      };
      const onUp = (e: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (inTray || (leftTray && isOverTray(e.clientX, e.clientY))) {
          // Released back over the tray: discard the throw, un-arm it, and leave the
          // readied dice resting in the tray so nothing is left in hand.
          if (!inTray) {
            engine.cancelActiveDrag();
          }
          armedRef.current.delete(rollId);
          ourRollIdsRef.current.delete(rollId);
          setSelection(grabbedSelectionRef.current);
        } else {
          engine.endDrag(e.clientX, e.clientY);
        }
        onUpExtra?.();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [isOverTray],
  );

  const grabFromTray = useCallback(
    (event: { clientX: number; clientY: number }): boolean => {
      if (!enabledRef.current) {
        return false;
      }
      const engine = engineRef.current;
      const tray = trayRef.current;
      if (!engine || !tray) {
        void ensureEngine(); // warm up for next time
        return false;
      }
      const hit = tray.hitTest(event.clientX, event.clientY);
      if (hit === null) {
        return false;
      }
      // Grabbing a highlighted die picks up the whole selection (grabbed type first);
      // an unhighlighted die is a quick single grab.
      const current = selectionRef.current;
      const picks: Array<[number, number]> =
        (current[hit] ?? 0) > 0
          ? [
              [hit, current[hit]],
              ...Object.entries(current)
                .filter(([s, n]) => Number(s) !== hit && n > 0)
                .map(([s, n]) => [Number(s), n] as [number, number]),
            ]
          : [[hit, 1]];
      const poses = tray.liftForGrab(picks);
      const specs: DieSpec[] = applySkinsToSpecs(
        picks.flatMap(([sides, count]) =>
          Array.from({ length: count }, () =>
            decomposeDie(sides).map((spec) => ({ ...spec, id: uid() })),
          ).flat(),
        ),
        skinPrefsRef.current,
      );
      if (specs.length === 0 || specs.length > MAX_DICE_PER_THROW) {
        tray.restoreLifted();
        return false;
      }
      const rollId = uid();
      armedRef.current.set(rollId, { specs, modifier: 0 });
      ourRollIdsRef.current.add(rollId);
      // Remember what was readied so dropping the dice back into the tray restores it.
      grabbedSelectionRef.current = current;
      setSelection({});
      audioRef.current?.resume();
      engine.beginTrayGrab(rollId, specs, poses, event.clientX, event.clientY);
      rideDrag(engine, rollId, picks, specs, () => trayRef.current?.restoreLifted());
      return true;
    },
    [ensureEngine, rideDrag],
  );

  const throwExpression = useCallback(
    (expression: string): boolean => {
      if (!enabledRef.current || !engineRef.current) {
        if (enabledRef.current) {
          void ensureEngine();
        }
        return false;
      }
      const parsed = parseDiceExpression(expression);
      if (!parsed || parsed.specs.length > MAX_PHYSICAL_DICE) {
        return false;
      }
      const specs = applySkinsToSpecs(
        parsed.specs.map((spec) => ({ ...spec, id: uid() })),
        skinPrefsRef.current,
      );
      const engine = engineRef.current;
      const rollId = uid();
      armedRef.current.set(rollId, { specs, modifier: parsed.modifier });
      ourRollIdsRef.current.add(rollId);
      audioRef.current?.resume();
      engine.arm(rollId, specs, viewCenter());
      engine.autoThrow(rollId);
      return true;
    },
    [ensureEngine, viewCenter],
  );

  const throwSelection = useCallback((): boolean => {
    if (!enabledRef.current || !engineRef.current) {
      if (enabledRef.current) {
        void ensureEngine(); // warm up for next time
      }
      return false;
    }
    // Same spec-building as grabFromTray, minus the tray lift: the dice drop in from
    // the view center like an expression throw. decomposeDie handles the coin (d2)
    // and splits a d100 into its d10 pair.
    const current = selectionRef.current;
    const specs: DieSpec[] = applySkinsToSpecs(
      Object.entries(current).flatMap(([sides, count]) =>
        Array.from({ length: count }, () =>
          decomposeDie(Number(sides)).map((spec) => ({ ...spec, id: uid() })),
        ).flat(),
      ),
      skinPrefsRef.current,
    );
    if (specs.length === 0 || specs.length > MAX_DICE_PER_THROW) {
      return false;
    }
    const engine = engineRef.current;
    const rollId = uid();
    armedRef.current.set(rollId, { specs, modifier: 0 });
    ourRollIdsRef.current.add(rollId);
    setSelection({});
    audioRef.current?.resume();
    engine.arm(rollId, specs, viewCenter());
    engine.autoThrow(rollId);
    return true;
  }, [ensureEngine, viewCenter]);

  const throwInitiative = useCallback(
    (entryIds?: string[]): boolean => {
      if (!enabledRef.current || !engineRef.current) {
        if (enabledRef.current) {
          void ensureEngine(); // warm up for next time
        }
        return false;
      }
      // One d20 per targeted entry (DM rolling NPCs); a lone d20 for a player's own roll.
      const targets =
        entryIds && entryIds.length > 0 ? entryIds.slice(0, MAX_PHYSICAL_DICE) : undefined;
      const count = targets ? targets.length : 1;
      const specs = applySkinsToSpecs(
        Array.from({ length: count }, () => ({ id: uid(), kind: "d20" as const, percentile: false })),
        skinPrefsRef.current,
      );
      const engine = engineRef.current;
      const rollId = uid();
      armedRef.current.set(rollId, {
        specs,
        modifier: 0,
        context: { label: "Initiative", ...(targets ? { initiativeEntryIds: targets } : {}) },
      });
      ourRollIdsRef.current.add(rollId);
      audioRef.current?.resume();
      engine.arm(rollId, specs, viewCenter());
      engine.autoThrow(rollId);
      return true;
    },
    [ensureEngine, viewCenter],
  );

  // Preload the engine as soon as 3D is enabled and the arena exists, so the first
  // grab doesn't stall on the three/rapier download.
  useEffect(() => {
    if (enabled && container) {
      void ensureEngine();
    }
  }, [enabled, container, ensureEngine]);

  return {
    containerRef,
    trayMountRef,
    setProjection,
    setSafeAreaProvider,
    setSecret,
    enabled,
    setEnabled,
    muted,
    setMuted,
    skinPrefs,
    setSkinPref,
    previewSkinPref,
    preloadAllSkins,
    selection,
    adjustSelection,
    clearSelection,
    setInitiativeDieHighlight,
    grabFromTray,
    throwExpression,
    throwSelection,
    throwInitiative,
  };
}
