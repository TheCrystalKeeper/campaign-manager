import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRoom } from "../hooks/useGameRoom";
import { TOKEN_COLORS, type Viewport } from "../lib/types";
import { DiceAudio } from "./diceAudio";
import {
  decomposeDie,
  parseDiceExpression,
  type DieSpec,
  type WorldPoint,
} from "./diceProtocol";
import type { DiceEngine } from "./diceEngine";

/** Live map projection the dice arena needs to anchor + draw dice on the shared map. */
export interface MapProjection {
  viewport: Viewport;
  gridSize: number;
  /** Current view center in map/world coords; used as a roll's tray anchor. */
  center: WorldPoint;
  /** Roll region size in grid cells (sized from the shared map), for the physics box. */
  regionCellsW: number;
  regionCellsH: number;
}

const DEFAULT_PROJECTION: MapProjection = {
  viewport: { x: 0, y: 0, scale: 1 },
  gridSize: 50,
  center: [0, 0],
  regionCellsW: 12,
  regionCellsH: 12,
};

/// <summary>
/// Owns the 3D dice arena lifecycle: lazily loads the Three.js + Rapier engine, wires
/// it to the multiplayer room (recorded-track throws, live drag motion + roller cursor,
/// authoritative results), confines dice to the map pane, and exposes arm/throw controls.
/// </summary>

const TRAY_KEY = "dice-tray-visible";
const CURSOR_HIDE_MS = 1400;

interface ArmedRoll {
  specs: DieSpec[];
  modifier: number;
  private: boolean;
  /** Map/world anchor captured when the roll was armed. */
  trayCenter: WorldPoint;
}

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
  arm: (sides: number, options?: { modifier?: number; private?: boolean }) => void;
  /** Throws the currently armed dice without a manual drag. */
  throwArmed: () => void;
  /** Parses an expression (e.g. "1d77", "2d6+3") and throws it physically. */
  throwExpression: (expression: string) => void;
  /** Resolves the currently armed dice with a quick spin-to-value reveal. */
  instantArmed: () => void;
  /** Parses an expression and resolves it with a quick spin-to-value reveal. */
  instantExpression: (expression: string) => void;
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

  const [ready, setReady] = useState(false);
  const [hasArmed, setHasArmed] = useState(false);
  const [trayVisible, setTrayVisibleState] = useState(readTrayVisible);
  const [muted, setMutedState] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<RemoteCursor | null>(null);

  roomRef.current = room;

  const showRemoteCursor = useCallback((cursor: WorldPoint, rollerId: string, name: string) => {
    // The cursor is in shared map/world coords; project it through our own viewport so it
    // lands at the same map location regardless of our window size or zoom.
    const rect = mapElRef.current?.getBoundingClientRect();
    const left = rect ? rect.left : 0;
    const top = rect ? rect.top : 0;
    const { viewport } = projectionRef.current;
    setRemoteCursor({
      x: left + viewport.x + cursor[0] * viewport.scale,
      y: top + viewport.y + cursor[1] * viewport.scale,
      name,
      color: colorFor(rollerId),
    });
    if (cursorTimerRef.current) {
      clearTimeout(cursorTimerRef.current);
    }
    cursorTimerRef.current = setTimeout(() => setRemoteCursor(null), CURSOR_HIDE_MS);
  }, []);

  const setProjection = useCallback((projection: MapProjection) => {
    projectionRef.current = projection;
    engineRef.current?.setMapProjection({
      viewport: projection.viewport,
      gridSize: projection.gridSize,
      regionCellsW: projection.regionCellsW,
      regionCellsH: projection.regionCellsH,
    });
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
            if (armed) {
              roomRef.current.sendDiceMotion(rollId, armed.specs, transforms, cursor, armed.trayCenter);
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
                private: armed.private,
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
        engine.setMapProjection({
          viewport: projectionRef.current.viewport,
          gridSize: projectionRef.current.gridSize,
          regionCellsW: projectionRef.current.regionCellsW,
          regionCellsH: projectionRef.current.regionCellsH,
        });
        setReady(true);

        unsubscribe = roomRef.current.subscribeDice((event) => {
          const eng = engineRef.current;
          if (!eng) {
            return;
          }
          if (event.type === "DICE_THROW") {
            const local = ourRollIdsRef.current.has(event.rollId);
            const trayCenter = event.trayCenter ?? projectionRef.current.center;
            eng.playTrack(event.rollId, event.specs, event.track, event.faceValues, local, trayCenter);
            if (local) {
              ourRollIdsRef.current.delete(event.rollId);
              armedRef.current.delete(event.rollId);
            }
          } else if (event.type === "DICE_MOTION") {
            if (!ourRollIdsRef.current.has(event.rollId)) {
              const trayCenter = event.trayCenter ?? projectionRef.current.center;
              eng.applyRemoteMotion(event.rollId, event.specs, event.transforms, trayCenter);
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

  // Places a parsed dice set on the tray (clearing any prior armed-but-unthrown roll) and
  // returns its rollId, or null if the engine isn't ready.
  const armSpecs = useCallback((specs: DieSpec[], modifier: number, isPrivate: boolean): string | null => {
    const engine = engineRef.current;
    if (!engine || specs.length === 0) {
      return null;
    }
    const previous = currentRollIdRef.current;
    if (previous && armedRef.current.has(previous)) {
      engine.clearRoll(previous);
      armedRef.current.delete(previous);
      ourRollIdsRef.current.delete(previous);
    }
    const rollId = uid();
    const trayCenter = projectionRef.current.center;
    armedRef.current.set(rollId, { specs, modifier, private: isPrivate, trayCenter });
    ourRollIdsRef.current.add(rollId);
    currentRollIdRef.current = rollId;
    engine.arm(rollId, specs, trayCenter);
    audioRef.current?.resume();
    return rollId;
  }, []);

  const arm = useCallback(
    (sides: number, options?: { modifier?: number; private?: boolean }) => {
      const specs = decomposeDie(sides).map((spec) => ({ ...spec, id: uid() }));
      if (armSpecs(specs, options?.modifier ?? 0, options?.private ?? false)) {
        setHasArmed(true);
      }
    },
    [armSpecs],
  );

  const throwExpression = useCallback(
    (expression: string) => {
      const parsed = parseDiceExpression(expression);
      if (!parsed) {
        return;
      }
      const specs = parsed.specs.map((spec) => ({ ...spec, id: uid() }));
      const rollId = armSpecs(specs, parsed.modifier, false);
      if (rollId) {
        engineRef.current?.autoThrow(rollId);
      }
    },
    [armSpecs],
  );

  const instantArmed = useCallback(() => {
    const engine = engineRef.current;
    const rollId = currentRollIdRef.current;
    if (!engine || !rollId) {
      return;
    }
    audioRef.current?.resume();
    engine.quickThrow(rollId);
  }, []);

  const instantExpression = useCallback(
    (expression: string) => {
      const parsed = parseDiceExpression(expression);
      if (!parsed) {
        return;
      }
      const specs = parsed.specs.map((spec) => ({ ...spec, id: uid() }));
      const rollId = armSpecs(specs, parsed.modifier, false);
      if (rollId) {
        engineRef.current?.quickThrow(rollId);
      }
    },
    [armSpecs],
  );

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
  };
}
