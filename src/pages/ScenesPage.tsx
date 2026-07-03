import { ScenePanel } from "../components/ScenePanel";
import { PageShell } from "./PageShell";
import type { PanelContext } from "../panels/registry";

/// <summary>
/// DM-only Scenes page: the roomier scene manager — the full ScenePanel
/// (list, settings, calibration, fog) beside a large preview of the active
/// scene's map. Phase 7 grows this into the detailed prep editor that edits
/// the *selected* (not active) scene.
/// </summary>
export function ScenesPage({ ctx }: { ctx: PanelContext }) {
  const { state, dm } = ctx;
  const active =
    state.scenes.find((scene) => scene.id === state.activeSceneId) ?? state.scenes[0] ?? null;

  return (
    <PageShell roster={<ScenePanel state={state} dm={dm} />}>
      {active ? (
        <div className="scene-preview">
          <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
            <span className="section-title" style={{ margin: 0 }}>
              {active.name} — active scene
            </span>
            <span className="muted">
              {active.mapUrl
                ? `${active.width}×${active.height}px · ${active.gridSize}px grid · ${active.feetPerSquare}ft/square`
                : "No map image"}
            </span>
          </div>
          {active.mapUrl ? (
            <img src={active.mapUrl} alt={active.name} />
          ) : (
            <div className="page-empty muted">
              Upload a map image in the scene settings to see it here.
            </div>
          )}
        </div>
      ) : (
        <div className="page-empty muted">No scenes yet.</div>
      )}
    </PageShell>
  );
}
