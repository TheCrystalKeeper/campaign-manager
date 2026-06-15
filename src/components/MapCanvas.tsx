import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Group, Image, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type Konva from "konva";
import { DEFAULT_SCENE_BACKGROUND, DEFAULT_VIEWPORT, type GameState, type MapLayer, type Viewport } from "../lib/types";
import { canPlayerSeeScene } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import {
  fillFog,
  fogCanvasToDataUrl,
  loadFogCanvas,
  paintFogBrush,
  type FogBrushMode,
} from "../lib/fogCanvas";
import { moveMapLayer, normalizeScene, fitViewportToScene } from "../lib/sceneUtils";

type MapCanvasProps = {
  state: GameState;
  isDm: boolean;
  playerSlotId?: string | null;
  dm: ReturnType<typeof useDmActions>;
  fogMode: boolean;
  fogPreview: boolean;
  fogBrushMode: FogBrushMode;
  sceneEditMode: boolean;
  viewCommand: { type: "fit" | "reset"; id: number } | null;
  onSettingsViewportChange?: (viewport: Viewport) => void;
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
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = layer.url;
  }, [layer.url]);

  if (!image) {
    return null;
  }

  return (
    <Group
      x={layer.x}
      y={layer.y}
      draggable={draggable}
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

type FogOverlayProps = {
  fogDataUrl: string | null;
  mapWidth: number;
  mapHeight: number;
};

/// <summary>
/// Renders the fog mask over the map so players (and DM preview) only see revealed areas.
/// </summary>
function FogOverlay({ fogDataUrl, mapWidth, mapHeight }: FogOverlayProps) {
  const [fogImage, setFogImage] = useState<HTMLImageElement | null>(null);

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
    return <Rect x={0} y={0} width={mapWidth} height={mapHeight} fill="rgba(0,0,0,0.92)" listening={false} />;
  }

  return (
    <Image
      image={fogImage}
      x={0}
      y={0}
      width={mapWidth}
      height={mapHeight}
      listening={false}
    />
  );
}

const FOG_SYNC_MS = 50;
const BRUSH_RADIUS = 48;

type SceneGridProps = {
  width: number;
  height: number;
  gridSize: number;
};

/// <summary>
/// Renders orthogonal grid lines; each line is its own Konva Line so segments are not connected.
/// </summary>
function SceneGrid({ width, height, gridSize }: SceneGridProps) {
  const verticals: number[] = [];
  for (let x = 0; x <= width; x += gridSize) {
    verticals.push(x);
  }

  const horizontals: number[] = [];
  for (let y = 0; y <= height; y += gridSize) {
    horizontals.push(y);
  }

  return (
    <>
      {verticals.map((x) => (
        <Line
          key={`grid-v-${x}`}
          points={[x, 0, x, height]}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          listening={false}
        />
      ))}
      {horizontals.map((y) => (
        <Line
          key={`grid-h-${y}`}
          points={[0, y, width, y]}
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={1}
          listening={false}
        />
      ))}
    </>
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
/// Konva canvas for the shared battle map with DM viewport sync, tokens, grid, and fog.
/// </summary>
export function MapCanvas({
  state,
  isDm,
  playerSlotId,
  dm,
  fogMode,
  fogPreview,
  fogBrushMode,
  sceneEditMode,
  viewCommand,
  onSettingsViewportChange,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [localViewport, setLocalViewport] = useState<Viewport>(
    isDm ? state.viewport : DEFAULT_VIEWPORT,
  );
  const [localFogDataUrl, setLocalFogDataUrl] = useState<string | null>(null);
  const [fogReady, setFogReady] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const isPanning = useRef(false);
  const isPaintingFog = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fogInitKeyRef = useRef("");
  const fogSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsViewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFogSceneIdRef = useRef<string | null>(null);
  const playerInitializedRef = useRef(false);
  const dmSceneIdRef = useRef<string | null>(null);
  const dmSettingsModeRef = useRef(false);

  const rawScene = state.scenes.find((scene) => scene.id === state.activeSceneId);
  const activeScene = rawScene ? normalizeScene(rawScene) : undefined;
  const sceneTokens = state.tokens.filter((token) => token.sceneId === state.activeSceneId);
  const mapWidth = activeScene?.width ?? 800;
  const mapHeight = activeScene?.height ?? 600;
  const sceneBackground = activeScene?.backgroundColor ?? DEFAULT_SCENE_BACKGROUND;
  const viewport = localViewport;
  const showFog = Boolean(
    activeScene?.fogEnabled && (!isDm || (fogPreview && !sceneEditMode)),
  );
  const playerShowFog = Boolean(activeScene?.fogEnabled);
  const fogDataUrl = isDm ? (localFogDataUrl ?? activeScene?.fogDataUrl ?? null) : (activeScene?.fogDataUrl ?? null);
  const canPan = isDm || !isDm;
  const canZoom = isDm || !isDm;
  const playerSlot =
    !isDm && playerSlotId
      ? state.playerSlots.find((slot) => slot.id === playerSlotId)
      : undefined;
  const sceneHidden =
    !isDm &&
    playerSlot &&
    !canPlayerSeeScene(playerSlot, state.activeSceneId);

  useEffect(() => {
    if (!isDm) {
      return;
    }

    const sceneId = state.activeSceneId;
    const sceneChanged = dmSceneIdRef.current !== sceneId;
    const settingsOpened = !dmSettingsModeRef.current && sceneEditMode;
    dmSceneIdRef.current = sceneId;
    dmSettingsModeRef.current = sceneEditMode;

    if (!sceneChanged && !settingsOpened) {
      return;
    }

    const raw = state.scenes.find((item) => item.id === sceneId);
    if (!raw) {
      return;
    }

    const next = normalizeScene(raw).defaultViewport;
    setLocalViewport(next);
    if (sceneEditMode) {
      onSettingsViewportChange?.(next);
    }
  }, [isDm, state.activeSceneId, sceneEditMode, onSettingsViewportChange]);

  useEffect(() => {
    if (!isDm && activeScene && !playerInitializedRef.current) {
      playerInitializedRef.current = true;
      setLocalViewport({
        x: size.width / 2 - (mapWidth * 0.4),
        y: size.height / 2 - (mapHeight * 0.4),
        scale: 0.8,
      });
    }
  }, [isDm, activeScene, mapWidth, mapHeight, size.width, size.height]);

  useEffect(() => {
    playerInitializedRef.current = false;
    setSelectedLayerId(null);
  }, [state.activeSceneId]);

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
    };
  }, []);

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
    const next =
      viewCommand.type === "reset"
        ? { ...DEFAULT_VIEWPORT }
        : fitViewportToScene(activeScene, size.width, size.height);
    setLocalViewport(next);
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
      setLocalViewport(next);
      if (isDm && sceneEditMode) {
        saveSettingsViewport(next);
        return;
      }
      if (isDm) {
        dm.updateViewport(next);
      }
    },
    [dm, isDm, saveSettingsViewport, sceneEditMode],
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
    const nextScale = Math.min(4, Math.max(0.2, viewport.scale * (direction > 0 ? scaleBy : 1 / scaleBy)));
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

    if (isPanning.current) {
      const dx = pointer.x - lastPointer.current.x;
      const dy = pointer.y - lastPointer.current.y;
      lastPointer.current = pointer;
      setViewport({
        ...viewport,
        x: viewport.x + dx,
        y: viewport.y + dy,
      });
      return;
    }

    if (isDm && fogMode && activeScene?.fogEnabled && !sceneEditMode && isPaintingFog.current && (event.evt.buttons & 1) !== 0) {
      applyFogBrush(pointer.x, pointer.y);
    }
  };

  const handlePointerUp = () => {
    if (isPaintingFog.current && activeScene && fogCanvasRef.current) {
      dm.updateFog(activeScene.id, fogCanvasToDataUrl(fogCanvasRef.current));
    }
    isPanning.current = false;
    isPaintingFog.current = false;
  };

  const ping =
    state.ping && state.ping.sceneId === state.activeSceneId ? state.ping : null;

  const fogBadgeText =
    fogBrushMode === "reveal"
      ? "Reveal brush — paint to clear fog for players"
      : "Hide brush — paint to add fog back";

  return (
    <div
      ref={containerRef}
      className={`map-canvas ${isDm ? "dm" : "player"} ${fogMode ? "fog-mode" : ""} ${sceneEditMode ? "scene-edit" : ""}`}
      style={{ backgroundColor: sceneBackground }}
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
            <Rect
              x={0}
              y={0}
              width={mapWidth}
              height={mapHeight}
              fill={sceneBackground}
              listening={false}
            />
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
                  draggable={isDm && sceneEditMode}
                  onDragEnd={handleLayerDragEnd}
                />
              </Group>
            ))}
            {activeScene?.showGrid && activeScene.gridSize > 0 ? (
              <SceneGrid width={mapWidth} height={mapHeight} gridSize={activeScene.gridSize} />
            ) : null}
            {(isDm ? showFog : playerShowFog) && activeScene ? (
              <FogOverlay fogDataUrl={fogDataUrl} mapWidth={mapWidth} mapHeight={mapHeight} />
            ) : null}
            {sceneTokens.map((token) => (
              <Group
                key={token.id}
                x={token.x}
                y={token.y}
                draggable={isDm && !fogMode && !sceneEditMode}
                onDragEnd={(event) => {
                  dm.moveToken(token.id, event.target.x(), event.target.y());
                }}
              >
                <Circle radius={22} fill={token.color} stroke="#111" strokeWidth={2} />
                <Text
                  text={token.label}
                  fontSize={12}
                  fill="#111"
                  width={60}
                  offsetX={30}
                  offsetY={-34}
                  align="center"
                />
              </Group>
            ))}
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
      {!sceneHidden && !sceneEditMode && activeScene && activeScene.gridSize > 0 ? (
        <div className="map-scale-overlay" aria-label="Map scale">
          <div
            className="map-scale-bar"
            style={{ width: Math.max(24, activeScene.gridSize * viewport.scale) }}
          />
          <span className="map-scale-caption">1 yard</span>
        </div>
      ) : null}
      {!isDm && !sceneHidden ? <div className="player-badge">Pan & zoom freely · scroll or drag</div> : null}
      {isDm && fogPreview && !sceneEditMode && activeScene?.fogEnabled ? (
        <div className="fog-badge">Fog preview on — players see this</div>
      ) : null}
      {isDm && !fogPreview && !sceneEditMode && activeScene?.fogEnabled ? (
        <div className="fog-badge xray-badge">X-ray on — fog hidden for you only</div>
      ) : null}
      {isDm && sceneEditMode ? (
        <div className="fog-badge scene-edit-badge">
          Settings — drag to pan, scroll to zoom, drag images to position (players cannot see this)
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
