import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRoom } from "../hooks/useGameRoom";
import { TOKEN_COLORS, type Viewport } from "../lib/types";
import { DiceAudio } from "./diceAudio";
import {
  decomposeDie,
  parseDiceExpression,
  type DieSpec,
  type DieTransform,
  type WorldPoint,
} from "./diceProtocol";
import type { DiceEngine } from "./diceEngine";

/** Live map projection the dice arena needs to anchor + draw dice on the shared map. */
export interface MapProjection {
  viewport: Viewport;
  /** Current view center in map/world coords; used as a roll's tray anchor. */
  center: WorldPoint;
}

const DEFAULT_PROJECTION: MapProjection = {
  viewport: { x: 0, y: 0, scale: 1 },
  center: [0, 0],
};

/// <summary>
/// Owns the 3D dice arena lifecycle: lazily loads the Three.js + Rapier engine, wires
/// it to the multiplayer room (recorded-track throws, live drag motion + roller cursor,
/// authoritative results), confines dice to the map pane, and exposes arm/throw controls.
/// </summary>

const TRAY_KEY = "dice-tray-visible";
const CURSOR_HIDE_MS = 1400;
const MOTION_KEEPALIVE_MS = 140;
const MOTION_EPS = 0.01;
const CURSOR_EPS = 0.35;

interface ArmedRoll {
  specs: DieSpec[];
  modifier: number;
  /** Map/world anchor captured when the roll was armed. */
  trayCenter: WorldPoint;
}

type MotionSendState = {
  lastSentAt: number;
  specsSent: boolean;
  lastTransforms: DieTransform[] | null;
  lastCursor?: WorldPoint;
};

export interface RemoteCursor {
  x: number;
  y: number;
  name: string;
  color: string;
}

export interface DiceArenaController {
  /** Callback ref for the arena element; engine boots when the node mounts. */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Callback ref for the map pane element; dice are confined to it. */
  mapAreaRef: (node: HTMLDivElement | null) => void;
  /** Feeds the live map viewport/grid so dice stay anchored to the map. */
  setProjection: (projection: MapProjection) => void;
  ready: boolean;
  hasArmed: boolean;
  trayVisible: boolean;
  setTrayVisible: (visible: boolean) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** The roller's cursor to draw while someone else is rolling, or null. */
  remoteCursor: RemoteCursor | null;
  /** Arms a die set (d100 becomes a percentile d10 + a unit d10) ready to grab/throw. */
  arm: (sides: number, options?: { modifier?: number }) => void;
  /** Throws the currently armed dice without a manual drag. */
  throwArmed: () => void;
  /** Parses an expression (e.g. "1d77", "2d6+3") and throws it physically. */
  throwExpression: (expression: string) => void;
  /** Resolves the currently armed dice with a quick spin-to-value reveal. */
  instantArmed: () => void;
  /** Parses an expression and resolves it with a quick spin-to-value reveal. */
  instantExpression: (expression: string) => void;
  /** DM-only: while on, the DM's rolls are secret (players see blank dice, no numbers). */
  setSecretMode: (on: boolean) => void;
}

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function readTrayVisible(): boolean {
  try {
    return window.localStorage.getItem(TRAY_KEY) !== "0";
  } catch {
    return true;
  }
}

/// <summary>Deterministically picks a player color from a roller id.</summary>
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return TOKEN_COLORS[hash % TOKEN_COLORS.length];
}

export function useDiceArena(room: GameRoom): DiceArenaController {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), []);
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const mapAreaRef = useCallback((node: HTMLDivElement | null) => setMapEl(node), []);
  const mapElRef = useRef<HTMLDivElement | null>(null);
  mapElRef.current = mapEl;

  const engineRef = useRef<DiceEngine | null>(null);
  const audioRef = useRef<DiceAudio | null>(null);
  const roomRef = useRef(room);
  const projectionRef = useRef<MapProjection>(DEFAULT_PROJECTION);
  const armedRef = useRef<Map<string, ArmedRoll>>(new Map());
  const ourRollIdsRef = useRef<Set<string>>(new Set());
  const currentRollIdRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionStateRef = useRef<Map<string, MotionSendState>>(new Map());
  const remoteSpecsRef = useRef<Map<string, DieSpec[]>>(new Map());
  // DM-only secret mode, read live at throw/drag time so it can't go stale.
  const secretModeRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [hasArmed, setHasArmed] = useState(false);
  const [trayVisible, setTrayVisibleState] = useState(readTrayVisible);
  const [muted, setMutedState] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<RemoteCursor | null>(null);

  roomRef.current = room;

  const showRemoteCursor = useCallback((cursor: WorldPoint, rollerId: string, name: string) => {
    // The cursor is normalized 0..1 within the roller's map pane; place it at the same
    // relative spot in our own pane (dice are centered per-viewer, so this stays aligned).
    const rect = mapElRef.current?.getBoundingClientRect();
    const left = rect ? rect.left : 0;
    const top = rect ? rect.top : 0;
    const width = rect ? rect.width : window.innerWidth;
    const height = rect ? rect.height : window.innerHeight;
    setRemoteCursor({
      x: left + cursor[0] * width,
      y: top + cursor[1] * height,
      name,
      color: colorFor(rollerId),
    });
    if (cursorTimerRef.current) {
      clearTimeout(cursorTimerRef.current);
    }
    cursorTimerRef.current = setTimeout(() => setRemoteCursor(null), CURSOR_HIDE_MS);
  }, []);

  /// <summary>Quantizes and compares motion payloads to avoid noisy cloud sync updates.</summary>
  const pushMotion = useCallback(
    (rollId: string, armed: ArmedRoll, transforms: DieTransform[], cursor: WorldPoint) => {
      const now = performance.now();
      const state = motionStateRef.current.get(rollId) ?? {
        lastSentAt: 0,
        specsSent: false,
        lastTransforms: null,
      };
      const wireTransforms = transforms.map((transform) => ({
        id: transform.id,
        p: transform.p.map((value: number) => Math.round(value * 1000) / 1000) as DieTransform["p"],
        q: transform.q.map((value: number) => Math.round(value * 1000) / 1000) as DieTransform["q"],
      }));
      const wireCursor: WorldPoint = [
        Math.round(cursor[0] * 100) / 100,
        Math.round(cursor[1] * 100) / 100,
      ];
      const moved =
        !state.lastTransforms ||
        wireTransforms.length !== state.lastTransforms.length ||
        wireTransforms.some((next, index) => {
          const prev = state.lastTransforms![index];
          if (!prev || prev.id !== next.id) {
            return true;
          }
          for (let i = 0; i < 3; i += 1) {
            if (Math.abs(prev.p[i] - next.p[i]) > MOTION_EPS) {
              return true;
            }
          }
          for (let i = 0; i < 4; i += 1) {
            if (Math.abs(prev.q[i] - next.q[i]) > MOTION_EPS) {
              return true;
            }
          }
          return false;
        });
      const cursorMoved =
        !state.lastCursor ||
        Math.hypot(state.lastCursor[0] - wireCursor[0], state.lastCursor[1] - wireCursor[1]) >
          CURSOR_EPS;
      const stale = now - state.lastSentAt >= MOTION_KEEPALIVE_MS;
      if (!moved && !cursorMoved && !stale) {
        return;
      }
      roomRef.current.sendDiceMotion(
        rollId,
        state.specsSent ? undefined : armed.specs,
        wireTransforms,
        wireCursor,
        armed.trayCenter,
        secretModeRef.current,
      );
      motionStateRef.current.set(rollId, {
        lastSentAt: now,
        specsSent: true,
        lastTransforms: wireTransforms,
        lastCursor: wireCursor,
      });
    },
    [],
  );

  const setProjection = useCallback((projection: MapProjection) => {
    projectionRef.current = projection;
    engineRef.current?.setMapProjection({ viewport: projection.viewport });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!container) {
      return;
    }

    const audio = new DiceAudio();
    audioRef.current = audio;
    setMutedState(audio.isMuted());

    let cleanupPointer: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      try {
        const { DiceEngine } = await import("./diceEngine");
        if (cancelled) {
          return;
        }
        const engine = await DiceEngine.create(container, {
          onMotion: (rollId, transforms, cursor) => {
            const armed = armedRef.current.get(rollId);
            // Broadcast the live shake for everyone; secret rolls just render blank (no numbers).
            if (armed) {
              pushMotion(rollId, armed, transforms, cursor);
            }
          },
          onRelease: (rollId, track) => {
            const armed = armedRef.current.get(rollId);
            if (armed) {
              roomRef.current.throwDice({
                rollId,
                specs: armed.specs,
                track,
                modifier: armed.modifier,
                private: secretModeRef.current,
                trayCenter: armed.trayCenter,
              });
            }
            if (currentRollIdRef.current === rollId) {
              currentRollIdRef.current = null;
              setHasArmed(false);
            }
          },
          onImpact: (strength) => audio.impact(strength),
        });
        if (cancelled) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        engine.setPlayArea(mapElRef.current);
        engine.setMapProjection({ viewport: projectionRef.current.viewport });
        setReady(true);

        unsubscribe = roomRef.current.subscribeDice((event) => {
          const eng = engineRef.current;
          if (!eng) {
            return;
          }
          if (event.type === "DICE_THROW") {
            const local = ourRollIdsRef.current.has(event.rollId);
            // No faceValues => a DM secret roll relayed to a non-DM client: render blank.
            const blank = !event.faceValues || event.faceValues.length === 0;
            eng.playTrack(
              event.rollId,
              event.specs,
              event.track,
              event.faceValues ?? [],
              local,
              blank,
            );
            if (local) {
              ourRollIdsRef.current.delete(event.rollId);
              armedRef.current.delete(event.rollId);
              motionStateRef.current.delete(event.rollId);
            } else {
              remoteSpecsRef.current.delete(event.rollId);
            }
          } else if (event.type === "DICE_MOTION") {
            if (!ourRollIdsRef.current.has(event.rollId)) {
              if (event.specs && event.specs.length > 0) {
                remoteSpecsRef.current.set(event.rollId, event.specs);
              }
              const specs = event.specs ?? remoteSpecsRef.current.get(event.rollId);
              if (!specs) {
                return;
              }
              eng.applyRemoteMotion(event.rollId, specs, event.transforms, event.secret === true);
              if (event.cursor) {
                showRemoteCursor(event.cursor, event.rollerId, event.rollerName);
              }
            }
          }
        });

        // The arena canvas stays click-through; dragging engages only when the pointer
        // lands on an armed die, so the rest of the UI is never blocked.
        const onDown = (e: PointerEvent) => {
          const rollId = currentRollIdRef.current;
          if (!rollId || !engine.isArmed(rollId) || !engine.hitTestArmed(rollId, e.clientX, e.clientY)) {
            return;
          }
          audio.resume();
          draggingRef.current = true;
          engine.beginDrag(rollId, e.clientX, e.clientY);
          e.preventDefault();
          e.stopPropagation();
        };
        const onMove = (e: PointerEvent) => {
          if (draggingRef.current) {
            engine.moveDrag(e.clientX, e.clientY);
          }
        };
        const onUp = (e: PointerEvent) => {
          if (!draggingRef.current) {
            return;
          }
          draggingRef.current = false;
          engine.endDrag(e.clientX, e.clientY);
        };
        window.addEventListener("pointerdown", onDown, true);
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
        cleanupPointer = () => {
          window.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("pointermove", onMove, true);
          window.removeEventListener("pointerup", onUp, true);
        };
      } catch (err) {
        console.error("[dice] engine init failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      cleanupPointer?.();
      unsubscribe?.();
      if (cursorTimerRef.current) {
        clearTimeout(cursorTimerRef.current);
      }
      motionStateRef.current.clear();
      remoteSpecsRef.current.clear();
      engineRef.current?.dispose();
      engineRef.current = null;
      audioRef.current?.dispose();
      audioRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]);

  // Keep the engine's play area pointed at the current map pane.
  useEffect(() => {
    engineRef.current?.setPlayArea(mapEl);
  }, [mapEl, ready]);

  const setTrayVisible = useCallback((visible: boolean) => {
    setTrayVisibleState(visible);
    try {
      window.localStorage.setItem(TRAY_KEY, visible ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, []);

  const setMuted = useCallback((next: boolean) => {
    audioRef.current?.setMuted(next);
    setMutedState(next);
  }, []);

  /// <summary>
  /// Places a parsed dice set on the tray, clearing any prior armed roll immediately.
  /// Returns the new roll id (or null when the engine isn't ready).
  /// </summary>
  const armSpecs = useCallback((specs: DieSpec[], modifier: number) => {
    const engine = engineRef.current;
    if (!engine || specs.length === 0) {
      return null;
    }
    const previous = currentRollIdRef.current;
    if (previous && armedRef.current.has(previous)) {
      engine.clearRoll(previous);
      armedRef.current.delete(previous);
      ourRollIdsRef.current.delete(previous);
      motionStateRef.current.delete(previous);
    }
    const rollId = uid();
    const trayCenter = projectionRef.current.center;
    armedRef.current.set(rollId, { specs, modifier, trayCenter });
    ourRollIdsRef.current.add(rollId);
    currentRollIdRef.current = rollId;
    motionStateRef.current.set(rollId, {
      lastSentAt: 0,
      specsSent: false,
      lastTransforms: null,
    });
    engine.arm(rollId, specs);
    audioRef.current?.resume();
    return rollId;
  }, []);

  /// <summary>Arms a single die size (d100 expands to two d10s) at screen center.</summary>
  const arm = useCallback(
    (sides: number, options?: { modifier?: number }) => {
      const specs = decomposeDie(sides).map((spec) => ({ ...spec, id: uid() }));
      if (armSpecs(specs, options?.modifier ?? 0)) {
        setHasArmed(true);
      }
    },
    [armSpecs],
  );

  /// <summary>DM-only: toggles secret mode (the DM's rolls hide their numbers from players).</summary>
  const setSecretMode = useCallback((on: boolean) => {
    secretModeRef.current = on;
  }, []);

  /// <summary>Parses and physically throws an expression after fading previous dice.</summary>
  const throwExpression = useCallback(
    (expression: string) => {
      const parsed = parseDiceExpression(expression);
      if (!parsed) {
        return;
      }
      const specs = parsed.specs.map((spec) => ({ ...spec, id: uid() }));
      const rollId = armSpecs(specs, parsed.modifier);
      if (rollId) {
        engineRef.current?.autoThrow(rollId);
      }
    },
    [armSpecs],
  );

  /// <summary>Resolves the currently armed dice with a fast local spin.</summary>
  const instantArmed = useCallback(() => {
    const engine = engineRef.current;
    const rollId = currentRollIdRef.current;
    if (!engine || !rollId) {
      return;
    }
    audioRef.current?.resume();
    engine.quickThrow(rollId);
  }, []);

  /// <summary>Parses and instantly resolves an expression after fading previous dice.</summary>
  const instantExpression = useCallback(
    (expression: string) => {
      const parsed = parseDiceExpression(expression);
      if (!parsed) {
        return;
      }
      const specs = parsed.specs.map((spec) => ({ ...spec, id: uid() }));
      const rollId = armSpecs(specs, parsed.modifier);
      if (rollId) {
        engineRef.current?.quickThrow(rollId);
      }
    },
    [armSpecs],
  );

  /// <summary>Throws the currently armed dice from the centered tray.</summary>
  const throwArmed = useCallback(() => {
    const engine = engineRef.current;
    const rollId = currentRollIdRef.current;
    if (!engine || !rollId) {
      return;
    }
    audioRef.current?.resume();
    engine.autoThrow(rollId);
  }, []);

  return {
    containerRef,
    mapAreaRef,
    setProjection,
    ready,
    hasArmed,
    trayVisible,
    setTrayVisible,
    muted,
    setMuted,
    remoteCursor,
    arm,
    throwArmed,
    throwExpression,
    instantArmed,
    instantExpression,
    setSecretMode,
  };
}
