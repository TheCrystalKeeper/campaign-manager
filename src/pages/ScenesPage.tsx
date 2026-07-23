import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, PanelLeft, PanelRight } from "lucide-react";
import { MapCanvas } from "../components/MapCanvas";
import { SceneSettings } from "../components/SceneSettings";
import { ActorsPanel } from "../components/ActorsPanel";
import { ItemsPanel } from "../components/ItemsPanel";
import { ChipTabStrip } from "./ChipTabStrip";
import { PageSwitcher, type PageId } from "./PageSwitcher";
import { campaignKey, readCampaignFlag, writeCampaignFlag } from "../lib/campaignStore";
import { applySceneMessage, sceneMessageSceneId } from "../lib/sceneMessages";
import { buildInverse, useHistory } from "../lib/history";
import { useKeybinds } from "../lib/useKeybinds";
import { matchesBinding } from "../lib/keybinds";
import { createEmptyScene, fitViewportToScene } from "../lib/sceneUtils";
import { actorToken, itemToken } from "../lib/tokenFactory";
import {
  DEFAULT_VIEWPORT,
  type Annotation,
  type ClientMessage,
  type Scene,
  type Viewport,
} from "../lib/types";
import type { PanelContext } from "../panels/registry";

const LIVE_KEY = "cm-scene-editor-live";

type InspectorTab = "scene" | "actors" | "items";
type PanelLayout = "tabs" | "roster";

/** Ephemeral annotations (pointer arrows, fading player strokes) never belong in a draft. */
function stripEphemeral(scene: Scene): Scene {
  return { ...scene, annotations: scene.annotations.filter((a: Annotation) => !a.ephemeral) };
}

type Draft = { scene: Scene; baselineJson: string };

// --- Inspector / roster width persistence ---
const INSPECTOR_MIN_W = 260;
const INSPECTOR_MAX_W = 560;
const INSPECTOR_DEFAULT_W = 340;
const ROSTER_MIN_W = 220;
const ROSTER_MAX_W = 560;
const ROSTER_DEFAULT_W = 300;

function loadWidth(roomId: string, key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(campaignKey(roomId, key));
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(Math.max(n, min), max);
  } catch { /* use fallback */ }
  return fallback;
}
function saveWidth(roomId: string, key: string, w: number) {
  try { localStorage.setItem(campaignKey(roomId, key), String(Math.round(w))); } catch { /* noop */ }
}

function loadLayout(roomId: string): PanelLayout {
  try {
    const raw = localStorage.getItem(campaignKey(roomId, "scene-panel-layout"));
    if (raw === "roster") return "roster";
  } catch { /* noop */ }
  return "tabs";
}
function saveLayout(roomId: string, layout: PanelLayout) {
  try { localStorage.setItem(campaignKey(roomId, "scene-panel-layout"), layout); } catch { /* noop */ }
}

export function ScenesPage({
  ctx,
  active,
  activePage,
  onNavigate,
}: {
  ctx: PanelContext;
  active: boolean;
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}) {
  const { state, dm, room } = ctx;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveUpdates, setLiveUpdatesState] = useState(() =>
    readCampaignFlag(state.roomId, "scene-live", true, LIVE_KEY),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const fittedSceneRef = useRef<string | null>(null);
  const history = useHistory();
  const keybinds = useKeybinds();

  // Inspector tabs + layout toggle state
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("scene");
  const [panelLayout, setPanelLayoutState] = useState<PanelLayout>(() => loadLayout(state.roomId));
  const [rosterTab, setRosterTab] = useState<"actors" | "items">("actors");

  const setPanelLayout = (layout: PanelLayout) => {
    setPanelLayoutState(layout);
    saveLayout(state.roomId, layout);
  };

  // Resizable inspector width
  const [inspectorW, setInspectorW] = useState(() =>
    loadWidth(state.roomId, "scene-inspector-w", INSPECTOR_DEFAULT_W, INSPECTOR_MIN_W, INSPECTOR_MAX_W),
  );
  const inspectorDragging = useRef(false);

  // Resizable left roster width
  const [rosterW, setRosterW] = useState(() =>
    loadWidth(state.roomId, "scene-roster-w", ROSTER_DEFAULT_W, ROSTER_MIN_W, ROSTER_MAX_W),
  );
  const rosterDragging = useRef(false);

  // Fall back to the live scene when nothing (or a removed scene) is selected.
  const selectedSceneId =
    selectedId && state.scenes.some((scene) => scene.id === selectedId)
      ? selectedId
      : state.activeSceneId;
  const serverScene = state.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const draft = drafts[selectedSceneId] ?? null;
  const dirty = draft !== null;
  const serverChanged =
    dirty && serverScene !== null && JSON.stringify(stripEphemeral(serverScene)) !== draft.baselineJson;

  // Fit the editor viewport when the edited scene changes.
  useEffect(() => {
    if (!active || !serverScene || fittedSceneRef.current === selectedSceneId) return;
    const box = canvasBoxRef.current?.getBoundingClientRect();
    if (!box || box.width < 10 || box.height < 10) return;
    fittedSceneRef.current = selectedSceneId;
    setViewport(fitViewportToScene(serverScene, box.width, box.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectedSceneId, serverScene?.id]);

  const editorState = useMemo(() => {
    if (liveUpdates || !draft) return state;
    return {
      ...state,
      scenes: state.scenes.map((scene) => (scene.id === selectedSceneId ? draft.scene : scene)),
    };
  }, [state, liveUpdates, draft, selectedSceneId]);

  const editorSend = useCallback(
    (msg: ClientMessage) => {
      if (liveUpdates) { room.send(msg); return; }
      const targetId = sceneMessageSceneId(msg);
      const isEphemeralArrow =
        msg.type === "ADD_ANNOTATION" && (msg.annotation.ephemeral || msg.annotation.kind === "arrow");
      if (targetId !== selectedSceneId || isEphemeralArrow) { room.send(msg); return; }
      setDrafts((current) => {
        const existing = current[selectedSceneId];
        const server = state.scenes.find((scene) => scene.id === selectedSceneId);
        const base = existing?.scene ?? (server ? stripEphemeral(server) : null);
        if (!base) return current;
        const next = applySceneMessage(base, msg);
        if (next === base && existing) return current;
        return {
          ...current,
          [selectedSceneId]: {
            scene: next,
            baselineJson: existing?.baselineJson ?? JSON.stringify(server ? stripEphemeral(server) : base),
          },
        };
      });
    },
    [liveUpdates, room, selectedSceneId, state.scenes],
  );

  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;
  const recordEdit = history.record;
  const resetHistory = history.reset;
  const historyEditorSend = useCallback(
    (msg: ClientMessage) => {
      const inverse = buildInverse(editorStateRef.current, msg);
      if (inverse) recordEdit({ send: editorSend, undo: inverse.undo, redo: inverse.redo });
      editorSend(msg);
    },
    [editorSend, recordEdit],
  );

  useEffect(() => { resetHistory(); }, [selectedSceneId, liveUpdates, resetHistory]);

  const { undo: historyUndo, redo: historyRedo } = history;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const t = event.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); historyRedo();
      } else if (matchesBinding(event, keybinds.redo)) {
        event.preventDefault(); historyRedo();
      } else if (matchesBinding(event, keybinds.undo)) {
        event.preventDefault(); historyUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, historyUndo, historyRedo, keybinds]);

  const applyDraft = useCallback(
    (sceneId: string) => {
      const pending = drafts[sceneId];
      if (pending) {
        room.send({ type: "UPDATE_SCENE", scene: stripEphemeral(pending.scene) });
        setDrafts((current) => { const next = { ...current }; delete next[sceneId]; return next; });
      }
    },
    [drafts, room],
  );

  const discardDraft = (sceneId: string) =>
    setDrafts((current) => { const next = { ...current }; delete next[sceneId]; return next; });

  const setLiveUpdates = (on: boolean) => {
    if (on) {
      for (const sceneId of Object.keys(drafts)) {
        const pending = drafts[sceneId];
        room.send({ type: "UPDATE_SCENE", scene: stripEphemeral(pending.scene) });
      }
      setDrafts({});
    }
    writeCampaignFlag(state.roomId, "scene-live", on);
    setLiveUpdatesState(on);
  };

  const setLive = () => {
    applyDraft(selectedSceneId);
    if (selectedSceneId !== state.activeSceneId) dm.setScene(selectedSceneId);
  };

  const addScene = () => {
    const scene = createEmptyScene(`Scene ${state.scenes.length + 1}`);
    dm.addScene(scene);
    setSelectedId(scene.id);
  };

  const removeScene = () => {
    discardDraft(selectedSceneId);
    dm.removeScene(selectedSceneId);
    setSelectedId(null);
  };

  // --- Scene-aware drop wiring ---
  // Always-live: tokens aren't draftable (sceneMessageSceneId returns null for ADD_TOKEN),
  // so editorSend forwards them to the room even in staged mode. Players can't see tokens
  // on non-active scenes (redaction), so instant sends are safe.
  const dropActorAtScene = useCallback(
    (sheetId: string | null, clientX: number, clientY: number) => {
      const box = canvasBoxRef.current?.getBoundingClientRect();
      if (!box || !serverScene) return;
      const x = (clientX - box.left - viewport.x) / viewport.scale;
      const y = (clientY - box.top - viewport.y) / viewport.scale;
      const token = actorToken(state, sheetId, selectedSceneId, x, y);
      historyEditorSend({ type: "ADD_TOKEN", token });
    },
    [viewport, selectedSceneId, serverScene, state, historyEditorSend],
  );

  const dropItemAtScene = useCallback(
    (itemId: string, clientX: number, clientY: number) => {
      const box = canvasBoxRef.current?.getBoundingClientRect();
      if (!box || !serverScene) return;
      const x = (clientX - box.left - viewport.x) / viewport.scale;
      const y = (clientY - box.top - viewport.y) / viewport.scale;
      const token = itemToken(state, itemId, selectedSceneId, x, y);
      if (token) historyEditorSend({ type: "ADD_TOKEN", token });
    },
    [viewport, selectedSceneId, serverScene, state, historyEditorSend],
  );

  const shownScene = editorState.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
  const stagedCount = state.tokens.filter((token) => token.sceneId === selectedSceneId).length;

  // --- Resize handlers ---
  const onInspectorHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    inspectorDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onInspectorHandleMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!inspectorDragging.current) return;
    setInspectorW(Math.min(Math.max(window.innerWidth - e.clientX, INSPECTOR_MIN_W), INSPECTOR_MAX_W));
  }, []);
  const onInspectorHandleUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!inspectorDragging.current) return;
    inspectorDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setInspectorW((w) => { saveWidth(state.roomId, "scene-inspector-w", w); return w; });
  }, [state.roomId]);

  const onRosterHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    rosterDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onRosterHandleMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rosterDragging.current) return;
    setRosterW(Math.min(Math.max(e.clientX, ROSTER_MIN_W), ROSTER_MAX_W));
  }, []);
  const onRosterHandleUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!rosterDragging.current) return;
    rosterDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setRosterW((w) => { saveWidth(state.roomId, "scene-roster-w", w); return w; });
  }, [state.roomId]);

  // Clamp widths if window shrinks
  useEffect(() => {
    const onResize = () => {
      setInspectorW((w) => Math.min(w, Math.max(INSPECTOR_MIN_W, window.innerWidth - 400)));
      setRosterW((w) => Math.min(w, Math.max(ROSTER_MIN_W, window.innerWidth - 400)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- Shared panel elements ---
  const stagedHeader = (
    <div className="scene-staged-header">
      <div className="scene-staged-header-row">
        <span>Tokens on scene</span>
        <span>{stagedCount}</span>
      </div>
      <p style={{ margin: "0 0 0.2rem" }}>
        Staged tokens stay hidden from players until this scene is set live.
      </p>
    </div>
  );

  const actorsPanelEl = (
    <>
      {stagedHeader}
      <ActorsPanel
        state={state}
        dm={dm}
        openSheet={ctx.openSheet}
        dropActorAt={dropActorAtScene}
        openOnCreate={false}
      />
    </>
  );

  const itemsPanelEl = (
    <ItemsPanel
      state={state}
      dm={dm}
      openItemSheet={ctx.openItemSheet}
      dropItemAt={dropItemAtScene}
    />
  );

  const sceneSettingsEl = shownScene ? (
    <div className="stack">
      <SceneSettings
        scene={shownScene}
        roomId={state.roomId}
        onPatch={(patch) =>
          editorSend({ type: "UPDATE_SCENE", scene: { ...shownScene, ...patch } })
        }
        onSetFog={(patch) =>
          editorSend({
            type: "FOG_SET",
            sceneId: shownScene.id,
            enabled: patch.enabled ?? shownScene.fog.enabled,
            inverted: patch.inverted,
          })
        }
        onResetFog={() => editorSend({ type: "FOG_RESET", sceneId: shownScene.id })}
        onRotate={() => historyEditorSend({ type: "ROTATE_SCENE", sceneId: shownScene.id })}
        rotateDisabled={dirty}
      />
      <button
        className="btn-danger"
        disabled={state.scenes.length <= 1}
        title="Remove this scene (tokens on it are removed too)"
        onClick={removeScene}
      >
        Delete scene
      </button>
    </div>
  ) : null;

  const layoutToggle = (
    <button
      className="scene-inspector-tab-toggle"
      title={panelLayout === "tabs"
        ? "Move actors & items to the left side"
        : "Move actors & items back to the right side"}
      onClick={() => setPanelLayout(panelLayout === "tabs" ? "roster" : "tabs")}
    >
      {panelLayout === "tabs" ? <PanelLeft size={14} strokeWidth={2.2} /> : <PanelRight size={14} strokeWidth={2.2} />}
    </button>
  );

  return (
    <div className="scene-editor">
      <div className="chip-tabs scene-tabs">
        <PageSwitcher active={activePage} onSelect={onNavigate} className="page-switcher--inline" />
        <span className="page-topbar-sep" aria-hidden />
        <ChipTabStrip activeId={selectedSceneId}>
          {state.scenes.map((scene) => {
            const isLive = scene.id === state.activeSceneId;
            const isSelected = scene.id === selectedSceneId;
            return (
              <button
                key={scene.id}
                data-chip-id={scene.id}
                className={`chip-tab${isSelected ? " chip-tab--open" : ""}`}
                title={isLive ? `${scene.name} — live on the board` : `Edit ${scene.name}`}
                onClick={() => setSelectedId(scene.id)}
              >
                {isLive ? <span className="chip-tab-live">●</span> : null}
                <span className="chip-tab-name">{scene.name}</span>
                {drafts[scene.id] ? <span className="chip-tab-dirty" title="Unsaved changes" /> : null}
              </button>
            );
          })}
        </ChipTabStrip>
        <button className="chip-tab chip-tab--add" title="Add a scene" onClick={addScene}>
          ＋ Add
        </button>

        <span className="scene-tabs-actions">
          {dirty ? (
            <>
              {serverChanged ? (
                <span className="muted" title="This scene was edited on the board after you started staging — Apply will overwrite those changes">
                  <AlertTriangle size={12} strokeWidth={2.2} /> changed on the board
                </span>
              ) : null}
              <button className="btn-primary" onClick={() => applyDraft(selectedSceneId)}>
                Apply
              </button>
              <button onClick={() => discardDraft(selectedSceneId)}>Discard</button>
            </>
          ) : null}
          <button
            className={liveUpdates ? "btn-active" : ""}
            title={
              liveUpdates
                ? "Edits reach the board (and players, if this scene is live) instantly"
                : "Edits are staged locally until you Apply"
            }
            onClick={() => setLiveUpdates(!liveUpdates)}
          >
            {liveUpdates ? "Live updates: on" : "Live updates: off"}
          </button>
          {(() => {
            const serverScene = state.scenes.find((scene) => scene.id === selectedSceneId);
            const isLiveScene = selectedSceneId === state.activeSceneId;
            if (!serverScene) return null;
            return (
              <button
                className={serverScene.playerVisible && !isLiveScene ? "btn-active" : ""}
                disabled={isLiveScene}
                title={
                  isLiveScene
                    ? "Players always see the live scene"
                    : serverScene.playerVisible
                      ? "Players can view this scene alongside the live one — click to close it"
                      : "Hidden from players — click to let them view it alongside the live scene"
                }
                onClick={() => dm.setScenePlayerVisible(serverScene.id, !serverScene.playerVisible)}
              >
                {serverScene.playerVisible || isLiveScene ? (
                  <Eye size={12} strokeWidth={2.2} />
                ) : (
                  <EyeOff size={12} strokeWidth={2.2} />
                )}{" "}
                {isLiveScene ? "Visible (live)" : serverScene.playerVisible ? "Open to players" : "Players can't view"}
              </button>
            );
          })()}
          <button
            className="btn-primary"
            disabled={selectedSceneId === state.activeSceneId && !dirty}
            title="Apply any staged changes and make this the scene everyone plays on"
            onClick={setLive}
          >
            {selectedSceneId === state.activeSceneId ? "● Live" : "Set Live on Board"}
          </button>
        </span>
      </div>

      <div className="scene-editor-body">
        {/* Layout B: left roster for actors/items */}
        {panelLayout === "roster" ? (
          <>
            <aside className="scene-editor-roster" style={{ width: rosterW }}>
              <div className="scene-inspector-tabs">
                <button
                  className={rosterTab === "actors" ? "btn-active" : ""}
                  onClick={() => setRosterTab("actors")}
                >
                  Actors
                </button>
                <button
                  className={rosterTab === "items" ? "btn-active" : ""}
                  onClick={() => setRosterTab("items")}
                >
                  Items
                </button>
              </div>
              <div className="scene-inspector-body scene-inspector-body--dir">
                {rosterTab === "actors" ? actorsPanelEl : itemsPanelEl}
              </div>
            </aside>
            <div
              className="page-resize"
              title="Drag to resize"
              onPointerDown={onRosterHandleDown}
              onPointerMove={onRosterHandleMove}
              onPointerUp={onRosterHandleUp}
              onPointerCancel={onRosterHandleUp}
            />
          </>
        ) : null}

        <div className="scene-editor-canvas" ref={canvasBoxRef}>
          {active && shownScene ? (
            <MapCanvas
              state={editorState}
              sceneId={selectedSceneId}
              isDm
              yourPlayerId={room.yourPlayerId}
              viewport={viewport}
              onViewportChange={setViewport}
              onMoveToken={(tokenId, x, y, facing) => room.send({ type: "MOVE_TOKEN", tokenId, x, y, ...(facing !== undefined ? { facing } : {}) })}
              send={historyEditorSend}
              subscribeMeasure={room.subscribeMeasure}
              subscribeTemplate={room.subscribeTemplate}
              subscribeTokenDrag={room.subscribeTokenDrag}
              showLiveDrags={false}
              snap={ctx.snap}
              onToggleSnap={ctx.toggleSnap}
              history={history}
              embedded
            />
          ) : null}
        </div>

        {/* Inspector resize handle */}
        <div
          className="page-resize"
          title="Drag to resize"
          onPointerDown={onInspectorHandleDown}
          onPointerMove={onInspectorHandleMove}
          onPointerUp={onInspectorHandleUp}
          onPointerCancel={onInspectorHandleUp}
        />

        <aside className="scene-editor-inspector" style={{ width: inspectorW }}>
          {panelLayout === "tabs" ? (
            <>
              <div className="scene-inspector-tabs">
                <button
                  className={inspectorTab === "scene" ? "btn-active" : ""}
                  onClick={() => setInspectorTab("scene")}
                >
                  Scene
                </button>
                <button
                  className={inspectorTab === "actors" ? "btn-active" : ""}
                  onClick={() => setInspectorTab("actors")}
                >
                  Actors
                </button>
                <button
                  className={inspectorTab === "items" ? "btn-active" : ""}
                  onClick={() => setInspectorTab("items")}
                >
                  Items
                </button>
                {layoutToggle}
              </div>
              <div className={`scene-inspector-body${inspectorTab !== "scene" ? " scene-inspector-body--dir" : ""}`}>
                {inspectorTab === "scene" ? sceneSettingsEl : null}
                {inspectorTab === "actors" ? actorsPanelEl : null}
                {inspectorTab === "items" ? itemsPanelEl : null}
              </div>
            </>
          ) : (
            <>
              <div className="scene-inspector-tabs">
                <span style={{ flex: 1, fontWeight: 700, fontSize: "0.78rem" }}>Scene Settings</span>
                {layoutToggle}
              </div>
              <div className="scene-inspector-body">
                {sceneSettingsEl}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
