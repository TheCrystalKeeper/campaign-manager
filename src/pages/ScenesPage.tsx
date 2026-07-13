import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { MapCanvas } from "../components/MapCanvas";
import { SceneSettings } from "../components/SceneSettings";
import { PageSwitcher, type PageId } from "./PageSwitcher";
import { readCampaignFlag, writeCampaignFlag } from "../lib/campaignStore";
import { applySceneMessage, sceneMessageSceneId } from "../lib/sceneMessages";
import { buildInverse, useHistory } from "../lib/history";
import { createEmptyScene, fitViewportToScene } from "../lib/sceneUtils";
import {
  DEFAULT_VIEWPORT,
  TOKEN_ENEMY_COLOR,
  type Annotation,
  type ClientMessage,
  type GameState,
  type Scene,
  type Viewport,
} from "../lib/types";
import type { GameRoom } from "../hooks/useGameRoom";
import type { PanelContext } from "../panels/registry";

const LIVE_KEY = "cm-scene-editor-live";

/** Ephemeral annotations (pointer arrows, fading player strokes) never belong in a draft. */
function stripEphemeral(scene: Scene): Scene {
  return { ...scene, annotations: scene.annotations.filter((a: Annotation) => !a.ephemeral) };
}

type Draft = { scene: Scene; baselineJson: string };

/// <summary>
/// DM-only Scenes page: the full scene EDITOR. Top tabs pick the scene being
/// edited (independent of the board's live scene); the main area is a second,
/// embedded MapCanvas with its own local viewport and the full tool set; the
/// right inspector holds the scene settings. "Live updates" ON = edits ride the
/// normal room messages instantly. OFF = edits stage into a local per-scene
/// draft (via the pure applySceneMessage reducer) until Apply pushes the whole
/// scene in one UPDATE_SCENE. "Set Live on Board" applies any dirty draft, then
/// switches the table to this scene.
/// </summary>
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
  // Undo/redo for scene-editor edits (independent of the board's history).
  const history = useHistory();

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

  // Fit the editor viewport when the edited scene changes (only while visible,
  // so the box has a real size to measure).
  useEffect(() => {
    if (!active || !serverScene || fittedSceneRef.current === selectedSceneId) {
      return;
    }
    const box = canvasBoxRef.current?.getBoundingClientRect();
    if (!box || box.width < 10 || box.height < 10) {
      return;
    }
    fittedSceneRef.current = selectedSceneId;
    setViewport(fitViewportToScene(serverScene, box.width, box.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selectedSceneId, serverScene?.id]);

  /** The state MapCanvas sees: the draft substituted in while staging. */
  const editorState = useMemo(() => {
    if (liveUpdates || !draft) {
      return state;
    }
    return {
      ...state,
      scenes: state.scenes.map((scene) => (scene.id === selectedSceneId ? draft.scene : scene)),
    };
  }, [state, liveUpdates, draft, selectedSceneId]);

  /**
   * The editor's send: live → straight to the room. Staging → scene-shape
   * messages for the edited scene fold into the draft; everything transient
   * (MEASURE, ephemeral pointer arrows) still goes live.
   */
  const editorSend = useCallback(
    (msg: ClientMessage) => {
      if (liveUpdates) {
        room.send(msg);
        return;
      }
      const targetId = sceneMessageSceneId(msg);
      const isEphemeralArrow =
        msg.type === "ADD_ANNOTATION" && (msg.annotation.ephemeral || msg.annotation.kind === "arrow");
      if (targetId !== selectedSceneId || isEphemeralArrow) {
        room.send(msg);
        return;
      }
      setDrafts((current) => {
        const existing = current[selectedSceneId];
        const server = state.scenes.find((scene) => scene.id === selectedSceneId);
        const base = existing?.scene ?? (server ? stripEphemeral(server) : null);
        if (!base) {
          return current;
        }
        const next = applySceneMessage(base, msg);
        if (next === base && existing) {
          return current;
        }
        return {
          ...current,
          [selectedSceneId]: {
            scene: next,
            baselineJson:
              existing?.baselineJson ?? JSON.stringify(server ? stripEphemeral(server) : base),
          },
        };
      });
    },
    [liveUpdates, room, selectedSceneId, state.scenes],
  );

  // `editorSend` wrapped to record undo/redo, mirroring App's board history: build the inverse from
  // the state the editor currently sees (draft while staging, else live), record it, then forward.
  // Undo/redo replay through the raw `editorSend`, so they re-fold into the draft or hit the room
  // exactly like the original edit.
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;
  const recordEdit = history.record;
  const resetHistory = history.reset;
  const historyEditorSend = useCallback(
    (msg: ClientMessage) => {
      const inverse = buildInverse(editorStateRef.current, msg);
      if (inverse) {
        recordEdit({ send: editorSend, undo: inverse.undo, redo: inverse.redo });
      }
      editorSend(msg);
    },
    [editorSend, recordEdit],
  );
  // A fresh editing context (different scene, or toggling live/staged) starts with a clean stack.
  useEffect(() => {
    resetHistory();
  }, [selectedSceneId, liveUpdates, resetHistory]);
  // Ctrl+Z / Ctrl+Shift+Z (+ Ctrl+Y) undo/redo while the Scenes page is visible.
  const { undo: historyUndo, redo: historyRedo } = history;
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const t = event.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) historyRedo();
        else historyUndo();
      } else if (key === "y") {
        event.preventDefault();
        historyRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, historyUndo, historyRedo]);

  const applyDraft = useCallback(
    (sceneId: string) => {
      const pending = drafts[sceneId];
      if (pending) {
        room.send({ type: "UPDATE_SCENE", scene: stripEphemeral(pending.scene) });
        setDrafts((current) => {
          const next = { ...current };
          delete next[sceneId];
          return next;
        });
      }
    },
    [drafts, room],
  );

  const discardDraft = (sceneId: string) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[sceneId];
      return next;
    });

  const setLiveUpdates = (on: boolean) => {
    if (on) {
      // Turning live back on pushes every staged draft first — nothing silently lost.
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
    if (selectedSceneId !== state.activeSceneId) {
      dm.setScene(selectedSceneId);
    }
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

  const shownScene = editorState.scenes.find((scene) => scene.id === selectedSceneId) ?? null;

  return (
    <div className="scene-editor">
      <div className="chip-tabs scene-tabs">
        <PageSwitcher active={activePage} onSelect={onNavigate} className="page-switcher--inline" />
        <span className="page-topbar-sep" aria-hidden />
        {state.scenes.map((scene) => {
          const isLive = scene.id === state.activeSceneId;
          const isSelected = scene.id === selectedSceneId;
          return (
            <button
              key={scene.id}
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

        <aside className="scene-editor-inspector">
          {shownScene ? (
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
                // Always-live (bypasses staging by design — it also moves the scene's
                // TOKENS, which drafts can't hold). Disabled while a draft is dirty:
                // applying pre-rotation staged geometry afterwards would desync it.
                onRotate={() => historyEditorSend({ type: "ROTATE_SCENE", sceneId: shownScene.id })}
                rotateDisabled={dirty}
              />
              <StageActors state={state} scene={shownScene} room={room} />
              <button
                className="btn-danger"
                disabled={state.scenes.length <= 1}
                title="Remove this scene (tokens on it are removed too)"
                onClick={removeScene}
              >
                Delete scene
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/// <summary>
/// Pre-staging (Phase 7): drop actors onto the SELECTED scene ahead of time. Because
/// players only ever receive the ACTIVE scene's tokens (redactStateFor), tokens staged on
/// a non-active scene stay invisible until the DM sets it live — so an encounter can be
/// laid out in advance. Tokens land near the scene center; nudge them on the editor canvas.
/// </summary>
function StageActors({ state, scene, room }: { state: GameState; scene: Scene; room: GameRoom }) {
  const actors = Object.values(state.sheets);
  const stagedCount = state.tokens.filter((token) => token.sceneId === scene.id).length;
  const stage = (sheetId: string) => {
    const record = state.sheets[sheetId];
    if (!record) return;
    const isPc = record.kind === "pc";
    const jitter = () => (Math.random() - 0.5) * scene.gridSize * 3;
    room.send({
      type: "ADD_TOKEN",
      token: {
        id: `token-${crypto.randomUUID().slice(0, 8)}`,
        sceneId: scene.id,
        x: scene.width / 2 + jitter(),
        y: scene.height / 2 + jitter(),
        label: record.data.characterName || "Token",
        color: TOKEN_ENEMY_COLOR,
        kind: isPc ? "player" : "enemy",
        imageUrl: record.data.iconUrl ?? null,
        ownerPlayerId: isPc ? record.id : null,
        sheetId: isPc ? null : record.id,
        conditions: [],
        showHp: "none",
      },
    });
  };

  return (
    <div className="stage-actors">
      <div className="sheet-section-head">
        <span className="sheet-section-title">Stage actors</span>
        <span className="muted" style={{ fontSize: "0.7rem" }}>{stagedCount} on scene</span>
      </div>
      <p className="muted" style={{ fontSize: "0.72rem", margin: "0 0 0.3rem" }}>
        Staged tokens stay hidden from players until this scene is set live.
      </p>
      <div className="stage-actor-list">
        {actors.length === 0 ? (
          <span className="muted" style={{ fontSize: "0.78rem" }}>No actors yet — create some in Actors/NPCs.</span>
        ) : null}
        {actors.map((record) => (
          <button
            key={record.id}
            className="btn-ghost stage-actor-row"
            title="Add a token for this actor to the selected scene"
            onClick={() => stage(record.id)}
          >
            ＋ {record.data.characterName || (record.kind === "pc" ? "Player" : "NPC")}
          </button>
        ))}
      </div>
    </div>
  );
}
