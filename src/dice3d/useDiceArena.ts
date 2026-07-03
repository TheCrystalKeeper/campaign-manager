import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRoom } from "../hooks/useGameRoom";
import { TOKEN_COLORS } from "../lib/types";
import { DiceAudio } from "./diceAudio";
import { DICE_ROLL_LINGER_MS } from "./diceTiming";
import {
  decomposeDie,
  parseDiceExpression,
  type DieSpec,
  type DieTransform,
  type WorldPoint,
} from "./diceProtocol";
import type { DiceEngine } from "./diceEngine";

/// <summary>
/// Owns the 3D dice arena lifecycle: lazily loads the Three.js + Rapier engine, wires
/// it to the multiplayer room (recorded-track throws, live drag motion + roller cursor),
/// and exposes arm/throw controls. Dice render in fixed screen space over the full UI.
/// </summary>

const TRAY_KEY = "dice-tray-visible";
const CURSOR_HIDE_MS = 1400;
const MOTION_KEEPALIVE_MS = 140;
const MOTION_EPS = 0.01;
const CURSOR_EPS = 0.003;
/** Screen-space tray anchor (legacy wire field; always viewport center). */
const TRAY_CENTER: WorldPoint = [0, 0];

interface ArmedRoll {
  specs: DieSpec[];
  modifier: number;
  private: boolean;
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
  /** Fades 3D dice out after the roll notification linger period. */
  scheduleRollFade: (physicsRollId: string) => void;
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
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerElRef.current = node;
    setContainer(node);
  }, []);

  const engineRef = useRef<DiceEngine | null>(null);
  const audioRef = useRef<DiceAudio | null>(null);
  const roomRef = useRef(room);
  const armedRef = useRef<Map<string, ArmedRoll>>(new Map());
  const ourRollIdsRef = useRef<Set<string>>(new Set());
  const currentRollIdRef = useRef<string | null>(null);
  const draggingRef = useRef(false);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionStateRef = useRef<Map<string, MotionSendState>>(new Map());
  const remoteSpecsRef = useRef<Map<string, DieSpec[]>>(new Map());
  const rollFadeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [ready, setReady] = useState(false);
  const [hasArmed, setHasArmed] = useState(false);
  const [trayVisible, setTrayVisibleState] = useState(readTrayVisible);
  const [muted, setMutedState] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<RemoteCursor | null>(null);

  roomRef.current = room;

  const showRemoteCursor = useCallback((cursor: WorldPoint, rollerId: string, name: string) => {
    const rect = containerElRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setRemoteCursor({
      x: rect.left + cursor[0] * rect.width,
      y: rect.top + cursor[1] * rect.height,
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
        Math.round(cursor[0] * 1000) / 1000,
        Math.round(cursor[1] * 1000) / 1000,
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
        setReady(true);

        unsubscribe = roomRef.current.subscribeDice((event) => {
          const eng = engineRef.current;
          if (!eng) {
            return;
          }
          if (event.type === "DICE_THROW") {
            const local = ourRollIdsRef.current.has(event.rollId);
            eng.playTrack(event.rollId, event.specs, event.track, event.faceValues, local, TRAY_CENTER);
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
              eng.applyRemoteMotion(event.rollId, specs, event.transforms, TRAY_CENTER);
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
      for (const timer of rollFadeTimersRef.current.values()) {
        clearTimeout(timer);
      }
      rollFadeTimersRef.current.clear();
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
  /// Places a parsed dice set on the tray after fading any prior armed roll out, then
  /// returns the new roll id (or null when the engine isn't ready).
  /// </summary>
  const armSpecs = useCallback(async (specs: DieSpec[], modifier: number, isPrivate: boolean) => {
    const engine = engineRef.current;
    if (!engine || specs.length === 0) {
      return null;
    }
    const previous = currentRollIdRef.current;
    if (previous && armedRef.current.has(previous)) {
      await engine.fadeOutAndClear(previous);
      armedRef.current.delete(previous);
      ourRollIdsRef.current.delete(previous);
      motionStateRef.current.delete(previous);
    }
    const rollId = uid();
    armedRef.current.set(rollId, { specs, modifier, private: isPrivate, trayCenter: TRAY_CENTER });
    ourRollIdsRef.current.add(rollId);
    currentRollIdRef.current = rollId;
    motionStateRef.current.set(rollId, {
      lastSentAt: 0,
      specsSent: false,
      lastTransforms: null,
    });
    engine.arm(rollId, specs, TRAY_CENTER);
    audioRef.current?.resume();
    return rollId;
  }, []);

  /// <summary>Arms a single die size (d100 expands to two d10s) at screen center.</summary>
  const arm = useCallback(
    (sides: number, options?: { modifier?: number; private?: boolean }) => {
      void (async () => {
        const specs = decomposeDie(sides).map((spec) => ({ ...spec, id: uid() }));
        if (await armSpecs(specs, options?.modifier ?? 0, options?.private ?? false)) {
          setHasArmed(true);
        }
      })();
    },
    [armSpecs],
  );

  /// <summary>Parses and physically throws an expression after fading previous dice.</summary>
  const throwExpression = useCallback(
    (expression: string) => {
      void (async () => {
        const parsed = parseDiceExpression(expression);
        if (!parsed) {
          return;
        }
        const specs = parsed.specs.map((spec) => ({ ...spec, id: uid() }));
        const rollId = await armSpecs(specs, parsed.modifier, false);
        if (rollId) {
          engineRef.current?.autoThrow(rollId);
        }
      })();
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
      void (async () => {
        const parsed = parseDiceExpression(expression);
        if (!parsed) {
          return;
        }
        const specs = parsed.specs.map((spec) => ({ ...spec, id: uid() }));
        const rollId = await armSpecs(specs, parsed.modifier, false);
        if (rollId) {
          engineRef.current?.quickThrow(rollId);
        }
      })();
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

  const scheduleRollFade = useCallback((physicsRollId: string) => {
    const existing = rollFadeTimersRef.current.get(physicsRollId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      rollFadeTimersRef.current.delete(physicsRollId);
      engineRef.current?.triggerFade(physicsRollId);
    }, DICE_ROLL_LINGER_MS);
    rollFadeTimersRef.current.set(physicsRollId, timer);
  }, []);

  return {
    containerRef,
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
    scheduleRollFade,
  };
}
