import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Group, Image, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import { DEFAULT_SCENE_BACKGROUND, DEFAULT_VIEWPORT, type GameState, type MapLayer, type Token, type Viewport } from "../lib/types";
import { canPlayerSeeScene } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import {
  fillFog,
  fogCanvasToDataUrl,
  loadFogCanvas,
  paintFogBrush,
  type FogBrushMode,
} from "../lib/fogCanvas";
import {
  clampPlayerViewport,
  clampViewport,
  clampViewportScale,
  fitViewportToScene,
  isDefaultViewport,
  loadImageForCanvas,
  moveMapLayer,
  moveSceneCenter,
  normalizeScene,
  tokenDiameterForGridSize,
  viewportForNormalizedScene,
} from "../lib/sceneUtils";
import {
  getSessionViewport,
  saveSessionViewport,
  type SessionViewportMode,
} from "../lib/sessionViewportMemory";
import { ROLL_REGION_BORDER_CELLS, rollRegionCells } from "../dice3d/diceProtocol";
import {
  ANNOTATION_MIN_LENGTH,
  annotationOpacity,
  annotationPathLength,
  appendAnnotationSample,
  appendDraftAnnotationSample,
  buildAnnotationDraftPreview,
  isAnnotationAtMaxPoints,
  MAX_ACTIVE_ANNOTATIONS_PER_PLAYER,
  trimAnnotationPoints,
} from "../lib/mapAnnotation";

type MapCanvasProps = {
  state: GameState;
  sceneId: string;
  isDm: boolean;
  playerSlotId?: string | null;
  dm: ReturnType<typeof useDmActions>;
  onMoveToken?: (tokenId: string, x: number, y: number) => void;
  onAddAnnotation?: (sceneId: string, points: number[], color: string) => void;
  annotationColor?: string;
  fogMode: boolean;
  fogPreview: boolean;
  fogBrushMode: FogBrushMode;
  sceneEditMode: boolean;
  viewCommand: { type: "fit" | "reset"; id: number } | null;
  onSettingsViewportChange?: (viewport: Viewport) => void;
  /** Receives the map pane element so the 3D dice arena can confine dice to it. */
  onContainerEl?: (element: HTMLDivElement | null) => void;
  /**
   * Fires whenever the live viewport/grid changes so the 3D dice can stay anchored to the
   * map. `center` is the current view center in map/world coords (a roll's tray anchor).
   */
  onViewportChange?: (info: {
    viewport: Viewport;
    gridSize: number;
    center: [number, number];
    regionCellsW: number;
    regionCellsH: number;
  }) => void;
};

type MapLayerImageProps = {
  layer: MapLayer;
  selected: boolean;
  draggable: boolean;
  onDragEnd: (layerId: string, x: number, y: number) => void;
};

/// <summary>
/// Renders a single positioned map image layer on the scene canvas.
/// </summary>
function MapLayerImage({ layer, selected, draggable, onDragEnd }: MapLayerImageProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadImageForCanvas(layer.url)
      .then((img) => {
        if (!cancelled) {
          setImage(img);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImage(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [layer.url]);

  if (!image) {
    return null;
  }

  return (
    <Group
      x={layer.x}
      y={layer.y}
      draggable={draggable}
      dragDistance={6}
      onDragEnd={(event) => {
        onDragEnd(layer.id, event.target.x(), event.target.y());
      }}
    >
      <Image image={image} x={0} y={0} width={layer.width} height={layer.height} />
      {selected ? (
        <Rect
          x={0}
          y={0}
          width={layer.width}
          height={layer.height}
          stroke="#6b8afd"
          strokeWidth={3}
          dash={[8, 4]}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

type SceneOriginMarkerProps = {
  armLength: number;
};

/// <summary>
/// Draws a crosshair at scene (0, 0) so the DM can see the world origin while editing.
/// </summary>
function SceneOriginMarker({ armLength }: SceneOriginMarkerProps) {
  const arm = Math.max(24, armLength);
  const labelOffset = arm + 14;

  return (
    <Group listening={false}>
      <Line
        points={[-arm, 0, arm, 0]}
        stroke="#4ade80"
        strokeWidth={2}
        listening={false}
      />
      <Line
        points={[0, -arm, 0, arm]}
        stroke="#4ade80"
        strokeWidth={2}
        listening={false}
      />
      <Circle
        x={0}
        y={0}
        radius={6}
        fill="rgba(74,222,128,0.35)"
        stroke="#4ade80"
        strokeWidth={2}
        listening={false}
      />
      <Text
        text="Origin (0, 0)"
        x={-48}
        y={labelOffset}
        width={96}
        align="center"
        fontSize={12}
        fill="#4ade80"
        listening={false}
      />
    </Group>
  );
}

type SceneCenterHandleProps = {
  centerX: number;
  centerY: number;
  armLength: number;
  onDragEnd: (centerX: number, centerY: number) => void;
};

/// <summary>
/// Draggable scene center marker; position is stored on the scene and does not move map images.
/// </summary>
function SceneCenterHandle({ centerX, centerY, armLength, onDragEnd }: SceneCenterHandleProps) {
  const arm = Math.max(18, armLength * 0.6);
  const labelOffset = arm + 12;

  return (
    <Group
      x={centerX}
      y={centerY}
      draggable
      dragDistance={6}
      onDragEnd={(event) => {
        onDragEnd(event.target.x(), event.target.y());
      }}
    >
      <Line
        points={[-arm, 0, arm, 0]}
        stroke="#c9a227"
        strokeWidth={2}
        listening={false}
      />
      <Line
        points={[0, -arm, 0, arm]}
        stroke="#c9a227"
        strokeWidth={2}
        listening={false}
      />
      <Circle
        x={0}
        y={0}
        radius={10}
        fill="rgba(201, 162, 39, 0.45)"
        stroke="#c9a227"
        strokeWidth={2}
      />
      <Text
        text="Scene center — drag to position"
        x={-84}
        y={labelOffset}
        width={168}
        align="center"
        fontSize={11}
        fill="#e8d5a3"
        listening={false}
      />
    </Group>
  );
}

type FogOverlayProps = {
  fogDataUrl: string | null;
  mapWidth: number;
  mapHeight: number;
  opacity?: number;
  playerOpaque?: boolean;
};

/// <summary>
/// Renders the fog mask over the map so players (and DM preview) only see revealed areas.
/// </summary>
function FogOverlay({
  fogDataUrl,
  mapWidth,
  mapHeight,
  opacity = 1,
  playerOpaque = false,
}: FogOverlayProps) {
  const [fogImage, setFogImage] = useState<HTMLImageElement | null>(null);
  const overlayOpacity = playerOpaque ? 1 : opacity;

  useEffect(() => {
    if (!fogDataUrl) {
      setFogImage(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setFogImage(img);
    img.src = fogDataUrl;
  }, [fogDataUrl]);

  if (!fogImage) {
    return (
      <Rect
        x={0}
        y={0}
        width={mapWidth}
        height={mapHeight}
        fill="#000000"
        opacity={overlayOpacity}
        listening={false}
      />
    );
  }

  return (
    <Image
      image={fogImage}
      x={0}
      y={0}
      width={mapWidth}
      height={mapHeight}
      opacity={overlayOpacity}
      listening={false}
    />
  );
}

type MapTokenProps = {
  token: Token;
  gridSize: number;
  showHoverOutline: boolean;
};

/// <summary>
/// Renders a map token sized to exactly half of one grid cell.
/// </summary>
function MapToken({ token, gridSize, showHoverOutline }: MapTokenProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const tokenDiameter = tokenDiameterForGridSize(gridSize);
  const tokenRadius = tokenDiameter / 2;
  const labelFontSize = Math.max(10, Math.round(gridSize / 4.5));
  const labelWidth = Math.max(72, gridSize * 1.5);

  useEffect(() => {
    if (!token.imageUrl) {
      setImage(null);
      return;
    }
    let cancelled = false;
    void loadImageForCanvas(token.imageUrl)
      .then((img) => {
        if (!cancelled) {
          setImage(img);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImage(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token.imageUrl]);

  const tokenOutlineColor = "rgba(8, 6, 5, 0.95)";
  const tokenOutlineWidth = Math.max(1, Math.round(labelFontSize * 0.22));
  const ringRadius = tokenRadius - tokenOutlineWidth / 2;
  const labelGap = 2;
  const labelY = tokenRadius + labelGap;
  const tightLabelWidth = Math.min(
    labelWidth,
    Math.ceil(token.label.length * labelFontSize * 0.58) + tokenOutlineWidth * 2 + 4,
  );

  return (
    <>
      {showHoverOutline ? (
        <Circle
          radius={tokenRadius + 3}
          stroke="#ffffff"
          strokeWidth={2}
          listening={false}
        />
      ) : null}
      {image ? (
        <Group
          listening={false}
          clipFunc={(ctx) => {
            ctx.arc(0, 0, tokenRadius, 0, Math.PI * 2);
          }}
        >
          <Image
            image={image}
            x={-tokenRadius}
            y={-tokenRadius}
            width={tokenDiameter}
            height={tokenDiameter}
            listening={false}
          />
          <Circle
            radius={ringRadius}
            stroke={tokenOutlineColor}
            strokeWidth={tokenOutlineWidth}
            listening={false}
          />
        </Group>
      ) : (
        <>
          <Circle radius={tokenRadius} fill={token.color} listening={false} />
          <Circle
            radius={ringRadius}
            stroke={tokenOutlineColor}
            strokeWidth={tokenOutlineWidth}
            listening={false}
          />
        </>
      )}
      <Text
        text={token.label}
        x={-tightLabelWidth / 2}
        y={labelY}
        width={tightLabelWidth}
        fontSize={labelFontSize}
        fill="#f0e6d2"
        stroke={tokenOutlineColor}
        strokeWidth={tokenOutlineWidth}
        fillAfterStrokeEnabled
        align="center"
        ellipsis
        listening={false}
      />
    </>
  );
}

type MapTokenNodeProps = {
  token: Token;
  gridSize: number;
  draggable: boolean;
  onDragEnd: (x: number, y: number) => void;
};

/// <summary>
/// Wraps a map token with drag handling and hover feedback for draggable tokens.
/// </summary>
function MapTokenNode({ token, gridSize, draggable, onDragEnd }: MapTokenNodeProps) {
  const [hovered, setHovered] = useState(false);
  const tokenRadius = tokenDiameterForGridSize(gridSize) / 2;

  const setMapCursor = (event: KonvaEventObject<MouseEvent>, cursor: string) => {
    const stage = event.target.getStage();
    if (stage) {
      stage.container().style.cursor = cursor;
    }
  };

  return (
    <Group
      x={token.x}
      y={token.y}
      draggable={draggable}
      onMouseEnter={(event) => {
        if (!draggable) {
          return;
        }
        setHovered(true);
        setMapCursor(event, "grab");
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        if (draggable) {
          setMapCursor(event, "");
        }
      }}
      onDragStart={(event) => {
        if (event.evt.shiftKey) {
          event.target.stopDrag();
          return;
        }
        if (draggable) {
          setMapCursor(event, "grabbing");
        }
      }}
      onDragEnd={(event) => {
        if (draggable) {
          setMapCursor(event, "grab");
        }
        onDragEnd(event.target.x(), event.target.y());
      }}
    >
      <Circle radius={tokenRadius} fill="rgba(0,0,0,0.001)" />
      <MapToken token={token} gridSize={gridSize} showHoverOutline={hovered && draggable} />
    </Group>
  );
}

type MapAnnotationArrowProps = {
  points: number[];
  opacity: number;
  tension?: number;
};

/// <summary>
/// Renders a freehand annotation arrow on the map canvas.
/// </summary>
function MapAnnotationArrow({ points, opacity, tension = 0.5 }: MapAnnotationArrowProps) {
  return (
    <>
      <Arrow
        points={points}
        tension={tension}
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
        tension={tension}
        lineCap="round"
        lineJoin="round"
        stroke="#f0e6d2"
        fill="#f0e6d2"
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

const FOG_SYNC_MS = 50;
const BRUSH_RADIUS = 48;
const ANNOTATION_COMMIT_GRACE_MS = 500;
const ANNOTATION_MATCH_TOLERANCE = 2;

type SceneGridProps = {
  width: number;
  height: number;
  gridSize: number;
  originX: number;
  originY: number;
  zoomScale: number;
};

/// <summary>
/// Expands grid bounds to cover the visible viewport, snapped to grid cell boundaries.
/// </summary>
function computeVisibleGridBounds(
  viewport: Viewport,
  stageWidth: number,
  stageHeight: number,
  gridSize: number,
) {
  const visibleLeft = -viewport.x / viewport.scale;
  const visibleTop = -viewport.y / viewport.scale;
  const visibleRight = (stageWidth - viewport.x) / viewport.scale;
  const visibleBottom = (stageHeight - viewport.y) / viewport.scale;
  const pad = gridSize * 2;
  const x = Math.floor((visibleLeft - pad) / gridSize) * gridSize;
  const y = Math.floor((visibleTop - pad) / gridSize) * gridSize;
  const right = Math.ceil((visibleRight + pad) / gridSize) * gridSize;
  const bottom = Math.ceil((visibleBottom + pad) / gridSize) * gridSize;
  return { x, y, width: right - x, height: bottom - y };
}

/// <summary>
/// Deterministic pseudo-random in [0, 1) from stable seeds.
/// </summary>
function gridNoise2D(worldX: number, worldY: number): number {
  const value = Math.sin(worldX * 12.9898 + worldY * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/// <summary>
/// Builds a reusable hand-drawn single-cell grid tile for pattern fills.
/// </summary>
function createGridTile(gridSize: number): { canvas: HTMLCanvasElement; scale: number } | null {
  if (typeof document === "undefined" || gridSize <= 0) {
    return null;
  }
  const cellPx = 64;
  const metaTileCells = 2;
  const metaTilePx = cellPx * metaTileCells;
  const scale = gridSize / cellPx;
  const canvas = document.createElement("canvas");
  canvas.width = metaTilePx;
  canvas.height = metaTilePx;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.clearRect(0, 0, metaTilePx, metaTilePx);
  context.strokeStyle = "rgba(14, 12, 10, 0.44)";
  context.lineWidth = 1.15;
  context.lineCap = "round";
  context.lineJoin = "round";

  const amplitude = 0.85;
  const step = 8;
  const segments = Math.ceil(cellPx / step);

  const drawSketchLine = (
    vertical: boolean,
    fixed: number,
    seedOffset: number,
    originX: number,
    originY: number,
  ) => {
    context.beginPath();
    let started = false;
    for (let index = 0; index <= segments; index += 1) {
      const along = Math.min(cellPx, index * step);
      const gapNoise = gridNoise2D(seedOffset + index * 3.17, seedOffset + index * 7.11);
      if (gapNoise > 0.92) {
        started = false;
        continue;
      }
      const wobble = (gridNoise2D(seedOffset + along * 0.37, seedOffset + 13.7) - 0.5) * 2 * amplitude;
      const x = vertical ? originX + fixed + wobble : originX + along;
      const y = vertical ? originY + along : originY + fixed + wobble;
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  };

  // Draw a 2x2 meta-tile with seed variants to reduce visible repetition.
  for (let row = 0; row < metaTileCells; row += 1) {
    for (let col = 0; col < metaTileCells; col += 1) {
      const originX = col * cellPx;
      const originY = row * cellPx;
      const variantSeed = 1000 + row * 101 + col * 211;
      drawSketchLine(true, 0.5, variantSeed + 1, originX, originY);
      drawSketchLine(false, 0.5, variantSeed + 2, originX, originY);
    }
  }

  return { canvas, scale };
}

/// <summary>
/// Renders sketchy grid cheaply using a repeating pattern tile.
/// </summary>
function SceneGrid({ width, height, gridSize, originX, originY, zoomScale }: SceneGridProps) {
  const pattern = useMemo(() => createGridTile(gridSize), [gridSize]);
  if (!pattern) {
    return null;
  }
  const zoomOpacity = Math.max(0.35, Math.min(1, 0.5 + zoomScale / 2));

  return (
    <Rect
      x={0}
      y={0}
      width={width}
      height={height}
      fillPatternImage={pattern.canvas as unknown as HTMLImageElement}
      fillPatternRepeat="repeat"
      fillPatternScaleX={pattern.scale}
      fillPatternScaleY={pattern.scale}
      fillPatternOffsetX={originX / pattern.scale}
      fillPatternOffsetY={originY / pattern.scale}
      opacity={zoomOpacity}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

/// <summary>
/// Returns true when the pointer event hit a Konva node that is currently draggable (e.g. a token).
/// </summary>
function isOnDraggableNode(event: KonvaEventObject<PointerEvent>) {
  const stage = event.target.getStage();
  let node: Konva.Node | null = event.target;
  while (node) {
    if (node !== stage && "draggable" in node && node.draggable()) {
      return true;
    }
    node = node.getParent();
  }
  return false;
}

/// <summary>
/// Returns true when two annotation polylines share the same endpoints within tolerance.
/// </summary>
function annotationsMatch(a: number[], b: number[], tolerance = ANNOTATION_MATCH_TOLERANCE) {
  if (a.length < 4 || b.length < 4) {
    return false;
  }
  const dxStart = Math.abs(a[0] - b[0]);
  const dyStart = Math.abs(a[1] - b[1]);
  const axEnd = a[a.length - 2];
  const ayEnd = a[a.length - 1];
  const bxEnd = b[b.length - 2];
  const byEnd = b[b.length - 1];
  return (
    dxStart <= tolerance &&
    dyStart <= tolerance &&
    Math.abs(axEnd - bxEnd) <= tolerance &&
    Math.abs(ayEnd - byEnd) <= tolerance
  );
}

/// <summary>
/// Konva canvas for the shared battle map; DM drives shared scene state, players view locally.
/// </summary>
export function MapCanvas({
  state,
  sceneId,
  isDm,
  playerSlotId,
  dm,
  fogMode,
  fogPreview,
  fogBrushMode,
  sceneEditMode,
  viewCommand,
  onSettingsViewportChange,
  onMoveToken,
  onAddAnnotation,
  annotationColor = "#fcd34d",
  onContainerEl,
  onViewportChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setContainerEl = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef.current = element;
      onContainerEl?.(element);
    },
    [onContainerEl],
  );
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [localViewport, setLocalViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [localFogDataUrl, setLocalFogDataUrl] = useState<string | null>(null);
  const [fogReady, setFogReady] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [draftAnnotation, setDraftAnnotation] = useState<number[] | null>(null);
  const [fadeClock, setFadeClock] = useState(() => Date.now());
  const [shiftHeld, setShiftHeld] = useState(false);
  const isPanning = useRef(false);
  const isPaintingFog = useRef(false);
  const isDrawingAnnotation = useRef(false);
  const annotationPoints = useRef<number[]>([]);
  const draftAnnotationPoints = useRef<number[]>([]);
  const pendingCommitPointsRef = useRef<number[] | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fogInitKeyRef = useRef("");
  const fogSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsViewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFogSceneIdRef = useRef<string | null>(null);
  const sceneNavRef = useRef<string | null>(null);
  const pendingAnnotationCommitRef = useRef(false);
  const annotationCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef<Viewport>(localViewport);
  viewportRef.current = localViewport;
  const roomId = state.roomId;
  const viewerId = isDm ? "dm" : (playerSlotId ?? "player");
  const viewportMode: SessionViewportMode = sceneEditMode ? "edit" : "play";

  const persistSessionViewport = useCallback(
    (next: Viewport, scene = sceneId, mode: SessionViewportMode = viewportMode) => {
      saveSessionViewport(roomId, viewerId, scene, mode, next);
    },
    [roomId, sceneId, viewerId, viewportMode],
  );

  const rawScene = state.scenes.find((scene) => scene.id === sceneId);
  const activeScene = rawScene ? normalizeScene(rawScene) : undefined;
  const sceneTokens = state.tokens.filter((token) => token.sceneId === sceneId);
  const mapWidth = activeScene?.width ?? 800;
  const mapHeight = activeScene?.height ?? 600;
  const sceneBackground = activeScene?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND;
  const viewport = localViewport;
  const showFog = Boolean(
    activeScene?.fogEnabled && (!isDm || (fogPreview && !sceneEditMode)),
  );
  const dmFogPreviewOpacity = 0.5;
  const fogOverlayOpacity = isDm && fogPreview && !sceneEditMode ? dmFogPreviewOpacity : 1;
  const playerShowFog = Boolean(activeScene?.fogEnabled);
  const fogActiveForView = isDm ? showFog : playerShowFog;
  const canvasBackground = fogActiveForView ? "#000000" : sceneBackground;
  const fogDataUrl = isDm ? (localFogDataUrl ?? activeScene?.fogDataUrl ?? null) : (activeScene?.fogDataUrl ?? null);
  const canPan = isDm || !isDm;
  const canZoom = isDm || !isDm;
  const playerSlot =
    !isDm && playerSlotId
      ? state.playerSlots.find((slot) => slot.id === playerSlotId)
      : undefined;
  const sceneHidden =
    !isDm && playerSlot && !canPlayerSeeScene(playerSlot, sceneId);

  const sceneAnnotationSource = useMemo(
    () => (state.annotations ?? []).filter((annotation) => annotation.sceneId === sceneId),
    [sceneId, state.annotations],
  );

  const sceneAnnotations = useMemo(
    () =>
      sceneAnnotationSource.filter(
        (annotation) => annotationOpacity(annotation.createdAt, fadeClock) > 0,
      ),
    [fadeClock, sceneAnnotationSource],
  );

  const localAnnotationOwnerId = isDm ? "dm" : (playerSlotId ?? null);

  const sceneAnnotationsForRender = useMemo(() => {
    if (!draftAnnotation || !pendingCommitPointsRef.current || !localAnnotationOwnerId) {
      return sceneAnnotations;
    }
    const pendingPoints = pendingCommitPointsRef.current;
    return sceneAnnotations.filter(
      (annotation) =>
        annotation.playerId !== localAnnotationOwnerId ||
        annotation.sceneId !== sceneId ||
        !annotationsMatch(annotation.points, pendingPoints),
    );
  }, [draftAnnotation, localAnnotationOwnerId, sceneAnnotations, sceneId]);

  const activePlayerAnnotationCount = useMemo(() => {
    if (!localAnnotationOwnerId) {
      return 0;
    }
    return (state.annotations ?? []).filter(
      (annotation) =>
        annotation.playerId === localAnnotationOwnerId &&
        annotationOpacity(annotation.createdAt, fadeClock) > 0,
    ).length;
  }, [fadeClock, localAnnotationOwnerId, state.annotations]);
  const annotationSlotsFull =
    activePlayerAnnotationCount >= MAX_ACTIVE_ANNOTATIONS_PER_PLAYER;
  const canAnnotate =
    Boolean(onAddAnnotation) &&
    !sceneEditMode &&
    !(isDm && fogMode) &&
    !annotationSlotsFull;

  useEffect(() => {
    const syncShift = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftHeld(event.type === "keydown");
      }
    };
    const clearShift = () => setShiftHeld(false);

    window.addEventListener("keydown", syncShift);
    window.addEventListener("keyup", syncShift);
    window.addEventListener("blur", clearShift);
    return () => {
      window.removeEventListener("keydown", syncShift);
      window.removeEventListener("keyup", syncShift);
      window.removeEventListener("blur", clearShift);
    };
  }, []);

  useEffect(() => {
    if (sceneAnnotationSource.length === 0 && !draftAnnotation) {
      return;
    }
    const timer = setInterval(() => setFadeClock(Date.now()), 50);
    return () => clearInterval(timer);
  }, [draftAnnotation, sceneAnnotationSource]);

  const gridBounds = useMemo(() => {
    const gridSize = activeScene?.gridSize ?? 50;
    if (gridSize <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return computeVisibleGridBounds(viewport, size.width, size.height, gridSize);
  }, [activeScene?.gridSize, viewport, size.width, size.height]);

  const markerArmLength = activeScene?.gridSize ?? 50;
  const sceneCenterX = activeScene?.centerX ?? mapWidth / 2;
  const sceneCenterY = activeScene?.centerY ?? mapHeight / 2;


  useEffect(() => {
    setSelectedLayerId(null);
  }, [sceneId]);

  useEffect(() => {
    return () => {
      persistSessionViewport(viewportRef.current);
    };
  }, [persistSessionViewport, sceneId, viewportMode]);

  useEffect(() => {
    if (!activeScene || size.width <= 0 || size.height <= 0) {
      return;
    }

    const navKey = `${viewportMode}:${sceneId}:${size.width}x${size.height}`;
    const sceneChanged = !sceneNavRef.current?.startsWith(`${viewportMode}:${sceneId}:`);
    const sizeReady = sceneNavRef.current === null;
    const modeChanged =
      sceneNavRef.current !== null && !sceneNavRef.current.startsWith(`${viewportMode}:`);

    if (!sceneChanged && !sizeReady && !modeChanged) {
      return;
    }

    sceneNavRef.current = navKey;

    const normalizedViewport = viewportForNormalizedScene(
      activeScene,
      size.width,
      size.height,
    );
    const savedSessionViewport = getSessionViewport(
      roomId,
      viewerId,
      sceneId,
      viewportMode,
    );
    const savedEditViewport =
      viewportMode === "edit" && !isDefaultViewport(activeScene.defaultViewport)
        ? activeScene.defaultViewport
        : null;

    let next =
      savedSessionViewport ??
      (viewportMode === "edit" ? savedEditViewport : null) ??
      normalizedViewport;
    next = clampViewport(next);
    if (!isDm && !sceneEditMode) {
      next = clampPlayerViewport(next, activeScene, size.width, size.height);
    }
    viewportRef.current = next;
    setLocalViewport(next);

    if (sceneEditMode) {
      onSettingsViewportChange?.(next);
    } else if (isDm && !savedSessionViewport) {
      dm.updateViewport(next);
    }
  }, [
    activeScene,
    dm,
    isDm,
    onSettingsViewportChange,
    roomId,
    sceneEditMode,
    sceneId,
    size.height,
    size.width,
    viewerId,
    viewportMode,
  ]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the 3D dice anchored to the map: report the live viewport, grid size, and the
  // current (scene-bounded) view center so a roll's tray lands at the same map location
  // on every client through pan/zoom and window-size differences.
  useEffect(() => {
    if (!onViewportChange) {
      return;
    }
    const scale = viewport.scale > 0 ? viewport.scale : 1;
    const centerX = (size.width / 2 - viewport.x) / scale;
    const centerY = (size.height / 2 - viewport.y) / scale;
    // Size the dice roll region from the shared map (map cells + a fixed border, clamped),
    // then anchor it at the view center but keep it within map ± border. For a normal map the
    // region covers it and this resolves to the map center; a capped huge map follows the view.
    const gridSize = activeScene?.gridSize ?? 50;
    const region = rollRegionCells(mapWidth / gridSize, mapHeight / gridSize);
    const borderPx = ROLL_REGION_BORDER_CELLS * gridSize;
    const clampAnchor = (center: number, span: number, halfPx: number) => {
      if (span <= 0) {
        return center;
      }
      const lo = halfPx - borderPx;
      const hi = span + borderPx - halfPx;
      return lo <= hi ? Math.max(lo, Math.min(hi, center)) : span / 2;
    };
    onViewportChange({
      viewport,
      gridSize,
      center: [
        clampAnchor(centerX, mapWidth, (region.w / 2) * gridSize),
        clampAnchor(centerY, mapHeight, (region.h / 2) * gridSize),
      ],
      regionCellsW: region.w,
      regionCellsH: region.h,
    });
  }, [
    onViewportChange,
    viewport,
    size.width,
    size.height,
    mapWidth,
    mapHeight,
    activeScene?.gridSize,
  ]);

  useEffect(() => {
    if (!activeScene || mapWidth <= 0 || mapHeight <= 0) {
      return;
    }

    const initKey = `${activeScene.id}:${mapWidth}x${mapHeight}`;

    if (fogInitKeyRef.current !== initKey) {
      fogInitKeyRef.current = initKey;
      setFogReady(false);

      const canvas = document.createElement("canvas");
      fogCanvasRef.current = canvas;

      void loadFogCanvas(canvas, mapWidth, mapHeight, activeScene.fogDataUrl).then(() => {
        if (fogInitKeyRef.current !== initKey) {
          return;
        }
        setLocalFogDataUrl(fogCanvasToDataUrl(canvas));
        setFogReady(true);
      });
      return;
    }

    if (activeScene.fogDataUrl === null && fogCanvasRef.current) {
      fillFog(fogCanvasRef.current);
      setLocalFogDataUrl(fogCanvasToDataUrl(fogCanvasRef.current));
    }
  }, [activeScene?.id, activeScene?.fogDataUrl, mapWidth, mapHeight]);

  useEffect(() => {
    return () => {
      if (fogSyncTimerRef.current) {
        clearTimeout(fogSyncTimerRef.current);
      }
      if (settingsViewportTimerRef.current) {
        clearTimeout(settingsViewportTimerRef.current);
      }
      if (annotationCommitTimerRef.current) {
        clearTimeout(annotationCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      !pendingAnnotationCommitRef.current ||
      !pendingCommitPointsRef.current ||
      !localAnnotationOwnerId
    ) {
      return;
    }
    const committed = sceneAnnotations.some(
      (annotation) =>
        annotation.playerId === localAnnotationOwnerId &&
        annotation.sceneId === sceneId &&
        annotationsMatch(annotation.points, pendingCommitPointsRef.current!),
    );
    if (!committed) {
      return;
    }
    pendingAnnotationCommitRef.current = false;
    pendingCommitPointsRef.current = null;
    if (annotationCommitTimerRef.current) {
      clearTimeout(annotationCommitTimerRef.current);
      annotationCommitTimerRef.current = null;
    }
    setDraftAnnotation(null);
  }, [localAnnotationOwnerId, sceneAnnotations, sceneId]);

  const saveSettingsViewport = useCallback(
    (next: Viewport) => {
      if (!activeScene) {
        return;
      }
      onSettingsViewportChange?.(next);
      if (settingsViewportTimerRef.current) {
        clearTimeout(settingsViewportTimerRef.current);
      }
      settingsViewportTimerRef.current = setTimeout(() => {
        settingsViewportTimerRef.current = null;
        dm.updateScene({ ...activeScene, defaultViewport: next });
      }, 150);
    },
    [activeScene, dm, onSettingsViewportChange],
  );

  useEffect(() => {
    if (!viewCommand || !sceneEditMode || !activeScene) {
      return;
    }
    const next = clampViewport(
      viewCommand.type === "reset"
        ? { ...DEFAULT_VIEWPORT }
        : fitViewportToScene(activeScene, size.width, size.height),
    );
    viewportRef.current = next;
    setLocalViewport(next);
    persistSessionViewport(next);
    saveSettingsViewport(next);
  }, [viewCommand?.id]);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      return {
        x: (screenX - viewport.x) / viewport.scale,
        y: (screenY - viewport.y) / viewport.scale,
      };
    },
    [viewport],
  );

  const setViewport = useCallback(
    (next: Viewport) => {
      let resolved = clampViewport(next);
      if (!isDm && !sceneEditMode && activeScene) {
        resolved = clampPlayerViewport(resolved, activeScene, size.width, size.height);
      }
      viewportRef.current = resolved;
      setLocalViewport(resolved);
      persistSessionViewport(resolved);
      if (isDm && sceneEditMode) {
        saveSettingsViewport(resolved);
        return;
      }
      if (isDm) {
        dm.updateViewport(resolved);
      }
    },
    [
      activeScene,
      dm,
      isDm,
      persistSessionViewport,
      saveSettingsViewport,
      sceneEditMode,
      size.height,
      size.width,
    ],
  );

  const scheduleFogSync = useCallback(
    (sceneId: string) => {
      pendingFogSceneIdRef.current = sceneId;
      if (fogSyncTimerRef.current) {
        return;
      }
      fogSyncTimerRef.current = setTimeout(() => {
        fogSyncTimerRef.current = null;
        const canvas = fogCanvasRef.current;
        const syncSceneId = pendingFogSceneIdRef.current;
        if (!canvas || !syncSceneId) {
          return;
        }
        dm.updateFog(syncSceneId, fogCanvasToDataUrl(canvas));
      }, FOG_SYNC_MS);
    },
    [dm],
  );

  const applyFogBrush = useCallback(
    (screenX: number, screenY: number) => {
      if (!activeScene || !fogCanvasRef.current || !fogReady) {
        return;
      }
      const world = screenToWorld(screenX, screenY);
      const radius = BRUSH_RADIUS / viewport.scale;
      paintFogBrush(fogCanvasRef.current, world.x, world.y, radius, fogBrushMode);
      const dataUrl = fogCanvasToDataUrl(fogCanvasRef.current);
      setLocalFogDataUrl(dataUrl);
      scheduleFogSync(activeScene.id);
    },
    [activeScene, fogBrushMode, fogReady, scheduleFogSync, screenToWorld, viewport.scale],
  );

  const handleLayerDragEnd = useCallback(
    (layerId: string, x: number, y: number) => {
      if (!activeScene) {
        return;
      }
      dm.updateScene(moveMapLayer(activeScene, layerId, x, y));
    },
    [activeScene, dm],
  );

  const handleSceneCenterDragEnd = useCallback(
    (centerX: number, centerY: number) => {
      if (!activeScene) {
        return;
      }
      dm.updateScene(moveSceneCenter(activeScene, Math.round(centerX), Math.round(centerY)));
    },
    [activeScene, dm],
  );

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    if (!canZoom) {
      return;
    }
    event.evt.preventDefault();
    const stage = event.target.getStage();
    if (!stage) {
      return;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }
    const scaleBy = 1.08;
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextScale = clampViewportScale(
      viewport.scale * (direction > 0 ? scaleBy : 1 / scaleBy),
    );
    const mousePointTo = {
      x: (pointer.x - viewport.x) / viewport.scale,
      y: (pointer.y - viewport.y) / viewport.scale,
    };
    setViewport({
      scale: nextScale,
      x: pointer.x - mousePointTo.x * nextScale,
      y: pointer.y - mousePointTo.y * nextScale,
    });
  };

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    if (event.evt.button === 1) {
      event.evt.preventDefault();
      isPanning.current = true;
      lastPointer.current = pointer;
      return;
    }

    if (isDm && sceneEditMode && event.evt.button === 0) {
      if (!isOnDraggableNode(event)) {
        isPanning.current = true;
        lastPointer.current = pointer;
      }
      return;
    }

    if (isDm && fogMode && activeScene?.fogEnabled && event.evt.button === 0) {
      isPaintingFog.current = true;
      applyFogBrush(pointer.x, pointer.y);
      return;
    }

    if (
      canAnnotate &&
      event.evt.button === 0 &&
      event.evt.shiftKey &&
      (isDm ? !isOnDraggableNode(event) : true)
    ) {
      if (annotationSlotsFull) {
        return;
      }
      event.evt.preventDefault();
      const world = screenToWorld(pointer.x, pointer.y);
      isDrawingAnnotation.current = true;
      pendingAnnotationCommitRef.current = false;
      if (annotationCommitTimerRef.current) {
        clearTimeout(annotationCommitTimerRef.current);
        annotationCommitTimerRef.current = null;
      }
      annotationPoints.current = [world.x, world.y];
      draftAnnotationPoints.current = [world.x, world.y];
      setDraftAnnotation([world.x, world.y]);
      return;
    }

    if (canPan && event.evt.button === 0 && !isOnDraggableNode(event)) {
      isPanning.current = true;
      lastPointer.current = pointer;
      return;
    }

    if (isDm && event.evt.button === 2) {
      const world = screenToWorld(pointer.x, pointer.y);
      dm.setPing(world.x, world.y);
    }
  };

  const handlePointerMove = (event: KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    if (isDrawingAnnotation.current && (event.evt.buttons & 1) !== 0) {
      const world = screenToWorld(pointer.x, pointer.y);
      const atMaxPoints = isAnnotationAtMaxPoints(annotationPoints.current);

      if (!atMaxPoints) {
        const sparseNext = appendAnnotationSample(annotationPoints.current, world.x, world.y);
        if (sparseNext.length !== annotationPoints.current.length) {
          annotationPoints.current = trimAnnotationPoints(sparseNext);
        }
        draftAnnotationPoints.current = appendDraftAnnotationSample(
          draftAnnotationPoints.current,
          world.x,
          world.y,
        );
      }

      setDraftAnnotation(
        buildAnnotationDraftPreview(
          annotationPoints.current,
          draftAnnotationPoints.current,
          world.x,
          world.y,
          atMaxPoints,
        ),
      );
      return;
    }

    if (isPanning.current) {
      const dx = pointer.x - lastPointer.current.x;
      const dy = pointer.y - lastPointer.current.y;
      lastPointer.current = pointer;
      const current = viewportRef.current;
      setViewport({
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      });
      return;
    }

    if (isDm && fogMode && activeScene?.fogEnabled && !sceneEditMode && isPaintingFog.current && (event.evt.buttons & 1) !== 0) {
      applyFogBrush(pointer.x, pointer.y);
    }
  };

  const handlePointerUp = (event?: KonvaEventObject<PointerEvent>) => {
    if (isDrawingAnnotation.current) {
      const stage = event?.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (pointer && activeScene && onAddAnnotation) {
        const world = screenToWorld(pointer.x, pointer.y);
        const points = isAnnotationAtMaxPoints(annotationPoints.current)
          ? annotationPoints.current
          : trimAnnotationPoints(
              appendAnnotationSample(annotationPoints.current, world.x, world.y),
            );
        if (annotationPathLength(points) >= ANNOTATION_MIN_LENGTH) {
          pendingCommitPointsRef.current = points;
          onAddAnnotation(activeScene.id, points, annotationColor);
          pendingAnnotationCommitRef.current = true;
          if (annotationCommitTimerRef.current) {
            clearTimeout(annotationCommitTimerRef.current);
          }
          annotationCommitTimerRef.current = setTimeout(() => {
            pendingAnnotationCommitRef.current = false;
            pendingCommitPointsRef.current = null;
            setDraftAnnotation(null);
            annotationCommitTimerRef.current = null;
          }, ANNOTATION_COMMIT_GRACE_MS);
        } else {
          setDraftAnnotation(null);
        }
      } else {
        setDraftAnnotation(null);
      }
      isDrawingAnnotation.current = false;
      annotationPoints.current = [];
      draftAnnotationPoints.current = [];
    }

    if (isPaintingFog.current && activeScene && fogCanvasRef.current) {
      dm.updateFog(activeScene.id, fogCanvasToDataUrl(fogCanvasRef.current));
    }
    isPanning.current = false;
    isPaintingFog.current = false;
  };

  const ping = state.ping && state.ping.sceneId === sceneId ? state.ping : null;

  const fogBadgeText =
    fogBrushMode === "reveal"
      ? "Reveal brush — paint to clear fog for players"
      : "Hide brush — paint to add fog back";

  return (
    <div
      ref={setContainerEl}
      className={`map-canvas ${isDm ? "dm" : "player"} ${fogMode ? "fog-mode" : ""} ${sceneEditMode ? "scene-edit" : ""}`}
      style={{ backgroundColor: canvasBackground }}
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault();
        }
      }}
    >
      {sceneHidden ? (
        <div className="scene-hidden-overlay">
          <p>The DM has not shared this scene with you.</p>
        </div>
      ) : (
      <Stage
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onClick={(event) => {
          if (isDm && sceneEditMode && event.target === event.target.getStage()) {
            setSelectedLayerId(null);
          }
        }}
      >
        <Layer>
          <Group x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
            {isDm && sceneEditMode ? (
              <Rect
                x={0}
                y={0}
                width={mapWidth}
                height={mapHeight}
                fill={sceneBackground}
                listening={false}
              />
            ) : null}
            {activeScene?.layers.map((layer) => (
              <Group
                key={layer.id}
                onClick={(event) => {
                  if (isDm && sceneEditMode) {
                    event.cancelBubble = true;
                    setSelectedLayerId(layer.id);
                  }
                }}
              >
                <MapLayerImage
                  layer={layer}
                  selected={sceneEditMode && selectedLayerId === layer.id}
                  draggable={isDm && sceneEditMode && selectedLayerId === layer.id}
                  onDragEnd={handleLayerDragEnd}
                />
              </Group>
            ))}
            {isDm && sceneEditMode ? <SceneOriginMarker armLength={markerArmLength} /> : null}
            {isDm && sceneEditMode ? (
              <SceneCenterHandle
                centerX={sceneCenterX}
                centerY={sceneCenterY}
                armLength={markerArmLength}
                onDragEnd={handleSceneCenterDragEnd}
              />
            ) : null}
            {activeScene?.showGrid && activeScene.gridSize > 0 ? (
              <Group x={gridBounds.x} y={gridBounds.y}>
                <SceneGrid
                  width={gridBounds.width}
                  height={gridBounds.height}
                  gridSize={activeScene.gridSize}
                  originX={gridBounds.x}
                  originY={gridBounds.y}
                  zoomScale={viewport.scale}
                />
              </Group>
            ) : null}
            {(isDm ? showFog : playerShowFog) && activeScene ? (
              <FogOverlay
                fogDataUrl={fogDataUrl}
                mapWidth={mapWidth}
                mapHeight={mapHeight}
                opacity={fogOverlayOpacity}
                playerOpaque={!isDm}
              />
            ) : null}
            {sceneTokens.map((token) => {
              const isOwnToken = !isDm && token.ownerPlayerId === playerSlotId;
              const canDragToken =
                (isDm && !fogMode && !sceneEditMode) || (isOwnToken && !sceneEditMode && !shiftHeld);

              return (
                <MapTokenNode
                  key={token.id}
                  token={token}
                  gridSize={activeScene?.gridSize ?? 50}
                  draggable={canDragToken}
                  onDragEnd={(x, y) => {
                    if (isDm) {
                      dm.moveToken(token.id, x, y);
                      return;
                    }
                    onMoveToken?.(token.id, x, y);
                  }}
                />
              );
            })}
            {ping ? (
              <Circle
                x={ping.x}
                y={ping.y}
                radius={18}
                stroke="#ffeb3b"
                strokeWidth={3}
                fill="rgba(255,235,59,0.25)"
                listening={false}
              />
            ) : null}
            {sceneAnnotationsForRender.map((annotation) => (
              <MapAnnotationArrow
                key={annotation.id}
                points={annotation.points}
                opacity={annotationOpacity(annotation.createdAt, fadeClock)}
              />
            ))}
            {draftAnnotation && draftAnnotation.length >= 2 ? (
              <MapAnnotationArrow
                points={draftAnnotation}
                opacity={0.85}
                tension={0}
              />
            ) : null}
            {isDm && sceneEditMode ? (
              <Rect
                x={0}
                y={0}
                width={mapWidth}
                height={mapHeight}
                stroke="rgba(107,138,253,0.5)"
                strokeWidth={2}
                dash={[12, 6]}
                listening={false}
              />
            ) : null}
          </Group>
        </Layer>
      </Stage>
      )}
      {isDm && fogPreview && !sceneEditMode && activeScene?.fogEnabled ? (
        <div className="fog-badge">Fog preview on — semi-transparent for you; players see full fog</div>
      ) : null}
      {isDm && !fogPreview && !sceneEditMode && activeScene?.fogEnabled ? (
        <div className="fog-badge xray-badge">X-ray on — fog hidden for you only</div>
      ) : null}
      {isDm && sceneEditMode ? (
        <div className="fog-badge scene-edit-badge">
          Settings — click an image to select it, then drag to move; drag elsewhere to pan
        </div>
      ) : null}
      {isDm && fogMode && !sceneEditMode && activeScene?.fogEnabled ? (
        <div className="fog-badge fog-brush-badge">
          {fogBadgeText} · middle mouse to pan
        </div>
      ) : null}
    </div>
  );
}
