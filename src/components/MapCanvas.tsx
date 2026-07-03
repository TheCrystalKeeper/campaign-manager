import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import {
  ANNOTATION_FADE_MS,
  CONDITIONS,
  type Annotation,
  type ClientMessage,
  type GameState,
  type HitPoints,
  type Light,
  type Viewport,
} from "../lib/types";
import {
  clampViewportScale,
  loadImageForCanvas,
  tokenRadiusForGridSize,
} from "../lib/sceneUtils";
import type { MeasureEvent } from "../hooks/useGameRoom";
import type { History } from "../lib/history";
import { toolsForRole } from "../map/tools/registry";
import { selectTool } from "../map/tools/select";
import { LIGHT_PRESETS, type LightPreset } from "../map/tools/lights";
import { RulerShape } from "../map/tools/measure";
import type { ToolPointerEvent, ToolRuntime } from "../map/tools/types";
import { MapToolbar } from "./MapToolbar";
import { FogLayer } from "./MapFog";
import { DmLightingOverlay, VisionMaskLayer, WallsLightsEditor } from "./MapVision";
import {
  annotationOpacity,
  annotationPathLength,
  appendAnnotationSample,
  appendDraftAnnotationSample,
  buildAnnotationDraftPreview,
  isAnnotationAtMaxPoints,
  trimAnnotationPoints,
  ANNOTATION_MIN_LENGTH,
} from "../lib/mapAnnotation";

/** The classic pointer-arrow palette (dark outline + cream fill), from the v1 system. */
const ARROW_COLOR = "#f0e6d2";

/** One remote client's live ruler, kept until cleared or stale (~2.5s). */
type RemoteRuler = {
  points: number[];
  name: string;
  color: string;
  sceneId: string;
  at: number;
};

const CURRENT_TURN_COLOR = "#e9c176";

const CONDITION_EMOJI = new Map<string, string>(
  CONDITIONS.map((condition) => [condition.id, condition.emoji]),
);

function hpBarColor(ratio: number): string {
  if (ratio > 0.5) return "#7bc488";
  if (ratio > 0.25) return "#e5a34a";
  return "#e5686b";
}

type MapCanvasProps = {
  state: GameState;
  sceneId: string;
  isDm: boolean;
  yourPlayerId: string | null;
  viewport: Viewport;
  /** Provided for the DM (pan/zoom enabled); omitted for players (read-only mirror). */
  onViewportChange?: (viewport: Viewport) => void;
  onMoveToken: (tokenId: string, x: number, y: number) => void;
  onSelectToken?: (tokenId: string | null) => void;
  selectedTokenId?: string | null;
  /** When set, the next map click places a token at the returned world coords. */
  onPlaceToken?: (x: number, y: number) => void;
  /** Room send — map tools commit their work as ordinary room messages. */
  send: (message: ClientMessage) => void;
  /** Live-ruler relay subscription (transient MEASURE messages). */
  subscribeMeasure: (listener: (event: MeasureEvent) => void) => () => void;
  /** Per-client snap-to-grid — owned by App (settings + the toolbar 🧲 share it). */
  snap: boolean;
  onToggleSnap: () => void;
  /**
   * Gates the window-level tool hotkeys (V/M/D/…): with two canvases mounted
   * (board + scene editor), only the visible one may listen. Default true.
   */
  hotkeysEnabled?: boolean;
  /** Scene-editor mode: the canvas fills its host element instead of the window. */
  embedded?: boolean;
  /** DM undo/redo for map/token edits — renders the ↶/↷ rail buttons when present. */
  history?: History;
};

/// <summary>
/// Loads an image URL into an HTMLImageElement for Konva, or null while loading.
/// </summary>
function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let active = true;
    loadImageForCanvas(url)
      .then((loaded) => {
        if (active) setImg(loaded);
      })
      .catch(() => {
        if (active) setImg(null);
      });
    return () => {
      active = false;
    };
  }, [url]);
  return img;
}

/// <summary>
/// Tracks the size of the canvas host element (ResizeObserver) so the Konva stage
/// fills it. On the board the host is fixed/inset-0 (== window size); embedded in
/// the scene editor it is the editor box. Guards the initial 0×0 pre-measure.
/// </summary>
function useElementSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/// <summary>
/// A single token: colored circle with optional portrait image, label, and
/// combat state — current-turn ring, HP bar (from the linked sheet), condition
/// badges, and a desaturated skull overlay at 0 HP.
/// </summary>
function TokenNode({
  token,
  imageUrl,
  radius,
  draggable,
  selected,
  isCurrentTurn,
  hp,
  showHpValues,
  onSelect,
  onMove,
}: {
  token: GameState["tokens"][number];
  /** Portrait to render on the token (resolved live from the linked sheet). */
  imageUrl: string | null;
  radius: number;
  draggable: boolean;
  selected: boolean;
  isCurrentTurn: boolean;
  /** HP to display under the token, or null to show no bar. */
  hp: HitPoints | null;
  showHpValues: boolean;
  onSelect?: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const img = useImage(imageUrl);
  const dead = hp !== null && hp.max > 0 && hp.current <= 0;
  const showBar = hp !== null && hp.max > 0;
  const ratio = showBar ? Math.min(Math.max(hp.current / hp.max, 0), 1) : 0;
  const badges = token.conditions
    .map((id) => CONDITION_EMOJI.get(id))
    .filter(Boolean) as string[];
  const badgeText =
    badges.length > 4 ? `${badges.slice(0, 4).join("")}+${badges.length - 4}` : badges.join("");
  const labelY = radius + (showBar ? 9 : 2);

  return (
    <Group
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={token.hidden ? 0.4 : dead ? 0.55 : 1}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={(e) => {
        // Shift-drag draws a pointer arrow instead of moving the token.
        if (e.evt.shiftKey) {
          e.target.stopDrag();
        }
      }}
      onDragEnd={(e) => onMove(e.target.x(), e.target.y())}
    >
      {isCurrentTurn ? (
        <Circle radius={radius + 4} stroke={CURRENT_TURN_COLOR} strokeWidth={2.5} listening={false} />
      ) : null}
      {img ? (
        <Circle
          radius={radius}
          fillPatternImage={img}
          fillPatternScale={{ x: (radius * 2) / img.width, y: (radius * 2) / img.height }}
          fillPatternOffset={{ x: img.width / 2, y: img.height / 2 }}
          stroke={selected ? "#4a9eff" : token.color}
          strokeWidth={selected ? 3 : 2}
        />
      ) : (
        <Circle
          radius={radius}
          fill={token.color}
          stroke={selected ? "#4a9eff" : "#00000066"}
          strokeWidth={selected ? 3 : 2}
        />
      )}
      {dead ? (
        <Text
          text="💀"
          fontSize={radius * 1.1}
          align="center"
          width={radius * 4}
          offsetX={radius * 2}
          y={-radius * 0.55}
          listening={false}
        />
      ) : null}
      {badgeText ? (
        <Text
          text={badgeText}
          fontSize={Math.max(9, radius * 0.55)}
          align="center"
          width={radius * 6}
          offsetX={radius * 3}
          y={-radius - Math.max(12, radius * 0.7)}
          listening={false}
        />
      ) : null}
      {showBar ? (
        <>
          <Rect
            x={-radius}
            y={radius + 3}
            width={radius * 2}
            height={4}
            cornerRadius={2}
            fill="rgba(0,0,0,0.6)"
            listening={false}
          />
          <Rect
            x={-radius}
            y={radius + 3}
            width={radius * 2 * ratio}
            height={4}
            cornerRadius={2}
            fill={hpBarColor(ratio)}
            listening={false}
          />
          {showHpValues ? (
            <Text
              text={`${hp.current}/${hp.max}`}
              fontSize={Math.max(8, radius * 0.45)}
              fill="#e6e6e8"
              align="center"
              width={radius * 4}
              offsetX={radius * 2}
              y={radius + 8}
              listening={false}
            />
          ) : null}
        </>
      ) : null}
      <Text
        text={token.label}
        fontSize={Math.max(10, radius * 0.7)}
        fill="#e6e6e8"
        align="center"
        width={radius * 4}
        offsetX={radius * 2}
        y={labelY + (showHpValues && showBar ? Math.max(8, radius * 0.45) + 1 : 0)}
        listening={false}
      />
    </Group>
  );
}

/// <summary>
/// Full-bleed tactical map: single background image, grid, and tokens. The DM pans/zooms
/// (broadcast to players); players render the shared viewport read-only but can drag their
/// own token.
/// </summary>
export function MapCanvas({
  state,
  sceneId,
  isDm,
  yourPlayerId,
  viewport,
  onViewportChange,
  onMoveToken,
  onSelectToken,
  selectedTokenId,
  onPlaceToken,
  send,
  subscribeMeasure,
  snap,
  onToggleSnap,
  hotkeysEnabled = true,
  embedded = false,
  history,
}: MapCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { width: stageW, height: stageH } = useElementSize(rootRef);
  const scene = state.scenes.find((item) => item.id === sceneId) ?? state.scenes[0];
  const mapImg = useImage(scene?.mapUrl ?? null);
  const sceneWalls = scene?.walls;

  // Stable wall/light editor callbacks so the memoized WallsLightsEditor layer bails
  // during (heavy) fog-brush strokes when a scene has many walls/lights.
  const onDeleteWall = useCallback(
    (id: string) =>
      send({ type: "SET_WALLS", sceneId: sceneId, walls: (sceneWalls ?? []).filter((w) => w.id !== id) }),
    [send, sceneId, sceneWalls],
  );
  const onToggleDoor = useCallback(
    (id: string) => send({ type: "TOGGLE_DOOR", sceneId, wallId: id }),
    [send, sceneId],
  );
  const onMoveLight = useCallback(
    (light: Light) => send({ type: "UPDATE_LIGHT", sceneId, light }),
    [send, sceneId],
  );
  const onDeleteLight = useCallback(
    (id: string) => send({ type: "REMOVE_LIGHT", sceneId, lightId: id }),
    [send, sceneId],
  );

  const canControlView = Boolean(onViewportChange);
  const placing = Boolean(onPlaceToken);
  const radius = tokenRadiusForGridSize(scene?.gridSize ?? 50);

  // ---- Map tools (Phase 5): active tool, its transient draft, per-client options ----
  const [activeToolId, setActiveToolId] = useState("select");
  const [draft, setDraft] = useState<unknown>(null);
  const [drawColor, setDrawColor] = useState("#ffd166");
  const [drawWidth, setDrawWidth] = useState(4);
  /** Fog brush: paint direction + size (radius = gridSize × scale). */
  const [fogMode, setFogMode] = useState<"reveal" | "cover">("reveal");
  const [fogBrushScale, setFogBrushScale] = useState(0.75);
  /** Walls tool: default kind a plain drag draws. */
  const [wallKind, setWallKind] = useState<"wall" | "door">("wall");
  /** Lights tool: which preset a freshly placed light uses. */
  const [lightPreset, setLightPreset] = useState<LightPreset>("torch");
  /** DM-only: preview dynamic vision as a player would see it. */
  const [visionPreview, setVisionPreview] = useState(false);
  const [rulers, setRulers] = useState<Record<string, RemoteRuler>>({});
  /** Active middle-mouse pan: pointer start + the viewport frozen at press. */
  const panRef = useRef<{ x: number; y: number; vp: Viewport } | null>(null);

  // ---- Shift-drag pointer arrow (always available; fades ~10s, like v1) ----
  const [shiftHeld, setShiftHeld] = useState(false);
  const [arrowDraft, setArrowDraft] = useState<number[] | null>(null);
  /** Id of our just-committed arrow: its server echo is hidden while the preview shows. */
  const [pendingArrowId, setPendingArrowId] = useState<string | null>(null);
  const drawingArrow = useRef(false);
  const arrowSparse = useRef<number[]>([]); // sparse, networked
  const arrowDense = useRef<number[]>([]); // dense, local preview
  const arrowGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Removed arrows fade out client-side (a "ghost") over ANNOTATION_FADE_MS — smooth and
  // immediate regardless of why the server dropped them (cap or end-of-life TTL).
  const [ghosts, setGhosts] = useState<Array<{ id: string; points: number[]; removedAt: number }>>([]);
  const prevArrowsRef = useRef<{ sceneId: string; ids: Map<string, number[]> }>({
    sceneId: "",
    ids: new Map(),
  });
  // Repaint clock that drives fades (ghost arrows, ephemeral strokes, live draft).
  const [fadeClock, setFadeClock] = useState(() => Date.now());

  const playersCanDraw = state.playersCanDraw;

  // Track Shift so the stage stops panning while an arrow is being drawn.
  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftHeld(event.type === "keydown");
      }
    };
    const clear = () => setShiftHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Other clients' live rulers arrive over the transient relay.
  useEffect(() => {
    return subscribeMeasure((event) => {
      setRulers((current) => {
        const next = { ...current };
        if (!event.points) {
          delete next[event.clientId];
        } else {
          next[event.clientId] = {
            points: event.points,
            name: event.name,
            color: event.color,
            sceneId: event.sceneId,
            at: Date.now(),
          };
        }
        return next;
      });
    });
  }, [subscribeMeasure]);

  // Prune rulers whose clear frame never arrived (disconnects, dropped frames).
  useEffect(() => {
    const timer = setInterval(() => {
      setRulers((current) => {
        const cutoff = Date.now() - 2500;
        const keep = Object.entries(current).filter(([, ruler]) => ruler.at >= cutoff);
        return keep.length === Object.keys(current).length
          ? current
          : Object.fromEntries(keep);
      });
    }, 800);
    return () => clearInterval(timer);
  }, []);

  // Snapshot removed arrows as fading "ghosts" so they fade out instead of popping.
  const sceneAnnotationsForGhosts = scene?.annotations;
  const currentSceneId = scene?.id ?? "";
  useEffect(() => {
    const current = new Map<string, number[]>();
    for (const annotation of sceneAnnotationsForGhosts ?? []) {
      if (annotation.kind === "arrow") {
        current.set(annotation.id, annotation.points ?? []);
      }
    }
    const prev = prevArrowsRef.current;
    if (prev.sceneId === currentSceneId) {
      const removed = [...prev.ids]
        .filter(([id]) => !current.has(id))
        .map(([id, points]) => ({ id, points, removedAt: Date.now() }));
      if (removed.length > 0) {
        setGhosts((g) => [...g, ...removed.filter((r) => !g.some((x) => x.id === r.id))]);
      }
    } else {
      setGhosts([]); // scene change — drop stale ghosts, don't animate
    }
    prevArrowsRef.current = { sceneId: currentSceneId, ids: current };
  }, [currentSceneId, sceneAnnotationsForGhosts]);

  // Ticks the fade clock while anything is fading (ghosts, ephemeral strokes, or a draft).
  const hasEphemeral = (scene?.annotations ?? []).some((annotation) => annotation.ephemeral);
  useEffect(() => {
    if (!hasEphemeral && !arrowDraft && ghosts.length === 0) {
      return;
    }
    const timer = setInterval(() => setFadeClock(Date.now()), 40);
    return () => clearInterval(timer);
  }, [hasEphemeral, arrowDraft, ghosts.length]);

  // Drop ghosts once their fade completes.
  useEffect(() => {
    if (ghosts.length === 0) {
      return;
    }
    const alive = ghosts.filter((g) => fadeClock - g.removedAt < ANNOTATION_FADE_MS);
    if (alive.length !== ghosts.length) {
      setGhosts(alive);
    }
  }, [fadeClock, ghosts]);

  // Hand off preview → committed arrow: once our echo lands, drop the local preview and
  // reveal the server copy in one swap, so only ever one arrow is on screen.
  const sceneAnnotations = scene?.annotations;
  useEffect(() => {
    if (!pendingArrowId) {
      return;
    }
    if ((sceneAnnotations ?? []).some((annotation) => annotation.id === pendingArrowId)) {
      if (arrowGraceRef.current) {
        clearTimeout(arrowGraceRef.current);
        arrowGraceRef.current = null;
      }
      setArrowDraft(null);
      setPendingArrowId(null);
    }
  }, [pendingArrowId, sceneAnnotations]);

  // Tools available to this client (players lose Draw unless the DM enabled it).
  const availableTools = useMemo(
    () => toolsForRole(isDm).filter((tool) => tool.id !== "draw" || isDm || playersCanDraw),
    [isDm, playersCanDraw],
  );

  // If the active tool becomes unavailable (DM revoked drawing), fall back to select.
  useEffect(() => {
    if (!availableTools.some((tool) => tool.id === activeToolId)) {
      setActiveToolId("select");
      setDraft(null);
    }
  }, [availableTools, activeToolId]);

  // Tool hotkeys (V/M/D/G/F/W/L, Esc = back to select) — ignored while typing, and
  // gated off entirely when this canvas isn't the visible one (board under a page).
  useEffect(() => {
    if (!hotkeysEnabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        setActiveToolId("select");
        setDraft(null);
        return;
      }
      const tool = availableTools.find((item) => item.hotkey === event.key.toLowerCase());
      if (tool) {
        setActiveToolId(tool.id);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [availableTools, hotkeysEnabled]);

  const gridLines = useMemo(() => {
    const lines: number[][] = [];
    if (!scene || !scene.showGrid || scene.gridSize <= 0) {
      return lines;
    }
    const { width, height, gridSize, gridOffsetX, gridOffsetY } = scene;
    if (width / gridSize + height / gridSize > 600) {
      return lines; // guard against pathological grid counts
    }
    const startX = ((gridOffsetX % gridSize) + gridSize) % gridSize;
    const startY = ((gridOffsetY % gridSize) + gridSize) % gridSize;
    for (let x = startX; x <= width; x += gridSize) {
      lines.push([x, 0, x, height]);
    }
    for (let y = startY; y <= height; y += gridSize) {
      lines.push([0, y, width, y]);
    }
    return lines;
  }, [scene]);

  if (!scene) {
    return <div className={`map-root${embedded ? " map-root--embedded" : ""}`} ref={rootRef} />;
  }

  const activeTool =
    availableTools.find((tool) => tool.id === activeToolId) ?? selectTool;
  const toolActive = activeTool.id !== "select";

  const fogBrushR = scene.gridSize * fogBrushScale;

  const runtime: ToolRuntime = {
    scene,
    isDm,
    yourPlayerId,
    send,
    draft,
    setDraft,
    drawColor,
    drawWidth,
    snap,
    fogMode,
    fogBrushR,
    wallKind,
    lightRadii: LIGHT_PRESETS[lightPreset],
  };

  /** Snaps a world point to the nearest grid cell center when snap is on. */
  const snapPoint = (x: number, y: number): { x: number; y: number } => {
    if (!snap || scene.gridSize <= 0) {
      return { x, y };
    }
    const g = scene.gridSize;
    return {
      x: Math.floor((x - scene.gridOffsetX) / g) * g + scene.gridOffsetX + g / 2,
      y: Math.floor((y - scene.gridOffsetY) / g) * g + scene.gridOffsetY + g / 2,
    };
  };

  /** Routes a stage pointer event to the active tool in world coordinates. */
  const toolPointer =
    (handler?: (event: ToolPointerEvent, rt: ToolRuntime) => void) =>
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      if (!handler) {
        return;
      }
      const pos = stageRef.current?.getRelativePointerPosition();
      if (!pos) {
        return;
      }
      handler({ world: pos, shiftKey: Boolean(e.evt.shiftKey) }, runtime);
    };

  const eraseAnnotation = (annotation: Annotation) => {
    if (!isDm && annotation.authorId !== yourPlayerId) {
      return;
    }
    send({ type: "REMOVE_ANNOTATION", sceneId: scene.id, annotationId: annotation.id });
  };

  /**
   * Middle-mouse pan: independent of Konva's draggable (left button only), so it works
   * for everyone and even while a tool is active. Rides window listeners.
   */
  const startMiddlePan = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!onViewportChange) {
      return;
    }
    e.evt.preventDefault(); // suppress browser middle-click autoscroll
    panRef.current = { x: e.evt.clientX, y: e.evt.clientY, vp: viewport };
    const onMove = (ev: PointerEvent) => {
      const start = panRef.current;
      if (!start) {
        return;
      }
      onViewportChange({
        x: start.vp.x + (ev.clientX - start.x),
        y: start.vp.y + (ev.clientY - start.y),
        scale: start.vp.scale,
      });
    };
    const onUp = () => {
      panRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---- Shift-drag pointer arrow: begin / extend / commit ----
  const arrowWorld = () => stageRef.current?.getRelativePointerPosition() ?? null;

  const startArrow = () => {
    const p = arrowWorld();
    if (!p) {
      return;
    }
    if (arrowGraceRef.current) {
      clearTimeout(arrowGraceRef.current);
      arrowGraceRef.current = null;
    }
    setPendingArrowId(null); // reveal any previous arrow still mid-handoff
    drawingArrow.current = true;
    arrowSparse.current = [p.x, p.y];
    arrowDense.current = [p.x, p.y];
    setArrowDraft([p.x, p.y]);
  };

  const extendArrow = () => {
    const p = arrowWorld();
    if (!p) {
      return;
    }
    const atMax = isAnnotationAtMaxPoints(arrowSparse.current);
    if (!atMax) {
      const next = appendAnnotationSample(arrowSparse.current, p.x, p.y);
      if (next.length !== arrowSparse.current.length) {
        arrowSparse.current = trimAnnotationPoints(next);
      }
      arrowDense.current = appendDraftAnnotationSample(arrowDense.current, p.x, p.y);
    }
    setArrowDraft(
      buildAnnotationDraftPreview(arrowSparse.current, arrowDense.current, p.x, p.y, atMax),
    );
  };

  const commitArrow = () => {
    if (!drawingArrow.current) {
      return;
    }
    drawingArrow.current = false;
    const p = arrowWorld();
    // Always include the exact release point (minDistance 1) so the committed arrow is
    // the same length as the preview — sparse sampling alone could stop up to 48px short.
    const points = p
      ? trimAnnotationPoints(appendAnnotationSample(arrowSparse.current, p.x, p.y, 1))
      : arrowSparse.current;
    arrowSparse.current = [];
    arrowDense.current = [];
    if (annotationPathLength(points) < ANNOTATION_MIN_LENGTH) {
      setArrowDraft(null);
      return;
    }
    const id = `arw-${crypto.randomUUID().slice(0, 8)}`;
    send({
      type: "ADD_ANNOTATION",
      sceneId: scene.id,
      annotation: {
        id,
        authorId: yourPlayerId ?? "dm",
        kind: "arrow",
        points,
        color: ARROW_COLOR,
        width: 3,
        createdAt: Date.now(),
        ephemeral: true,
      },
    });
    // Keep showing the preview and hide the incoming server echo until they can swap in
    // one paint (the effect above), so a shorter duplicate never overlaps the original.
    setArrowDraft(points);
    setPendingArrowId(id);
    if (arrowGraceRef.current) {
      clearTimeout(arrowGraceRef.current);
    }
    arrowGraceRef.current = setTimeout(() => {
      setArrowDraft(null);
      setPendingArrowId(null);
      arrowGraceRef.current = null;
    }, 1500);
  };

  /** True when a shift-drag pointer arrow should start (select mode, left button). */
  const arrowGestureArmed = (e: Konva.KonvaEventObject<PointerEvent>) =>
    !toolActive && !placing && e.evt.button === 0 && e.evt.shiftKey;

  const sceneTokens = state.tokens.filter((token) => token.sceneId === scene.id);
  const currentTurnTokenId =
    state.combat?.entries[state.combat.turnIndex]?.tokenId ?? null;

  // ---- Dynamic vision (Phase 6) ----
  const ftToPx = scene.gridSize / Math.max(scene.feetPerSquare, 1);
  const wallsActive = activeTool.id === "walls";
  const lightsActive = activeTool.id === "lights";
  // The viewer's vision-enabled tokens on this scene reveal the dark. Players use their
  // own tokens; the DM sees everything unless previewing (then all vision tokens reveal).
  const viewerVisionTokens = sceneTokens.filter(
    (token) =>
      token.vision?.enabled &&
      (isDm ? visionPreview : token.ownerPlayerId === yourPlayerId),
  );
  // Dynamic lighting off = the scene is dark. Players (and the DM's 👁 preview) get the
  // strict LOS-gated mask; the DM's own view instead gets a dimmed "here's my lighting"
  // overlay so lights are visibly working during setup without needing a token.
  const dark = !scene.globalIllumination;
  const maskActive = dark && (!isDm || visionPreview);
  const dmLightingActive = dark && isDm && !visionPreview;
  const sceneVisionTokens = sceneTokens.filter((token) => token.vision?.enabled);
  const hasVisionTokens = sceneVisionTokens.length > 0;

  const emitViewportFromStage = () => {
    const stage = stageRef.current;
    if (!stage || !onViewportChange) return;
    onViewportChange({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (!canControlView || !onViewportChange) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const oldScale = viewport.scale;
    const worldX = (pointer.x - viewport.x) / oldScale;
    const worldY = (pointer.y - viewport.y) / oldScale;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = clampViewportScale(oldScale * (direction > 0 ? 1.1 : 1 / 1.1));
    onViewportChange({
      scale: newScale,
      x: pointer.x - worldX * newScale,
      y: pointer.y - worldY * newScale,
    });
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (toolActive || drawingArrow.current || arrowDraft) {
      return; // tools/arrow own the pointer; don't deselect/place underneath them
    }
    if (placing) {
      const point = stageRef.current?.getRelativePointerPosition();
      if (point && onPlaceToken) {
        const snapped = snapPoint(point.x, point.y);
        onPlaceToken(snapped.x, snapped.y);
      }
      return;
    }
    if (e.target === e.target.getStage()) {
      onSelectToken?.(null);
    }
  };

  // Shift disables the pan-drag so a shift-drag draws an arrow instead of panning.
  const stageDraggable = canControlView && !placing && !toolActive && !shiftHeld;
  const sceneRulers = Object.entries(rulers).filter(
    ([, ruler]) => ruler.sceneId === scene.id,
  );

  return (
    <div
      className={`map-root${embedded ? " map-root--embedded" : ""}`}
      ref={rootRef}
      style={toolActive ? { cursor: activeTool.cursor } : undefined}
    >
      <Stage
        ref={stageRef}
        width={stageW}
        height={stageH}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={stageDraggable}
        onDragMove={emitViewportFromStage}
        onDragEnd={emitViewportFromStage}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onPointerDown={(e) => {
          if (e.evt.button === 1) {
            startMiddlePan(e);
            return;
          }
          if (arrowGestureArmed(e)) {
            e.evt.preventDefault();
            startArrow();
            return;
          }
          // Clicking an existing wall/light marker interacts with it (drag/toggle/delete)
          // rather than placing a new one underneath.
          if (typeof e.target?.hasName === "function" && e.target.hasName("map-handle")) {
            return;
          }
          if (toolActive && e.evt.button === 0) {
            toolPointer(activeTool.onDown)(e);
          }
        }}
        onPointerMove={(e) => {
          if (drawingArrow.current) {
            extendArrow();
            return;
          }
          if (toolActive) {
            toolPointer(activeTool.onMove)(e);
          }
        }}
        onPointerUp={(e) => {
          if (drawingArrow.current) {
            commitArrow();
            return;
          }
          if (toolActive) {
            toolPointer(activeTool.onUp)(e);
          }
        }}
        onPointerLeave={() => {
          if (drawingArrow.current) {
            commitArrow();
          }
        }}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.backgroundColor} />
          {mapImg ? (
            <KonvaImage image={mapImg} x={0} y={0} width={scene.width} height={scene.height} />
          ) : null}
          {gridLines.map((points, index) => (
            <Line
              key={index}
              points={points}
              stroke={scene.gridColor}
              opacity={scene.gridOpacity}
              strokeWidth={1}
            />
          ))}
        </Layer>

        {/* Annotations: under tokens; erasable (right-click) while the draw tool is active. */}
        <Layer listening={activeTool.id === "draw"}>
          {scene.annotations.map((annotation) =>
            // Our own just-committed arrow is hidden until the preview hands off to it.
            annotation.id === pendingArrowId ? null : annotation.kind === "arrow" ? (
              // Solid while it exists; a client-local ghost fades it out on removal.
              <MapAnnotationArrow key={annotation.id} points={annotation.points ?? []} opacity={1} />
            ) : (
              <AnnotationNode
                key={annotation.id}
                annotation={annotation}
                now={fadeClock}
                onErase={() => eraseAnnotation(annotation)}
              />
            ),
          )}
        </Layer>

        <Layer listening={activeTool.id === "select"}>
          {sceneTokens.map((token) => {
            const draggable = isDm || token.ownerPlayerId === yourPlayerId;
            // Prefer the linked sheet's portrait so uploads/changes reflect live;
            // fall back to the token's own snapshot, then its color.
            const linkedSheetId = token.sheetId ?? token.ownerPlayerId;
            const sheet = linkedSheetId ? state.sheets[linkedSheetId] : undefined;
            const sheetHp = sheet?.data.hp;
            // DM always sees bars; players only when the DM turned the display on.
            // (Redaction keeps hp available for showHp tokens even on hidden sheets.)
            const hp = sheetHp && (isDm || token.showHp !== "none") ? sheetHp : null;
            return (
              <TokenNode
                key={token.id}
                token={token}
                imageUrl={sheet?.data.iconUrl ?? token.imageUrl ?? null}
                radius={radius}
                draggable={draggable}
                selected={selectedTokenId === token.id}
                isCurrentTurn={currentTurnTokenId === token.id}
                hp={hp}
                showHpValues={token.showHp === "values"}
                onSelect={() => onSelectToken?.(token.id)}
                onMove={(x, y) => {
                  const snapped = snapPoint(x, y);
                  onMoveToken(token.id, snapped.x, snapped.y);
                }}
              />
            );
          })}
        </Layer>

        {/* Manual fog of war (memoized so brush strokes don't re-diff committed shapes). */}
        <FogLayer scene={scene} isDm={isDm} />

        {/* Dynamic vision: a darkness sheet above tokens (also hides tokens in the dark),
            erased inside each viewer token's line of sight where light/darkvision reach. */}
        {maskActive ? (
          <VisionMaskLayer scene={scene} tokens={viewerVisionTokens} ftToPx={ftToPx} />
        ) : null}

        {/* DM dynamic-lighting overview: dimmed map with lit pools cut bright. */}
        {dmLightingActive ? (
          <DmLightingOverlay scene={scene} tokens={sceneVisionTokens} ftToPx={ftToPx} />
        ) : null}

        {/* DM wall/door lines + light markers; interactive only with the matching tool. */}
        {isDm && (scene.walls.length > 0 || scene.lights.length > 0 || wallsActive || lightsActive) ? (
          <WallsLightsEditor
            scene={scene}
            ftToPx={ftToPx}
            wallsActive={wallsActive}
            lightsActive={lightsActive}
            onDeleteWall={onDeleteWall}
            onToggleDoor={onToggleDoor}
            onMoveLight={onMoveLight}
            onDeleteLight={onDeleteLight}
          />
        ) : null}

        {/* Topmost overlay: everyone's live rulers + the active tool's draft. */}
        <Layer listening={false}>
          {sceneRulers.map(([clientId, ruler]) => (
            <RulerShape
              key={clientId}
              scene={scene}
              points={ruler.points}
              color={ruler.color}
              name={ruler.name}
            />
          ))}
          {ghosts.map((g) => (
            <MapAnnotationArrow
              key={`ghost-${g.id}`}
              points={g.points}
              opacity={Math.max(0, Math.min(1, 1 - (fadeClock - g.removedAt) / ANNOTATION_FADE_MS))}
            />
          ))}
          {arrowDraft && arrowDraft.length >= 4 ? (
            <MapAnnotationArrow points={arrowDraft} opacity={1} />
          ) : null}
          {activeTool.renderDraft?.(draft, runtime)}
        </Layer>
      </Stage>

      <MapToolbar
        isDm={isDm}
        tools={availableTools}
        activeToolId={activeTool.id}
        onSelectTool={(id) => {
          setActiveToolId(id);
          setDraft(null);
        }}
        snap={snap}
        onToggleSnap={onToggleSnap}
        drawColor={drawColor}
        onDrawColor={setDrawColor}
        drawWidth={drawWidth}
        onDrawWidth={setDrawWidth}
        fogEnabled={scene.fog.enabled}
        onToggleFog={() => send({ type: "FOG_SET", sceneId: scene.id, enabled: !scene.fog.enabled })}
        onResetFog={() => send({ type: "FOG_RESET", sceneId: scene.id })}
        fogMode={fogMode}
        onFogMode={setFogMode}
        fogBrushScale={fogBrushScale}
        onFogBrushScale={setFogBrushScale}
        fogInverted={scene.fog.inverted}
        onToggleFogInverted={() =>
          send({
            type: "FOG_SET",
            sceneId: scene.id,
            enabled: scene.fog.enabled,
            inverted: !scene.fog.inverted,
          })
        }
        onClearAnnotations={() => send({ type: "CLEAR_ANNOTATIONS", sceneId: scene.id })}
        playersCanDraw={playersCanDraw}
        onTogglePlayersCanDraw={() =>
          send({ type: "SET_PLAYERS_CAN_DRAW", enabled: !playersCanDraw })
        }
        globalIllumination={scene.globalIllumination}
        onToggleGlobalIllumination={() =>
          send({ type: "UPDATE_SCENE", scene: { ...scene, globalIllumination: !scene.globalIllumination } })
        }
        visionPreview={visionPreview}
        onToggleVisionPreview={() => setVisionPreview((v) => !v)}
        wallKind={wallKind}
        onWallKind={setWallKind}
        wallCount={scene.walls.length}
        onClearWalls={() => send({ type: "SET_WALLS", sceneId: scene.id, walls: [] })}
        lightPreset={lightPreset}
        onLightPreset={setLightPreset}
        lightCount={scene.lights.length}
        onClearLights={() => send({ type: "UPDATE_SCENE", scene: { ...scene, lights: [] } })}
        hasVisionTokens={hasVisionTokens}
        history={history}
      />

      {!scene.mapUrl ? <div className="map-empty">No map image for “{scene.name}”</div> : null}
    </div>
  );
}

/// <summary>
/// The dotted pointer arrow (recovered from v1): a dark dashed outline under a cream
/// dashed arrow with a smooth (tension) curve. Non-interactive — it just points and fades.
/// </summary>
function MapAnnotationArrow({ points, opacity }: { points: number[]; opacity: number }) {
  if (opacity <= 0 || points.length < 4) {
    return null;
  }
  return (
    <>
      <Arrow
        points={points}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        stroke="rgba(8, 6, 5, 0.95)"
        fill="rgba(8, 6, 5, 0.95)"
        strokeWidth={6}
        pointerLength={14}
        pointerWidth={12}
        opacity={opacity}
        dash={[10, 6]}
        listening={false}
      />
      <Arrow
        points={points}
        tension={0.5}
        lineCap="round"
        lineJoin="round"
        stroke={ARROW_COLOR}
        fill={ARROW_COLOR}
        strokeWidth={3}
        pointerLength={12}
        pointerWidth={10}
        opacity={opacity}
        dash={[10, 6]}
        listening={false}
      />
    </>
  );
}

/// <summary>
/// Renders one committed annotation. Strokes get a wide hit area so right-click
/// erasing works while the draw tool is active (authorization enforced server-side;
/// the client also checks in `eraseAnnotation`). Ephemeral strokes fade with age.
/// </summary>
function AnnotationNode({
  annotation,
  now,
  onErase,
}: {
  annotation: Annotation;
  now: number;
  onErase: () => void;
}) {
  const opacity = annotation.ephemeral ? annotationOpacity(annotation.createdAt, now) : 1;
  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    onErase();
  };
  switch (annotation.kind) {
    case "stroke":
      return (
        <Line
          points={annotation.points ?? []}
          stroke={annotation.color}
          strokeWidth={annotation.width}
          lineCap="round"
          lineJoin="round"
          opacity={opacity}
          hitStrokeWidth={14}
          onContextMenu={onContextMenu}
        />
      );
    case "rect":
      return (
        <Rect
          x={annotation.x ?? 0}
          y={annotation.y ?? 0}
          width={annotation.w ?? 0}
          height={annotation.h ?? 0}
          stroke={annotation.color}
          strokeWidth={annotation.width}
          opacity={opacity}
          onContextMenu={onContextMenu}
        />
      );
    case "circle":
      return (
        <Circle
          x={annotation.x ?? 0}
          y={annotation.y ?? 0}
          radius={Math.max(annotation.w ?? 0, 1)}
          stroke={annotation.color}
          strokeWidth={annotation.width}
          opacity={opacity}
          onContextMenu={onContextMenu}
        />
      );
    case "text":
      return (
        <Text
          x={annotation.x ?? 0}
          y={annotation.y ?? 0}
          text={annotation.text ?? ""}
          fontSize={Math.max(annotation.width * 5, 14)}
          fill={annotation.color}
          opacity={opacity}
          onContextMenu={onContextMenu}
        />
      );
  }
}
